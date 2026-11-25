# CLAUDE.md — Mizan POS Engineering Guide

Main engineering reference for this repository. Read it before changing anything. It reflects decisions confirmed by the project owner on 2026-11-24.

Detailed analysis lives in `docs/`:
- [PROJECT_ANALYSIS](docs/PROJECT_ANALYSIS.md)
- [ARCHITECTURE](docs/ARCHITECTURE.md)
- [DATABASE_AUDIT](docs/DATABASE_AUDIT.md)
- [SECURITY_AUDIT](docs/SECURITY_AUDIT.md)
- [REFACTORING_ROADMAP](docs/REFACTORING_ROADMAP.md)
- [SAAS_ARCHITECTURE](docs/SAAS_ARCHITECTURE.md) (future phase)

The docs are in Arabic with English technical terms. Reply to the owner in Arabic.

---

## 1. Project Overview

**Mizan POS** is a bilingual (Arabic RTL / English) point-of-sale and back-office system: sales, receipts, credit notes, inventory, purchasing, cash vouchers, reports, users and roles. It was generated from a Google AI Studio template as a **retail/supermarket POS with a ZATCA e-invoicing simulator**. It is now being refactored into a product for **one restaurant**.

### Confirmed scope

| In scope | Out of scope for this project |
|---|---|
| A single restaurant, one deployment | Multi-tenant SaaS, plans, billing. These are a **separate project after delivery** |
| Recipe-based inventory: selling a dish deducts its ingredients | Tables, kitchen tickets/KDS, item modifiers |
| Receipt QR = **link to the public invoice page** (D1/D8); a 5-field ZATCA Phase-1 TLV QR may be added later if the accountant confirms it (D7) | **Any ZATCA integration**: CSID, signing, UBL XML, ICV/PIH, dispatch, ZATCA settings (removed in R1.4) |
| Hostinger Business shared hosting with MariaDB | Docker or containers in production, Redis, WebSockets, background workers |

The existing data is **demo only**. The database may be reset, after a backup.

---

## 2. Mandatory Workflow (owner's rule, applies to every code change)

1. **Review** the requirement against the current architecture and code.
2. **List the impact**: files, functions, routes and tables affected.
3. **Present a clear summary** of the proposed changes, risks and test plan.
4. **Wait for explicit approval.** Approving one task does not approve the next one.
5. **Implement** on a feature branch, in small reviewable steps.
6. **Verify with tests** and report the real results, failures included.
7. **Write a short report**: what was done and what remains. Each roadmap phase ends with `docs/reports/RX-report.md`.

Never run destructive DB migrations, delete features, rewrite git history, force-push or commit without explicit approval.

---

## 3. Technology Stack

Kysely (D3) and TanStack Query (D4) are **proposed** and still awaiting the owner's approval; see the decision list in REFACTORING_ROADMAP §13.

| Layer | Current | Target (see ARCHITECTURE) |
|---|---|---|
| Language | TypeScript ^7 with `"strict": true` set explicitly (R1.11); 0 errors | Keep 0 errors |
| Frontend | React 19, Vite 8, Tailwind 4, lucide-react, qrcode | + React Router, TanStack Query, shared UI kit, typed i18n |
| Backend | Express ^5 (R2.1): `server/src/app.ts` (`createApp`), `main.ts` (entry), routes still in `server/src/legacy/routes.ts` | Express 5 modular monolith (`server/src/modules/*`) |
| Validation | Manual `String(b.x ?? '')` checks | zod schemas in `shared/schemas` |
| Data access | Legacy routes: better-sqlite3 (sync), inline SQL. New modules (R2.3): Kysely 0.29 (`server/src/db/kysely.ts`) on the same connection, table types in `server/src/db/schema.ts`, writes through `withTransaction()` (`server/src/db/transaction.ts`) | Kysely on **MariaDB via mysql2** (R3) |
| Database | SQLite file in `./data` | **MariaDB** (Hostinger; MySQL-compatible SQL only) |
| Auth | Bearer token held in React state | httpOnly cookie session + CSRF |
| Logging | pino JSON on stdout, one line per API request with `X-Request-Id`, credentials redacted (R2.1) | + optional Sentry |
| Tests | Vitest: API tests with Supertest (`tests/api`, temp SQLite per file) and UI tests with Testing Library + jsdom (`tests/ui/*.test.tsx`); CI on Node 22/24 | + MariaDB integration tests, Playwright E2E |
| Package manager | npm + `package-lock.json`, package `mizan-pos`, `engines.node >= 22`. Build tools (vite and its plugins) stay in `dependencies` because Hostinger builds on the server; CI runs `npm audit --omit=dev --audit-level=high` (R1.11) | — |

