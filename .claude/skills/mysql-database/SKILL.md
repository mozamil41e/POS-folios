---
name: mysql-database
description: Use for Mizan POS database work - schema design, normalization, relationships, foreign keys, indexes, CHECK constraints, Kysely migrations, query optimization, transactions and row locking, document numbering, data integrity, and backups. Target is MariaDB on Hostinger (MySQL-compatible SQL only); current code is SQLite in src/server/db.ts.
---

# MySQL / MariaDB Database — Mizan POS

Target engine: **MariaDB on Hostinger Business** (the version varies, so check it with `SELECT VERSION();` in phpMyAdmin; expect 10.11 or 11.x). Write SQL in the **portable MySQL/MariaDB subset**. The full target schema is in `docs/DATABASE_AUDIT.md` §11.

## When to use / not use
- **Use:** creating or altering tables, writing migrations, adding indexes or constraints, designing new entities (menu, recipes, sequences), tuning queries, transactions and locking, backup and restore.
- **Don't use for:** business-rule placement (`nodejs-backend`) or hosting setup (`devops`).

## Current state (SQLite, until R3)
- The schema lives in `initDatabase()` (`src/server/db.ts:40-267`), with "migrations" done as `PRAGMA table_info` + `ALTER` (`:269-306`).
- No secondary indexes. Money stored as `REAL`, quantities as `INTEGER`, dates as ISO text in UTC.
- Demo seeds run whenever a table is empty (`:356-459`). In R1 they become dev-only.
- `data/*.db*` is committed to git. R1.7 removes it from tracking.
- **The SQLite file would be wiped on every Hostinger deploy.** MariaDB is mandatory before go-live (R3).
- During R1–R2 keep SQLite changes minimal: new tables or columns only when a task needs them (for example `document_sequences`). Data is demo-only, so recreating the dev DB after a backup is acceptable.

## Design rules
- Engine `InnoDB`, charset `utf8mb4`, collation `utf8mb4_unicode_ci` on every table.
- Primary keys: `BIGINT UNSIGNED AUTO_INCREMENT`. Tables are plural `snake_case`. Bilingual columns use the `_ar`/`_en` suffix.
- Types:

| Kind | Type |
|---|---|
| Money | `DECIMAL(12,2)` |
| Quantity | `DECIMAL(14,3)` |
| Unit cost per base unit | `DECIMAL(14,6)` |
| Tax rate | `DECIMAL(5,2)` |
| Boolean | `TINYINT(1)` |
| Timestamp (UTC) | `DATETIME(3)` |
| Business date (Asia/Riyadh) | `DATE` |
| UUID | `CHAR(36)` |
| JSON | `JSON` (a validated LONGTEXT in MariaDB) |

- Enumerations: `VARCHAR(n)` plus `CHECK (col IN (...))`, not `ENUM`, because it migrates more easily. CHECK constraints are enforced in MariaDB ≥ 10.2.
- Every relationship gets an explicit FK:
  - financial data: `ON DELETE RESTRICT`
  - owned children: `CASCADE`, only for non-financial data such as `recipe_lines` and `role_permissions`
  - optional references: `SET NULL`
- Normalise where it prevents anomalies: `role_permissions` instead of a JSON list, and `purchase_payments` instead of a running `paid_amount` alone.
- **Snapshot on purpose** inside historical documents: line name, price, tax rate and `unit_cost` on `invoice_items`. Never re-derive history from the current catalog.
- Financial documents are **never hard-deleted**. Use `status = 'void'` with `void_reason`, `voided_by`, `voided_at`, or a reversing document.
- Every document and stock movement has `created_by`, and every financial or admin change writes to `audit_logs`.
- **No `tenant_id` in this project.** SaaS is a later project; see the `saas-architecture` skill.
- Avoid non-portable features: `INSERT … RETURNING` (MariaDB-only), MySQL-8-only JSON table functions, `CONVERT_TZ` with named zones (the tz tables may be missing). KSA has no DST, so use the fixed offset `'+03:00'` or compute `business_date` in the application.

## Indexing rules
- Index every FK column, because InnoDB does not do this for you on every engine and version.
- Put composite indexes in this order: **equality columns first, then the range or sort column**. Examples: `(document_type, business_date)`, `(inventory_item_id, created_at)`.
- Don't wrap indexed columns in functions inside `WHERE` (no `DATE(created_at) = ?`). Filter on `business_date` or on a half-open UTC range instead.
- Run `EXPLAIN` on every report query and every list query. Avoid `type: ALL` scans on growing tables.

