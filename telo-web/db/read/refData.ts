import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';
import { cached, redis } from '@/lib/cache';

export interface RefEntity {
  id: number;
  code: string | null;
  name: string;
}

const doctorsMccKey = (mccId: number) => `telo:ref:doctors:mcc:${mccId}:v1`;
const customersMccKey = (mccId: number) => `telo:ref:customers:mcc:${mccId}:v1`;

async function loadDoctorsUncached(): Promise<RefEntity[]> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool.request().query<{
      id: number;
      code: string | null;
      name: string | null;
    }>(`
      SELECT id, doctor_code AS code, doctor_name AS name
      FROM dbo.tbl_med_mcc_doctors
      WHERE IsActive = 1 AND doctor_name IS NOT NULL
      ORDER BY doctor_name
    `);
    return r.recordset.map((x) => ({
      id: x.id,
      code: x.code?.trim() ?? null,
      name: (x.name ?? '').trim(),
    }));
  });
}

async function loadCustomersUncached(): Promise<RefEntity[]> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool.request().query<{
      id: number;
      code: string | null;
      name: string | null;
    }>(`
      SELECT id, customer_code AS code, customer_name AS name
      FROM dbo.tbl_med_mcc_customer
      WHERE IsActive = 1 AND customer_name IS NOT NULL
      ORDER BY customer_name
    `);
    return r.recordset.map((x) => ({
      id: x.id,
      code: x.code?.trim() ?? null,
      name: (x.name ?? '').trim(),
    }));
  });
}

export function fetchDoctors(): Promise<RefEntity[]> {
  return cached('telo:ref:doctors:v1', 900, loadDoctorsUncached);
}

export function fetchCustomers(): Promise<RefEntity[]> {
  return cached('telo:ref:customers:v1', 900, loadCustomersUncached);
}

/**
 * Per-MCC referrer lists. In Noble every doctor/customer is owned by exactly
 * one MCC via tbl_med_mcc_doctors.pcc_code / tbl_med_mcc_customer.pcc_code
 * (the column name is misleading — it actually stores the MCC unit id, with
 * 100% historical alignment to bill.mcc_code). The new-order form fetches
 * these per selected Client code so the dropdown only shows referrers that
 * belong to the chosen centre.
 */
async function loadDoctorsForMccUncached(mccId: number): Promise<RefEntity[]> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('mcc', sql.Int, mccId)
      .query<{ id: number; code: string | null; name: string | null }>(`
        SELECT id, doctor_code AS code, doctor_name AS name
        FROM dbo.tbl_med_mcc_doctors
        WHERE IsActive = 1 AND doctor_name IS NOT NULL AND pcc_code = @mcc
        ORDER BY doctor_name
      `);
    return r.recordset.map((x) => ({
      id: x.id,
      code: x.code?.trim() ?? null,
      name: (x.name ?? '').trim(),
    }));
  });
}

async function loadCustomersForMccUncached(mccId: number): Promise<RefEntity[]> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('mcc', sql.Int, mccId)
      .query<{ id: number; code: string | null; name: string | null }>(`
        SELECT id, customer_code AS code, customer_name AS name
        FROM dbo.tbl_med_mcc_customer
        WHERE IsActive = 1 AND customer_name IS NOT NULL AND pcc_code = @mcc
        ORDER BY customer_name
      `);
    return r.recordset.map((x) => ({
      id: x.id,
      code: x.code?.trim() ?? null,
      name: (x.name ?? '').trim(),
    }));
  });
}

export function fetchDoctorsForMcc(mccId: number): Promise<RefEntity[]> {
  return cached(doctorsMccKey(mccId), 900, () => loadDoctorsForMccUncached(mccId));
}

export function fetchCustomersForMcc(mccId: number): Promise<RefEntity[]> {
  return cached(customersMccKey(mccId), 900, () => loadCustomersForMccUncached(mccId));
}

/** Bust the per-MCC ref caches after an order writes a new referrer. */
export async function invalidateRefDataCache(mccId: number): Promise<void> {
  try {
    await redis().del(doctorsMccKey(mccId), customersMccKey(mccId));
  } catch {
    /* best-effort — next read will re-cache from source of truth */
  }
}
