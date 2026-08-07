import 'server-only';
import { logger } from '@/lib/logger';
import { getPool, sql } from '@/db/pool';

/**
 * Structured audit trail. Two sinks per event:
 *  1. The app log stream (as before — ships with the container logs).
 *  2. dbo.telo_audit_log (fire-and-forget INSERT) — powers the in-app
 *     "Audit trail" tab. A failed insert only ever logs a warning; it can
 *     never fail or slow the business action that emitted the event.
 *
 * NEVER include passwords, card data, or full PII — identifiers and outcomes
 * only (logger.redact also strips known secret keys).
 */
type AuditEvent =
  | { kind: 'login.success'; username: string; uid: number }
  | { kind: 'login.failure'; username: string; reason: string }
  | { kind: 'login.rate_limited'; username: string }
  | { kind: 'order.placed'; uid: number; mcc: number; billId: number; total: number }
  | { kind: 'payment.recorded'; billId: number; amount: number; ref: string | null }
  | { kind: 'payment.refunded'; billId: number; amount: number; ref: string | null }
  | { kind: 'admin.user.create'; actor: number; target: number; role: string; lisUsertypeId: number; mccCount: number }
  | { kind: 'admin.user.update'; actor: number; target: number; mccCount: number }
  | { kind: 'admin.user.scope.partial'; actor: number; target: number; mccCount: number; error: string }
  | { kind: 'admin.user.role'; actor: number; target: number; role: string }
  | { kind: 'admin.user.password'; actor: number; target: number } // never the password value
  | { kind: 'admin.user.active'; actor: number; target: number; active: boolean }
  | { kind: 'admin.user.lis_access'; actor: number; target: number; enabled: boolean }
  | { kind: 'admin.user.mrp_only'; actor: number; target: number; enabled: boolean }
  | { kind: 'admin.user.prepared_by'; actor: number; target: number; cleared: boolean }
  | { kind: 'admin.profile_interpretation.save'; actor: number; target: number }
  | { kind: 'patient.info.update'; actor: number; billId: number }
  | { kind: 'bill.discount.set'; actor: number; billId: number; discount: number }
  | { kind: 'receipt.voided'; actor: number; billId: number; receiptId: number }
  | { kind: 'receipt.amount.edited'; actor: number; billId: number; receiptId: number; oldAmount: number | null; newAmount: number }
  | { kind: 'bill.test.cancelled'; actor: number; billId: number; lineId: number }
  | { kind: 'bill.booking.cancelled'; actor: number; billId: number; cancelled: number; refunded: number }
  | { kind: 'bill.booking.cancel.blocked'; actor: number; billId: number; cancelled: number; blocked: number }
  | { kind: 'mcc.payment.recorded'; actor: number; mcc: number; amount: number; mode: number }
  | { kind: 'bill.tests.edited'; actor: number; billId: number; itemCount: number; customCount: number; balance: number | null }
  | { kind: 'sample.accessioned'; actor: number; registered: number; skipped: number; charged: number; chargeTotal: number }
  // Report access — who opened/downloaded which patient's report. `sid` is the
  // sample barcode (the LIS's VAILID); mirrors the LIS audit trail's SAMPLEID
  // column so the two trails correlate.
  | { kind: 'report.viewed'; actor: number; sid: string }
  | { kind: 'report.pdf'; actor: number; sid: string }
  | { kind: 'report.smart_pdf'; actor: number; sid: string }
  | { kind: 'report.pdf_bulk'; actor: number; count: number; sids: string }
  // CCAvenue online client payment: a client started a payment, and the gateway
  // callback outcome (status + whether a wallet credit was posted this call).
  | { kind: 'mcc.online_payment.initiated'; actor: number; mcc: number; amount: number; orderId: string }
  | { kind: 'mcc.online_payment.result'; orderId: string; status: string; recorded: boolean; alreadyRecorded: boolean }
  // Emitted by the auth() session callback when a request's JWT carries an
  // older session_version than the live one — the session is then dropped
  // (forcing re-login). Captures both versions for ops correlation.
  | { kind: 'session.revoked'; uid: number; embedded: number; current: number };

export function audit(ev: AuditEvent): void {
  logger.info({ audit: true, ...ev }, `audit:${ev.kind}`);
  persist(ev);
}

/** Best-effort INSERT into dbo.telo_audit_log — see the module doc. */
function persist(ev: AuditEvent): void {
  const { kind, ...rest } = ev;
  // Acting-user id under either historical field name; username only exists on
  // the login events (where there may be no resolvable id at all).
  const record = rest as Record<string, unknown>;
  const actorId =
    typeof record.actor === 'number'
      ? (record.actor as number)
      : typeof record.uid === 'number'
        ? (record.uid as number)
        : null;
  const username =
    typeof record.username === 'string' ? (record.username as string) : null;
  delete record.actor;
  delete record.uid;
  delete record.username;
  const details = Object.keys(record).length > 0 ? JSON.stringify(record) : null;

  void (async () => {
    const pool = await getPool();
    await pool
      .request()
      .input('kind', sql.VarChar(60), kind.slice(0, 60))
      .input('actorId', sql.Int, actorId)
      .input('username', sql.NVarChar(50), username?.slice(0, 50) ?? null)
      .input('details', sql.NVarChar(2000), details?.slice(0, 2000) ?? null)
      .query(`
        INSERT INTO dbo.telo_audit_log (kind, actor_id, username, details)
        VALUES (@kind, @actorId, @username, @details)
      `);
  })().catch((e) => {
    // Table not deployed yet / transient DB issue — the log-stream copy above
    // is still intact, so quietly degrade rather than surfacing anywhere.
    logger.warn(
      { auditPersistError: e instanceof Error ? e.message.slice(0, 160) : String(e) },
      'audit: telo_audit_log insert failed',
    );
  });
}
