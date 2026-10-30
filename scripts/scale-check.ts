/**
 * Scale check (Section 21.3): builds a throwaway SQLite database from the real migrations, fills it with synthetic
 * orders (1,000,000 by default) and times the admin's hot queries exactly as the repository layer builds them.
 * D1 runs SQLite, so query plans and index work match; D1 adds network time on top, which this does not measure.
 *
 *   npm run scale:check                # 1,000,000 orders
 *   npm run scale:check -- --orders 200000
 */
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dashboardFigures, stageCounts } from '../worker/src/repo/dashboard';
import { listOrdersQuery, type OrderFilters } from '../worker/src/repo/orders';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name: string, fallback: number) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? Number(process.argv[i + 1]) : fallback; };
const N = arg('orders', 1_000_000);
const BUDGET_MS = 300;

const dir = mkdtempSync(join(tmpdir(), 'absvai-scale-'));
const file = join(dir, 'scale.sqlite');
// Synthetic orders point at geo areas and staff that this throwaway database does not hold, so FK checks are off here only.
const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = OFF;');
db.exec(readFileSync(join(ROOT, 'worker/migrations/0001_schema.sql'), 'utf8'));
db.exec('PRAGMA foreign_keys = OFF;'); // the schema turns them on

// Deterministic pseudo-random data so runs are comparable.
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pickW = <T>(items: Array<[T, number]>) => { let r = rnd() * items.reduce((s, [, w]) => s + w, 0); for (const [v, w] of items) { if ((r -= w) <= 0) return v; } return items[0][0]; };
const STATUS: Array<[string, number]> = [['delivered', 62], ['returned', 9], ['cancelled', 10], ['in_courier', 6], ['packed', 3], ['confirmed', 4], ['new', 5], ['partial_delivered', 1]];
const SOURCE: Array<[string, number]> = [['web', 55], ['landing', 15], ['messenger', 12], ['facebook_comment', 8], ['whatsapp', 6], ['phone_call', 4]];
const start = Date.parse('2024-11-01T00:00:00Z');
const span = Date.parse('2026-10-30T00:00:00Z') - start;

