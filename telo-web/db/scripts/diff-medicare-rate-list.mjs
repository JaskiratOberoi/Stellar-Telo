/*
 * diff-medicare-rate-list.mjs — READ-ONLY coverage analysis.
 *
 * For every Excel row, find a matching active master test/profile in Noble,
 * then check whether that master entry has a row in rate list 139
 * (MEDICARE MRP RATE LIST). Each Excel row is classified as:
 *
 *   ✓ covered                    — has a master match AND is in list 139
 *   △ in master, NOT in list 139 — needs adding to the rate list
 *   ✗ no master match            — test/profile not in catalogue at all
 *   ? ambiguous                  — multiple plausible master matches
 *
 * Output: stdout summary + /tmp/medicare_diff_report.json with full details.
 */

import sql from 'mssql';
import net from 'net';
import fs from 'fs';

const RATE_TYPE_ID = 139;

function splitServer(raw) {
  const m = /^(.+?)[,:](\d+)$/.exec(raw.trim());
  return m
    ? { host: m[1].trim(), port: Number(m[2]) }
    : { host: raw.trim(), port: undefined };
}

const { host, port } = splitServer(process.env.TELO_SQL_SERVER);
const pool = await new sql.ConnectionPool({
  server: host,
  port,
  database: process.env.TELO_SQL_DATABASE,
  user: process.env.TELO_SQL_USER,
  password: process.env.TELO_SQL_PASSWORD,
  options: {
    encrypt: process.env.TELO_SQL_ENCRYPT !== 'false',
    trustServerCertificate: process.env.TELO_SQL_TRUST_CERT === 'true',
    serverName: net.isIP(host) ? 'sqlserver' : undefined,
    useUTC: false,
  },
}).connect();

const excelItems = JSON.parse(
  fs.readFileSync('/tmp/medicare_excel_items.json', 'utf8'),
);

// ── Pull all masters (incl. inactive — list 139 has rows pointing at them) ──
const tests = (await pool.request().query(`
  SELECT id AS masterId, TestCode AS code, Testname AS name, MRP AS mrp, IsActive
  FROM dbo.tbl_med_test_master
`)).recordset.map((x) => ({ ...x, kind: 'test', active: !!x.IsActive }));

const profiles = (await pool.request().query(`
  SELECT id AS masterId, Profile_Code AS code, Profile_Name AS name, MRP AS mrp, IsActive
  FROM dbo.tbl_med_test_profile_master
`)).recordset.map((x) => ({ ...x, kind: 'profile', active: !!x.IsActive }));

const allMasters = [...tests, ...profiles];

// ── Pull membership of rate list 139 ───────────────────────────────────
const inListTestIds = new Set(
  (await pool.request().input('id', sql.Int, RATE_TYPE_ID).query(`
    SELECT TestCode FROM dbo.tbl_med_test_rates_with_pcc_type
    WHERE RateTypeId = @id AND IsActive = 1
  `)).recordset.map((x) => x.TestCode),
);
const inListProfileIds = new Set(
  (await pool.request().input('id', sql.Int, RATE_TYPE_ID).query(`
    SELECT profilecode FROM dbo.tbl_med_profile_rates_with_pcc_types
    WHERE RateTypeId = @id AND IsActive = 1
  `)).recordset.map((x) => x.profilecode),
);

function inList(row) {
  return row.kind === 'test'
    ? inListTestIds.has(row.masterId)
    : inListProfileIds.has(row.masterId);
}

console.log(
  `Masters: ${tests.length} tests + ${profiles.length} profiles = ${allMasters.length}`,
);
console.log(
  `Rate list 139: ${inListTestIds.size} tests + ${inListProfileIds.size} profiles = ${inListTestIds.size + inListProfileIds.size}`,
);
console.log(`Excel rows to check: ${excelItems.length}\n`);

