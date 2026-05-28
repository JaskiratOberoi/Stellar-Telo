import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';
import { cached, redis } from '@/lib/cache';

/** Cache key for one user's session-version snapshot. */
function svKey(userId: number): string {
  return `telo:sv:${userId}`;
}

/**
 * Current session version for a user. Defaults to 0 when the row does not
 * exist yet (first-ever login, or no admin action has ever bumped them).
 * Returns 0 on any DB / Redis failure — the design intentionally fails OPEN
 * for session checks so a Redis outage doesn't log everyone out. The real
 * security gates (capability + scope) run on every request regardless.
 *
 * Cached 30s in Redis to amortize across the burst of `auth()` calls that
 * happens on every page render in App Router.
 */
export async function getSessionVersion(userId: number): Promise<number> {
  if (!Number.isInteger(userId) || userId <= 0) return 0;
  try {
    return await cached(svKey(userId), 30, async () => {
      try {
        return await withRetry(async () => {
          const pool = await getPool();
          const r = await pool
            .request()
            .input('uid', sql.Int, userId)
            .query<{ version: number | null }>(
              `SELECT version FROM dbo.telo_user_session_version WHERE user_id = @uid`,
            );
          return r.recordset[0]?.version ?? 0;
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Table doesn't exist yet (migration not applied) — degrade quietly
        // so the auth flow keeps working until the migration ships.
        if (msg.includes('Invalid object name')) return 0;
        throw err;
      }
    });
  } catch {
    return 0;
  }
}

/**
 * Bump the session version for a user — call after ANY admin write that
 * should immediately revoke an existing JWT (deactivation, role change,
 * password reset, profile update). UPSERT semantics: inserts a row at
 * version 1 for users who don't have one yet, otherwise increments by 1.
 *
 * Best-effort: a DB failure here does NOT block the admin action that
 * triggered it (the action audit log + UI confirmation still happen).
 * Worst case the user keeps their old JWT until natural expiry — same as
 * the pre-fix behaviour, no regression. Always busts the Redis cache so
 * the next session check sees fresh data.
 */
export async function bumpSessionVersion(
  userId: number,
  actorUserId?: number | null,
): Promise<void> {
  if (!Number.isInteger(userId) || userId <= 0) return;
  try {
    await withRetry(async () => {
      const pool = await getPool();
      await pool
        .request()
        .input('uid', sql.Int, userId)
        .input('actor', sql.Int, actorUserId ?? null)
        .query(`
          MERGE dbo.telo_user_session_version AS tgt
          USING (SELECT @uid AS user_id) AS src
            ON tgt.user_id = src.user_id
          WHEN MATCHED THEN
            UPDATE SET version = tgt.version + 1,
                       updated_at = SYSUTCDATETIME(),
                       updated_by = @actor
          WHEN NOT MATCHED THEN
            INSERT (user_id, version, updated_at, updated_by)
            VALUES (@uid, 1, SYSUTCDATETIME(), @actor);
        `);
    });
  } catch {
    /* best-effort — fall through to cache bust regardless */
  }
  try {
    await redis().del(svKey(userId));
  } catch {
    /* best-effort */
  }
}
