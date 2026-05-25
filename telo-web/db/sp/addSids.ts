import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';
import type { SampleSid, IssuedSample } from '@/db/sp/createOrder';

export interface AddSidsInput {
  userId: number;
  patientId: number;
  mcc: number;
  sampleSids: SampleSid[];
}

export interface AddSidsResult {
  ok: boolean;
  errorCode: string | null;
  message: string | null;
  patientId: number | null;
  sampleCount: number;
  samples: IssuedSample[];
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
 * Calls dbo.usp_telo_add_sids — deferred accessioning. Inserts the supplied
 * Sample IDs onto an already-registered order. Emits TWO recordsets:
 *   [0] status row (ok/error_code/message/patient_id/sample_count)
 *   [1] one row per issued sample (sample_id, vailid, sample_type_id, name)
 */
export async function addSids(input: AddSidsInput): Promise<AddSidsResult> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('userId', sql.Int, input.userId)
      .input('patientId', sql.Int, input.patientId)
      .input('mcc', sql.Int, input.mcc)
      .input('sids', buildSidTvp(input.sampleSids))
      .execute<Record<string, unknown>>('dbo.usp_telo_add_sids');

    const sets = r.recordsets as unknown as [
      Array<{
        ok: boolean;
        error_code: string | null;
        message: string | null;
        patient_id: number | null;
        sample_count: number;
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
      sampleCount: status?.sample_count ?? samples.length,
      samples,
    };
  });
}
