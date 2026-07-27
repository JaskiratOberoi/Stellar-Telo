import 'server-only';
import { getPool, sql, withRetry } from '@/db/pool';

export interface AccessionOutcome {
  vailid: string;
  /** 'registered' = skeleton written + status moved to 2; 'skipped' = the SID
   *  was not at status 1 (already accessioned, or not found). */
  outcome: 'registered' | 'skipped';
  resultRows: number;
}

export interface AccessionResult {
  ok: boolean;
  errorCode: string | null;
  message: string | null;
  registered: number;
  skipped: number;
  outcomes: AccessionOutcome[];
}

function buildVailidTvp(vailids: string[]): sql.Table {
  const t = new sql.Table('dbo.TeloVailidList');
  t.create = false;
  t.columns.add('vailid', sql.NVarChar(50), { nullable: false });
  const seen = new Set<string>();
  for (const raw of vailids) {
    const v = (raw ?? '').toString().trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    t.rows.add(v.slice(0, 50));
  }
  return t;
}

/**
 * Calls dbo.usp_telo_accession_samples — the Telo port of the LIS "Register"
 * action. Generates each SID's empty result skeleton (Profile/Head/Test/Param
 * rows with per-patient normal ranges) and moves the sample to status 2
 * ('Sample Registered'), which is what makes it visible on the worksheet.
 *
 * Emits TWO recordsets: [0] status row, [1] one row per submitted SID.
 */
export async function accessionSamples(input: {
  userId: number;
  username: string;
  vailids: string[];
}): Promise<AccessionResult> {
  return withRetry(async () => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('userId', sql.Int, input.userId)
      .input('user', sql.NVarChar(50), input.username.slice(0, 50))
      .input('vailids', buildVailidTvp(input.vailids))
      .execute<Record<string, unknown>>('dbo.usp_telo_accession_samples');

    const sets = r.recordsets as unknown as [
      Array<{
        ok: boolean;
        error_code: string | null;
        message: string | null;
        registered: number;
        skipped: number;
      }>,
      Array<{ vailid: string; outcome: string; result_rows: number }>,
    ];

    const status = sets[0]?.[0];
    return {
      ok: status?.ok === true,
      errorCode: status?.error_code ?? null,
      message: status?.message ?? null,
      registered: Number(status?.registered ?? 0),
      skipped: Number(status?.skipped ?? 0),
      outcomes: (sets[1] ?? []).map((x) => ({
        vailid: (x.vailid ?? '').trim(),
        outcome: x.outcome === 'registered' ? 'registered' : 'skipped',
        resultRows: Number(x.result_rows ?? 0),
      })),
    };
  });
}
