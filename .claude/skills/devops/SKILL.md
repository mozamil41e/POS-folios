---
name: devops
description: Use for Mizan POS deployment and operations on Hostinger Business shared hosting - environment variables and config validation, GitHub Actions CI/CD, the production branch auto-deploy, local MariaDB for development, migrations at boot, hPanel cron jobs, logging and monitoring, backups and disaster recovery, release/rollback runbooks, and security hardening.
---

# DevOps — Mizan POS on Hostinger Business

The production target is a **Hostinger Business (Unlimited) Node.js app plus MariaDB**. This is shared hosting: no root access, no Docker, no system services. Design for the platform as it is, and follow the approval workflow in `CLAUDE.md` §2 for any change to pipelines, environments or production.

## When to use / not use
- **Use:**
  - CI/CD workflows
  - Hostinger app and database setup
  - env vars and config validation
  - cron jobs
  - backups and restores
  - monitoring
  - release and rollback
  - production hardening
  - local dev environment (MariaDB)
- **Don't use for:** application code structure (`nodejs-backend`) or schema design (`mysql-database`).

## Platform facts (Hostinger support pages, checked 2026-11-24)
- Node.js apps run only on the **Business/Cloud** plans. Available versions: **18/20/22/24**. Use 22 or 24.
- Resources: 2 CPU, 3 GB RAM, **NPROC 120** shared by every site on the plan. Exceeding NPROC returns 503s.
- **Requests are cut off after 120 s.** No inbound WebSockets, **no background workers or endless timers** (they stop on deploy or restart), no custom ports, no Docker, no Redis.
- **Cron jobs** are available. They run in **UTC**, stop after **30 minutes**, and the command must be ≤ 255 characters without `%`.
- Deploys: GitHub/GitLab import with auto-deploy on push, or an archive upload.
  - Build settings: preset "Other", Node version, root directory, branch, package manager, build command, output directory, **entry file**.
  - npm install and build run on Hostinger, and npm cannot be run over SSH.
- **The app lives in `…/hbuilds/current/nodejs` and is overwritten on every deploy.** Hostinger keeps the live build plus up to 2 earlier ones. Never persist anything to the app's disk.
- The database is **MariaDB** on port 3306. Environment variables are set in hPanel during setup and later from the dashboard.
- **Not yet verified (do this in R8.1 on a staging app):**
  - whether SSH is available on the plan
  - Node connecting to the account's MariaDB through `localhost`
  - whether devDependencies are installed before the build
  - whether `mysqldump` is available to cron
  - proxy headers for `trust proxy`
  - the exact MariaDB version

## Environments
| Env | Where | Database | Deploy |
|---|---|---|---|
| local | developer PC (Windows) | MariaDB via docker-compose, or a native install of the **same major version** as Hostinger | `npm run dev` |
| CI | GitHub Actions | `mariadb:<same-major>` service container | on every PR or push |
| staging | Hostinger, a second Node app on a subdomain | separate MariaDB database | auto-deploy from the `staging` branch |
| production | Hostinger Node app on the main domain | production MariaDB | auto-deploy from the protected `production` branch |

## Configuration (validated at boot)
```ts
// server/src/config/env.ts
const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().default(3000),
  APP_ORIGIN: z.string().url(),                 // https://pos.example.com — used for CSRF Origin checks
  DB_HOST: z.string(), DB_PORT: z.coerce.number().default(3306),
  DB_NAME: z.string(), DB_USER: z.string(), DB_PASSWORD: z.string().min(12),
  SESSION_TTL_HOURS: z.coerce.number().default(12),
  SETUP_TOKEN: z.string().min(24).optional(),   // first-run admin creation only
  TRUST_PROXY: z.string().default('1'),
  SENTRY_DSN: z.string().url().optional(),
  BACKUP_TARGET_URL: z.string().optional(),     // off-site backup destination
});
export const env = Env.parse(process.env);      // throws ⇒ app refuses to boot with a clear message
```
- `.env.example` lists every variable with placeholder values. Real values live only in hPanel and in local `.env` files, which are git-ignored.

## CI (GitHub Actions) template
```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      mariadb:
        image: mariadb:11          # match Hostinger's major version once verified
        env: { MARIADB_ROOT_PASSWORD: root, MARIADB_DATABASE: mizan_test }
        ports: ['3306:3306']
        options: --health-cmd="healthcheck.sh --connect --innodb_initialized" --health-interval=5s --health-retries=20
    env: { NODE_ENV: test, DB_HOST: 127.0.0.1, DB_NAME: mizan_test, DB_USER: root, DB_PASSWORD: root }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run lint && npm run typecheck
      - run: npm test -- --coverage
      - run: npm run build
      - run: npm audit --omit=dev --audit-level=high
```
- Protect `production` (and `staging`): require PRs and a green `ci` run, and forbid force pushes. Each push to `production` **deploys immediately**.
- Add Dependabot for npm and GitHub Actions.

