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
| A local ZATCA Phase-1-style **5-field TLV QR** on receipts | **Any ZATCA integration**: CSID, signing, UBL XML, ICV/PIH, dispatch, ZATCA settings |
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
| Language | TypeScript ^7 (not `strict`) | TypeScript `strict` |
| Frontend | React 19, Vite 8, Tailwind 4, lucide-react, qrcode | + React Router, TanStack Query, shared UI kit, typed i18n |
| Backend | Express ^4.21 in a single `server.ts` | Express 5 modular monolith (`server/src/modules/*`) |
| Validation | Manual `String(b.x ?? '')` checks | zod schemas in `shared/schemas` |
| Data access | better-sqlite3 (sync), inline SQL | Kysely, first on SQLite, then **MariaDB via mysql2** |
| Database | SQLite file in `./data` | **MariaDB** (Hostinger; MySQL-compatible SQL only) |
| Auth | Bearer token held in React state | httpOnly cookie session + CSRF |
| Logging | `console.log` at boot only | pino (stdout) + optional Sentry |
| Tests | **none** | Vitest + Supertest + Playwright, run in GitHub Actions |
| Package manager | `bun.lock` with npm scripts (inconsistent) | npm + `package-lock.json`, `engines.node >= 22` |

---

## 4. Commands (current)

```bash
npm install          # node_modules is not committed. R1.1 standardises on npm (bun.lock will be removed)
npm run dev          # tsx server.ts — Express + Vite middleware on http://localhost:3000
npm run build        # vite build + esbuild bundle server.ts -> server.js
npm start            # node server.js (production mode, serves dist/)
npm run lint         # currently only `tsc --noEmit`
```

Planned in R1.1: `npm test`, `npm run typecheck`, a real ESLint `npm run lint`, and `npm run seed:dev`.

---

## 5. Current Architecture (AS-IS)

Do not assume that the target structure exists yet.

- `server.ts` (2,021 lines): every API route, with validation, business logic and SQL inline. It also hosts the Vite dev middleware and static serving.
- `src/server/db.ts` (1,361 lines): schema creation, ad-hoc `ALTER` "migrations", **demo seeds**, queries, sessions, password hashing.
- `src/server/zatca.ts`: UBL XML, signing and TLV QR. **To be removed (R1.4)**, except a tiny 5-field QR builder.
- `src/App.tsx` (1,221 lines): global `data` state loaded from `/api/bootstrap`, plus 25 copy-pasted fetch handlers, plus manual section switching (there is no router).
- `src/components/*View.tsx`: god components. `ReportsCenterView` is 3,206 lines and computes 25 reports in the browser.
- Shared between client and server: `src/types.ts`, `src/permissions.ts`.
- Data flow:
  1. login
  2. the token is kept in memory
  3. `GET /api/bootstrap` returns everything
  4. every mutation returns full replacement lists
  5. `setData` merges them

**Known critical issues** (fix before any production use; see docs):
- open registration (fixed in R1.2 on branch `r1/close-registration`; first-run setup needs `SETUP_TOKEN` in production)
- read permissions not enforced on the server
- secrets inside `/api/bootstrap`
- reports computed from `LIMIT 100` data
- SQLite would be wiped on every Hostinger deploy
- a failed checkout clears the cart

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
- GitHub auto-deploy; npm install and build run on Hostinger. Env vars are managed in hPanel. Entry file: `server.js`.
- Resources: 2 CPU, 3 GB RAM, NPROC 120. A single Node process serves both the SPA and the API (same origin).
- Still to verify during R8.1: whether SSH is available, the localhost MariaDB connection, whether devDependencies are installed during the build, whether `mysqldump` works in cron, and proxy/`trust proxy` behaviour.

---

## 8. Coding Standards

- TypeScript everywhere. Move toward `strict: true`. Avoid `as` casts: parse with zod instead. Never use `any` in new code.
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
  - QR TLV round-trip
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
