import 'server-only';
import { redis } from '@/lib/cache';

/**
 * Fixed-window rate limiter (redis INCR + EX). Fail-OPEN: if redis is down we
 * allow the request rather than lock everyone out — availability over a
 * best-effort throttle. Used to blunt password brute-force on /login.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; remaining: number }> {
  try {
    const r = redis();
    const k = `telo:rl:${key}`;
    const n = await r.incr(k);
    if (n === 1) await r.expire(k, windowSeconds);
    return { allowed: n <= limit, remaining: Math.max(0, limit - n) };
  } catch {
    return { allowed: true, remaining: limit };
  }
}
