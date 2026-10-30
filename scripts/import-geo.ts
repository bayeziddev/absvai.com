/**
 * One-time geo import: Bangladesh-geocode (hierarchy + district coordinates + outlines)
 * paired with the postcode file shipped in the same repository (postcode-bd/postcode.csv).
 *
 * Outputs
 *   worker/migrations/0002_geo_data.sql      D1 migration with every geo row
 *   data/geo/reports/postcode-match-report.csv   one line per postcode row and how it was linked
 *   data/geo/reports/postcode-match-summary.md   counts + the rows that need manual fixing in admin
 *   data/geo/generated/outlines/<districtId>.json  simplified district outline (map card)
 *   data/geo/generated/districts.json        all simplified outlines (point-in-polygon for "Use my location")
 *   worker/src/generated/geo-version.ts      content hash used to version the static geo URLs
 *
 * Rules (from the build prompt, Section 6.1):
 *   - IDs come from the pinned files, never from documentation.
 *   - Postcode rows are linked to an upazila by normalised English name *within the same district*.
 *   - Anything that cannot be linked with confidence is written to the report, not guessed.
 *
 * Run: npm run gen:geo
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'data/geo/source/bangladesh-geocode');
const OUT_GENERATED = join(ROOT, 'data/geo/generated');
const OUT_REPORTS = join(ROOT, 'data/geo/reports');

type Row = Record<string, string>;

function phpMyAdminTable(file: string): Row[] {
  const parsed = JSON.parse(readFileSync(join(SRC, file), 'utf8')) as Array<{ type?: string; data?: Row[] }>;
  const table = parsed.find(item => Array.isArray(item.data));
  if (!table?.data) throw new Error(`${file}: no table data found`);
  return table.data;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// ───────────── Name normalisation ─────────────

export function normKey(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '');
}

/** Folds common English transliteration variants so "Rouzan" ≈ "Raozan", "Davidhar" ≈ "Debidwar". */
export function fold(name: string): string {
  let s = normKey(name);
  s = s
    .replace(/chh/g, 'ch')
    .replace(/([bdgjkpt])h/g, '$1')
    .replace(/sh/g, 's')
    .replace(/ph/g, 'f')
    .replace(/z/g, 'j')
    .replace(/v/g, 'b')
    .replace(/w/g, 'o')
    .replace(/q/g, 'k')
    .replace(/y/g, 'i')
    .replace(/ou|ao|au|oa/g, 'o')
    .replace(/ee|ei|ie/g, 'i')
    .replace(/oo/g, 'u')
    .replace(/(.)\1+/g, '$1');
  return s;
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/**
 * District spellings used by the postcode file (Wikipedia) and the outline file (ADM2_EN)
 * mapped to the spelling used by Bangladesh-geocode districts.json. Keys and values are normKey()s.
 */
const DISTRICT_ALIASES: Record<string, string> = {
  bagherhat: 'bagerhat',
  barishal: 'barisal',
  bogra: 'bogura',
  brahamanbaria: 'brahmanbaria',
  chapinawabganj: 'chapainawabganj',
  nawabganj: 'chapainawabganj', // ADM2_EN in the outline file
  chittagong: 'chattogram',
  cumilla: 'comilla',
  hobiganj: 'habiganj',
  jessore: 'jashore',
  jhalokathi: 'jhalakathi',
  jhalokati: 'jhalakathi',
  jinaidaha: 'jhenaidah',
  khagrachari: 'khagrachhari',
  kustia: 'kushtia',
  maulvibazar: 'moulvibazar',
  narshingdi: 'narsingdi',
  netrakona: 'netrokona',
};

/**
 * City-corporation areas. The source dataset stops at upazilas, and city areas (most of
 * Dhaka city, for example) are not upazilas, so without these a Dhaka city customer has
 * no area to choose. Linked to their district by the district's name in the pinned file.
 */
const CITY_CORPORATIONS: Array<{ id: number; district: string; name: string }> = [
  { id: 9001, district: 'Dhaka', name: 'Dhaka North City Corporation' },
  { id: 9002, district: 'Dhaka', name: 'Dhaka South City Corporation' },
  { id: 9003, district: 'Chattogram', name: 'Chattogram City Corporation' },
  { id: 9004, district: 'Khulna', name: 'Khulna City Corporation' },
  { id: 9005, district: 'Rajshahi', name: 'Rajshahi City Corporation' },
  { id: 9006, district: 'Sylhet', name: 'Sylhet City Corporation' },
  { id: 9007, district: 'Barisal', name: 'Barishal City Corporation' },
  { id: 9008, district: 'Rangpur', name: 'Rangpur City Corporation' },
  { id: 9009, district: 'Mymensingh', name: 'Mymensingh City Corporation' },
  { id: 9010, district: 'Gazipur', name: 'Gazipur City Corporation' },
  { id: 9011, district: 'Narayanganj', name: 'Narayanganj City Corporation' },
  { id: 9012, district: 'Comilla', name: 'Cumilla City Corporation' },
];

// ───────────── Geometry ─────────────

type Pt = [number, number];

function perpDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function douglasPeucker(points: Pt[], tolerance: number): Pt[] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpDist(points[i], points[s], points[e]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tolerance && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function ringArea(ring: Pt[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(a / 2);
}

function simplifyMultiPolygon(coords: Pt[][][], tolerance: number): Pt[][][] {
  const out: Pt[][][] = [];
  for (const polygon of coords) {
    const rings: Pt[][] = [];
    for (const [ri, ring] of polygon.entries()) {
      // Drop specks (tiny islands / holes) that would not be visible on a phone-sized map card.
      if (ringArea(ring) < tolerance * tolerance * 4) continue;
      const simplified = douglasPeucker(ring, tolerance).map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4] as Pt);
      if (simplified.length >= 4) rings.push(simplified);
      else if (ri === 0) break;
    }
    if (rings.length) out.push(rings);
  }
  return out;
}

// ───────────── SQL helpers ─────────────

function sqlValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

function insertBatches(table: string, columns: string[], rows: unknown[][], batch = 150): string {
  const parts: string[] = [];
  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch).map(r => `(${r.map(sqlValue).join(',')})`).join(',\n');
    parts.push(`INSERT INTO ${table} (${columns.join(',')}) VALUES\n${chunk};`);
  }
  return parts.join('\n');
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ───────────── Main ─────────────

