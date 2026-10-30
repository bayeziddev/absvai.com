/** Incomplete orders (Section 8): one row per checkout session, upserted; converted rows are kept to measure recovery. */
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
export type Row = Record<string, unknown>;

export interface Capture {
  sessionId: string;
  phone: string;
  name: string | null;
  address: Record<string, unknown>;
  cart: Array<{ variantId: number; qty: number; pricePaisa: number; name: string; sku: string }>;
  subtotalPaisa: number;
  source: Record<string, unknown>;
  deviceHash: string | null;
  ipHash: string | null;
  riskLevel: string;
  riskReasons: string[];
}

/** Every update overwrites the same row; a converted row is never overwritten. Returns false when nothing changed. */
export async function upsertCapture(db: D1Database, c: Capture): Promise<boolean> {
  const r = await db.prepare(
    `INSERT INTO abandoned_checkouts (checkout_session_id, phone, name, address, cart, subtotal_paisa, source, device_hash, ip_hash, risk_level, risk_reasons)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(checkout_session_id) DO UPDATE SET phone = excluded.phone, name = COALESCE(excluded.name, abandoned_checkouts.name), address = excluded.address,
       cart = excluded.cart, subtotal_paisa = excluded.subtotal_paisa, device_hash = excluded.device_hash, ip_hash = excluded.ip_hash,
       risk_level = excluded.risk_level, risk_reasons = excluded.risk_reasons, updated_at = ${NOW}
     WHERE abandoned_checkouts.status != 'converted'`,
  ).bind(c.sessionId, c.phone, c.name, JSON.stringify(c.address), JSON.stringify(c.cart), c.subtotalPaisa, JSON.stringify(c.source), c.deviceHash, c.ipHash, c.riskLevel, JSON.stringify(c.riskReasons)).run();
  return (r.meta.changes ?? 0) > 0;
}

export async function sessionStatus(db: D1Database, sessionId: string): Promise<string | null> {
  return (await db.prepare('SELECT status FROM abandoned_checkouts WHERE checkout_session_id = ?').bind(sessionId).first<{ status: string }>())?.status ?? null;
}

export async function incompleteById(db: D1Database, id: number): Promise<Row | null> {
  return db.prepare('SELECT * FROM abandoned_checkouts WHERE id = ?').bind(id).first<Row>();
}

export interface IncompleteFilters { status?: string; assignedTo?: string | null; phone?: string }

/** Newest first, with duplicate grouping by phone and keyset pagination on (updated_at, id). */
export async function listIncomplete(db: D1Database, f: IncompleteFilters, cursor: { updatedAt: string; id: number } | null, limit = 50): Promise<Row[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.status) { where.push('a.status = ?'); params.push(f.status); }
  if (f.assignedTo === '') where.push('a.assigned_to IS NULL');
  else if (f.assignedTo) { where.push('a.assigned_to = ?'); params.push(f.assignedTo); }
  if (f.phone) { where.push('a.phone = ?'); params.push(f.phone); }
  if (cursor) { where.push('(a.updated_at, a.id) < (?, ?)'); params.push(cursor.updatedAt, cursor.id); }
  return (await db.prepare(
    `SELECT a.*, ad.name AS assignee_name, o.order_no AS converted_order_no,
            (SELECT COUNT(*) FROM abandoned_checkouts b WHERE b.phone = a.phone AND b.id != a.id) AS same_phone_count
       FROM abandoned_checkouts a LEFT JOIN admins ad ON ad.id = a.assigned_to LEFT JOIN orders o ON o.id = a.converted_order_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.updated_at DESC, a.id DESC LIMIT ${Math.min(Math.max(limit, 1), 200)}`,
  ).bind(...params).all<Row>()).results;
}

export async function setIncompleteStatus(db: D1Database, id: number, status: string, note: string | null): Promise<boolean> {
  const r = await db.prepare(
    `UPDATE abandoned_checkouts SET status = ?, note = COALESCE(?, note), contacted_at = CASE WHEN ? = 'contacted' THEN COALESCE(contacted_at, ${NOW}) ELSE contacted_at END,
       updated_at = ${NOW} WHERE id = ? AND status != 'converted'`,
  ).bind(status, note, status, id).run();
  return (r.meta.changes ?? 0) > 0;
}

export async function assignIncomplete(db: D1Database, id: number, adminId: string | null): Promise<void> {
  await db.prepare(`UPDATE abandoned_checkouts SET assigned_to = ?, updated_at = ${NOW} WHERE id = ?`).bind(adminId, id).run();
}

/** Data minimisation: unconverted records older than the retention period are deleted (default 60 days). */
export async function purgeIncomplete(db: D1Database, olderThanIso: string): Promise<number> {
  const r = await db.prepare("DELETE FROM abandoned_checkouts WHERE status != 'converted' AND updated_at < ?").bind(olderThanIso).run();
  return r.meta.changes ?? 0;
}

export async function newIncompleteCount(db: D1Database, sinceIso: string): Promise<number> {
  return Number((await db.prepare("SELECT COUNT(*) AS n FROM abandoned_checkouts WHERE status = 'new' AND updated_at >= ?").bind(sinceIso).first<{ n: number }>())?.n ?? 0);
}

/**
 * Recovery report: captured, contacted, completed by the customer on their own, and recovered by staff
 * (converted after a contact, or through a manual order), with recovered revenue by source and agent.
 */
export async function recoveryReport(db: D1Database, sinceIso: string) {
  const base = `FROM abandoned_checkouts a LEFT JOIN orders o ON o.id = a.converted_order_id WHERE a.created_at >= ?`;
  const recovered = "(a.status = 'converted' AND (a.contacted_at IS NOT NULL OR o.created_by IS NOT NULL))";
  const [totals, bySource, byAgent] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS captured, SUM(a.contacted_at IS NOT NULL) AS contacted, SUM(a.status = 'converted') AS converted,
                       SUM(${recovered}) AS recovered, COALESCE(SUM(CASE WHEN ${recovered} AND o.status NOT IN ('cancelled','returned') THEN o.total_paisa END), 0) AS recovered_revenue_paisa ${base}`).bind(sinceIso),
    db.prepare(`SELECT COALESCE(json_extract(a.source, '$.utm.utm_source'), CASE WHEN json_extract(a.source, '$.landingPageId') IS NOT NULL THEN 'landing page' END, 'direct') AS source,
                       COUNT(*) AS captured, SUM(${recovered}) AS recovered ${base} GROUP BY 1 ORDER BY captured DESC LIMIT 20`).bind(sinceIso),
    db.prepare(`SELECT COALESCE(ad.name, 'Unassigned') AS agent, COUNT(*) AS assigned, SUM(a.contacted_at IS NOT NULL) AS contacted, SUM(${recovered}) AS recovered,
                       COALESCE(SUM(CASE WHEN ${recovered} AND o.status NOT IN ('cancelled','returned') THEN o.total_paisa END), 0) AS revenue_paisa
                  FROM abandoned_checkouts a LEFT JOIN orders o ON o.id = a.converted_order_id LEFT JOIN admins ad ON ad.id = a.assigned_to
                 WHERE a.created_at >= ? GROUP BY a.assigned_to ORDER BY recovered DESC`).bind(sinceIso),
  ]);
  return { totals: totals.results[0] as Row, bySource: bySource.results as Row[], byAgent: byAgent.results as Row[] };
}
