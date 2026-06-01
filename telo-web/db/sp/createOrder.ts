import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';
import type { CartItem } from '@/domain/cart/cart.types';

export interface SampleSid {
  sampleTypeId: number;
  vailid: string;
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
  paymentType?: string | null;
  payMode?: number | null;
  receiptAmount?: number;
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

function buildTestListTvp(items: CartItem[]): sql.Table {
  const t = new sql.Table('dbo.TeloTestList');
  t.create = false;
  t.columns.add('testMasterId', sql.Int, { nullable: false });
  t.columns.add('isProfile', sql.Bit, { nullable: false });
  t.columns.add('code', sql.NVarChar(50), { nullable: false });
  t.columns.add('name', sql.NVarChar(200), { nullable: false });
  const seen = new Set<string>();
  for (const i of items) {
    const key = `${i.kind === 'profile' ? 1 : 0}:${i.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    t.rows.add(
      i.id,
      i.kind === 'profile' ? 1 : 0,
      (i.code ?? '').slice(0, 50) || String(i.id),
      (i.name ?? '').slice(0, 200) || (i.code ?? String(i.id)),
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
      .input('paymentType', sql.VarChar(50), input.paymentType ?? null)
      .input('payMode', sql.Int, input.payMode ?? null)
      .input('receiptAmount', sql.Int, input.receiptAmount ?? 0)
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
