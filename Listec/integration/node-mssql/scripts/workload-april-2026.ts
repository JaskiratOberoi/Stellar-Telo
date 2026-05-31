/**
 * Refresh ~/Downloads/Workload Sheet Immunoassay.xlsx (sheet "Lowest") with
 * April 2026 SID counts per (BusinessUnit × test code) pulled from Noble LIS.
 *
 * Rule:
 *   - Column H holds 1+ LIS test codes (comma/semicolon separated).
 *   - For each row with codes, query usp_listec_worksheet_report_json with
 *     fromDate=2026-04-01, toDate=2026-04-30, businessUnitId, testCode.
 *   - Raw sum SID counts across codes per BU, multiply by 1.5, write to cell.
 *   - HALDWANI is not a BU in LIS: HALDWANI cell = DELHI cell / 2.
 *   - Rows with blank Column H are left untouched.
 *
 *   npx ts-node scripts/workload-april-2026.ts
 */

import { config as loadEnv } from 'dotenv';
import path from 'path';
import os from 'os';
import ExcelJS from 'exceljs';

loadEnv({ path: path.resolve(__dirname, '..', '..', '..', '.env') });
loadEnv();

import {
  getListecPool,
  closeListecPool,
  fetchAllWorksheetReports,
} from '../listec.client';
import { resolveBusinessUnitId } from '../listec.lookups';

const WORKBOOK_PATH = path.join(os.homedir(), 'Downloads', 'Workload Sheet Immunoassay.xlsx');
const SHEET_NAME = 'Lowest';
const FROM_DATE = '2026-04-01';
const TO_DATE = '2026-04-30';
const MULTIPLIER = 1.5;

const COL = {
  LIST_SIZE_NBR: 1, // A
  DESCRIPTION: 2,   // B
  SRINAGAR: 3,      // C
  DELHI: 4,         // D
  ROHTAK: 5,        // E
  HALDWANI: 6,      // F
  KARNAL: 7,        // G
  TEST_CODES: 8,    // H
} as const;

type BuTarget = {
  header: 'SRINAGAR' | 'DELHI' | 'ROHTAK' | 'KARNAL';
  col: number;
  buCode: string;
  buId: number;
};

function parseCodes(cell: unknown): string[] {
  if (cell == null) return [];
  const raw = String(cell).trim();
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,;]/)) {
    const c = part.trim();
    if (!c) continue;
    const key = c.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function readCellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    const r = v as { richText?: { text: string }[]; text?: string; result?: unknown };
    if (Array.isArray(r.richText)) return r.richText.map((p) => p.text).join('');
    if (typeof r.text === 'string') return r.text;
    if (r.result != null) return String(r.result);
  }
  return String(v);
}

async function dumpBuMaster(): Promise<void> {
  const pool = await getListecPool();
  const r = await pool
    .request()
    .query<{ id: number; BusinessUnitCode: string | null; BusinessUnitName: string | null }>(
      'SELECT id, BusinessUnitCode, BusinessUnitName FROM dbo.tbl_med_business_unit_master ORDER BY BusinessUnitCode',
    );
  console.error('\nAvailable BusinessUnits in LIS:');
  for (const row of r.recordset) {
    console.error(`  id=${row.id}  code=${row.BusinessUnitCode}  name=${row.BusinessUnitName}`);
  }
}

async function resolveBuTargets(): Promise<BuTarget[]> {
  const requested = [
    { header: 'SRINAGAR' as const, col: COL.SRINAGAR, buCode: 'SRINAGAR' },
    { header: 'DELHI' as const,    col: COL.DELHI,    buCode: 'QUGEN'    },
    { header: 'ROHTAK' as const,   col: COL.ROHTAK,   buCode: 'ROHTAK'   },
    { header: 'KARNAL' as const,   col: COL.KARNAL,   buCode: 'KARNAL'   },
  ];
  const resolved: BuTarget[] = [];
  const missing: string[] = [];
  for (const r of requested) {
    const id = await resolveBusinessUnitId(r.buCode);
    if (id == null) {
      missing.push(r.buCode);
    } else {
      resolved.push({ ...r, buId: id });
    }
  }
  if (missing.length) {
    console.error(`\nERROR: could not resolve BusinessUnit code(s): ${missing.join(', ')}`);
    await dumpBuMaster();
    throw new Error('Unresolved business unit(s); aborting.');
  }
  return resolved;
}

