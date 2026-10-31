/** Product reviews (reviews; migration 0009): customers write them, the shop approves, replies or adds its own. */
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export interface ReviewRow {
  id: number; product_id: number; name: string; rating: number; body: string | null; status: 'pending' | 'approved' | 'rejected'; verified: number; reply: string | null;
  source: string; phone: string | null; created_at: string;
}
export interface PublicReview { id: number; name: string; rating: number; body: string | null; verified: boolean; reply: string | null; created_at: string }

export async function addReview(db: D1Database, r: { productId: number; name: string; rating: number; body: string; phone: string | null; verified: boolean; status: 'pending' | 'approved'; source: 'customer' | 'shop'; ipHash: string | null; orderId: number | null }): Promise<number> {
  const row = await db.prepare(`INSERT INTO reviews (product_id, order_id, name, rating, body, status, phone, verified, source, ip_hash, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${NOW}) RETURNING id`)
    .bind(r.productId, r.orderId, r.name, r.rating, r.body, r.status, r.phone, r.verified ? 1 : 0, r.source, r.ipHash).first<{ id: number }>();
  return row!.id;
}

export async function reviewExists(db: D1Database, productId: number, phone: string): Promise<boolean> {
  return Boolean(await db.prepare('SELECT 1 FROM reviews WHERE product_id = ? AND phone = ?').bind(productId, phone).first());
}

/** A delivered order on this number with this product: the review shows "Verified buyer". */
export async function deliveredPurchase(db: D1Database, productId: number, phone: string): Promise<number | null> {
  const r = await db.prepare(`SELECT o.id FROM orders o JOIN order_items i ON i.order_id = o.id WHERE o.phone = ? AND i.product_id = ? AND o.status IN ('delivered','partial_delivered') ORDER BY o.id DESC LIMIT 1`)
    .bind(phone, productId).first<{ id: number }>();
  return r?.id ?? null;
}

/** Approved reviews of a product, newest first, and the rating summary. */
export async function productReviews(db: D1Database, productId: number, limit = 20): Promise<{ items: PublicReview[]; count: number; average: number; stars: number[] }> {
  const [rows, sum] = await db.batch([
    db.prepare("SELECT id, name, rating, body, verified, reply, created_at FROM reviews WHERE product_id = ? AND status = 'approved' ORDER BY created_at DESC LIMIT ?").bind(productId, limit),
    db.prepare("SELECT rating, COUNT(*) AS n FROM reviews WHERE product_id = ? AND status = 'approved' GROUP BY rating").bind(productId),
  ]);
  const stars = [0, 0, 0, 0, 0];
  for (const r of sum.results as Array<{ rating: number; n: number }>) stars[r.rating - 1] = Number(r.n);
  const count = stars.reduce((a, b) => a + b, 0);
  const average = count ? stars.reduce((a, n, i) => a + n * (i + 1), 0) / count : 0;
  const items = (rows.results as Array<Record<string, unknown>>).map(r => ({ id: Number(r.id), name: String(r.name), rating: Number(r.rating), body: (r.body as string) ?? null, verified: Boolean(r.verified), reply: (r.reply as string) ?? null, created_at: String(r.created_at) }));
  return { items, count, average: Math.round(average * 10) / 10, stars };
}

/** Admin list by status, with the product. The phone is masked by the route. */
export async function listReviews(db: D1Database, status: string | null, limit = 200): Promise<Array<ReviewRow & { product_name: string; product_slug: string }>> {
  return (await db.prepare(
    `SELECT r.id, r.product_id, r.name, r.rating, r.body, r.status, r.verified, r.reply, r.source, r.phone, r.created_at, p.name AS product_name, p.slug AS product_slug
       FROM reviews r JOIN products p ON p.id = r.product_id ${status ? 'WHERE r.status = ?' : ''} ORDER BY r.created_at DESC LIMIT ?`,
  ).bind(...(status ? [status, limit] : [limit])).all<ReviewRow & { product_name: string; product_slug: string }>()).results;
}

export async function reviewCounts(db: D1Database): Promise<Record<string, number>> {
  const rows = (await db.prepare('SELECT status, COUNT(*) AS n FROM reviews GROUP BY status').all<{ status: string; n: number }>()).results;
  return Object.fromEntries(rows.map(r => [r.status, Number(r.n)]));
}

export async function reviewById(db: D1Database, id: number): Promise<ReviewRow | null> {
  return db.prepare('SELECT id, product_id, name, rating, body, status, verified, reply, source, phone, created_at FROM reviews WHERE id = ?').bind(id).first<ReviewRow>();
}

export async function setReviewStatus(db: D1Database, id: number, status: 'approved' | 'rejected' | 'pending'): Promise<void> {
  await db.prepare(`UPDATE reviews SET status = ?, updated_at = ${NOW} WHERE id = ?`).bind(status, id).run();
}

export async function setReviewReply(db: D1Database, id: number, reply: string | null): Promise<void> {
  await db.prepare(`UPDATE reviews SET reply = ?, updated_at = ${NOW} WHERE id = ?`).bind(reply, id).run();
}

export async function deleteReview(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM reviews WHERE id = ?').bind(id).run();
}