export interface PostcodeMatch {
  postcode: string;
  postOffice: string;
  sourceDivision: string;
  sourceDistrict: string;
  sourceThana: string;
  divisionId: number;
  districtId: number;
  upazilaId: number | null;
  status: 'exact' | 'alias' | 'fuzzy' | 'unmatched';
  note: string;
}

export function matchUpazila(
  thana: string,
  candidates: Array<{ id: number; name: string }>,
  districtName: string,
): { id: number | null; status: PostcodeMatch['status']; note: string } {
  const key = normKey(thana);
  const exact = candidates.filter(u => normKey(u.name) === key);
  if (exact.length === 1) return { id: exact[0].id, status: 'exact', note: '' };

  // "<District> Sadar" spelled differently from the upazila (e.g. "Barishal Sadar" vs "Barisal Sadar").
  if (/sadar/i.test(thana)) {
    const sadar = candidates.filter(u => /sadar/i.test(u.name));
    if (sadar.length === 1) return { id: sadar[0].id, status: 'alias', note: `"${thana.trim()}" → "${sadar[0].name}" (district sadar)` };
  }
  if (key === normKey(districtName)) {
    const sadar = candidates.filter(u => /sadar/i.test(u.name));
    if (sadar.length === 1) return { id: sadar[0].id, status: 'alias', note: `"${thana.trim()}" → "${sadar[0].name}" (thana named after district)` };
  }

  const folded = fold(thana.replace(/\b(UPO|TSO|Thana)\b/gi, ''));
  const foldedHits = candidates.filter(u => fold(u.name) === folded);
  if (foldedHits.length === 1) return { id: foldedHits[0].id, status: 'fuzzy', note: `"${thana.trim()}" → "${foldedHits[0].name}" (spelling variant)` };

  const limit = folded.length <= 6 ? 1 : 2;
  const scored = candidates
    .map(u => ({ u, d: levenshtein(folded, fold(u.name)) }))
    .filter(x => x.d <= limit)
    .sort((a, b) => a.d - b.d);
  if (scored.length && (scored.length === 1 || scored[1].d > scored[0].d)) {
    return { id: scored[0].u.id, status: 'fuzzy', note: `"${thana.trim()}" → "${scored[0].u.name}" (edit distance ${scored[0].d}, please review)` };
  }
  return { id: null, status: 'unmatched', note: scored.length > 1 ? 'several equally close upazilas' : 'no upazila with a similar name in this district' };
}

