import 'server-only';
import { logger } from '@/lib/logger';

/**
 * Structured audit trail. Separate channel from app logs so it can be shipped
 * to a retention store. NEVER include passwords, card data, or full PII —
 * identifiers and outcomes only (logger.redact also strips known secret keys).
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
  | { kind: 'admin.user.active'; actor: number; target: number; active: boolean };

export function audit(ev: AuditEvent): void {
  logger.info({ audit: true, ...ev }, `audit:${ev.kind}`);
}
