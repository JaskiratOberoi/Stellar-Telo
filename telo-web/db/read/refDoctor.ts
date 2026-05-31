import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';
import { cached } from '@/lib/cache';

/**
 * Referring doctor for a patient — the report's "Ref. Doctor" line. The
 * worksheet feed carries the referring customer/client but not the doctor, so
 * we read it from `tbl_med_mcc_patient_master` (FK `ref_doctor` →
 * `tbl_med_mcc_doctors.doctor_name`), falling back to the free-text
 * `ref_doctor_other` when no master row is linked.
 */
export async function getReferringDoctor(pid: number): Promise<string | null> {
  if (!Number.isInteger(pid)) return null;

  return cached<string | null>(`telo:report:refdoc:${pid}`, 60 * 60, () =>
    withRetry(async () => {
      const pool = await getPool();
      const r = await pool
        .request()
        .input('pid', sql.Int, pid)
        .query<{ doctorName: string | null; doctorOther: string | null }>(`
          SELECT TOP (1)
            d.doctor_name      AS doctorName,
            p.ref_doctor_other AS doctorOther
          FROM dbo.tbl_med_mcc_patient_master p
          LEFT JOIN dbo.tbl_med_mcc_doctors d ON d.id = p.ref_doctor
          WHERE p.id = @pid
        `);
      const row = r.recordset[0];
      if (!row) return null;
      return row.doctorName?.trim() || row.doctorOther?.trim() || null;
    }),
  );
}
