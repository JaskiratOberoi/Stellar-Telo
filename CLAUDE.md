# Project conventions

## Git workflow
- **Commit and push directly to `main` by default** whenever asked to commit/push
  (e.g. "gacp" = git add, commit, push). Do **not** create a feature branch
  unless the user explicitly asks for one.
- End commit messages with the `Co-Authored-By: Claude ...` trailer.
- Do not commit one-off/throwaway scripts under `telo-web/db/scripts/*.mjs`
  (debug/ops helpers) unless explicitly asked.

# Architecture & data access (read before touching data)

This repo is **Stellar Telo**: a B2C/B2B billing + reporting web app layered on
top of an existing legacy **LIS** (Laboratory Information System). Three runtime
services, defined in the repo-root `docker-compose.yml`:

| Service | What it is | Where |
|---|---|---|
| **telo-web** | The Next.js 15 app (App Router, server actions). All features live here. | `telo-web/` |
| **listec** | Small Node/Express **read-only bridge** to the LIS SQL Server. | `Listec/integration/node-mssql/` |
| **redis** | Sessions (Auth.js) + lookup cache. | image only |

## Noble = the LIS database (shared, production)
- **Noble** is the legacy LIS's **MS SQL Server** database. It is the system of
  record for patients, samples, tests, bills, users, results — everything. It is
  **shared with the live LIS**, so writes/migrations are high-impact.
- LIS tables use legacy names: `tbl_med_*` (users, patients, samples, tests,
  MCC units), `tbl_billing_*` (bills, line items, receipts).
- **Telo's own sidecar tables/SPs live in the same DB**, prefixed/namespaced as
  `telo_*` / `dbo.usp_telo_*`: e.g. `telo_account` (per-user Telo flags:
  `lis_access`, `mrp_only`, `prepared_by`), `tbl_telo_user_role` (Telo role
  override), `telo_mcc_invoice_config` (per-client invoice branding), `telo_txn`
  (payment txn ids), `telo_balance_pin_pref`.
- **`'telo:<userId>'` origin marker**: every row Telo creates in shared LIS
  tables is stamped `addedby` / `createdby` / `receivedby = 'telo:<userId>'`.
  This is how Telo distinguishes its own orders/bills/users from native LIS ones
  (`WHERE addedby LIKE 'telo:%'`) **and** attributes a row to the exact account
  that made it. Do not break this convention.

## How telo-web reaches Noble (direct SQL)
- Telo owns its **own mssql connection pool** (login `nobleone`, same server as
  Listec). Config via `TELO_SQL_*` env vars (see `telo-web/.env.example`).
- **`telo-web/db/pool.ts` is the ONLY runtime SQL entrypoint** — `getPool()`,
  `withRetry()`, `traceDb()`. Pure config is in `telo-web/db/config.ts` (reused
  by the deploy CLI without tripping `server-only`).
- Code layout:
  - **Reads** → `telo-web/db/read/*.ts` (one module per area: orders, ledger,
    receipts, teloUsers, sampleReport, …).
  - **Writes** → `telo-web/db/sp/*.ts` thin wrappers that `.execute('dbo.usp_telo_*')`.
  - **SQL artefacts** (tables, types, stored procedures, migrations) →
    `telo-web/db/sql/NN_*.sql`, numbered; applied in lexical order.
- **Deploying SQL** (tables/SPs/migrations) to Noble:
  `cd telo-web && npm run deploy:sp -- ./db/sql/NN_file.sql` (or no arg = all
  files, idempotent). Migrations use `IF COL_LENGTH(...) IS NULL` guards and SPs
  use `CREATE OR ALTER`, so re-runs are safe.
  - ⚠️ **`deploy:sp` connects to the live production Noble server.** Treat any
    `ALTER`/SP deploy as a **production database migration** — get explicit user
    authorization before running it (the sandbox classifier blocks it by
    default). The migration files themselves are fine to author/commit anytime.

## How telo-web reaches Noble (read proxy via Listec)
- For the **worksheet/reporting reads** (complex LIS result JSON we don't want to
  re-implement), telo-web calls the **Listec** HTTP service instead of SQL —
  base URL `LISTEC_API_BASE_URL` (default `http://listec:31311`). No SQL creds
  needed by the consumer.
- Client + types: `telo-web/lib/listec.ts` (redis-cached lookups; worksheet reads
  are not cached) and `telo-web/lib/listec.types.ts`.
- Listec endpoints (Express, `Listec/integration/node-mssql/`):
  `GET /api/worksheet-reports` (main result feed, wraps
  `dbo.usp_listec_worksheet_report_json`), `GET /api/lookups`,
  `GET /api/mcc-units`, `GET /api/regions`, `GET /health`, and a Noble **ER
  diagram browser at `/er/`** (`GET /api/noble/schema`) — handy for exploring the
  LIS schema. Keep Listec internal (it exposes schema + data with no auth).
- Deploy Listec's SP/TVP: `cd Listec/integration/node-mssql && npm run deploy:sp`
  (see `Listec/README.md`). Same `nobleone` login.

## Access / credentials
- Same Noble SQL Server + `nobleone` login for **both** Listec and telo-web.
  Host/db are in the env templates (`TELO_SQL_SERVER`, `TELO_SQL_DATABASE=Noble`);
  **passwords live only in gitignored env files** — `telo-web/.env` and
  `Listec/.env`. Never commit secrets; reference the `.env.example` files.
- Auth.js sessions use `NEXTAUTH_SECRET`; users sign in with their **LIS
  credentials** (`dbo.usp_telo_authenticate`). Telo role/capabilities
  (`@/auth/rbac`, `@/auth/scope`) gate features; MCC "scope" limits which client
  codes a user can act on.

## Deployment topology
- Prod runs via the root `docker-compose.yml`. `telo-web` is bound to host
  `127.0.0.1:3110`; a host **Caddy** reverse-proxies `telo.genomicslab.in` →
  `127.0.0.1:3110` with auto-HTTPS. Listec is internal (`127.0.0.1:31311`).
- Local dev: `cd telo-web && npm run dev` (needs a populated `telo-web/.env`).
