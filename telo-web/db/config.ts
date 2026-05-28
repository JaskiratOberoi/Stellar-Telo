import net from 'net';
import sql from 'mssql';
import { env } from '@/lib/env';

/**
 * Pure mssql pool-config builder. NO `server-only` guard so the deploy-sp CLI
 * (run via tsx, outside Next) can reuse it. The runtime singleton + retry live
 * in pool.ts which adds the `server-only` boundary.
 *
 * Carries Listec's proven TLS serverName workaround for bare-IP servers.
 */

/** Split `host` or `host,port` (SQL Server connection-string convention). */
export function splitServer(raw: string): { host: string; port: number | undefined } {
  const trimmed = raw.trim();
  const m = /^(.+?)[,:](\d+)$/.exec(trimmed);
  if (m) return { host: m[1].trim(), port: Number(m[2]) };
  return { host: trimmed, port: undefined };
}

export function getTeloPoolConfig(): sql.config {
  const e = env();
  const { host, port } = splitServer(e.TELO_SQL_SERVER);

  return {
    server: host,
    port,
    database: e.TELO_SQL_DATABASE,
    user: e.TELO_SQL_USER,
    password: e.TELO_SQL_PASSWORD,
    options: {
      encrypt: e.TELO_SQL_ENCRYPT !== 'false',
      trustServerCertificate: e.TELO_SQL_TRUST_CERT === 'true',
      appName: e.TELO_SQL_APP_NAME,
      // Node TLS rejects a bare IP as the SNI servername. When the server is an
      // IP and we already trust the cert, override SNI with a placeholder —
      // hostname is not validated anyway. (Proven in Listec's listec.client.ts.)
      serverName: net.isIP(host) ? 'sqlserver' : undefined,
      // Noble's SQL Server runs in India and stores datetime columns as IST
      // wall-clock (no TZ info — GETDATE() returns server local time).
      // useUTC=true (driver default) would mis-label that wall-clock as UTC,
      // then our IST display formatter would add ANOTHER 5:30h on top.
      // Setting useUTC=false makes the driver interpret datetime as the
      // Node process's local time — IST in dev (operator's Mac) and IST in
      // prod (Docker has TZ=Asia/Kolkata). Display lines up.
      useUTC: false,
    },
    pool: {
      max: e.TELO_SQL_POOL_MAX,
      min: e.TELO_SQL_POOL_MIN,
      idleTimeoutMillis: e.TELO_SQL_POOL_IDLE_MS,
    },
    connectionTimeout: e.TELO_SQL_CONNECT_TIMEOUT_MS,
    requestTimeout: e.TELO_SQL_REQUEST_TIMEOUT_MS,
  };
}
