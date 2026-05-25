import { NextResponse } from 'next/server';
import { getPool, sql } from '@/db/pool';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Liveness + DB connectivity probe. Used by the Docker healthcheck.
 * Returns 200 only when the Noble pool answers a trivial query.
 */
export async function GET() {
  try {
    const pool = await getPool();
    await pool.request().query('SELECT 1 AS ok');
    return NextResponse.json({ ok: true, db: 'up' });
  } catch (e) {
    return NextResponse.json(
      { ok: false, db: 'down', error: e instanceof Error ? e.message : String(e) },
      { status: 503 },
    );
  }
}
