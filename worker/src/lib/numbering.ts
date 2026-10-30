import { bdDate, bdDateCompact } from './dates';

/** Atomically increments a named counter and returns the new value (single SQL statement, safe under concurrency). */
export async function nextCounter(db: D1Database, name: string): Promise<number> {
  const row = await db.prepare(
    'INSERT INTO counters (name, value) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value',
  ).bind(name).first<{ value: number }>();
  if (!row) throw new Error(`counter ${name} failed`);
  return row.value;
}

/** AV-YYMMDD-#### for orders, PRE-YYMMDD-#### for pre-orders (Bangladesh date). */
export async function nextOrderNo(db: D1Database, preOrder: boolean, now = new Date()): Promise<string> {
  const day = bdDate(now).slice(2).replace(/-/g, '');
  const prefix = preOrder ? 'PRE' : 'AV';
  const n = await nextCounter(db, `order:${prefix}:${day}`);
  return `${prefix}-${day}-${String(n).padStart(4, '0')}`;
}

/** INV-YYYYMMDD-#### issued when an order is confirmed. */
export async function nextInvoiceNo(db: D1Database, now = new Date()): Promise<string> {
  const day = bdDateCompact(now);
  const n = await nextCounter(db, `invoice:${day}`);
  return `INV-${day}-${String(n).padStart(4, '0')}`;
}

export async function nextSkuSequence(db: D1Database, categoryCode: string): Promise<number> {
  return nextCounter(db, `sku:${categoryCode}`);
}
