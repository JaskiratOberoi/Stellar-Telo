import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';
import type { CartItem } from '@/domain/cart/cart.types';

export interface SampleSid {
  sampleTypeId: number;
  vailid: string;
}

/** One payment line collected at registration. Split payments are supported:
 *  a patient may pay part Cash and part UPI, yielding multiple lines. */
export interface PaymentLine {
  method: string; // Cash / UPI / Card / Cheque / Online
  amount: number; // rupees for this line (> 0; non-positive lines are dropped)
  ref?: string | null; // txn reference for a non-cash line; null for Cash
}

export interface IssuedSample {
  sampleId: number;
  vailid: string;
  sampleTypeId: number; // NULL in DB if Unspecified — we re-bind to -1 here
  sampleTypeName: string;
}

export interface CreateOrderInput {
  userId: number;
  mcc: number;
  sampleSids: SampleSid[]; // one entry per distinct sample type the order needs
  patientId?: number; // 0/undefined = create new
  name?: string;
  initial?: string | null; // salutation (Mr/Ms/...) — kept separate from name, like the LIS form
  age?: number | null;
  gender?: number | null;
  ageType?: number | null;
  mobile?: string | null;
  email?: string | null;
  clinicalHistory?: string | null;
  clinicalFile?: Buffer | null;
  clinicalFileName?: string | null;
  mrnId?: string | null;
  refDoctor?: number | null;
  refCustomer?: number | null;
  newRefDoctorName?: string | null;
  newRefCustomerName?: string | null;
  items: CartItem[];
  discountAmount?: number;
  payMode?: number | null;
  /** Payment lines collected now. Each becomes one receipt row; an empty array
   *  means nothing was collected at registration. */
  payments?: PaymentLine[];
  /** B2B mode: bill every line at catalogue MRP (patient price), skipping the
   *  client rate list. Defaults to false (the classic New-Order behavior). */
  billAtMrp?: boolean;
  /** B2C Gold Card: when true (and card details supplied) the SP halves every
   *  line — the whole bill is charged at 50%. Ignored in B2B. */
  goldCard?: boolean;
  goldCardNumber?: string | null;
  goldCardHolder?: string | null;
}

export interface CreateOrderResult {
  ok: boolean;
  errorCode: string | null;
  message: string | null;
  patientId: number | null;
  billId: number | null;
  billNumber: number | null;
  total: number;
  sampleCount: number;
  samples: IssuedSample[];
  txnId: string | null;
}

/** TeloTestList.itemKind: 0 = test, 1 = profile, 2 = master profile. */
function itemKindOf(kind: CartItem['kind']): number {
  return kind === 'master' ? 2 : kind === 'profile' ? 1 : 0;
}

