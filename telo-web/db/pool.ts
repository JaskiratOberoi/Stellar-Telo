import 'server-only';
import sql from 'mssql';
import { getTeloPoolConfig } from './config';
import { logger } from '@/lib/logger';

/**
 * Telo's runtime mssql connection pool. The `server-only` boundary keeps the
 * singleton out of client bundles. Pure config lives in ./config so the
 * deploy-sp CLI can reuse it without tripping `server-only`.
 *
 * This module is the ONLY runtime SQL entrypoint. All queries flow through here.
 */

let poolPromise: Promise<sql.ConnectionPool> | null = null;

/** Singleton connection pool (one per server process). */
export async function getPool(): Promise<sql.ConnectionPool> {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(getTeloPoolConfig())
      .connect()
      .catch((e) => {
        poolPromise = null; // allow a later request to retry the initial connect
        throw e;
      });
  }
  return poolPromise;
}

export async function closePool(): Promise<void> {
  if (poolPromise) {
    const p = await poolPromise;
    await p.close();
    poolPromise = null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Snapshot of the pool's current saturation. `null` if the pool hasn't
 * connected yet. Cheap to call — reads in-memory tarn.js counters maintained
 * by mssql. Used by /api/health for ops dashboards.
 */
export async function getPoolStats(): Promise<{
  size: number;
  available: number;
  pending: number;
  borrowed: number;
} | null> {
  if (!poolPromise) return null;
  try {
    const p = await poolPromise;
    // mssql wraps tarn.js — these properties are stable across mssql ≥ 9.
    const inner = (p as unknown as { pool?: {
      size?: number;
      numFree?: () => number;
      numPendingAcquires?: () => number;
      numUsed?: () => number;
    } }).pool;
    if (!inner) return null;
    return {
      size: inner.size ?? 0,
      available: inner.numFree?.() ?? 0,
      pending: inner.numPendingAcquires?.() ?? 0,
      borrowed: inner.numUsed?.() ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * Known-transient SQL Server / Node driver error numbers and codes. The old
 * implementation matched any message containing `'failed'` — which retried
 * non-transient application errors (e.g. validation failures from our own
 * SPs that happen to say "operation failed"), amplifying load during real
 * outages and risking double-execution of non-idempotent flows.
 *
 * SQL Server numbers:
 *   1205  — deadlock victim (the canonical safe-retry case)
 *   1222  — lock request timeout
 *   233   — no process on the other end of pipe
 *   64    — network name no longer available
 *   10054 — connection reset by peer
 *   10053 — connection aborted
 *   10060 — connection timed out
 *   40197 / 40501 / 40613 / 49918 / 49919 / 49920 — SQL-Azure transient family
 *
 * Driver/network codes: ETIMEOUT, ESOCKET, ECONNRESET, ECONNREFUSED, EPIPE,
 *   EHOSTUNREACH, ENOTFOUND (DNS blip during failover).
 *
 * Application-level: 'DUPLICATES PREVENTED' is our own trigger's rollback
 * for a raced-in vailid — explicitly safe to retry once because the order
 * SP just reserves a fresh block.
 */
const TRANSIENT_SQL_NUMBERS = new Set([
  64, 233, 1205, 1222, 10053, 10054, 10060, 40197, 40501, 40613, 49918, 49919, 49920,
]);
const TRANSIENT_DRIVER_CODES = new Set([
  'ETIMEOUT',
  'ESOCKET',
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'EHOSTUNREACH',
  'ENOTFOUND',
]);

function isTransient(e: unknown): boolean {
  if (e == null) return false;
  const err = e as {
    number?: number;
    code?: string;
    message?: string;
    originalError?: { number?: number; code?: string; message?: string };
  };
  const num = err.number ?? err.originalError?.number;
  const code = err.code ?? err.originalError?.code;
  const msg = err.message ?? err.originalError?.message ?? '';
  if (num != null && TRANSIENT_SQL_NUMBERS.has(num)) return true;
  if (code && TRANSIENT_DRIVER_CODES.has(code)) return true;
  // Driver sometimes only surfaces text — keep the targeted substrings.
  if (msg.includes('DUPLICATES PREVENTED')) return true;
  if (/\bdeadlock\b/i.test(msg)) return true;
  return false;
}

/**
 * Retry only the failure modes that are demonstrably safe to retry — see
 * `isTransient` for the curated list. Non-transient errors throw immediately
 * (no retry loop, no extra load on a failing DB).
 */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const transient = isTransient(e);
      if (!transient || i === attempts - 1) {
        if (transient) {
          logger.warn(
            { err: e, attempts, exhausted: true },
            'db.retry.exhausted',
          );
        }
        throw e;
      }
      logger.info(
        {
          err: e,
          attempt: i + 1,
          nextDelayMs: 200 * (i + 1),
        },
        'db.retry.transient',
      );
      await sleep(200 * (i + 1));
    }
  }
  throw last;
}

/**
 * Wrap any DB function with pino timing — emits `db.slow` at WARN when the
 * call exceeds `slowMs` (default 500 ms, comfortably above the IST↔caller
 * RTT floor) and `db.query` at DEBUG for everything else. Use to instrument
 * hot read paths and surface slow Noble queries before they cascade.
 *
 *   const rows = await traceDb('orders.list', () => listOrders(scope));
 */
export async function traceDb<T>(
  name: string,
  fn: () => Promise<T>,
  opts: { slowMs?: number } = {},
): Promise<T> {
  const slowMs = opts.slowMs ?? 500;
  const start = Date.now();
  try {
    const out = await fn();
    const ms = Date.now() - start;
    if (ms >= slowMs) {
      logger.warn({ op: name, durationMs: ms }, 'db.slow');
    } else {
      logger.debug({ op: name, durationMs: ms }, 'db.query');
    }
    return out;
  } catch (e) {
    const ms = Date.now() - start;
    logger.error({ op: name, durationMs: ms, err: e }, 'db.error');
    throw e;
  }
}

export { sql };
