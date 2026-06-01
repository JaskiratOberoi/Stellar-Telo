import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

// usertypeids that bypass MCC scoping in the legacy LIS (act on any centre).
const UNRESTRICTED_USERTYPES = [1 /* Super Admin */, 5 /* Admin */];

// Client-side logins (a collection-centre/customer account, e.g. "DL0002").
// These are hard-locked to their OWN centre and can never act on another MCC,
// even if an admin has added sales-mcc mappings to them.
const CLIENT_USERTYPES = [
  2 /* Client */,
  7 /* Sub Client */,
  8 /* CLIENT REPORTING */,
  10 /* CLIENT ACCESSION */,
  12 /* CLIENT INVOICE */,
];

/**
 * Allowed MCC id set for a user.
 *
 * - Unrestricted roles (Super Admin / Admin) → ALL active MCC units, mirroring
 *   the legacy LIS where those roles are not centre-scoped.
 * - Client logins (Client / Sub Client / Client Reporting / Accession / Invoice)
 *   → ONLY their own centre (PCC_Id / sub_pcc_id). Sales-mcc mappings are
 *   deliberately ignored so a client can never see or order under another MCC.
 * - Everyone else (staff: sales/marketing, technicians, …) →
 *   tbl_med_user_sales_mcc_mapping rows ∪ their own PCC_Id / sub_pcc_id.
 *
 * Resolved per session and redis-cached by auth/scope.ts. This is read-only on
 * the LIS tables — it never writes to them.
 */
export async function fetchUserMccScope(userId: number): Promise<number[]> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('uid', sql.Int, userId)
      .query<{ mcc_code: number }>(`
        DECLARE @ut INT =
          (SELECT usertypeid FROM dbo.tbl_med_user_master WHERE id = @uid);

        IF @ut IN (${UNRESTRICTED_USERTYPES.join(',')})
          SELECT id AS mcc_code
          FROM dbo.tbl_med_mcc_unit_master
          WHERE IsActive = 1;
        ELSE IF @ut IN (${CLIENT_USERTYPES.join(',')})
          -- Client: own centre only — ignore sales-mcc mappings.
          SELECT u.PCC_Id AS mcc_code FROM dbo.tbl_med_user_master u
          WHERE u.id = @uid AND u.PCC_Id IS NOT NULL AND u.PCC_Id > 0
          UNION
          SELECT u.sub_pcc_id FROM dbo.tbl_med_user_master u
          WHERE u.id = @uid AND u.sub_pcc_id IS NOT NULL AND u.sub_pcc_id > 0;
        ELSE
          SELECT DISTINCT m.mcc_code
          FROM dbo.tbl_med_user_sales_mcc_mapping m
          WHERE m.user_id = @uid AND m.mcc_code IS NOT NULL
          UNION
          SELECT u.PCC_Id FROM dbo.tbl_med_user_master u
          WHERE u.id = @uid AND u.PCC_Id IS NOT NULL AND u.PCC_Id > 0
          UNION
          SELECT u.sub_pcc_id FROM dbo.tbl_med_user_master u
          WHERE u.id = @uid AND u.sub_pcc_id IS NOT NULL AND u.sub_pcc_id > 0;
      `);
    return r.recordset.map((x) => x.mcc_code);
  });
}