// ── Normalisation + tokenisation ───────────────────────────────────────
// We do NOT strip parens — parenthetical content (often the abbreviation
// or expansion) is a strong matching signal, so we keep every word as a
// candidate token. Common LIS stop-words ("test", "serum") are filtered
// out before scoring so they don't drag noise into the Jaccard ratio.
const STOP = new Set([
  'test', 'tests', 'serum', 'fluid', 'plasma', 'urine', 'blood',
  'level', 'levels', 'qualitative', 'quantitative', 'random',
  'with', 'and', 'or', 'the', 'a', 'an', 'of', 'for', 'by', 'in',
  'panel', 'profile',
]);
function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[*†‡§]+/g, ' ')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function tokens(s) {
  return new Set(
    norm(s)
      .split(' ')
      .filter((t) => t.length > 0 && !STOP.has(t)),
  );
}
// Strip-stop variant kept for substring fallback (we want the full text).
function flat(s) {
  return norm(s).replace(/\s+/g, '');
}

// Pre-compute normalised name + tokens for every master row.
const masters = allMasters.map((m) => ({
  ...m,
  _norm: norm(m.name),
  _flat: flat(m.name),
  _tokens: tokens(m.name),
}));
const masterByNorm = new Map();
for (const m of masters) {
  if (!m._norm) continue;
  if (!masterByNorm.has(m._norm)) masterByNorm.set(m._norm, []);
  masterByNorm.get(m._norm).push(m);
}

// Jaccard similarity for fuzzy fallback.
function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// ── Match each Excel row to master(s) ──────────────────────────────────
function findMatches(item) {
  const en = norm(item.name);
  const ef = flat(item.name);
  const et = tokens(item.name);

  // 1. exact normalised
  const exact = masterByNorm.get(en) ?? [];
  if (exact.length > 0) return { kind: 'exact', rows: exact };

  // 2. forward subset — every (non-stop) excel token appears in master.
  // No length floor: single-token excel names like "HbA1c" are matched
  // against any master that mentions hba1c.
  const fwd = [];
  if (et.size >= 1) {
    for (const m of masters) {
      let ok = true;
      for (const t of et) if (!m._tokens.has(t)) { ok = false; break; }
      if (ok) fwd.push(m);
    }
  }
  if (fwd.length === 1) return { kind: 'fwd-subset', rows: fwd };
  if (fwd.length > 1) {
    // Prefer shortest master name (fewest extra tokens).
    const minLen = Math.min(...fwd.map((m) => m._tokens.size));
    const best = fwd.filter((m) => m._tokens.size === minLen);
    if (best.length === 1) return { kind: 'fwd-shortest', rows: best };
    return { kind: 'ambiguous', rows: best.slice(0, 5) };
  }

  // 3. reverse subset — every master token appears in excel.
  const rev = [];
  for (const m of masters) {
    if (m._tokens.size === 0) continue;
    let ok = true;
    for (const t of m._tokens) if (!et.has(t)) { ok = false; break; }
    if (ok) rev.push(m);
  }
  if (rev.length === 1) return { kind: 'rev-subset', rows: rev };
  if (rev.length > 1) {
    // Prefer largest master (most informative coverage of excel name).
    const maxLen = Math.max(...rev.map((m) => m._tokens.size));
    const best = rev.filter((m) => m._tokens.size === maxLen);
    if (best.length === 1) return { kind: 'rev-largest', rows: best };
    return { kind: 'ambiguous', rows: best.slice(0, 5) };
  }

  // 4. substring fallback on the flattened (no-space, no-punct) form.
  const subHits = masters.filter(
    (m) => (m._flat.length >= 4 && ef.length >= 4) &&
           (m._flat.includes(ef) || ef.includes(m._flat)),
  );
  if (subHits.length === 1) return { kind: 'substring', rows: subHits };
  if (subHits.length > 1) {
    const minLen = Math.min(...subHits.map((m) => m._flat.length));
    const best = subHits.filter((m) => m._flat.length === minLen);
    if (best.length === 1) return { kind: 'substring-shortest', rows: best };
    return { kind: 'ambiguous', rows: best.slice(0, 5) };
  }

  // 5. Jaccard ≥ 0.4 ranked.
  if (et.size >= 1) {
    const scored = masters
      .map((m) => ({ m, score: jaccard(et, m._tokens) }))
      .filter((x) => x.score >= 0.4)
      .sort((a, b) => b.score - a.score);
    if (scored.length === 1) return { kind: 'jaccard', rows: [scored[0].m] };
    if (scored.length > 1) {
      const top = scored[0].score;
      const tied = scored.filter((x) => x.score === top);
      if (tied.length === 1) return { kind: 'jaccard-top', rows: [tied[0].m] };
      return { kind: 'ambiguous', rows: tied.slice(0, 5).map((x) => x.m) };
    }
  }

  return { kind: 'none', rows: [] };
}