## Deploy to Hostinger (R8.1)
1. hPanel: create the MariaDB database and user. Grant privileges on that database only, and keep remote MySQL access off.
2. hPanel → Websites → Add website → Node.js app → Import from GitHub, with these settings:
   - Branch: `production`
   - Framework: Other
   - Node: 22
   - Build command: `npm run build`
   - Entry file: `server.js`
3. Set every env var from `config/env.ts`. Use `NODE_ENV=production` and generate `SETUP_TOKEN` randomly.
4. Enable SSL for the domain and force HTTPS.
5. On first boot, migrations run under `GET_LOCK`. Open `/setup` with the token to create the admin, then **remove `SETUP_TOKEN`**.
6. Smoke test: `/api/v1/health`, then login, a sale, a print and a report.

## Cron jobs (hPanel, UTC)
| Job | Schedule (UTC) | Command (≤ 255 chars, no `%`) |
|---|---|---|
| Session and login-attempt cleanup | `0 * * * *` | `node --env-file=.env server/dist/scripts/cleanup.js` (or the env mechanism Hostinger provides; verify) |
| Daily backup export | `30 0 * * *` (03:30 Riyadh) | `node server/dist/scripts/backup-export.js` |

- Scripts must be idempotent, finish well under 30 minutes, log a one-line summary and exit non-zero on failure.
- No `setInterval` inside the web process for these jobs.

## Logging & monitoring
- pino JSON to stdout, so it appears in the Hostinger app logs. Include a `requestId` and never log secrets, cookies or passwords.
- `GET /api/v1/health` returns 200 only if a `SELECT 1` succeeds. Watch it with an external uptime monitor that alerts by email or WhatsApp.
- Sentry (optional) collects server 5xx errors and frontend errors. Scrub PII.
- Review weekly: error rate, slow requests (> 2 s), failed logins.

## Backups & disaster recovery
- Layers:
  1. Hostinger automatic backups
  2. our daily logical export (mysqldump if it is available to cron; otherwise a Node exporter that streams `SELECT`s into SQL or JSONL), copied off-site
  3. a manual export before every migration
- Retention (proposed): 7 daily, 4 weekly and 6 monthly backups. Confirm the legal record-retention period with the accountant.
- **Restore drill, quarterly:**
  1. restore into a staging DB
  2. run the integrity checks (`mysql-database` skill)
  3. point staging at it
  4. record the RTO
- Restaurant targets (proposed): RPO ≤ 24 h from the exports, better with Hostinger's snapshots; RTO ≤ 4 h.

## Release & rollback runbook
1. Merge the PR into `main`, then into `staging`, and let auto-deploy run. Smoke-test staging.
2. Take a production DB export if the release contains migrations.
3. Merge `staging` into `production`, let auto-deploy run, and smoke-test production.
4. **Rollback:**
   - redeploy the previous build from hPanel (2 are kept), or revert the commit on `production`;
   - if a migration ran, restore the pre-release export;
   - prefer forward-fix migrations to `down` in production.
5. Record every release in `docs/reports/releases.md`: date, commit, migrations, result.

## Security hardening (shared-hosting scope)
- Turn on 2FA for the hPanel and GitHub accounts. Use SSH keys if SSH is available. Use a least-privilege DB user.
- Configure HTTPS-only, HSTS through helmet, secure cookies, and `app.set('trust proxy', env.TRUST_PROXY)`.
- No secrets in the repo, and `data/` and `*.db*` are ignored. Rotate `SESSION`/DB credentials after staff changes.
- Keep dependencies patched: Dependabot plus `npm audit` in CI.
- **Linux/VPS-level hardening** (firewall, fail2ban, unattended upgrades, non-root services) becomes relevant only if the SaaS phase moves to a VPS. It isn't applicable on shared hosting.

## Anti-patterns already in this repo (don't copy them)
- A database file inside the app directory (`src/server/db.ts:30-36`), which would be lost on deploy.
- DB files committed to git (`data/*.db-wal`).
- A mixed `bun.lock` with npm scripts. There's no `engines` field and the `clean` script is POSIX-only (`rm -rf`).
- AI Studio leftovers: `DISABLE_HMR`, an asset-copy plugin for a folder that doesn't exist, and an unused `GEMINI_API_KEY`.

## Done checklist
- [ ] The owner approved the change. Production changes are scheduled outside service hours.
- [ ] CI is green (lint, typecheck, tests with MariaDB, build, audit).
- [ ] Env vars are documented in `.env.example` and validated by `config/env.ts`.
- [ ] Nothing persists to local disk. No timers or workers. Requests stay well under 120 s.
- [ ] A backup was taken before migrations, and the rollback path is known.
- [ ] Health and monitoring confirmed after deploy, and the release is logged.