async function countSids(buId: number, code: string): Promise<number> {
  const rows = await fetchAllWorksheetReports({
    fromDate: FROM_DATE,
    toDate: TO_DATE,
    businessUnitId: buId,
    testCode: code,
    includeUnauthorized: true,
    pageSize: 1000,
  });
  return rows.length;
}

async function main(): Promise<void> {
  console.log(`Loading workbook: ${WORKBOOK_PATH}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(WORKBOOK_PATH);
  const ws = wb.getWorksheet(SHEET_NAME);
  if (!ws) throw new Error(`Sheet "${SHEET_NAME}" not found.`);

  console.log('Resolving BusinessUnit IDs...');
  const targets = await resolveBuTargets();
  for (const t of targets) console.log(`  ${t.header.padEnd(8)} -> ${t.buCode} (id=${t.buId})`);

  const delhi = targets.find((t) => t.header === 'DELHI');
  if (!delhi) throw new Error('DELHI BU missing after resolve.');

  console.log('\nSmoke test: BC170 x QUGEN x April 2026 (expecting ~160 SIDs)...');
  const smoke = await countSids(delhi.buId, 'BC170');
  console.log(`  -> ${smoke} SIDs`);
  if (smoke < 100 || smoke > 250) {
    throw new Error(
      `Smoke test out of expected range [100, 250]: got ${smoke}. ` +
        `Verify date filter / BU / SP behaviour before continuing.`,
    );
  }

  const summary: { row: number; sku: string; desc: string; codes: string[]; values: Record<string, number> }[] = [];

  const lastRow = ws.actualRowCount;
  console.log(`\nProcessing rows 2..${lastRow}...`);

  for (let rowNum = 2; rowNum <= lastRow; rowNum++) {
    const row = ws.getRow(rowNum);
    const codes = parseCodes(row.getCell(COL.TEST_CODES).value);
    const sku = readCellText(row.getCell(COL.LIST_SIZE_NBR));
    const desc = readCellText(row.getCell(COL.DESCRIPTION));

    if (codes.length === 0) {
      if (sku || desc) console.log(`  [skip] row ${rowNum}: ${desc || sku} (no codes)`);
      continue;
    }

    const perBu: Record<string, number> = {};
    for (const t of targets) {
      let sum = 0;
      for (const code of codes) {
        const n = await countSids(t.buId, code);
        sum += n;
      }
      const val = sum * MULTIPLIER;
      perBu[t.header] = val;
      const cell = row.getCell(t.col);
      cell.value = val;
      cell.numFmt = '0.0';
    }

    const haldwaniVal = (perBu['DELHI'] ?? 0) / 2;
    perBu['HALDWANI'] = haldwaniVal;
    const hCell = row.getCell(COL.HALDWANI);
    hCell.value = haldwaniVal;
    hCell.numFmt = '0.0';

    summary.push({ row: rowNum, sku, desc, codes, values: perBu });
    console.log(
      `  row ${rowNum}: ${(desc || sku).padEnd(34).slice(0, 34)} [${codes.join('+')}]  ` +
        `SRI=${perBu.SRINAGAR} DEL=${perBu.DELHI} ROH=${perBu.ROHTAK} HAL=${perBu.HALDWANI} KAR=${perBu.KARNAL}`,
    );
  }

  console.log(`\nSaving workbook: ${WORKBOOK_PATH}`);
  await wb.xlsx.writeFile(WORKBOOK_PATH);

  console.log(`\nDone. Updated ${summary.length} reagent rows.`);
}

main()
  .catch((e) => {
    console.error('\nFATAL:', e instanceof Error ? e.message : e);
    if (e instanceof Error && e.stack) console.error(e.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeListecPool().catch(() => {});
  });
