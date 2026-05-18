# Stellar Telo — Listec service

This repository hosts the **Listec** integration: a small Node/Express API that connects to the **Noble** SQL Server database and exposes HTTP routes for worksheet reports and related lookups.

- **Listec docs & Noble deploy:** [Listec/README.md](Listec/README.md)
- **HTTP default:** port `31311`, overridable via `LISTEC_API_PORT` / `LISTEC_API_HOST` in `Listec/.env`
- **Consumers:** point `LISTEC_API_BASE_URL` at this service (e.g. `http://127.0.0.1:31311` or `http://listec:31311` in Compose)
- **Noble ER browser UI:** after the API is running, open [`http://127.0.0.1:31311/er/`](http://127.0.0.1:31311/er/) (see [Listec/README.md](Listec/README.md))

## Quick start

1. Copy `Listec/integration/node-mssql/.env.example` → `Listec/.env` and set `LISTEC_SQL_*` (Stellar Telo uses **`nobleone`** per project convention).
2. Deploy Noble SPs/TVP if needed: see [Listec/README.md](Listec/README.md).
3. From the **repo root**: `npm install` (installs Listec deps via `postinstall`) then `npm run dev` or `npm start`.
   - Or from `Listec/integration/node-mssql`: `npm install && npm run dev`.

## Docker

```bash
docker compose up listec --build
```