## Migration recipe (Kysely Migrator)
1. Create the file `server/src/db/migrations/00NN_<verb>_<thing>.ts` with both `up` and `down`.
2. Prefer additive changes: add the column as nullable or with a default, backfill it, then tighten it in a later migration.
3. **A destructive change** (DROP, type narrowing, data rewrite) requires all of the following:
   - a documented backup step
   - a rollback plan
   - an explicit owner approval note in the PR
4. Run `up → down → up` against MariaDB in CI.
5. Migrations run at boot under `SELECT GET_LOCK('mizan_migrations', 30)`. If a migration fails, the app refuses to start.

```ts
import { Kysely, sql } from 'kysely';
export async function up(db: Kysely<any>) {
  await db.schema.createTable('document_sequences')
    .addColumn('doc_type', 'varchar(20)', (c) => c.notNull())
    .addColumn('period_year', 'smallint', (c) => c.notNull().unsigned())
    .addColumn('last_value', 'integer', (c) => c.notNull().unsigned().defaultTo(0))
    .addPrimaryKeyConstraint('pk_document_sequences', ['doc_type', 'period_year'])
    .execute();
}
export async function down(db: Kysely<any>) { await db.schema.dropTable('document_sequences').execute(); }
```

## Transactions, locking, sequences
- The default isolation level (REPEATABLE READ) is fine. Do **read-then-write on stock under `SELECT … FOR UPDATE`**, locking rows in ascending id order to avoid deadlocks. Retry once on deadlock errors (`ER_LOCK_DEADLOCK`, 1213).
- Keep transactions short. No HTTP calls inside them.
- Atomic yearly numbering, inside the same transaction as the document:
```sql
INSERT INTO document_sequences (doc_type, period_year, last_value)
VALUES (?, ?, LAST_INSERT_ID(1))
ON DUPLICATE KEY UPDATE last_value = LAST_INSERT_ID(last_value + 1);
SELECT LAST_INSERT_ID() AS n;   -- read immediately, before any other insert
```
- **Never `SELECT COUNT(*) + 1`.** That is the current bug at `server.ts:568` and `:1188`.

## Query patterns
- Lists: select explicit columns, use `LIMIT/OFFSET` (or keyset pagination for large ledgers), and run a separate `COUNT(*)` only when the UI needs the total.
- Avoid N+1. Fetch children with `WHERE parent_id IN (…)` in one query and group them in code.
- Example report (daily sales):
```sql
SELECT business_date,
       SUM(CASE WHEN document_type = 'invoice' THEN grand_total ELSE -grand_total END) AS net_sales,
       SUM(CASE WHEN document_type = 'invoice' THEN vat_total   ELSE -vat_total   END) AS net_vat,
       SUM(CASE WHEN document_type = 'invoice' THEN cost_total  ELSE -cost_total  END) AS cogs
FROM invoices
WHERE business_date BETWEEN ? AND ?
GROUP BY business_date ORDER BY business_date;
```
- Recipe consumption: join `invoice_items → recipe_lines → inventory_items`, or read the `stock_movements` rows with `movement_type = 'sale'`. The ledger is the source of truth for quantities.

## Data integrity checks (run in tests)
- For every inventory item, `SUM(qty_delta)` over `stock_movements` must equal `inventory_items.stock_qty`.
- For every invoice, the sum of its line totals must equal `grand_total` exactly (after discount allocation).
- Document numbers within `(doc_type, year)` must be unique with no duplicates. Gaps are acceptable when a transaction rolls back.
- Negative tests: CHECK and FK constraints must reject invalid rows.

## Backup & restore
- Hostinger's built-in backups, plus a daily export by a cron script to off-site storage.
- Restore drill: restore the export into a scratch DB, run the integrity checks, and record the time taken (RTO).
- Before any migration in production: export first and confirm the file size and row counts.

## Anti-patterns already in this repo (don't copy them)
- `SELECT *` returned to clients (`db.ts:826`, `:875`).
- `LIMIT 100` lists used as report sources (`db.ts:850-894`).
- An N+1 loop for line items (`db.ts:877-881`).
- `ON DELETE CASCADE` from products onto stock history (`db.ts:104`).
- Free-text references (`related_invoice_number`) instead of FKs.
- A ledger that records the requested delta instead of the applied one (`server.ts:1076-1089`).

## Done checklist
- [ ] The owner approved the impact summary. Destructive changes have a backup, a rollback plan and approval.
- [ ] Types follow the table above. FKs, CHECK constraints and indexes are present, and every FK is indexed.
- [ ] Portable MySQL/MariaDB SQL only. Tested against MariaDB of the same major version as Hostinger.
- [ ] The migration has `up` and `down` and passes `up → down → up` in CI.
- [ ] `EXPLAIN` checked for new list and report queries.
- [ ] Integrity checks pass, and the real results have been reported.
