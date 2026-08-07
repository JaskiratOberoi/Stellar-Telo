import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';
import {
  EMPTY_AUTH_BITS,
  AUTH_BIT_LABELS,
  type LisAuthBits,
} from '@/lib/lis-security';

export type { LisAuthBits };
export { EMPTY_AUTH_BITS, AUTH_BIT_LABELS };

export interface LisUsertypeRow {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  userCount: number;
}

export interface LisMenuTitle {
  id: number;
  name: string;
}

export interface LisMenuItem {
  id: number;
  titleId: number;
  label: string;
  url: string | null;
  order: number | null;
}

export async function fetchAllLisUsertypes(): Promise<LisUsertypeRow[]> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool.request().query<{
      id: number;
      name: string | null;
      description: string | null;
      is_active: boolean;
      user_count: number;
    }>(`
      SELECT u.id, u.Name AS name, u.Description AS description,
             CAST(ISNULL(u.IsActive, 0) AS BIT) AS is_active,
             (SELECT COUNT(*) FROM dbo.tbl_med_user_master m WHERE m.usertypeid = u.id) AS user_count
      FROM dbo.tbl_med_usertypes u
      ORDER BY u.Name
    `);
    return r.recordset.map((x) => ({
      id: x.id,
      name: (x.name ?? '').trim(),
      description: x.description?.trim() || null,
      isActive: !!x.is_active,
      userCount: Number(x.user_count) || 0,
    }));
  });
}

export async function fetchLisMenuCatalog(): Promise<{
  titles: LisMenuTitle[];
  items: LisMenuItem[];
}> {
  return withRetry(async () => {
    const pool = await getPool();
    const [titles, items] = await Promise.all([
      pool.request().query<{ id: number; menu_name: string | null }>(`
        SELECT id, menu_name FROM dbo.tbl_med_menu_title_master
        WHERE IsActive = 1 ORDER BY id
      `),
      pool.request().query<{
        id: number;
        menu_id: number;
        page_title: string | null;
        page_url: string | null;
        ord: number | null;
      }>(`
        SELECT id, menu_id, page_title, page_url, [order] AS ord
        FROM dbo.tbl_med_menu_master
        ORDER BY menu_id, [order], id
      `),
    ]);
    return {
      titles: titles.recordset.map((t) => ({
        id: t.id,
        name: (t.menu_name ?? '').trim() || `Menu ${t.id}`,
      })),
      items: items.recordset.map((m) => ({
        id: m.id,
        titleId: m.menu_id,
        label: (m.page_title ?? '').trim() || `Menu #${m.id}`,
        url: m.page_url,
        order: m.ord,
      })),
    };
  });
}

export async function fetchUsertypeSecurity(usertypeId: number): Promise<{
  menuIds: number[];
  authBits: LisAuthBits;
}> {
  return withRetry(async () => {
    const pool = await getPool();
    const menus = await pool
      .request()
      .input('ut', sql.Int, usertypeId)
      .query<{ menuid: number }>(`
        SELECT menuid FROM dbo.tbl_med_security_master
        WHERE usertype = @ut
      `);
    const auth = await pool
      .request()
      .input('ut', sql.Int, usertypeId)
      .query<LisAuthBits>(`
        SELECT
          CAST(ISNULL(Auth, 0) AS BIT) AS Auth,
          CAST(ISNULL(EditPatientTests, 0) AS BIT) AS EditPatientTests,
          CAST(ISNULL(Result_Entry, 0) AS BIT) AS Result_Entry,
          CAST(ISNULL(Result_Edit, 0) AS BIT) AS Result_Edit,
          CAST(ISNULL(Reject_Sample, 0) AS BIT) AS Reject_Sample,
          CAST(ISNULL(Edit_Sales_target, 0) AS BIT) AS Edit_Sales_target,
          CAST(ISNULL(patient_details, 0) AS BIT) AS patient_details,
          CAST(ISNULL(Discount, 0) AS BIT) AS Discount,
          CAST(ISNULL(Covid19, 0) AS BIT) AS Covid19
        FROM dbo.tbl_med_mcc_user_security_auth
        WHERE user_type = @ut
      `);
    const row = auth.recordset[0];
    return {
      menuIds: menus.recordset.map((m) => m.menuid),
      authBits: row
        ? {
            Auth: !!row.Auth,
            EditPatientTests: !!row.EditPatientTests,
            Result_Entry: !!row.Result_Entry,
            Result_Edit: !!row.Result_Edit,
            Reject_Sample: !!row.Reject_Sample,
            Edit_Sales_target: !!row.Edit_Sales_target,
            patient_details: !!row.patient_details,
            Discount: !!row.Discount,
            Covid19: !!row.Covid19,
          }
        : { ...EMPTY_AUTH_BITS },
    };
  });
}
