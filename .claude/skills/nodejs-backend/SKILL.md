---
name: nodejs-backend
description: Use for any Mizan POS server-side work - adding or migrating Express routes, services, repositories, zod validation, auth/session/permission middleware, error handling, transactions, money/VAT math, logging, or backend performance. Also use when touching server.ts or src/server/*.ts in this repo.
---

# Node.js Backend — Mizan POS

Practical rules for building the Express backend described in `docs/ARCHITECTURE.md`. Follow the owner's **approval workflow** (`CLAUDE.md` §2) before any code change.

## When to use / not use
- **Use:** new or changed API endpoints, business rules (checkout, credit notes, purchases, recipes, vouchers), auth, permissions, validation, error handling, DB transactions, server performance, cron scripts.
- **Don't use for:** SQL schema design or migrations (use `mysql-database`), deployment or CI (use `devops`), UI (use `react-frontend`).

## Current state (read before editing)
- `server.ts` holds all 36 routes inline. Validation is `String(b.x ?? '')`, and SQL runs through better-sqlite3 directly.
- `src/server/db.ts` holds the schema, ad-hoc migrations, demo seeds, queries, sessions and scrypt.
- Express 4: **async handlers are not caught** (`server.ts:1736`, `:1771`). An unhandled rejection crashes the process.
- Transitional rule (R1): make **minimal, tested** fixes in place. Don't half-migrate a route to the new structure during R1.
- From R2: move **one domain at a time** into `server/src/modules/<domain>/`. Keep the old path working (alias to the new controller) until the frontend migrates.

## Target module layout
```
server/src/modules/<domain>/
  routes.ts      # router + middleware chain only
  controller.ts  # read validated input, call service, shape response
  service.ts     # business rules, transactions, audit — no req/res, no raw SQL
  repository.ts  # Kysely queries only — returns typed rows/DTO parts
  schemas.ts     # zod input schemas + DTO mappers
  <domain>.test.ts
```

## Recipe: add (or migrate) an endpoint
1. **Permission:** pick or add a key in `shared/permissions.ts` (`<area>.<action>`). Every route, reads included, needs one.
2. **Schema:** define the input with zod in `schemas.ts` (or in `shared/schemas/` if the UI reuses it).
3. **Repository:** add a typed Kysely query. Select explicit columns, never `selectAll()` into a response.
4. **Service:** implement the rule. Wrap multi-table writes in a transaction, take document numbers from `nextDocumentNumber(trx, type)`, and call `recordAudit(trx, …)`.
5. **Controller + route:** chain `requirePermission(key)` → `validate({ body })` → controller. Return `ok(res, dto)` or `created(res, dto)`.
6. **Tests:** cover the happy path, validation failure (422), forbidden for a role without the key (403), and the business errors (409).
7. **OpenAPI:** register the schema so `docs/api/` stays current.

### Templates
```ts
// schemas.ts
import { z } from 'zod';
export const createVoucherSchema = z.object({
  voucher_type: z.enum(['receipt', 'payment']),
  payment_channel: z.enum(['cash', 'bank']),
  party_name: z.string().trim().min(1).max(150),
  category: z.string().trim().max(80).default(''),
  amount: z.coerce.number().positive().max(10_000_000),
  notes: z.string().trim().max(500).default(''),
  voucher_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type CreateVoucherInput = z.infer<typeof createVoucherSchema>;
```
```ts
// service.ts
export async function createVoucher(input: CreateVoucherInput, actor: AuthUser) {
  return db.transaction().execute(async (trx) => {
    const number = await nextDocumentNumber(trx, input.voucher_type === 'receipt' ? 'RCV' : 'PAY');
    const id = await vouchersRepo.insert(trx, { ...input, document_number: number, created_by: actor.id });
    await recordAudit(trx, { actor, action: 'voucher.create', entityType: 'voucher', entityId: id, after: input });
    return vouchersRepo.findDtoById(trx, id);
  });
}
```
```ts
// routes.ts
router.post('/', requirePermission('vouchers.manage'), validate({ body: createVoucherSchema }),
  async (req, res) => created(res, await createVoucher(req.validated.body, res.locals.authUser)));
```

## Errors
- Throw `AppError` subclasses (`NotFound`, `Forbidden`, `Conflict('INSUFFICIENT_STOCK', …)`, `Invalid(details)`). Never call `res.status(...).json({error: 'text'})` ad hoc in new code.
- One `errorHandler` maps an `AppError` to `{ error: { code, message, details } }`. Anything else becomes a `500 INTERNAL`, with the full error logged through pino and **never** sent to the client.
- Error codes are stable `UPPER_SNAKE` strings. The client translates them, so don't send Arabic or English UI text from the server.
- **Express 5:** async errors propagate automatically. Until the upgrade (R2.1), wrap async handlers with `asyncHandler`.
- Express 5 gotchas:
  - `req.query` is read-only, so store parsed input in `req.validated`.
  - Wildcards must be named, so the SPA fallback `app.get('*')` becomes `app.get('/{*splat}')`.

## Validation middleware
```ts
export const validate = (s: { body?: ZodTypeAny; query?: ZodTypeAny; params?: ZodTypeAny }) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const out: Record<string, unknown> = {};
    for (const key of ['body', 'query', 'params'] as const) {
      const schema = s[key]; if (!schema) continue;
      const r = schema.safeParse(req[key]);
      if (!r.success) return next(Invalid(r.error.flatten()));
      out[key] = r.data;
    }
    (req as any).validated = out; next();
  };
```

## Auth, sessions, permissions
- `requireAuth`:
  - reads the `sid` cookie (or the legacy Bearer header until R4.3);
  - hashes it with SHA-256 and looks up `user_sessions` joined to an active user;
  - extends the sliding expiry;
  - sets `res.locals.authUser`.
- `requirePermission(key)` checks `authUser.permissions.includes(key)`. The `admin` role always gets every key (as `db.ts` does today).
- CSRF: on non-GET requests, check that `Origin` matches the configured app origin **and** that the `X-CSRF-Token` header equals the CSRF cookie.
- Passwords: `await scryptAsync(pw, salt, 64)`, compared with `timingSafeEqual`. Never use `scryptSync`, because it blocks the event loop (`db.ts:985`).
- Login: rate limit per IP in memory (single process), record each attempt in `login_attempts`, lock out after 5 failures in 15 minutes, and always reply with the same generic message.
- There is no self-registration. `POST /auth/setup` only works when the users table is empty **and** `SETUP_TOKEN` matches.

## Transactions & concurrency
- Every multi-table write goes inside `db.transaction().execute(async (trx) => …)`, and the service passes `trx` to the repositories.
- With MariaDB, requests interleave. Lock stock before reading balances:
```ts
const items = await trx.selectFrom('inventory_items')
  .select(['id', 'stock_qty', 'avg_cost'])
  .where('id', 'in', ids).orderBy('id').forUpdate().execute();
```
- Lock rows in **ascending id order**. Keep transactions short: no network calls or heavy CPU inside them.
- Document numbers come from `document_sequences` in the same transaction. **Never `COUNT(*)+1`** (current bug at `server.ts:568`, `:1188`).
- Checkout accepts an `Idempotency-Key`. Store it on the invoice with a unique index. If the key repeats, return the existing invoice.

## Money & VAT (server is authoritative)
- Compute through `shared/money.ts` in integer halalas, with one rounding rule (half-up, 2 decimals). mysql2 returns DECIMAL as **strings**, so convert them with the money helpers.
- Prices that include VAT (proposed restaurant default): `vat = round(gross * rate / (100 + rate))`, `net = gross - vat`.
- Prices that exclude VAT: `vat = round(net * rate / 100)`.
- Discounts: allocate the document discount **proportionally to the lines before line VAT**, and put the rounding remainder on the largest line, so that the line totals add up exactly to the document total.
- Never trust client totals, `cash_amount`, document type, `unit_cost`, numbers or tax category. Recompute everything from the DB.
- Store a cost snapshot on every sold line (`invoice_items.unit_cost`, from the recipe × `avg_cost`).

## Performance
- No N+1 queries: fetch child rows with `where('invoice_id', 'in', ids)` or a join (current N+1 at `db.ts:850-882`).
- Paginate every list (`page`, `pageSize` ≤ 100). Never return all rows, and never ship `xml_content`-sized fields in lists.
- Reports are SQL aggregations on `business_date` with indexes. No in-memory aggregation of whole tables.
- Each request must finish well under Hostinger's 120 s limit. Anything long becomes a cron script.

## Logging
- Use pino with a `requestId`. Log `{ userId, route, status, ms }` per request.
- Never log passwords, tokens, cookies or full request bodies on auth routes.

## Hostinger reminders
- Listen on `process.env.PORT`.
- Don't write to local disk.
- No timers (`setInterval`) for business jobs, no sockets, no workers. Periodic jobs go in `server/scripts/*.ts`, run by hPanel cron.

## Anti-patterns already in this repo (don't copy them)
- `SELECT *` sent to the client, which leaks secrets (`db.ts:826`, `server.ts:237`).
- Read endpoints without a permission check (`/api/bootstrap`).
- Trusting `invoice_type_code` from the client (`server.ts:1458`).
- Hard-deleting financial rows (`server.ts:606`).
- A write route that returns every list (`server.ts:1722-1728`).
- Duplicated checkout and credit-note blocks (`server.ts:1452-1733` vs `1771-1972`). Share one service.
- Demo seeds running in production (`db.ts:356-459`).

## Done checklist
- [ ] The owner approved the impact summary.
- [ ] The route has a permission, a zod schema and a DTO response, with no `SELECT *` leak.
- [ ] Business logic lives in the service; the controller stays thin; SQL stays in the repository.
- [ ] Multi-table writes are transactional, numbers come from sequences, and an audit row is recorded.
- [ ] Money goes through `shared/money`, and the server recomputes everything.
- [ ] Tests cover the happy path plus 422, 403 and 409. Characterization tests are still green.
- [ ] No new Hostinger-incompatible behaviour (disk, timers, sockets).
- [ ] The real test output has been reported.
