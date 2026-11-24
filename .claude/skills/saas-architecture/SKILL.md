---
name: saas-architecture
description: FUTURE-PHASE skill for turning Mizan POS into a multi-tenant SaaS (tenancy model, tenant isolation, registration, roles, plans and limits, subscription lifecycle, billing, super-admin and tenant dashboards, audit, SaaS security, backup). Do NOT use it to add tenant code now - in the current single-restaurant project use it only to review that a change does not block SaaS later, or once the owner explicitly starts the SaaS project after delivery.
---

# SaaS Architecture — Mizan POS (future phase)

> ⛔ **Status: deferred by the owner.** The current project delivers a **single-restaurant** product. SaaS is a **separate project that starts after delivery**. While this banner stands:
> - do **not** add `tenant_id`, tenant context, plans, subscriptions, billing, a super-admin or self-service signup;
> - do **not** shape APIs or schemas around tenants "just in case".
>
> Full design reference: `docs/SAAS_ARCHITECTURE.md`.

## When to use
1. **Now, as a reviewer only:** when reviewing a design or PR in the single-restaurant project, run the *no-regret checklist* below. If a change would make SaaS much harder later, flag it to the owner. Don't fix it by adding SaaS code.
2. **Later, as a builder:** only once the owner has explicitly started the SaaS project and its entry criteria are met.

## No-regret checklist (current phase, review only)
These are good practice for a single restaurant anyway, and they keep the SaaS path open:
- [ ] All DB access goes through repositories (`server/src/modules/*/repository.ts`). No SQL in controllers, services or scripts.
- [ ] Settings are read through `settingsService`, not `WHERE id = 1` scattered through the code.
- [ ] Document numbers come from `document_sequences` (later keyed by tenant). There is no `COUNT(*)+1`.
- [ ] `created_by` and `audit_logs` are written for financial and admin actions.
- [ ] No persistent files on local disk, and no business state in module-level variables or caches without invalidation.
- [ ] Permissions are checked by key through roles. Business logic does not hard-code a single admin, branch or device.
- [ ] Configuration comes from env vars and the settings table, never from constants tied to one restaurant (name, VAT number, address).

**Red flags to reject now (scope creep):**
- `tenant_id` columns
- `tenants`/`plans`/`subscriptions` tables
- tenant-resolving middleware or subdomain routing
- a billing SDK
- a platform-admin UI

## Entry criteria for starting the SaaS project
1. The single-restaurant release is accepted (R9) and stable in production (proposed: 60 days with no Critical or High bugs).
2. The target architecture is complete: modules, repositories, services, v1 API and cookie sessions.
3. Coverage is ≥ 80% on services, and E2E tests cover the critical flows.
4. The business decisions are written down: pricing, plans, target market, payment provider, and whether ZATCA Phase-2 returns (it is likely required to sell commercially in KSA).
5. **Hosting has moved off shared hosting** (VPS/Cloud), because SaaS needs workers, queues and Redis.

## Future design summary (when activated)
- **Tenancy model:** shared database plus shared schema with `tenant_id` on every business table. Large tenants can later move to a dedicated database (hybrid silo). In MySQL/MariaDB a "schema" *is* a database, so "schema-per-tenant" really means database-per-tenant.
- **Hierarchy:** Tenant (legal entity) → Branch → Device (a POS terminal; needed for ZATCA per-device chains if ZATCA returns).
- **Isolation (defense in depth):**
  1. `tenantId` comes only from the session and lives in `AsyncLocalStorage`. Never accept it from the body or query.
  2. A repository base automatically applies `where tenant_id = ?`, and an ESLint rule forbids Kysely use outside repositories.
  3. `tenant_id NOT NULL`, composite unique keys such as `(tenant_id, document_number)` and `(tenant_id, sku)`, indexes that lead with `tenant_id`, and composite FKs where cross-tenant linking is possible.
  4. A mandatory cross-tenant leak test suite runs for every endpoint in CI.
  5. Logs carry `tenantId`, with alerts on any cross-tenant access.
- **Users and roles:** a user belongs to one tenant in v1, with globally unique email. Roles are per tenant, copied from templates. `platform_admins` is a separate realm with mandatory 2FA.
- **Plans and limits:** tables `plans` and `plan_features`, with `requireFeature()` and `enforceLimit()` middleware backed by `usage_counters`. Only the server enforces them.
- **Lifecycle:** trialing → active → past_due (grace period) → suspended (read and export only) → canceled → purged (after the legal retention period).
- **Billing:**
  - a provider adapter (Moyasar, Tap or HyperPay; Stripe if available) with idempotent webhooks (`billing_events`) processed by a worker;
  - the platform's own subscription invoices are KSA tax invoices, so the platform needs e-invoicing compliance as a seller.
- **Dashboards:**
  - super-admin: tenants, plan, status, usage, feature flags, and audited, time-boxed impersonation;
  - tenant: subscription, usage against limits, branches, devices, users, data export.
- **Backup:** managed DB with point-in-time recovery, **per-tenant export/restore tooling** (required with a shared schema), defined RPO/RTO and restore drills.

### Sketch: tenant context (for the future phase only)
```ts
// server/src/shared/tenancy.ts  — DO NOT ADD BEFORE THE SAAS PROJECT STARTS
import { AsyncLocalStorage } from 'node:async_hooks';
const store = new AsyncLocalStorage<{ tenantId: number }>();
export const runWithTenant = <T>(tenantId: number, fn: () => T) => store.run({ tenantId }, fn);
export const currentTenantId = () => {
  const ctx = store.getStore();
  if (!ctx) throw new Error('TENANT_CONTEXT_MISSING');   // fail closed
  return ctx.tenantId;
};
// repository usage: db.selectFrom('invoices').where('tenant_id', '=', currentTenantId())…
```

### Migration path (summary)
1. Move hosting.
2. Add `tenants`, then add `tenant_id` everywhere and backfill it with tenant 1 (the delivered restaurant). Add composite keys.
3. Add the tenant context, the repository scoping and the isolation tests.
4. Build signup and onboarding.
5. Add plans, limits, subscriptions and billing.
6. Build the super-admin and tenant dashboards.
7. Add per-tenant backup and monitoring, and run load tests.
8. Optional: real ZATCA Phase-2 per tenant and device.

## Done checklist
**Current phase (review use):**
- [ ] The no-regret checklist has been run.
- [ ] No SaaS code was added.
- [ ] Anything that blocks SaaS later has been flagged to the owner.

**Future phase (build use):**
- [ ] The owner approved starting the SaaS project, and the entry criteria are met.
- [ ] Every new table has `tenant_id` plus composite keys and indexes.
- [ ] The isolation tests pass for every endpoint.
- [ ] Limits are enforced on the server.
- [ ] Webhooks are idempotent.
- [ ] Per-tenant export and restore have been tested.
