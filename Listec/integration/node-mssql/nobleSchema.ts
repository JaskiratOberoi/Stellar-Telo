/**
 * Read-only Noble (SQL Server) catalog introspection for ER diagram UI.
 */

import type { ConnectionPool } from 'mssql';

export interface NobleSchemaOptions {
  /** When true, include every schema's base tables. When false, use `schemas`. */
  allSchemas: boolean;
  /** Schema names (validated alphanum + underscore). Ignored if allSchemas. */
  schemas: string[];
}

export interface NobleColumnJson {
  name: string;
  ordinal: number;
  dataType: string;
  charMaxLength: number | null;
  numericPrecision: number | null;
  numericScale: number | null;
  nullable: boolean;
  isPrimaryKey: boolean;
}

export interface NobleTableJson {
  schema: string;
  name: string;
  fullName: string;
  columns: NobleColumnJson[];
}

export interface NobleForeignKeyJson {
  name: string;
  fromSchema: string;
  fromTable: string;
  fromColumn: string;
  toSchema: string;
  toTable: string;
  toColumn: string;
}

export interface NobleSchemaPayload {
  database: string;
  schemasRequested: string[] | 'all';
  generatedAt: string;
  tableCount: number;
  tables: NobleTableJson[];
  foreignKeys: NobleForeignKeyJson[];
}

const SCHEMA_SAFE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function quoteSchema(s: string): string {
  if (!SCHEMA_SAFE.test(s)) throw new Error(`Invalid schema name: ${s}`);
  return `N'${s}'`;
}

/** Parse `schemas` query: empty/omitted → dbo; `*` or `all` → all schemas; else comma-separated list. */
export function parseSchemaQuery(raw: string | undefined): NobleSchemaOptions {
  const t = raw?.trim();
  if (!t || t.toLowerCase() === 'dbo') {
    return { allSchemas: false, schemas: ['dbo'] };
  }
  if (t === '*' || t.toLowerCase() === 'all') {
    return { allSchemas: true, schemas: [] };
  }
  const parts = [...new Set(t.split(',').map((x) => x.trim()).filter(Boolean))];
  for (const p of parts) {
    if (!SCHEMA_SAFE.test(p)) {
      throw new Error(`Invalid schema token "${p}" (use letters, numbers, underscore).`);
    }
  }
  if (parts.length === 0) return { allSchemas: false, schemas: ['dbo'] };
  return { allSchemas: false, schemas: parts };
}

function tableKey(schema: string, name: string): string {
  return `${schema}.${name}`;
}