console.log(`Seeding ${N.toLocaleString('en-US')} orders…`);
const t0 = performance.now();
const ins = db.prepare(`INSERT INTO orders (order_no, access_token, invoice_no, status, payment_method, subtotal_paisa, total_paisa, customer_name, phone,
  division_id, district_id, upazila_id, division_name, district_name, upazila_name, address_line, source, risk_level, assigned_to, hold_reason,
  fulfilment_type, advance_status, return_received_at, created_at, updated_at)
  VALUES (?, 'x', ?, ?, 'cod', ?, ?, ?, ?, 3, ?, ?, 'Dhaka', 'District', 'Area', 'House 1, Road 2', ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const NAMES = ['Rahim', 'Karim', 'Shila', 'Nasima', 'Rubel', 'Mitu', 'Tania', 'Sabbir', 'Jannat', 'Arif'];
db.exec('BEGIN');
for (let i = 1; i <= N; i++) {
  const created = new Date(start + (i / N) * span + rnd() * 60_000).toISOString();
  const status = pickW(STATUS);
  const day = created.slice(2, 10).replace(/-/g, '');
  const sub = 30000 + Math.floor(rnd() * 400000);
  // ~300k distinct customers (8801 + operator 3–9 + 8 digits), so repeat buyers exist.
  const phone = `8801${3 + Math.floor(rnd() * 7)}${String((Math.floor(rnd() * 300_000) * 331) % 100_000_000).padStart(8, '0')}`;
  const returning = status === 'returned' || status === 'partial_delivered';
  const updated = new Date(Date.parse(created) + (['new', 'confirmed'].includes(status) ? 0 : 3 * 86_400_000)).toISOString();
  const preOrder = rnd() < 0.02;
  ins.run(`AV-${day}-${String(i).padStart(7, '0')}`, status === 'new' || status === 'cancelled' ? null : `INV-${created.slice(0, 10).replace(/-/g, '')}-${String(i).padStart(7, '0')}`,
    status, sub, sub + 13000, `${NAMES[i % 10]} ${i}`, phone, 1 + (i % 64), 1 + (i % 500), pickW(SOURCE), rnd() < 0.05 ? 'high' : 'low',
    rnd() < 0.3 ? `agent-${i % 8}` : null, status === 'new' && rnd() < 0.1 ? 'Another order came from this phone 4 minutes earlier.' : null,
    preOrder ? 'pre_order' : 'standard', preOrder ? (status === 'new' ? 'submitted' : 'paid') : 'not_required',
    returning && i < N - 2000 ? updated : null, created, updated);
  if (i % 100_000 === 0) { db.exec('COMMIT; BEGIN'); process.stdout.write(`  ${i.toLocaleString('en-US')}\n`); }
}
db.exec('COMMIT; ANALYZE;');
console.log(`Seeded in ${((performance.now() - t0) / 1000).toFixed(1)} s, database ${(statSync(file).size / 2 ** 20).toFixed(0)} MB\n`);

const sample = db.prepare('SELECT phone, order_no, invoice_no, created_at, id FROM orders WHERE invoice_no IS NOT NULL ORDER BY id DESC LIMIT 1 OFFSET 777').get() as Record<string, string>;
const deep = db.prepare('SELECT created_at, id FROM orders ORDER BY created_at DESC, id DESC LIMIT 1 OFFSET 400000').get() as { created_at: string; id: number } | undefined;
const local = `0${sample.phone.slice(3)}`;
const cases: Array<[string, OrderFilters, { createdAt: string; id: number } | null]> = [
  ['All orders, first page', {}, null],
  ['All orders, page 8,000 (keyset)', {}, deep ? { createdAt: deep.created_at, id: deep.id } : null],
  ['Stage tab: New', { status: 'new' }, null],
  ['Stage tab: In Courier', { status: 'in_courier' }, null],
  ['On hold', { status: 'held' }, null],
  [`Phone search ${local}`, { phoneRange: [sample.phone, `${sample.phone.slice(0, -1)}${String.fromCharCode(sample.phone.charCodeAt(12) + 1)}`] }, null],
  ['Phone prefix 0171', { phoneRange: ['8801710', '8801711'] }, null],
  [`Order number ${sample.order_no}`, { numberPrefix: [sample.order_no, `${sample.order_no}￿`, 'order_no'] }, null],
  [`Invoice ${sample.invoice_no}`, { numberPrefix: [sample.invoice_no, `${sample.invoice_no}￿`, 'invoice_no'] }, null],
  ['My orders (agent-3)', { assignedTo: 'agent-3' }, null],
  ['High risk', { risk: 'high' }, null],
  ['Advances to verify', { advance: 'submitted' }, null],
  ['Pre-orders', { preOrder: true }, null],
  ['Unassigned', { assignedTo: '' }, null],
  ['Channel: Messenger', { source: 'messenger' }, null],
];

const rows: string[] = [];
let failed = 0;
for (const [name, f, cursor] of cases) {
  const q = listOrdersQuery(f, cursor, 50);
  const stmt = db.prepare(q.sql);
  stmt.all(...(q.params as never[])); // warm
  const times: number[] = [];
  let count = 0;
  for (let k = 0; k < 5; k++) { const a = performance.now(); count = stmt.all(...(q.params as never[])).length; times.push(performance.now() - a); }
  const ms = times.sort((a, b) => a - b)[2];
  const plan = (db.prepare(`EXPLAIN QUERY PLAN ${q.sql}`).all(...(q.params as never[])) as Array<{ detail: string }>).map(p => p.detail);
  const fullScan = plan.some(d => /^SCAN o\b/.test(d) && !/USING (COVERING )?INDEX/.test(d));
  const ok = ms < BUDGET_MS && !fullScan;
  if (!ok) failed++;
  rows.push(`| ${name} | ${count} | ${ms.toFixed(1)} ms | ${fullScan ? 'FULL SCAN' : plan.find(d => /orders|o /.test(d))?.replace(/^(SEARCH|SCAN) o /, '') ?? ''} | ${ok ? 'ok' : 'FAIL'} |`);
}
console.log(`| Query (50 rows) | Rows | Median | Plan | < ${BUDGET_MS} ms |\n|---|---|---|---|---|\n${rows.join('\n')}`);

// The dashboard's own repository functions, run through a minimal D1 adapter over the same database.
const d1 = {
  prepare(sql: string) {
    const st = db.prepare(sql);
    let params: unknown[] = [];
    const s = { bind: (...p: unknown[]) => { params = p; return s; }, all: async () => ({ results: st.all(...(params as never[])) }), first: async () => st.get(...(params as never[])) ?? null };
    return s;
  },
  batch: async (stmts: Array<{ all: () => Promise<unknown> }>) => Promise.all(stmts.map(x => x.all())),
} as unknown as D1Database;
const today = '2026-10-29';
const timed = async (name: string, fn: () => Promise<unknown>) => {
  await fn();
  const times: number[] = [];
  for (let k = 0; k < 5; k++) { const a = performance.now(); await fn(); times.push(performance.now() - a); }
  const ms = times.sort((a, b) => a - b)[2];
  if (ms >= BUDGET_MS) failed++;
  console.log(`| ${name} | ${ms.toFixed(1)} ms | ${ms < BUDGET_MS ? 'ok' : 'FAIL'} |`);
};
console.log(`\n| Dashboard (all queries in one batch) | Median | < ${BUDGET_MS} ms |\n|---|---|---|`);
await timed('Stage cards, on hold, returns to scan', () => stageCounts(d1, '2026-09-29T00:00:00Z'));
await timed('Today, 14-day chart, advances, pre-orders, COD with couriers', () => dashboardFigures(d1, {
  todayStartIso: `${today}T00:00:00+06:00`, todayEndIso: '2026-10-30T00:00:00+06:00', chartStartIso: '2026-10-16T00:00:00+06:00', weekAgoIso: '2026-10-22T00:00:00Z', todayBd: today,
}));
db.close();
rmSync(dir, { recursive: true, force: true });
if (failed) { console.error(`\n${failed} quer${failed === 1 ? 'y' : 'ies'} over budget or scanning the whole table.`); process.exit(1); }