function main() {
  const divisions = phpMyAdminTable('divisions.json').map(r => ({ id: Number(r.id), name: r.name.trim(), bn: r.bn_name?.trim() }));
  const districts = phpMyAdminTable('districts.json').map(r => ({
    id: Number(r.id), divisionId: Number(r.division_id), name: r.name.trim(), bn: r.bn_name?.trim(), lat: Number(r.lat), lon: Number(r.lon),
  }));
  const upazilas = phpMyAdminTable('upazilas.json').map(r => ({ id: Number(r.id), districtId: Number(r.district_id), name: r.name.trim(), bn: r.bn_name?.trim() }));
  const unions = phpMyAdminTable('unions.json').map(r => ({
    id: Number(r.id), upazilaId: Number(r.upazilla_id ?? r.upazila_id), name: r.name.trim(), bn: r.bn_name?.trim(),
  }));

  const expect = (label: string, got: number, want: number) => {
    if (got !== want) throw new Error(`${label}: expected ${want} rows in the pinned file, found ${got}`);
  };
  expect('divisions', divisions.length, 8);
  expect('districts', districts.length, 64);
  expect('upazilas', upazilas.length, 494);
  expect('unions', unions.length, 4540);

  const districtByKey = new Map(districts.map(d => [normKey(d.name), d]));
  const resolveDistrict = (name: string) => {
    const k = normKey(name);
    return districtByKey.get(k) ?? districtByKey.get(DISTRICT_ALIASES[k] ?? '');
  };

  const supplement = CITY_CORPORATIONS.map(cc => {
    const d = resolveDistrict(cc.district);
    if (!d) throw new Error(`City corporation ${cc.name}: district ${cc.district} not in pinned file`);
    if (upazilas.some(u => u.id === cc.id)) throw new Error(`City corporation id ${cc.id} clashes with a source upazila id`);
    return { id: cc.id, districtId: d.id, name: cc.name };
  });

  // Postcodes
  const postcodeLines = readFileSync(join(SRC, 'postcode.csv'), 'utf8').split(/\r?\n/).filter(l => l.trim());
  const matches: PostcodeMatch[] = [];
  const unresolvedDistricts = new Set<string>();
  for (const line of postcodeLines) {
    const [division, district, thana, office, code] = parseCsvLine(line).map(s => s.trim());
    if (!/^\d{4}$/.test(code)) throw new Error(`Bad postcode row: ${line}`);
    const d = resolveDistrict(district);
    if (!d) { unresolvedDistricts.add(district); continue; }
    const candidates = upazilas.filter(u => u.districtId === d.id);
    const m = matchUpazila(thana, candidates, d.name);
    matches.push({
      postcode: code, postOffice: office, sourceDivision: division, sourceDistrict: district, sourceThana: thana,
      divisionId: d.divisionId, districtId: d.id, upazilaId: m.id, status: m.status, note: m.note,
    });
  }
  if (unresolvedDistricts.size) throw new Error(`Postcode districts with no alias: ${[...unresolvedDistricts].join(', ')}`);

  // Outlines
  const geo = JSON.parse(readFileSync(join(SRC, 'districts.geojson.txt'), 'utf8')) as {
    features: Array<{ properties: { ADM2_EN: string; ADM1_EN: string }; geometry: { type: string; coordinates: Pt[][][] } }>;
  };
  const TOLERANCE = 0.0025; // ≈ 250 m, invisible on a phone map card
  const outlineFeatures: Array<{ type: 'Feature'; properties: { id: number; name: string }; geometry: { type: 'MultiPolygon'; coordinates: Pt[][][] } }> = [];
  const seen = new Set<number>();
  for (const f of geo.features) {
    const d = resolveDistrict(f.properties.ADM2_EN);
    if (!d) throw new Error(`Outline ${f.properties.ADM2_EN} has no district match`);
    if (seen.has(d.id)) throw new Error(`Two outlines resolve to district ${d.name}`);
    seen.add(d.id);
    const coordinates = f.geometry.type === 'Polygon'
      ? simplifyMultiPolygon([f.geometry.coordinates as unknown as Pt[][]], TOLERANCE)
      : simplifyMultiPolygon(f.geometry.coordinates, TOLERANCE);
    outlineFeatures.push({ type: 'Feature', properties: { id: d.id, name: d.name }, geometry: { type: 'MultiPolygon', coordinates } });
  }
  expect('outlines', outlineFeatures.length, 64);

  mkdirSync(join(OUT_GENERATED, 'outlines'), { recursive: true });
  mkdirSync(OUT_REPORTS, { recursive: true });
  for (const f of outlineFeatures) writeFileSync(join(OUT_GENERATED, 'outlines', `${f.properties.id}.json`), JSON.stringify(f));
  const allOutlines = JSON.stringify({ type: 'FeatureCollection', features: outlineFeatures });
  writeFileSync(join(OUT_GENERATED, 'districts.json'), allOutlines);

  // SQL migration
  const sql: string[] = [
    '-- GENERATED by scripts/import-geo.ts from data/geo/source/bangladesh-geocode (see data/geo/SOURCES.md).',
    '-- Do not edit by hand: fix postcodes in admin (Delivery Zones & Geo → Postcodes) or re-run the import.',
    insertBatches('geo_divisions', ['id', 'name', 'bn_name'], divisions.map(d => [d.id, d.name, d.bn])),
    insertBatches('geo_districts', ['id', 'division_id', 'name', 'bn_name', 'lat', 'lon'], districts.map(d => [d.id, d.divisionId, d.name, d.bn, d.lat, d.lon])),
    insertBatches('geo_upazilas', ['id', 'district_id', 'name', 'bn_name'], upazilas.map(u => [u.id, u.districtId, u.name, u.bn])),
    insertBatches('geo_upazilas', ['id', 'district_id', 'name', 'kind', 'source'], supplement.map(s => [s.id, s.districtId, s.name, 'city_corporation', 'absvai-supplement'])),
    insertBatches('geo_unions', ['id', 'upazila_id', 'name', 'bn_name'], unions.map(u => [u.id, u.upazilaId, u.name, u.bn])),
    insertBatches(
      'geo_postcodes',
      ['postcode', 'post_office', 'division_id', 'district_id', 'upazila_id', 'source_division_name', 'source_district_name', 'source_upazila_name', 'match_status', 'match_note'],
      matches.map(m => [m.postcode, m.postOffice, m.divisionId, m.districtId, m.upazilaId, m.sourceDivision, m.sourceDistrict, m.sourceThana, m.status, m.note]),
    ),
  ];
  writeFileSync(join(ROOT, 'worker/migrations/0002_geo_data.sql'), sql.join('\n\n') + '\n');

  // Reports
  const upName = new Map([...upazilas, ...supplement].map(u => [u.id, u.name]));
  const distName = new Map(districts.map(d => [d.id, d.name]));
  const header = ['postcode', 'post_office', 'source_district', 'source_thana', 'district_id', 'district', 'upazila_id', 'upazila', 'match_status', 'note'];
  const csv = [header.join(',')]
    .concat(matches.map(m => [m.postcode, m.postOffice, m.sourceDistrict, m.sourceThana, m.districtId, distName.get(m.districtId), m.upazilaId ?? '', m.upazilaId ? upName.get(m.upazilaId) : '', m.status, m.note].map(csvCell).join(',')))
    .join('\n');
  writeFileSync(join(OUT_REPORTS, 'postcode-match-report.csv'), csv + '\n');

  const count = (s: string) => matches.filter(m => m.status === s).length;
  const byDistrict = new Map<string, number>();
  for (const m of matches.filter(x => x.status === 'unmatched')) {
    const n = distName.get(m.districtId)!;
    byDistrict.set(n, (byDistrict.get(n) ?? 0) + 1);
  }
  const summary = [
    '# Postcode match report',
    '',
    'Generated by `scripts/import-geo.ts`. Postcode rows come from `postcode-bd/postcode.csv` in Bangladesh-geocode',
    '(scraped from Wikipedia\'s "List of postal codes in Bangladesh"). Each row is linked to a Bangladesh-geocode district by',
    'name (with the alias table in the script), then to an upazila *inside that district* by name.',
    '',
    '| Status | Rows | Meaning |',
    '|---|---:|---|',
    `| exact | ${count('exact')} | Same name after normalising case, spaces and punctuation |`,
    `| alias | ${count('alias')} | District "Sadar" thana spelled differently |`,
    `| fuzzy | ${count('fuzzy')} | Spelling variant (e.g. Rouzan → Raozan). Linked, but listed for a quick review in admin |`,
    `| unmatched | ${count('unmatched')} | District is known, upazila is not. Checkout still auto-fills Division + District and asks the customer to pick the area. Fix in admin |`,
    `| **total** | **${matches.length}** | |`,
    '',
    'Postcode division names in the source file use the pre-2015 seven-division structure (no Mymensingh), so the division',
    'is always taken from the matched Bangladesh-geocode district, never from the postcode file.',
    '',
    'Most unmatched rows are city thanas (Dhaka, Chattogram, Khulna, …) that are not upazilas. Assign them to the matching',
    'city-corporation area in admin → Delivery Zones & Geo → Postcodes (bulk assign by district is available).',
    '',
    '## Unmatched rows by district',
    '',
    '| District | Unmatched |',
    '|---|---:|',
    ...[...byDistrict.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `| ${n} | ${c} |`),
    '',
  ].join('\n');
  writeFileSync(join(OUT_REPORTS, 'postcode-match-summary.md'), summary);

  // Version for static URLs
  const version = createHash('sha256').update(allOutlines).update(sql.join('')).digest('hex').slice(0, 10);
  mkdirSync(join(ROOT, 'worker/src/generated'), { recursive: true });
  writeFileSync(
    join(ROOT, 'worker/src/generated/geo-version.ts'),
    `// GENERATED by scripts/import-geo.ts. Changes whenever the geo data changes, so static geo URLs can be cached forever.\nexport const GEO_VERSION = '${version}';\n`,
  );

  console.log(`divisions ${divisions.length}, districts ${districts.length}, upazilas ${upazilas.length} (+${supplement.length} city corporations), unions ${unions.length}`);
  console.log(`postcodes ${matches.length}: exact ${count('exact')}, alias ${count('alias')}, fuzzy ${count('fuzzy')}, unmatched ${count('unmatched')}`);
  console.log(`outlines 64, combined ${(allOutlines.length / 1024).toFixed(0)} KB, version ${version}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
