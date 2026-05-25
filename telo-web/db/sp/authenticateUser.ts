import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';
import type { AuthRow } from '@/types/auth';

/**
 * Calls dbo.usp_telo_authenticate. Plaintext password is passed as a typed
 * parameter (not concatenated) — the SP mirrors the legacy LIS check exactly.
 * Returns the auth row on success, or null on bad credentials / inactive user.
 */
export async function authenticateUser(
  username: string,
  password: string,
): Promise<AuthRow | null> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('Username', sql.NVarChar(50), username)
      .input('Password', sql.NVarChar(50), password)
      .execute<AuthRow>('dbo.usp_telo_authenticate');
    return r.recordset[0] ?? null;
  });
}
