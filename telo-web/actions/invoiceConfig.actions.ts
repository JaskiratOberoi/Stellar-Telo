'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/auth/session';
import { requireCapability } from '@/auth/guards';
import { hasCapability } from '@/auth/rbac';
import { getPool, sql, withRetry } from '@/db/pool';
import {
  getAllMccInvoiceConfigs,
  invalidateMccInvoiceLogo,
} from '@/db/read/invoiceConfig';
import { fetchAllActiveMccs, fetchScopedMccUnits } from '@/db/read/mccUnits';
import { getMccScope } from '@/auth/scope';
import { readTopRightLogo } from '@/lib/invoice-logo';

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

  const labName    = ((formData.get('labName')    as string) ?? '').trim() || null;
  const address    = ((formData.get('address')    as string) ?? '').trim() || null;
  const city       = ((formData.get('city')       as string) ?? '').trim() || null;
  const stateNm    = ((formData.get('state')      as string) ?? '').trim() || null;
  const pincode    = ((formData.get('pincode')    as string) ?? '').trim() || null;
  const phone      = ((formData.get('phone')      as string) ?? '').trim() || null;
  const email      = ((formData.get('email')      as string) ?? '').trim() || null;
  const preparedBy = ((formData.get('preparedBy') as string) ?? '').trim() || null;
  const removeLogo = formData.get('removeLogo') === '1';

  // Bill toggles. Like the layout block, only written when the form posted them
  // (flagsSubmitted=1). 'auto' / unknown → NULL (resolved MDCARE-aware at print).
  const flagsSubmitted = formData.get('flagsSubmitted') === '1';
  const obmRaw = ((formData.get('onBehalfMode') as string) ?? '').toLowerCase();
  const onBehalfMode: string | null = flagsSubmitted
    ? (obmRaw === 'client' ? 'client' : obmRaw === 'qugen' ? 'qugen' : null)
    : null;
  const triState = (v: string): number | null =>
    v === 'on' ? 1 : v === 'off' ? 0 : null;
  const showDisclaimer = flagsSubmitted
    ? triState(((formData.get('showDisclaimer') as string) ?? '').toLowerCase())
    : null;
  const showSignatory = flagsSubmitted
    ? triState(((formData.get('showSignatory') as string) ?? '').toLowerCase())
    : null;

  // Layout controls. Checkbox inputs only appear in the form when checked, so a
  // missing value means "false" — that's why visibility is read with a hidden
  // companion field (logoVisibleSubmitted=1) signalling the form posted them.
  const layoutSubmitted = formData.get('layoutSubmitted') === '1';
  const noblePosRaw = ((formData.get('nobleLogoPosition') as string) ?? '').toLowerCase();
  const nobleLogoPosition: 'left' | 'right' | null = layoutSubmitted
    ? (noblePosRaw === 'right' ? 'right' : 'left')
    : null;
  const nobleLogoVisible = layoutSubmitted
    ? (formData.get('nobleLogoVisible') === '1' ? 1 : 0)
    : null;
  const customLogoVisible = layoutSubmitted
    ? (formData.get('customLogoVisible') === '1' ? 1 : 0)
    : null;

  let logoUpload: { buffer: Buffer; mime: string } | null = null;
  try {
    logoUpload = await readTopRightLogo(formData);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Invalid logo file.';
    return { error: msg, ok: false };
  }

  // Logo column behaviour:
  //   removeLogo=true   → set both columns NULL
  //   logoUpload=<file> → write bytes+mime
  //   neither           → leave existing values untouched on UPDATE; NULL on INSERT
  const logoBytes = removeLogo ? null : logoUpload?.buffer ?? null;
  const logoMime = removeLogo ? null : logoUpload?.mime ?? null;
  const writeLogo = removeLogo || !!logoUpload;

  try {
    await withRetry(async () => {
      const pool = await getPool();
      const exists = await pool
        .request()
        .input('mid', sql.Int, mccId)
        .query<{ n: number }>(
          `SELECT COUNT(*) AS n FROM dbo.telo_mcc_invoice_config WHERE mcc_id = @mid`,
        );
      const rowExists = (exists.recordset[0]?.n ?? 0) > 0;

      const setClauses: string[] = [
        'lab_name    = @labName',
        'address     = @address',
        'city        = @city',
        'state       = @state',
        'pincode     = @pincode',
        'phone       = @phone',
        'email       = @email',
        'prepared_by = @preparedBy',
        'updated_at  = GETUTCDATE()',
      ];
      if (writeLogo) {
        setClauses.push('top_right_logo_bytes = @logoBytes');
        setClauses.push('top_right_logo_mime  = @logoMime');
      }
      if (layoutSubmitted) {
        setClauses.push('noble_logo_position = @nobleLogoPosition');
        setClauses.push('noble_logo_visible  = @nobleLogoVisible');
        setClauses.push('custom_logo_visible = @customLogoVisible');
      }
      if (flagsSubmitted) {
        setClauses.push('on_behalf_mode  = @onBehalfMode');
        setClauses.push('show_disclaimer = @showDisclaimer');
        setClauses.push('show_signatory  = @showSignatory');
      }

      const req = pool
        .request()
        .input('mid', sql.Int, mccId)
        .input('labName', sql.NVarChar(200), labName)
        .input('address', sql.NVarChar(500), address)
        .input('city', sql.NVarChar(120), city)
        .input('state', sql.NVarChar(120), stateNm)
        .input('pincode', sql.NVarChar(20), pincode)
        .input('phone', sql.NVarChar(50), phone)
        .input('email', sql.NVarChar(200), email)
        .input('preparedBy', sql.NVarChar(120), preparedBy);

      if (writeLogo) {
        req.input('logoBytes', sql.VarBinary(sql.MAX), logoBytes);
        req.input('logoMime', sql.NVarChar(64), logoMime);
      }
      if (layoutSubmitted) {
        req.input('nobleLogoPosition', sql.NVarChar(8), nobleLogoPosition);
        req.input('nobleLogoVisible', sql.Bit, nobleLogoVisible);
        req.input('customLogoVisible', sql.Bit, customLogoVisible);
      }
      if (flagsSubmitted) {
        req.input('onBehalfMode', sql.VarChar(12), onBehalfMode);
        req.input('showDisclaimer', sql.Bit, showDisclaimer);
        req.input('showSignatory', sql.Bit, showSignatory);
      }

      if (rowExists) {
        await req.query(`
          UPDATE dbo.telo_mcc_invoice_config
             SET ${setClauses.join(', ')}
           WHERE mcc_id = @mid
        `);
      } else {
        // Insert with all columns; layout/logo columns default to NULL when not submitted.
        if (!writeLogo) {
          req.input('logoBytes', sql.VarBinary(sql.MAX), null);
          req.input('logoMime', sql.NVarChar(64), null);
        }
        if (!layoutSubmitted) {
          req.input('nobleLogoPosition', sql.NVarChar(8), null);
          req.input('nobleLogoVisible', sql.Bit, null);
          req.input('customLogoVisible', sql.Bit, null);
        }
        if (!flagsSubmitted) {
          req.input('onBehalfMode', sql.VarChar(12), null);
          req.input('showDisclaimer', sql.Bit, null);
          req.input('showSignatory', sql.Bit, null);
        }
        await req.query(`
          INSERT INTO dbo.telo_mcc_invoice_config
            (mcc_id, lab_name, address, city, state, pincode, phone, email,
             top_right_logo_bytes, top_right_logo_mime,
             noble_logo_position, noble_logo_visible, custom_logo_visible,
             prepared_by, on_behalf_mode, show_disclaimer, show_signatory)
          VALUES
            (@mid, @labName, @address, @city, @state, @pincode, @phone, @email,
             @logoBytes, @logoMime,
             @nobleLogoPosition, @nobleLogoVisible, @customLogoVisible,
             @preparedBy, @onBehalfMode, @showDisclaimer, @showSignatory)
        `);
      }
    });
    // If the write touched the logo bytes (upload or removal), bust the
    // Redis cache so the next /api/mcc-invoice-logo/[mccId] read picks up
    // the new ETag immediately instead of waiting for the 1h TTL.
    if (writeLogo) {
      await invalidateMccInvoiceLogo(mccId);
    }
    revalidatePath('/admin/invoice');
    return { error: null, ok: true };
  } catch (err) {
    console.error('saveInvoiceConfigAction failed:', err);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Invalid object name')) {
      return {
        error:
          'Database table not yet created. Run db/sql/06_table_telo_mcc_invoice_config.sql first.',
        ok: false,
      };
    }
    if (msg.includes('Invalid column name')) {
      return {
        error:
          'Invoice columns missing. Run the db/sql migrations (07, 08, 09, and 17_alter_telo_mcc_invoice_config_add_b2b_fields.sql).',
        ok: false,
      };
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
  // Action-layer cap check (defence-in-depth). The /admin/invoice page also
  // gates on user:manage; this guard means the action itself rejects calls
  // from any other surface (including direct fetch) too.
  const user = await requireCapability('user:manage');
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