const covered = []; // master match exists AND at least one is in list 139
const needAddedToList = []; // master match exists but NOT in list 139
const noMasterMatch = []; // no master match at all
const ambiguous = [];

for (const it of excelItems) {
  const r = findMatches(it);
  if (r.kind === 'none') {
    noMasterMatch.push({ excel: it });
    continue;
  }
  if (r.kind === 'ambiguous') {
    ambiguous.push({ excel: it, candidates: r.rows });
    continue;
  }
  const anyInList = r.rows.some((m) => inList(m));
  if (anyInList) {
    covered.push({ excel: it, matched: r.rows.filter((m) => inList(m)), how: r.kind });
  } else {
    needAddedToList.push({ excel: it, masterMatch: r.rows, how: r.kind });
  }
}

// ── Summary ────────────────────────────────────────────────────────────
console.log('══ Coverage summary ══════════════════════════════════════');
console.log(`  ✓ Covered (in master AND in list 139)  : ${covered.length}`);
console.log(`  △ In master, NOT in list 139           : ${needAddedToList.length}`);
console.log(`  ✗ No matching test/profile in master   : ${noMasterMatch.length}`);
console.log(`  ? Ambiguous (multiple candidates)      : ${ambiguous.length}`);
console.log(`  ──────────────────────────────────────`);
console.log(`    Excel total                          : ${excelItems.length}`);
console.log(
  `    Coverage rate                        : ${((covered.length / excelItems.length) * 100).toFixed(1)}%`,
);
console.log('');

console.log('══ Need to be ADDED to rate list 139 (master exists) ══════');
console.log(`(${needAddedToList.length} items)\n`);
for (const x of needAddedToList) {
  const m = x.masterMatch[0];
  console.log(
    `  [${x.excel.subcategory.padEnd(18)}]  ${x.excel.name.padEnd(50)}  → ${m.kind} #${m.masterId} ${m.code} "${m.name}"  (excel ₹${x.excel.price ?? '—'} / master MRP ₹${m.mrp ?? '—'})`,
  );
}

console.log('\n══ NOT in master at all (need to be created) ══════════════');
console.log(`(${noMasterMatch.length} items)\n`);
for (const x of noMasterMatch) {
  console.log(
    `  [${x.excel.subcategory.padEnd(18)}]  ${x.excel.name}    excel price=₹${x.excel.price ?? '—'}`,
  );
}

console.log('\n══ Ambiguous (multiple plausible matches) ═════════════════');
console.log(`(${ambiguous.length} items)\n`);
for (const x of ambiguous) {
  console.log(`  Excel: "${x.excel.name}"  (${x.excel.subcategory})  ₹${x.excel.price}`);
  for (const c of x.candidates.slice(0, 4)) {
    console.log(
      `    ↳ ${c.kind} #${c.masterId} ${c.code} "${c.name}" ${inList(c) ? '✓in list' : '△not in list'}`,
    );
  }
}

fs.writeFileSync(
  '/tmp/medicare_diff_report.json',
  JSON.stringify(
    {
      summary: {
        excelTotal: excelItems.length,
        covered: covered.length,
        needAddedToList: needAddedToList.length,
        noMasterMatch: noMasterMatch.length,
        ambiguous: ambiguous.length,
      },
      covered,
      needAddedToList,
      noMasterMatch,
      ambiguous,
    },
    null,
    2,
  ),
);
console.log('\nFull report → /tmp/medicare_diff_report.json');

await pool.close();