export async function fetchNobleSchemaMetadata(
  pool: ConnectionPool,
  opts: NobleSchemaOptions,
): Promise<NobleSchemaPayload> {
  const schemaFilter = opts.allSchemas
    ? ''
    : `AND TABLE_SCHEMA IN (${opts.schemas.map(quoteSchema).join(', ')})`;

  const dbR = await pool.request().query<{ db: string }>(`SELECT DB_NAME() AS db`);
  const database = String(dbR.recordset[0]?.db ?? '');

  const tablesR = await pool.request().query<{ TABLE_SCHEMA: string; TABLE_NAME: string }>(`
    SELECT TABLE_SCHEMA, TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE = N'BASE TABLE'
    ${schemaFilter}
    ORDER BY TABLE_SCHEMA, TABLE_NAME
  `);

  const tableSet = new Set<string>();
  for (const row of tablesR.recordset) {
    tableSet.add(tableKey(row.TABLE_SCHEMA, row.TABLE_NAME));
  }

  const colFilter = opts.allSchemas
    ? ''
    : `AND c.TABLE_SCHEMA IN (${opts.schemas.map(quoteSchema).join(', ')})`;

  const colsR = await pool.request().query<{
    TABLE_SCHEMA: string;
    TABLE_NAME: string;
    COLUMN_NAME: string;
    ORDINAL_POSITION: number;
    DATA_TYPE: string;
    CHARACTER_MAXIMUM_LENGTH: number | null;
    NUMERIC_PRECISION: number | null;
    NUMERIC_SCALE: number | null;
    IS_NULLABLE: string;
  }>(`
    SELECT
      c.TABLE_SCHEMA,
      c.TABLE_NAME,
      c.COLUMN_NAME,
      c.ORDINAL_POSITION,
      c.DATA_TYPE,
      c.CHARACTER_MAXIMUM_LENGTH,
      c.NUMERIC_PRECISION,
      c.NUMERIC_SCALE,
      c.IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS c
    WHERE EXISTS (
      SELECT 1
      FROM INFORMATION_SCHEMA.TABLES t
      WHERE t.TABLE_SCHEMA = c.TABLE_SCHEMA
        AND t.TABLE_NAME = c.TABLE_NAME
        AND t.TABLE_TYPE = N'BASE TABLE'
    )
    ${colFilter}
    ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION
  `);

  const pkFilter = opts.allSchemas
    ? ''
    : `AND ku.TABLE_SCHEMA IN (${opts.schemas.map(quoteSchema).join(', ')})`;

  const pkR = await pool.request().query<{ TABLE_SCHEMA: string; TABLE_NAME: string; COLUMN_NAME: string }>(`
    SELECT ku.TABLE_SCHEMA, ku.TABLE_NAME, ku.COLUMN_NAME
    FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
    INNER JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
      ON tc.CONSTRAINT_SCHEMA = ku.CONSTRAINT_SCHEMA
      AND tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
    WHERE tc.CONSTRAINT_TYPE = N'PRIMARY KEY'
    ${pkFilter}
  `);

  const pkSet = new Set<string>();
  for (const row of pkR.recordset) {
    pkSet.add(`${tableKey(row.TABLE_SCHEMA, row.TABLE_NAME)}:${row.COLUMN_NAME}`);
  }

  const fkR = await pool.request().query<{
    fk_name: string;
    parent_schema: string;
    parent_table: string;
    parent_column: string;
    referenced_schema: string;
    referenced_table: string;
    referenced_column: string;
    ord: number;
  }>(`
    SELECT
      fk.name AS fk_name,
      OBJECT_SCHEMA_NAME(fk.parent_object_id) AS parent_schema,
      OBJECT_NAME(fk.parent_object_id) AS parent_table,
      cp.name AS parent_column,
      OBJECT_SCHEMA_NAME(fk.referenced_object_id) AS referenced_schema,
      OBJECT_NAME(fk.referenced_object_id) AS referenced_table,
      cr.name AS referenced_column,
      fkc.constraint_column_id AS ord
    FROM sys.foreign_keys fk
    INNER JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
    INNER JOIN sys.columns cp
      ON cp.object_id = fkc.parent_object_id AND cp.column_id = fkc.parent_column_id
    INNER JOIN sys.columns cr
      ON cr.object_id = fkc.referenced_object_id AND cr.column_id = fkc.referenced_column_id
    ORDER BY fk.name, fkc.constraint_column_id
  `);

  const colByTable = new Map<string, NobleColumnJson[]>();
  for (const c of colsR.recordset) {
    const tk = tableKey(c.TABLE_SCHEMA, c.TABLE_NAME);
    if (!tableSet.has(tk)) continue;
    const col: NobleColumnJson = {
      name: c.COLUMN_NAME,
      ordinal: c.ORDINAL_POSITION,
      dataType: c.DATA_TYPE,
      charMaxLength: c.CHARACTER_MAXIMUM_LENGTH,
      numericPrecision: c.NUMERIC_PRECISION,
      numericScale: c.NUMERIC_SCALE,
      nullable: c.IS_NULLABLE === 'YES',
      isPrimaryKey: pkSet.has(`${tk}:${c.COLUMN_NAME}`),
    };
    if (!colByTable.has(tk)) colByTable.set(tk, []);
    colByTable.get(tk)!.push(col);
  }

  const tables: NobleTableJson[] = tablesR.recordset.map((row) => {
    const tk = tableKey(row.TABLE_SCHEMA, row.TABLE_NAME);
    const columns = (colByTable.get(tk) ?? []).sort((a, b) => a.ordinal - b.ordinal);
    return {
      schema: row.TABLE_SCHEMA,
      name: row.TABLE_NAME,
      fullName: tk,
      columns,
    };
  });

  const foreignKeys: NobleForeignKeyJson[] = [];
  const seenFkCol = new Set<string>();
  for (const fk of fkR.recordset) {
    if (
      fk.parent_schema == null ||
      fk.parent_table == null ||
      fk.referenced_schema == null ||
      fk.referenced_table == null
    ) {
      continue;
    }
    const fromK = tableKey(fk.parent_schema, fk.parent_table);
    const toK = tableKey(fk.referenced_schema, fk.referenced_table);
    if (!tableSet.has(fromK) || !tableSet.has(toK)) continue;
    const dedupe = `${fk.fk_name}|${fromK}.${fk.parent_column}|${toK}.${fk.referenced_column}`;
    if (seenFkCol.has(dedupe)) continue;
    seenFkCol.add(dedupe);
    foreignKeys.push({
      name: fk.fk_name,
      fromSchema: fk.parent_schema,
      fromTable: fk.parent_table,
      fromColumn: fk.parent_column,
      toSchema: fk.referenced_schema,
      toTable: fk.referenced_table,
      toColumn: fk.referenced_column,
    });
  }

  const schemasRequested: NobleSchemaPayload['schemasRequested'] = opts.allSchemas ? 'all' : opts.schemas;

  return {
    database,
    schemasRequested,
    generatedAt: new Date().toISOString(),
    tableCount: tables.length,
    tables,
    foreignKeys,
  };
}
