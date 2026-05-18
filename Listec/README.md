# Listec (Noble SQL bridge)

HTTP service that connects to the **Noble** SQL Server database and exposes worksheet report APIs (same design as the **Stellar Matter** repo’s `Listec/` subtree). Consumers talk to Listec over **`LISTEC_API_BASE_URL`**; they do not need SQL credentials.

## Layout

| Path | Purpose |
|------|---------|
| [`integration/node-mssql/`](integration/node-mssql/) | Node/Express app (`mssql` driver), Dockerfile, TVP/by-codes SQL scripts |
| [`sp/`](sp/) | Legacy SP: `usp_listec_worksheet_report_json.sql` (`grant_listec_ro.sql` is **not** used here — read-only pattern retained only for reference) |
| [`docs/noble-schema/`](docs/noble-schema/) | Reference Noble schema snapshot (read-only documentation) |

## Configure

1. Copy [`Listec/.env.example`](.env.example) (or [`integration/node-mssql/.env.example`](integration/node-mssql/.env.example)) to **`Listec/.env`** at the repo root (same level as this `README.md`).
2. Set **`LISTEC_SQL_USER=nobleone`** (or the exact login name on your server) and **`LISTEC_SQL_PASSWORD`** from your secret store. Never commit `Listec/.env`.
3. Optional HTTP bind: `LISTEC_API_HOST`, `LISTEC_API_PORT` (defaults `0.0.0.0:31311`).

## Noble artefacts (deploy once per environment)

This project uses **`nobleone`** (or equivalent DDL-capable login) for both **runtime** and **one-time SQL deploy**. Do **not** rely on `grant_listec_ro.sql` / `listec_ro` here.

1. TVP + by-codes procedure (ordered scripts under `integration/node-mssql/sql/`):
   - `01_type_ClientCodeList.sql`
   - `02_usp_listec_worksheet_report_by_codes.sql`
2. Legacy JSON procedure: [`sp/usp_listec_worksheet_report_json.sql`](sp/usp_listec_worksheet_report_json.sql)

From `integration/node-mssql/` after `Listec/.env` is filled:

```bash
npm install
npm run deploy:sp
```

That runs every `*.sql` in `sql/` in lexical order, then smoke-tests `dbo.usp_listec_worksheet_report_json`. To deploy only the legacy SP:

```bash
npx ts-node scripts/deploy-sp.ts ../../sp/usp_listec_worksheet_report_json.sql
```

**Do not run** `npm run grant:ro` in this setup — it targets the read-only `listec_ro` principal and is unnecessary when using `nobleone`.

## Run locally

```bash
cd integration/node-mssql
npm install
npm run dev
# or: npm run build && npm start
```

Health: `GET http://127.0.0.1:31311/health`

## Noble ER diagram (browser UI)

Static UI is served from the same process as the API (no separate frontend build).

| URL | Purpose |
|-----|---------|
| [`/er/`](http://127.0.0.1:31311/er/) | Table list, column/PK/FK **details**, and a **Mermaid** ER diagram (`/er` redirects here) |
| `/` | Redirects to `/er/` |

Data: `GET /api/noble/schema` — read-only catalog (tables, columns, primary keys, foreign keys).

**Query parameters**

- **`schemas`** (API + page reload field): default **`dbo`**. Use comma-separated names (`dbo,foo`) or **`*`** / **`all`** for every schema (can be large and slow).
- **`filter`** (URL `?filter=` or on-page box): substring filter on `schema.table`; narrows the diagram and the sidebar list.

**Caveats:** Large databases produce heavy diagrams; narrow with **filter** or a single schema. The endpoint exposes full layout metadata — keep Listec **internal** on your network (same trust as SQL credentials).

## Docker

From the **repository root** (parent of `Listec/`):

```bash
docker compose up listec --build
```

Compose mounts **`Listec/.env`** into the container (see root `docker-compose.yml`). Do not bake `nobleone` credentials into the image.

## API surface (parity)

Full route set matches Stellar Matter’s Listec service (`example.express.ts`): worksheet reports, package aggregation, by-codes TVP path, regions/lookups/MCC dumps, and Tracer salesperson endpoints — so anything that expects `LISTEC_API_BASE_URL` can integrate without forking the contract.
