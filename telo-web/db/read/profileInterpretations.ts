import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

/**
 * Telo-owned, profile-level clinical-significance text (table
 * dbo.telo_profile_interpretation, keyed by tbl_med_test_profile_master.id).
 * Read for the report (a profileId → text map) and listed for the admin editor.
 */

/**
 * Map of profile_id → interpretation for every profile that has one. Resilient:
 * if the sidecar table hasn't been deployed yet, returns an empty map so the
 * report still renders.
 */
export async function getProfileInterpretations(): Promise<Record<number, string>> {
  try {
    return await withRetry(async () => {
      const pool = await getPool();
      const r = await pool.request().query<{
        profile_id: number;
        interpretation: string | null;
      }>(`
        SELECT profile_id, CAST(interpretation AS NVARCHAR(MAX)) AS interpretation
        FROM dbo.telo_profile_interpretation
        WHERE interpretation IS NOT NULL AND LEN(CAST(interpretation AS NVARCHAR(MAX))) > 0
      `);
      const map: Record<number, string> = {};
      for (const x of r.recordset) {
        const t = (x.interpretation ?? '').trim();
        if (t) map[x.profile_id] = t;
      }
      return map;
    });
  } catch {
    // Table not deployed yet (or transient) — degrade to no profile notes.
    return {};
  }
}

export interface ProfileInterpRow {
  profileId: number;
  code: string;
  name: string;
  interpretation: string | null;
}

/** All active profiles with their current Telo interpretation (for the admin
 *  editor). LEFT JOIN so profiles without one still appear. */
export async function listProfilesWithInterpretation(): Promise<ProfileInterpRow[]> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool.request().query<{
      profileId: number;
      code: string | null;
      name: string | null;
      interpretation: string | null;
    }>(`
      SELECT p.id AS profileId, p.Profile_Code AS code, p.Profile_Name AS name,
             CAST(pi.interpretation AS NVARCHAR(MAX)) AS interpretation
      FROM dbo.tbl_med_test_profile_master p
      LEFT JOIN dbo.telo_profile_interpretation pi ON pi.profile_id = p.id
      WHERE p.IsActive = 1
      ORDER BY p.Profile_Name
    `);
    return r.recordset.map((x) => ({
      profileId: x.profileId,
      code: (x.code ?? '').trim(),
      name: (x.name ?? '').trim(),
      interpretation: x.interpretation,
    }));
  });
}

/** Upsert one profile's interpretation. Empty/whitespace clears it (row kept,
 *  interpretation set to NULL). */
export async function upsertProfileInterpretation(
  profileId: number,
  interpretation: string | null,
  actorUid: number,
): Promise<void> {
  await withRetry(async () => {
    const pool = await getPool();
    const text = (interpretation ?? '').trim();
    await pool
      .request()
      .input('pid', sql.Int, profileId)
      .input('txt', sql.NVarChar(sql.MAX), text || null)
      .input('uid', sql.Int, actorUid)
      .query(`
        MERGE dbo.telo_profile_interpretation AS t
        USING (SELECT @pid AS profile_id) AS s
          ON t.profile_id = s.profile_id
        WHEN MATCHED THEN
          UPDATE SET interpretation = @txt, updated_by = @uid, updated_at = SYSDATETIME()
        WHEN NOT MATCHED THEN
          INSERT (profile_id, interpretation, updated_by) VALUES (@pid, @txt, @uid);
      `);
  });
}
