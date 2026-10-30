/** Search synonyms, wholesale inquiries and notify-me requests. */
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export async function listSynonyms(db: D1Database) {
  return (await db.prepare('SELECT * FROM search_synonyms ORDER BY group_key, term').all()).results;
}

export async function addSynonym(db: D1Database, group: string, term: string): Promise<void> {
  await db.prepare('INSERT INTO search_synonyms (group_key, term) VALUES (?, ?)').bind(group, term).run();
}

export async function deleteSynonym(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM search_synonyms WHERE id = ?').bind(id).run();
}

export async function addWholesaleInquiry(db: D1Database, w: { name: string; phone: string; business: string | null; district: string | null; message: string | null }): Promise<void> {
  await db.prepare('INSERT INTO wholesale_inquiries (name, phone, business, district, message) VALUES (?, ?, ?, ?, ?)').bind(w.name, w.phone, w.business, w.district, w.message).run();
}

export async function listWholesale(db: D1Database) {
  return (await db.prepare('SELECT * FROM wholesale_inquiries ORDER BY id DESC LIMIT 200').all()).results;
}

export async function setWholesaleStatus(db: D1Database, id: number, status: string): Promise<void> {
  await db.prepare('UPDATE wholesale_inquiries SET status = ? WHERE id = ?').bind(status, id).run();
}

export async function addNotifyRequest(db: D1Database, productId: number, phone: string, channel: 'sms' | 'whatsapp'): Promise<void> {
  await db.prepare("INSERT INTO notify_requests (product_id, phone, channel) VALUES (?, ?, ?) ON CONFLICT(product_id, phone) DO UPDATE SET status = 'waiting', channel = excluded.channel")
    .bind(productId, phone, channel).run();
}

export async function notifySummary(db: D1Database) {
  return (await db.prepare(
    `SELECT n.product_id, p.name, p.slug, SUM(CASE WHEN n.status = 'waiting' THEN 1 ELSE 0 END) AS waiting, SUM(CASE WHEN n.status = 'sent' THEN 1 ELSE 0 END) AS sent, MAX(n.created_at) AS last_at
       FROM notify_requests n JOIN products p ON p.id = n.product_id GROUP BY n.product_id ORDER BY waiting DESC`,
  ).all()).results;
}

export async function waitingNotify(db: D1Database, productId: number, limit = 500): Promise<Array<{ id: number; phone: string }>> {
  return (await db.prepare("SELECT id, phone FROM notify_requests WHERE product_id = ? AND status = 'waiting' LIMIT ?").bind(productId, limit).all<{ id: number; phone: string }>()).results;
}

export async function markNotified(db: D1Database, id: number): Promise<void> {
  await db.prepare(`UPDATE notify_requests SET status = 'sent', notified_at = ${NOW} WHERE id = ?`).bind(id).run();
}

export async function productsWaitingForSeason(db: D1Database, seasonId: number): Promise<number[]> {
  return (await db.prepare("SELECT DISTINCT n.product_id FROM notify_requests n JOIN product_seasons ps ON ps.product_id = n.product_id WHERE ps.season_id = ? AND n.status = 'waiting'")
    .bind(seasonId).all<{ product_id: number }>()).results.map(r => r.product_id);
}
