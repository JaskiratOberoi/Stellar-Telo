import { NextResponse } from 'next/server';
import { getPool, getPoolStats } from '@/db/pool';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Liveness + DB connectivity probe. Used by the Docker healthcheck.
 * Returns 200 only when the Noble pool answers a trivial query.
 *
 * Public (whitelisted in middleware) — error bodies must NOT include
 * exception messages: a leaked "connection refused to <host:port>" or SQL
 * stack trace is useful reconnaissance for an attacker. Details are logged
 * server-side with pino. Pool saturation is included on success so ops
 * dashboards can graph it without scraping logs.
 */
export async function GET() {
  try {
    const pool = await getPool();
    await pool.request().query('SELECT 1 AS ok');
    const stats = await getPoolStats();
    return NextResponse.json({ ok: true, db: 'up', pool: stats });
  } catch (e) {
    logger.error({ err: e }, 'health.db.down');
    return NextResponse.json(
      { ok: false, db: 'down' },
      { status: 503 },
    );
  }
}