function buildTestListTvp(items: CartItem[]): sql.Table {
  const t = new sql.Table('dbo.TeloTestList');
  t.create = false;
  t.columns.add('testMasterId', sql.Int, { nullable: false });
  t.columns.add('itemKind', sql.TinyInt, { nullable: false });
  t.columns.add('code', sql.NVarChar(50), { nullable: false });
  t.columns.add('name', sql.NVarChar(200), { nullable: false });
  const seen = new Set<string>();
  for (const i of items) {
    const kind = itemKindOf(i.kind);
    const key = `${kind}:${i.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    t.rows.add(
      i.id,
      kind,
      (i.code ?? '').slice(0, 50) || String(i.id),
      (i.name ?? '').slice(0, 200) || (i.code ?? String(i.id)),
    );
  }
  return t;
}

function buildPaymentTvp(payments: PaymentLine[]): sql.Table {
  const t = new sql.Table('dbo.TeloPayment');
  t.create = false;
  t.columns.add('seq', sql.Int, { nullable: false });
  t.columns.add('method', sql.VarChar(50), { nullable: false });
  t.columns.add('amount', sql.Int, { nullable: false });
  t.columns.add('ref', sql.NVarChar(50), { nullable: true });
  let seq = 0;
  for (const p of payments) {
    const amount = Math.round(Number(p.amount) || 0);
    if (amount <= 0) continue; // drop empty/zero lines; SP also guards
    seq += 1;
    const ref = p.ref != null ? String(p.ref).trim().slice(0, 50) : '';
    t.rows.add(
      seq,
      (p.method ?? 'Cash').slice(0, 50) || 'Cash',
      amount,
      ref || null,
    );
  }
  return t;
}

function buildSidTvp(sids: SampleSid[]): sql.Table {
  const t = new sql.Table('dbo.TeloSampleSid');
  t.create = false;
  t.columns.add('sampleTypeId', sql.Int, { nullable: false });
  t.columns.add('vailid', sql.NVarChar(50), { nullable: false });
  const seen = new Set<number>();
  for (const s of sids) {
    if (seen.has(s.sampleTypeId)) continue;
    seen.add(s.sampleTypeId);
    const v = (s.vailid ?? '').toString().trim();
    if (!v) continue;
    t.rows.add(s.sampleTypeId, v.slice(0, 50));
  }
  return t;
}

/**
 * Calls dbo.usp_telo_create_order. The SP atomically writes the 7-table
 * order chain and emits TWO recordsets:
 *   [0] status row (ok/error_code/message/patient_id/bill_id/bill_number/total/sample_count)
 *   [1] one row per issued sample (sample_id, vailid, sample_type_id, sample_type_name)
 *
 * withRetry catches the trigger_PreventDuplicate rollback signature and
 * retries once.
 */
export async function createOrder(
  input: CreateOrderInput,
): Promise<CreateOrderResult> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('userId', sql.Int, input.userId)
      .input('mcc', sql.Int, input.mcc)
      .input('sids', buildSidTvp(input.sampleSids))
      .input('patientId', sql.Int, input.patientId ?? 0)
      .input('name', sql.NVarChar(200), input.name ?? null)
      .input('initial', sql.NVarChar(10), input.initial ?? null)
      .input('age', sql.Int, input.age ?? null)
      .input('gender', sql.Int, input.gender ?? null)
      .input('ageType', sql.Int, input.ageType ?? null)
      .input('mobile', sql.VarChar(20), input.mobile ?? null)
      .input('email', sql.VarChar(100), input.email ?? null)
      .input('clinicalHistory', sql.VarChar(500), input.clinicalHistory ?? null)
      .input('clinicalFile', sql.VarBinary(sql.MAX), input.clinicalFile ?? null)
      .input('clinicalFileName', sql.VarChar(100), input.clinicalFileName ?? null)
      .input('mrnId', sql.VarChar(50), input.mrnId ?? null)
      .input('refDoctor', sql.Int, input.refDoctor ?? null)
      .input('refCustomer', sql.Int, input.refCustomer ?? null)
      .input('newRefDoctorName', sql.NVarChar(200), input.newRefDoctorName ?? null)
      .input('newRefCustomerName', sql.NVarChar(200), input.newRefCustomerName ?? null)
      .input('items', buildTestListTvp(input.items))
      .input('discountAmount', sql.Int, input.discountAmount ?? 0)
      .input('payMode', sql.Int, input.payMode ?? null)
      .input('billAtMrp', sql.Bit, input.billAtMrp ? 1 : 0)
      .input('goldCard', sql.Bit, input.goldCard ? 1 : 0)
      .input('goldCardNumber', sql.NVarChar(50), input.goldCardNumber ?? null)
      .input('goldCardHolder', sql.NVarChar(200), input.goldCardHolder ?? null)
      .input('payments', buildPaymentTvp(input.payments ?? []))
      .execute<Record<string, unknown>>('dbo.usp_telo_create_order');

    const sets = r.recordsets as unknown as [
      Array<{
        ok: boolean;
        error_code: string | null;
        message: string | null;
        patient_id: number | null;
        bill_id: number | null;
        bill_number: number | null;
        total: number;
        sample_count: number;
        txn_id: string | null;
      }>,
      Array<{
        sample_id: number;
        vailid: string;
        sample_type_id: number | null;
        sample_type_name: string;
      }>,
    ];

    const status = sets[0]?.[0];
    const samples = (sets[1] ?? []).map((s) => ({
      sampleId: s.sample_id,
      vailid: s.vailid,
      sampleTypeId: s.sample_type_id ?? -1,
      sampleTypeName: s.sample_type_name ?? 'Unspecified',
    }));

    return {
      ok: status?.ok === true,
      errorCode: status?.error_code ?? null,
      message: status?.message ?? null,
      patientId: status?.patient_id ?? null,
      billId: status?.bill_id ?? null,
      billNumber: status?.bill_number ?? null,
      total: status?.total ?? 0,
      sampleCount: status?.sample_count ?? samples.length,
      samples,
      txnId: status?.txn_id?.trim() || null,
    };
  });
}