---

## 4. Commands (current)

```bash
npm install          # node_modules is not committed
npm run dev          # tsx server/src/main.ts — Express + Vite middleware on http://localhost:3000
npm run build        # vite build + esbuild bundle server/src/main.ts -> server.js (Hostinger's entry file)
npm start            # node server.js (production mode, serves dist/)
npm run lint         # oxlint (typescript-eslint does not support TS 7 yet)
npm run typecheck    # tsc --noEmit
npm test             # Vitest: tests/api (Node) + tests/ui (jsdom, opted in per file)
npm run admin:create # create an admin from the command line
npm run seed:dev     # load demo data into an EMPTY development DB (refuses in production)
```

Production always starts empty (R1.7): no demo products, customers or invoices, only the 4 default roles and a neutral settings row.

---

## 5. Current Architecture (AS-IS)

Do not assume that the target structure exists yet.

- `server/src/` (R2.1): `main.ts` validates the environment (`config/env.ts`, zod; production refuses to start without `SETUP_TOKEN`), then serves Vite (dev) or `dist/` (production). `app.ts` builds the app: request id, request log, helmet, JSON body, the routes, and the central error handler (`AppError` from `shared/errors.ts` keeps its status and code; anything else is logged and answered 500 `INTERNAL` with the request id).
- `server/src/modules/inventory/` (R2.4a, the first module and the pattern for the others):
  - `routes.ts`: products, stock movements, categories, CSV import. Mounted before the legacy router; each route calls `requireAuth()` + `requirePermission()` from `server/src/middleware/auth.ts`.
  - `service.ts` and `import.ts`: the rules. Writes go through `withTransaction`.
  - `repository.ts`: Kysely, the only place with SQL.
  - Validation: the zod rules in `shared/schemas/` (`common.ts`, `inventory.ts`, `product-import.ts`), whose failures carry `{ field, reason }` codes.
  - `shared/csv.ts`: reads and writes CSV.
