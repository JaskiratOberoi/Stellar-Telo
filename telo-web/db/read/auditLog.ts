import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

/**
 * Reader for dbo.telo_audit_log — the persistent Telo audit trail behind the
 * "Audit trail" tab. Modelled on the LIS Audit_Trail.aspx viewer
 * (username / PID / SID / date / function filters over
 * TBL_MED_USER_ACTIVITY_LOG) but improved: events keep a machine-readable
 * `kind`, so filtering is by CATEGORY (reports / users / billing / …) instead
 * of substring-matching prose, and the free-text search still covers the
 * kind + JSON details (so a SID, bill number or role name finds its events).
 */

export type AuditCategory =
  | 'all'
  | 'reports'
  | 'users'
  | 'auth'
  | 'orders'
  | 'payments'
  | 'samples';

/** kind LIKE prefixes per category — single source of truth for the filter. */
const CATEGORY_PREFIXES: Record<Exclude<AuditCategory, 'all'>, string[]> = {
  reports: ['report.%'],
  users: ['admin.%'],
  auth: ['login.%', 'session.%'],
  orders: ['order.%', 'bill.%', 'patient.%'],
  payments: ['payment.%', 'receipt.%', 'mcc.%'],
  samples: ['sample.%'],
};

export interface AuditRow {
  id: number;
  /** ISO timestamp (UTC instant of the DB's SYSDATETIME). */
  at: string;
  kind: string;
  actorId: number | null;
  /** Resolved LIS username of the actor (or the typed username on login events). */
  actorUsername: string | null;
  /** Actor's display name from the LIS user master. */
  actorName: string | null;
  /** JSON payload of the event's remaining fields. */
  details: string | null;
}

export interface AuditFilters {
  /** ISO date (yyyy-mm-dd), inclusive. */
  from?: string | null;
  /** ISO date (yyyy-mm-dd), inclusive. */
  to?: string | null;
  category?: AuditCategory;
  /** Matches actor username OR display name (LIKE). */
  actor?: string | null;
  /** Free text over kind + details JSON (SIDs, bill ids, roles, …). */
  q?: string | null;
  page?: number;
  pageSize?: number;
}

export interface AuditPage {
  rows: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listAuditLog(filters: AuditFilters): Promise<AuditPage> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(Math.max(filters.pageSize ?? 50, 10), 200);
  const category = filters.category ?? 'all';

  return withRetry(async () => {
    const pool = await getPool();
    const req = pool.request();

    const where: string[] = [];
    if (filters.from && /^\d{4}-\d{2}-\d{2}$/.test(filters.from)) {
      req.input('from', sql.VarChar(10), filters.from);
      where.push(`a.at >= @from`);
    }
    if (filters.to && /^\d{4}-\d{2}-\d{2}$/.test(filters.to)) {
      req.input('to', sql.VarChar(10), filters.to);
      // Inclusive end-of-day.
      where.push(`a.at < DATEADD(DAY, 1, CONVERT(DATETIME2(3), @to))`);
    }
    if (category !== 'all') {
      const prefixes = CATEGORY_PREFIXES[category] ?? [];
      const ors = prefixes.map((p, i) => {
        req.input(`k${i}`, sql.VarChar(60), p);
        return `a.kind LIKE @k${i}`;
      });
      if (ors.length > 0) where.push(`(${ors.join(' OR ')})`);
    }
    const actor = (filters.actor ?? '').trim();
    if (actor) {
      req.input('actor', sql.NVarChar(100), `%${actor.replace(/[%_[\]]/g, ' ')}%`);
      where.push(
        `(u.Username LIKE @actor OR a.username LIKE @actor
          OR LTRIM(RTRIM(CONCAT(u.firstname, ' ', u.lastname))) LIKE @actor)`,
      );
    }
    const q = (filters.q ?? '').trim();
    if (q) {
      req.input('q', sql.NVarChar(200), `%${q.replace(/[%_[\]]/g, ' ')}%`);
      where.push(`(a.kind LIKE @q OR a.details LIKE @q)`);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    req.input('offset', sql.Int, (page - 1) * pageSize);
    req.input('limit', sql.Int, pageSize);

    const r = await req.query<{
      id: number;
      at: Date;
      kind: string;
      actorId: number | null;
      actorUsername: string | null;
      actorName: string | null;
      details: string | null;
      total: number;
    }>(`
      SELECT
        a.id, a.at, a.kind,
        a.actor_id AS actorId,
        COALESCE(u.Username, a.username) AS actorUsername,
        NULLIF(LTRIM(RTRIM(CONCAT(u.firstname, ' ', u.lastname))), '') AS actorName,
        a.details,
        COUNT(*) OVER () AS total
      FROM dbo.telo_audit_log a
      LEFT JOIN dbo.tbl_med_user_master u ON u.id = a.actor_id
      ${whereSql}
      ORDER BY a.id DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    return {
      rows: r.recordset.map((x) => ({
        id: x.id,
        at: x.at.toISOString(),
        kind: x.kind,
        actorId: x.actorId ?? null,
        actorUsername: x.actorUsername ? x.actorUsername.trim() : null,
        actorName: x.actorName ? x.actorName.trim() : null,
        details: x.details ?? null,
      })),
      total: r.recordset[0]?.total ?? 0,
      page,
      pageSize,
    };
  });
}
