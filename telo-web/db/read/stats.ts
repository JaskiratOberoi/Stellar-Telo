import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

export interface DayStats {
  date: string; // YYYY-MM-DD the stats are for
  bills: number;
  patients: number;
  registrations: number;
  revenue: number;
  collected: number;
  outstanding: number;
  discount: number;
  byStatus: { status: string; count: number }[];
  trend: { date: string; revenue: number }[]; // last 7 days incl. selected
  fetchedAt: string;
}

const EMPTY = (date: string): DayStats => ({
  date, bills: 0, patients: 0, registrations: 0, revenue: 0,
  collected: 0, outstanding: 0, discount: 0, byStatus: [], trend: [],
  fetchedAt: new Date().toISOString(),
});

/** Normalize to YYYY-MM-DD; default = today (server local). */
function normDate(d?: string): string {
  const dt = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T00:00:00') : new Date();
  if (isNaN(dt.getTime())) return new Date().toISOString().slice(0, 10);
  return dt.toISOString().slice(0, 10);
}

/**
 * KPIs for a given date + a 7-day revenue trend ending that date.
 * Scope-aware; >1000 centres (Super Admin/Admin) skips the IN-filter
 * (no-op at that breadth, avoids the 2100-param ceiling).
 */
export async function getStats(
  scope: number[],
  dateISO?: string,
): Promise<DayStats> {
  const date = normDate(dateISO);
  const ids = scope.filter((n) => Number.isInteger(n));
  if (ids.length === 0) return EMPTY(date);
  const unrestricted = ids.length > 1000;

  return withRetry(async () => {
    const pool = await getPool();
    const req = pool.request();
    req.input('d', sql.Date, date);
    let bF = 'WHERE CAST(b.bill_date AS DATE) = @d';
    let rF = 'WHERE CAST(p.sample_date AS DATE) = @d';
    let sF = 'WHERE CAST(s.addeddate AS DATE) = @d';
    let tF = 'WHERE CAST(b.bill_date AS DATE) BETWEEN DATEADD(DAY,-6,@d) AND @d';
    if (!unrestricted) {
      const inList = ids
        .map((c, i) => {
          req.input(`s${i}`, sql.Int, c);
          return `@s${i}`;
        })
        .join(',');
      bF += ` AND b.mcc_code IN (${inList})`;
      rF += ` AND p.mcc_code IN (${inList})`;
      sF += ` AND p2.mcc_code IN (${inList})`;
      tF += ` AND b.mcc_code IN (${inList})`;
    }

    const r = await req.query<Record<string, number | string>>(`
      SELECT
        (SELECT COUNT(*) FROM dbo.tbl_billing_patient_detail b ${bF}) AS bills,
        (SELECT COUNT(DISTINCT b.patientname) FROM dbo.tbl_billing_patient_detail b ${bF}) AS patients,
        (SELECT ISNULL(SUM(b.amount),0) FROM dbo.tbl_billing_patient_detail b ${bF}) AS revenue,
        (SELECT ISNULL(SUM(b.amount_paid),0) FROM dbo.tbl_billing_patient_detail b ${bF}) AS collected,
        (SELECT ISNULL(SUM(b.Balance),0) FROM dbo.tbl_billing_patient_detail b ${bF}) AS outstanding,
        (SELECT ISNULL(SUM(b.discount_amount),0) FROM dbo.tbl_billing_patient_detail b ${bF}) AS discount,
        (SELECT COUNT(*) FROM dbo.tbl_med_mcc_patient_master p ${rF}) AS registrations;

      SELECT st.status AS status, COUNT(*) AS count
      FROM dbo.tbl_med_mcc_patient_samples s
      JOIN dbo.tbl_med_mcc_patient_master p2 ON p2.id = s.patient_id
      LEFT JOIN dbo.tbl_med_mcc_patient_samples_status_master st ON st.id = s.sample_status
      ${sF}
      GROUP BY st.status ORDER BY COUNT(*) DESC;

      SELECT CAST(b.bill_date AS DATE) AS d, ISNULL(SUM(b.amount),0) AS rev
      FROM dbo.tbl_billing_patient_detail b
      ${tF}
      GROUP BY CAST(b.bill_date AS DATE) ORDER BY 1;
    `);

    const sets = r.recordsets as unknown as [
      Record<string, number>[],
      { status: string | null; count: number }[],
      { d: Date | string; rev: number }[],
    ];
    const k = sets[0]?.[0] ?? ({} as Record<string, number>);
    const byStatus = (sets[1] ?? []).map((x) => ({
      status: x.status ?? 'Unknown',
      count: Number(x.count),
    }));

    // Build a dense 7-day series (fill gaps with 0).
    const revByDate = new Map<string, number>();
    for (const t of sets[2] ?? []) {
      const key =
        typeof t.d === 'string' ? t.d.slice(0, 10) : t.d.toISOString().slice(0, 10);
      revByDate.set(key, Number(t.rev));
    }
    const trend: { date: string; revenue: number }[] = [];
    const end = new Date(date + 'T00:00:00');
    for (let i = 6; i >= 0; i--) {
      const dd = new Date(end);
      dd.setDate(end.getDate() - i);
      const key = dd.toISOString().slice(0, 10);
      trend.push({ date: key, revenue: revByDate.get(key) ?? 0 });
    }

    return {
      date,
      bills: Number(k.bills ?? 0),
      patients: Number(k.patients ?? 0),
      registrations: Number(k.registrations ?? 0),
      revenue: Number(k.revenue ?? 0),
      collected: Number(k.collected ?? 0),
      outstanding: Number(k.outstanding ?? 0),
      discount: Number(k.discount ?? 0),
      byStatus,
      trend,
      fetchedAt: new Date().toISOString(),
    };
  });
}