- `server/src/modules/auth/` (R2.4b): first-run setup, sign-in, `me`, sign-out (same paths and responses as before). It owns sessions (`repository.ts`: 24 h, only the SHA-256 of the token is stored), password hashing (`passwords.ts`: async scrypt, `salt:hash`; hash before `withTransaction`, never inside) and the per-email lockout (`lockout.ts`). `requireAuth()` reads sessions through it; the legacy users routes and `scripts/create-admin.ts` call its `hashPassword`, `revokeAllSessionsForUser`, `clearLoginFailures` and `resolveAuthUserById`. Input rules: `shared/schemas/auth.ts` (also for the users module). A 429 is thrown as `TooManyRequestsError` (the error handler sets `Retry-After`).
- `server/src/modules/users/` (R2.4b): users and roles (`/api/users`, `/api/roles`, all `users.manage`). Rules in `shared/schemas/users.ts`; the phone rule (`phoneField` in `shared/schemas/common.ts`) is the customers/suppliers one. Checks that the password hashing could invalidate (duplicate email, last user administrator) run again inside the transaction. Deleting a user is still a hard delete (owner, 2026-11-25; revisit in R3 with `created_by`). `/api/bootstrap` and `scripts/create-admin.ts` read users and roles through it.
- `server/src/modules/settings/` (R2.4b): `PUT /api/settings` (`settings.manage`); rules in `shared/schemas/settings.ts` (length limits, choices refused with `INVALID_CHOICE`, public link normalised). It reads named columns, never `SELECT *`. `/api/bootstrap` uses it; checkout, credit note and the public invoice still call `getOrganizationSettings()` in `src/server/db.ts` until their modules move. Modules turn a failed parse into a 400 with `valueOrThrow` (`server/src/shared/validation.ts`).
- `server/src/modules/customers/` and `server/src/modules/suppliers/` (R2.4b): `POST/PUT /api/customers` (`customers.manage`) and `POST/PUT /api/suppliers` (`purchases.manage`); shared rules in `shared/schemas/parties.ts` (the R1.10 rules; a VAT number may repeat, owner's decision). Neither is ever deleted. The checkout still reads a customer inline until the sales module moves.
- `server/src/modules/purchases/` (R2.4b): `POST /api/purchases` and `POST /api/purchases/:id/pay` (`purchases.manage`); rules in `shared/schemas/purchases.ts` (whole quantities, VAT 15 or 0, status of a partial payment from the amount). One transaction per purchase: the number from `nextDocumentNumber(trx, ...)` in `server/src/db/sequences.ts` (the modules' version of `src/server/sequences.ts`, same table), the lines, and the stock through `receiveStock()` of the inventory module, which re-reads the balance per line. Never write stock or movements outside the inventory module.
- `server/src/legacy/routes.ts`: every other API route, as in the old `server.ts` (validation, business logic and SQL inline). R2.4b moves them domain by domain into `server/src/modules/<domain>`.
- `src/server/db.ts`: schema creation, ad-hoc `ALTER` "migrations", queries (sessions, password hashing, and the users and roles queries moved to the auth and users modules in R2.4b; the default roles are still created here until R3). Demo data lives in `src/server/demo-data.ts`; only `npm run seed:dev` and the tests load it (R1.7).
- ZATCA was removed in R1.4 (`zatca.ts`, the ZATCA screen, routes, permission and DB columns). `removeZatcaSchema()` in `src/server/db.ts` upgrades older databases (automatic backup first).
- `src/App.tsx` (1,221 lines): global `data` state loaded from `/api/bootstrap`, plus 25 copy-pasted fetch handlers, plus manual section switching (there is no router).
- `src/components/*View.tsx`: god components. `ReportsCenterView` is 3,206 lines and computes 25 reports in the browser.
- Shared between client and server (R2.2): `shared/` holds `types.ts`, `permissions.ts`, `validation.ts`, `money.ts` (`roundMoney`, `vatOf`, `lineAmounts`, `sumMoney`, `splitVatInclusive`) and `constants.ts`. Every stored or displayed total is computed with `roundMoney` (half away from zero, float-safe); `Number(x.toFixed(2))` is no longer used for amounts. The UI imports them without the `.ts` extension, the server with it.
- Data flow:
  1. login
  2. the token is kept in memory
  3. `GET /api/bootstrap` returns every list the role may read (scoped since R1.3)
  4. every mutation returns full replacement lists
  5. `setData` merges them

**Known critical issues** (fix before any production use; see docs):
- open registration (fixed in R1.2, deployed; first-run setup needs `SETUP_TOKEN` in production)
- read permissions and secrets in responses (fixed in R1.3 on branch `r1/read-permissions`): all workspace responses go through `scopeForUser` (`src/server/visibility.ts`), using the rules in `src/permissions.ts`
- reports computed from `LIMIT 100` data
- SQLite would be wiped on every Hostinger deploy
- a failed checkout clears the cart (fixed in R1.6 on branch `r1/ui-safety`): every `App.tsx` mutation goes through `callApi` and returns `boolean` (or the new id, 0 on failure); screens clear carts, forms and modals only after success
- UI buttons follow permissions (R1.6): screens receive `currentUser` and use `hasPermission` with the same key as the route. This only avoids dead ends; the server's `requirePermission` is the real check
- Product categories (R1.11c) live in the `categories` table; `products.category_id` points to it and `category_ar`/`category_en` are a display copy kept in sync on rename (drop them in the MariaDB schema, R3). A category with active products cannot be deleted. Never write category text without going through `resolveProductCategory` / `findOrCreateCategory`.

---

## 6. Project Structure (TARGET)

```
server/src/{app.ts, main.ts, config/, db/{migrations,seeds}, shared/, modules/<domain>/}
  module = routes.ts · controller.ts · service.ts · repository.ts · schemas.ts · *.test.ts
server/scripts/            # cron jobs: cleanup, backup export
web/{app/, api/, features/<feature>/{pages,components,hooks,api.ts}, ui/, i18n/, lib/}
shared/{types.ts, permissions.ts, money.ts, constants.ts, schemas/}
e2e/                       # Playwright
docs/                      # analysis, architecture, roadmap, phase reports
```

- Domains: auth, users, roles, settings, customers, suppliers, menu, inventory, recipes, purchases, sales, vouchers, reports, receipts, public-invoice.
- Import rules: `web` must not import `server`, and vice versa. Both may import `shared`. There is one npm package and no monorepo tooling.

---

## 7. Hosting Constraints (Hostinger Business)

These facts come from Hostinger's support pages. Design around them:

- **The app folder `hbuilds/` is overwritten on every deploy.** Never persist files on local disk: no SQLite, no uploads, no generated files.
- The database is **MariaDB**. The version varies, so check with `SELECT VERSION()` in phpMyAdmin. Write MySQL-compatible SQL. Avoid `INSERT … RETURNING` and other dialect-specific features.
- **No inbound WebSockets, no background workers, no endless timers, no custom ports, no Docker, no Redis.**
- Each request is cut off after **120 s**. Keep every request short and do reporting work in SQL.
- Periodic work runs as **hPanel cron jobs**: small `node` scripts, UTC schedule, at most 30 minutes each.
- GitHub auto-deploy from **`main`** (confirmed from the build log on 2026-11-24): **every push to `main` is a production deploy**.
  - Hostinger runs Node 22, `npm install` (npm 10, devDependencies included), then `npm run build`. Entry file: `server.js`. Application type: Express.
  - If `npm install` fails, Hostinger retries with `--legacy-peer-deps`.
  - Env vars are managed in hPanel (`SETUP_TOKEN` is set). There is no `.env` file. Optional: `TRUST_PROXY` (R1.9; unset = one proxy hop in production).
- Resources: 2 CPU, 3 GB RAM, NPROC 120. A single Node process serves both the SPA and the API (same origin).
- Rate limits (R1.9, `src/server/security.ts`) live in process memory, which works because there is one process. The per-email sign-in lockout is in the DB (`login_attempts`, `server/src/modules/auth/lockout.ts`).
- Verified live on 2026-11-24: with `TRUST_PROXY=1` (the production default) the rate limiter sees the real client IP (IPv4, or the IPv6 /56) and ignores a spoofed `X-Forwarded-For`. Hostinger's CDN (`Server: hcdn`) adds its own `content-security-policy: upgrade-insecure-requests` header next to the app's CSP.
- Still to verify during R8.1: whether SSH is available, the localhost MariaDB connection, and whether `mysqldump` works in cron.

---

## 8. Coding Standards

- TypeScript everywhere, in strict mode (the TS 7 default). `npm run typecheck` must stay at 0 errors. Avoid `as` casts: parse with zod instead. Never use `any` in new code.
- **Business logic lives on the server only**: prices, VAT, discounts, stock, costing, document numbers, reports. The UI may show estimates, but the server is authoritative.
- Money:
  - use the helpers in `shared/money.ts` (one rounding rule: half-up to 2 decimals);
  - never sum floats for stored amounts;
  - store money as DECIMAL.
- Time: store UTC. Compute the **business date in Asia/Riyadh (UTC+3)** with the shared helpers. Never use `toISOString().slice(0,10)` as "today".
- No magic strings for domain values. Use the constants in `shared/constants.ts` (`DOCUMENT_TYPES`, `INVOICE_KINDS`, `PAYMENT_METHODS`, `MOVEMENT_TYPES`).
- No inline `isAr ? '…' : '…'` in new or migrated code. Use the typed i18n dictionary (`useT()`).
- Keep components under about 400 lines. Extract hooks and sub-components, and reuse `web/ui` primitives instead of copying markup (modals, tables, KPI cards).
- Errors: on the server, throw `AppError` subclasses. On the client, the API client throws `ApiError`. Components must only clear forms, carts or modals **after success**.
- Comments explain *why*, especially for financial rules. Don't leave commented-out code.

---

## 9. Naming Conventions

| Item | Convention | Example |
|---|---|---|
| DB tables / columns | `snake_case`, plural tables | `invoice_items.unit_cost` |
| Bilingual fields | `_ar` / `_en` suffix | `name_ar`, `name_en` |
| TS variables / functions | `camelCase` | `nextDocumentNumber` |
| Types / React components | `PascalCase` | `InvoiceDTO`, `ConfirmDialog` |
| Files | components `PascalCase.tsx`; others `kebab-case.ts` or `camelCase.ts`, consistent per folder | `ReceiptTemplate.tsx`, `money.ts` |
| Hooks | `useX` | `useCheckout()` |
| API paths | `/api/v1/<plural-kebab>` | `/api/v1/menu-items/:id` |
| Permission keys | `<area>.<action>` | `inventory.adjust`, `vouchers.void` |
| Error codes | `UPPER_SNAKE` | `INSUFFICIENT_STOCK` |
| Document numbers | `<PREFIX>-<YYYY>-<00000>` | `INV-2027-00042`, `CN-`, `PO-`, `RCV-`, `PAY-` |

---

## 10. Database Conventions

- InnoDB, `utf8mb4` / `utf8mb4_unicode_ci`, primary keys `BIGINT UNSIGNED AUTO_INCREMENT`.
- Column types:
  - money `DECIMAL(12,2)`
  - quantities `DECIMAL(14,3)`
  - unit cost `DECIMAL(14,6)`
  - tax rate `DECIMAL(5,2)`
  - timestamps `DATETIME(3)` in UTC
  - `business_date DATE` on financial documents
- Every relationship gets a FK. Financial records use `ON DELETE RESTRICT`.
- Index every FK and every report filter column. Constrain enumerations with `VARCHAR + CHECK`.
- **Financial documents are never hard-deleted.** Use `status='void'` (with a reason, who, when) or a reversing document (credit note).
- `created_by` on every document and stock movement. `audit_logs` gets every financial or administrative change.
- Document numbers come from `document_sequences`, inside the same transaction. **Never use `COUNT(*)+1`.**
- Multi-table writes run in one transaction. In checkout, lock stock rows with `SELECT … FOR UPDATE` in ascending id order.
- Schema changes go through **versioned Kysely migrations** (`up` and `down`) and run at boot under `GET_LOCK`. A destructive migration requires a documented backup, a rollback plan and approval.
- Seeds are **development only** (`npm run seed:dev`). Production starts empty plus a first-run setup.
- **Do not add `tenant_id`** in this project (SaaS comes later). Do keep all DB access inside repositories.

---

## 11. API Development Guidelines

- Middleware order: `requestId → logger → helmet → json(limit) → requireAuth → csrf → requirePermission(key) → validate(schema) → controller`.
- **Every route declares a permission**, reads included. The UI hiding something is not access control.
- Express 5 (R2.1) passes errors from `async` routes to the error handler by itself: no wrapper. Throw an `AppError` subclass (`NotFoundError`, `ConflictError`, `ValidationError`, ...) for known cases; anything else ends as JSON 500 `INTERNAL` with the request id, logged, no internals. In legacy routes, only known business codes may become 400 (`knownErrorCode`).
- Read configuration from the validated `AppConfig` (`server/src/config/env.ts`), never from `process.env` in routes. Add a new variable to the schema and to `.env.example`.
- Log through the pino logger (`createApp` gives one); never log request bodies, passwords, tokens or the setup token.
- Once a sale or credit note is committed, never answer with an error. Log any follow-up failure and still return 201 (prevents double sales).
- Responses:
  - success: `{ "data": … }`
  - lists: `{ "data": [...], "meta": { page, pageSize, total } }`
  - errors: `{ "error": { "code", "message", "details" } }`
  - never HTML stack traces
- Writes return the affected resource, not whole lists. Don't add new "bootstrap everything" endpoints.
- Checkout requires an `Idempotency-Key`. A repeated key returns the original invoice.
- The server computes all totals from DB prices and recipes. Never trust client totals, document types, costs or numbers.
- Return DTOs built from allowlists. **Never `SELECT *` into a response.** Settings go out through a public DTO.
- Error codes are stable and translated by the client. The server never sends localized UI strings.
- Keep the OpenAPI spec generated from zod up to date (`docs/api/`).

---

## 12. Security Guidelines

- Parameterised queries only; this already holds today. In Kysely, never pass user input to `sql.raw`.
- Sessions:
  - httpOnly + Secure + SameSite=Lax cookie;
  - token stored as SHA-256;
  - sliding expiry;
  - revoked on password change or deactivation.
- CSRF: `Origin` check plus a double-submit token on every non-GET request.
- Passwords: async `crypto.scrypt`, minimum 8 characters, rate limit per IP, lockout per email (`login_attempts`).
- First-run setup only creates the first admin, gated by `SETUP_TOKEN`. After that there is **no self-registration**.
- Secrets live only in hPanel env vars, validated at boot. Never commit `.env*` (except `.env.example`), `data/` or `*.db*`.
- `helmet` with CSP. Host fonts locally. Set `trust proxy` correctly behind Hostinger's proxy.
- Escape everything in print HTML and use one sandboxed print iframe. CSV export must neutralise `= + - @`.
- The public invoice endpoint: rate limited, `noindex`, minimal fields.
- Run `npm audit --omit=dev` in CI. No unused dependencies.

---

## 13. Testing Guidelines

- **Characterization tests before behaviour changes.** R1.1 builds the safety net, and nothing is refactored without it.
- Unit tests (Vitest) cover:
  - `shared/money`
  - VAT, both inclusive and exclusive
  - discount allocation
  - recipe deduction
  - moving-average cost
  - document sequences
  - QR TLV round-trip (only if the Phase-1 tax QR is added later)
- Integration tests run against **real MariaDB** (CI service / docker-compose): constraints, transactions, concurrency (two parallel sales), migrations `up/down/up`.
- API tests (Supertest on `createApp()`): every route, the **permission matrix (route × role)**, error codes, idempotency.
- E2E (Playwright): login → sale (cash, card, split) → print → hold/resume → credit note → purchase → daily report → void voucher.
- Coverage target: ≥ 80% on `service.ts` files and `shared/money.ts`.
- Use fixed fixtures with hand-calculated expected numbers for every report.
- Report real test output. Never claim green without running the tests.

---

## 14. Git Workflow

- `main` is the integration branch. `production` is protected; Hostinger auto-deploys it, so every push there ships.
- Feature branches: `r1/close-registration`, `fix/…`, `feat/…`, `refactor/…`. One roadmap task per PR where possible.
- Conventional commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`), in the imperative mood.
- CI must pass (lint, typecheck, tests, build) before merging. No direct pushes to `production`.
- Never commit secrets, `data/`, database files or `.env`. Rewriting history is a separate decision that needs approval.
- Commit, push or open a PR only when the owner asks.

---

## 15. Development Rules

- Study before proposing, analyse before implementing, and explain every engineering decision. Discuss alternatives when there is more than one reasonable option.
- When information is missing, **ask the owner** instead of assuming.
- Don't move to the next roadmap phase before the current phase report is reviewed.
- Keep the app runnable after every step (strangler approach). Old routes stay until the UI has migrated.
- **No SaaS code** (tenant_id, plans, billing) and **no ZATCA integration code** in this project.
- Stay inside the Hostinger constraints in section 7. Ask before adding anything that needs a worker, a socket or disk persistence.

---

## 16. Deployment Guidelines

- Target: Hostinger Business Node.js app from GitHub (`production` branch).
  - Build command: `npm run build`
  - Entry file: `server.js`
  - Node 22 or 24
- `NODE_ENV=production`. Required env vars are validated by `config/env.ts`; boot fails if one is missing.
- Migrations run at boot under `GET_LOCK`. Take a DB backup before any deploy that includes a migration.
- Cron jobs:
  - hourly: session and login-attempt cleanup
  - daily: backup export to off-site storage
- Health check: `GET /api/v1/health`, with an external uptime monitor and optional Sentry.
- Release flow: PR → CI → staging (subdomain app) → smoke test → merge to `production` → auto-deploy.
- Rollback: Hostinger keeps the 2 previous builds, plus the DB backup. Keep a runbook in `docs/`.

---

## 17. Refactoring Rules

1. No full rewrite without an engineering justification.
2. Don't break existing functionality.
3. Don't delete a feature before understanding and documenting its impact.
4. Change things incrementally.
5. Separate business logic from presentation.
6. Avoid over-engineering.
7. Don't use design patterns for their own sake.
8. Apply SOLID where it helps.
9. Write tests for important functionality.
10. Check every change's impact on the DB, the API and the frontend.
11. No destructive migration without a data-protection plan (backup plus rollback).
12. Keep compatibility with existing behaviour as far as possible.

Project lifecycle, in order, each with acceptance criteria and a phase report:
**Understand → Audit → Stabilize → Refactor → Test → Deploy & Operate**. SaaS Transformation is a later, separate project. Don't skip a phase: no refactoring before stabilization, and no SaaS before the base architecture is sound.

Current position: **R0 (Understand & Audit) is done. R1 (Stabilize) is waiting for approval.** See [REFACTORING_ROADMAP](docs/REFACTORING_ROADMAP.md).

---

## 18. Project Skills (`.claude/skills/`)

| Skill | Use when |
|---|---|
| `nodejs-backend` | Any server work: routes, services, validation, auth, errors, transactions |
| `react-frontend` | Any UI work: components, hooks, server state, i18n, printing |
| `mysql-database` | Schema, migrations, queries, indexes, transactions on MariaDB |
| `devops` | Hostinger deployment, CI/CD, env, cron, backups, monitoring |
| `saas-architecture` | **Future phase only.** Use now only for a "doesn't block SaaS later" review, never to add tenant code |
