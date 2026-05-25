import 'server-only';
import sql from 'mssql';
import { getTeloPoolConfig } from './config';

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
 * Retry transient failures. Extends Listec's transient set with the
 * trigger_PreventDuplicate rollback signature (a duplicate vailid raced in) —
 * retried once so the order SP can reserve a fresh vailid block.
 */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = String(e);
      const transient =
        msg.includes('ETIMEOUT') ||
        msg.includes('ECONNRESET') ||
        msg.includes('deadlock') ||
        msg.includes('DUPLICATES PREVENTED') ||
        msg.includes('failed');
      if (!transient || i === attempts - 1) throw e;
      await sleep(200 * (i + 1));
    }
  }
  throw last;
}

export { sql };
