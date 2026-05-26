'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/auth/session';
import { hasCapability } from '@/auth/rbac';
import { getPool, sql, withRetry } from '@/db/pool';
import { getAllMccInvoiceConfigs } from '@/db/read/invoiceConfig';
import { fetchAllActiveMccs, fetchScopedMccUnits } from '@/db/read/mccUnits';
import { getMccScope } from '@/auth/scope';

// SQL Server param hard-cap is 2100; keep an IN-list well below to leave room
// for the request's own bindings. Anything above this means the caller is an
// unrestricted role (Super Admin / Admin) — fetch the full active MCC list.
const SCOPED_IN_LIST_CAP = 1000;

export interface InvoiceConfigState {
  error: string | null;
  ok: boolean;
}

/**
 * Upsert the invoice branding config for one MCC.
 * Only users with `user:manage` capability may call this.
 */
export async function saveInvoiceConfigAction(
  _prev: InvoiceConfigState,
  formData: FormData,
): Promise<InvoiceConfigState> {
  const user = await requireSession();
  if (!hasCapability(user.caps, 'user:manage')) {
    return { error: 'Unauthorized', ok: false };
  }

  const mccId = Number(formData.get('mccId'));
  if (!Number.isInteger(mccId) || mccId <= 0) {
    return { error: 'Invalid MCC', ok: false };
  }

  const labName = ((formData.get('labName') as string) ?? '').trim() || null;
  const address = ((formData.get('address') as string) ?? '').trim() || null;
  const phone   = ((formData.get('phone')   as string) ?? '').trim() || null;
  const email   = ((formData.get('email')   as string) ?? '').trim() || null;

  try {
    await withRetry(async () => {
      const pool = await getPool();
      await pool
        .request()
        .input('mid',     sql.Int,           mccId)
        .input('labName', sql.NVarChar(200),  labName)
        .input('address', sql.NVarChar(500),  address)
        .input('phone',   sql.NVarChar(50),   phone)
        .input('email',   sql.NVarChar(200),  email)
        .query(`
          IF EXISTS (SELECT 1 FROM dbo.telo_mcc_invoice_config WHERE mcc_id = @mid)
            UPDATE dbo.telo_mcc_invoice_config
               SET lab_name   = @labName,
                   address    = @address,
                   phone      = @phone,
                   email      = @email,
                   updated_at = GETUTCDATE()
             WHERE mcc_id = @mid
          ELSE
            INSERT INTO dbo.telo_mcc_invoice_config
              (mcc_id, lab_name, address, phone, email)
            VALUES
              (@mid, @labName, @address, @phone, @email)
        `);
    });
    revalidatePath('/admin/invoice');
    return { error: null, ok: true };
  } catch (err) {
    console.error('saveInvoiceConfigAction failed:', err);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Invalid object name')) {
      return { error: 'Database table not yet created. Run db/sql/06_table_telo_mcc_invoice_config.sql first.', ok: false };
    }
    return { error: 'Failed to save. Please try again.', ok: false };
  }
}

/**
 * Fetch every MCC in scope merged with its invoice config.
 * Used to populate the admin invoice-config management page.
 *
 * Unrestricted roles (Super Admin / Admin) have scope = every active MCC
 * (~1.7k rows). That can't be passed as a single SQL IN-list, so we fall
 * back to fetchAllActiveMccs() which scans the master table directly.
 */
export async function getInvoiceConfigOverview() {
  const user = await requireSession();
  const scope = await getMccScope(user.uid);

  const mccsPromise =
    scope.length === 0
      ? Promise.resolve([])
      : scope.length <= SCOPED_IN_LIST_CAP
        ? fetchScopedMccUnits(scope)
        : fetchAllActiveMccs();

  const [mccs, configs] = await Promise.all([
    mccsPromise,
    getAllMccInvoiceConfigs(),
  ]);
  const configMap = new Map(configs.map((c) => [c.mccId, c]));
  return mccs.map((m) => ({
    mccId: m.id,
    mccCode: m.code,
    mccName: m.name,
    config: configMap.get(m.id) ?? null,
  }));
}
