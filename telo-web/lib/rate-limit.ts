import 'server-only';
import { redis } from '@/lib/cache';
import { logger } from '@/lib/logger';

/**
 * In-process token-bucket fallback for the rare windows when Redis is down.
 * Lives in a single Node process so it does not coordinate across replicas —
 * an attacker could in principle spread attempts across N pods, but they
 * still have to (a) discover the fan-out, and (b) deal with each pod's
 * local limit. Better than fail-open (no limit at all) during an incident.
 *
 * Bounded to ~5k recent keys so memory can't explode under adversarial input.
 */
type Bucket = { count: number; resetAt: number };
const localBuckets = new Map<string, Bucket>();
const MAX_LOCAL_BUCKETS = 5000;

function tickLocal(
  key: string,
  limit: number,
  windowSeconds: number,
): { allowed: boolean; remaining: number } {
  const now = Date.now();
  let b = localBuckets.get(key);
  if (!b || b.resetAt <= now) {
    if (localBuckets.size >= MAX_LOCAL_BUCKETS) {
      // Drop the oldest-inserted key (Map preserves insertion order).
      const oldest = localBuckets.keys().next().value;
      if (oldest) localBuckets.delete(oldest);
    }
    b = { count: 0, resetAt: now + windowSeconds * 1000 };
    localBuckets.set(key, b);
  }
  b.count += 1;
  return {
    allowed: b.count <= limit,
    remaining: Math.max(0, limit - b.count),
  };
}

/**
 * Fixed-window rate limiter (redis INCR + EX) with an in-process fallback.
 *
 * Previously fail-OPEN — a Redis outage silently disabled all throttling,
 * which is the exact moment an attacker would exploit. Now: if Redis is
 * down we degrade to a per-Node in-memory bucket so login (and any other
 * caller) keeps its throttle. Less coordinated across replicas than the
 * Redis path, but vastly better than no limit at all.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; remaining: number }> {
  const k = `telo:rl:${key}`;
  try {
    const r = redis();
    const n = await r.incr(k);
    if (n === 1) await r.expire(k, windowSeconds);
    return { allowed: n <= limit, remaining: Math.max(0, limit - n) };
  } catch (err) {
    // Log once-per-bucket-window worth of warnings — this only fires when
    // Redis is actually down, which should already be paging via /api/health.
    logger.warn({ err, key }, 'rate-limit.redis-down.using-local-fallback');
    return tickLocal(k, limit, windowSeconds);
  }
}
