import 'server-only';
import Redis from 'ioredis';
import { env } from '@/lib/env';

/**
 * Redis singleton — sessions adjuncts + lookup/scope cache. Lazy so build
 * (no Redis) doesn't connect. Cache misses must never break a request:
 * callers fall back to the source of truth on any Redis error.
 */
let client: Redis | null = null;

export function redis(): Redis {
  if (!client) {
    client = new Redis(env().REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
    });
    client.on('error', () => {
      /* swallow — callers degrade gracefully */
    });
  }
  return client;
}

/** Get JSON or compute+cache. Redis failures degrade to a direct compute. */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  compute: () => Promise<T>,
): Promise<T> {
  const r = redis();
  try {
    const hit = await r.get(key);
    if (hit) return JSON.parse(hit) as T;
  } catch {
    return compute();
  }
  const value = await compute();
  try {
    await r.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch {
    /* best-effort */
  }
  return value;
}
