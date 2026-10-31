/** Marketplace sellers: applications, approval, their products and their sales. */
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
type Row = Record<string, unknown>;

export interface SellerRow {
  id: number; shop_name: string; slug: string; owner_name: string; email: string; phone: string; password_hash: string; district: string | null; address: string | null;
  business_type: string | null; sells: string | null; about: string | null; payout_method: string | null; payout_number: string | null; status: string;
  review_note: string | null; reviewed_at: string | null; commission_percent: number; last_login_at: string | null; created_at: string;
}
const PUBLIC_COLS = 'id, shop_name, slug, owner_name, email, phone, district, address, business_type, sells, about, payout_method, payout_number, status, review_note, reviewed_at, commission_percent, last_login_at, created_at';

export async function createSeller(db: D1Database, s: { shopName: string; slug: string; ownerName: string; email: string; phone: string; passwordHash: string; district: string | null; address: string | null; businessType: string | null; sells: string | null; payoutMethod: string | null; payoutNumber: string | null; commission: number }): Promise<number> {
  const r = await db.prepare(`INSERT INTO sellers (shop_name, slug, owner_name, email, phone, password_hash, district, address, business_type, sells, payout_method, payout_number, commission_percent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
    .bind(s.shopName, s.slug, s.ownerName, s.email, s.phone, s.passwordHash, s.district, s.address, s.businessType, s.sells, s.payoutMethod, s.payoutNumber, s.commission).first<{ id: number }>();
  return r!.id;
}

export const sellerByEmail = (db: D1Database, email: string) => db.prepare('SELECT * FROM sellers WHERE email = ?').bind(email).first<SellerRow>();
export const sellerById = (db: D1Database, id: number) => db.prepare(`SELECT ${PUBLIC_COLS} FROM sellers WHERE id = ?`).bind(id).first<SellerRow>();
export const sellerSlugTaken = async (db: D1Database, slug: string) => Boolean(await db.prepare('SELECT 1 FROM sellers WHERE slug = ?').bind(slug).first());
export const approvedSellerBySlug = (db: D1Database, slug: string) => db.prepare(`SELECT id, shop_name, slug, district, about, created_at FROM sellers WHERE slug = ? AND status = 'approved'`).bind(slug).first<Row>();

export async function listSellers(db: D1Database, status: string | null): Promise<Row[]> {
  return (await db.prepare(
    `SELECT ${PUBLIC_COLS.split(', ').map(c => `s.${c}`).join(', ')},
            (SELECT COUNT(*) FROM products p WHERE p.seller_id = s.id AND p.deleted_at IS NULL) AS product_count,
            (SELECT COUNT(*) FROM products p WHERE p.seller_id = s.id AND p.status = 'published' AND p.deleted_at IS NULL) AS live_count
       FROM sellers s ${status ? 'WHERE s.status = ?' : ''} ORDER BY CASE s.status WHEN 'pending' THEN 0 ELSE 1 END, s.created_at DESC LIMIT 200`,
  ).bind(...(status ? [status] : [])).all()).results;
}

export async function reviewSeller(db: D1Database, id: number, r: { status: 'approved' | 'rejected' | 'suspended'; note: string | null; adminId: string; commission?: number | null }): Promise<boolean> {
  const res = await db.prepare(`UPDATE sellers SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ${NOW}, commission_percent = COALESCE(?, commission_percent), updated_at = ${NOW} WHERE id = ?`)
    .bind(r.status, r.note, r.adminId, r.commission ?? null, id).run();
  return (res.meta.changes ?? 0) > 0;
}

export async function updateSellerProfile(db: D1Database, id: number, p: { phone: string; district: string | null; address: string | null; about: string | null; payoutMethod: string | null; payoutNumber: string | null }): Promise<void> {
  await db.prepare(`UPDATE sellers SET phone = ?, district = ?, address = ?, about = ?, payout_method = ?, payout_number = ?, updated_at = ${NOW} WHERE id = ?`)
    .bind(p.phone, p.district, p.address, p.about, p.payoutMethod, p.payoutNumber, id).run();
}

export async function setSellerPassword(db: D1Database, id: number, hash: string): Promise<void> {
  await db.prepare(`UPDATE sellers SET password_hash = ?, updated_at = ${NOW} WHERE id = ?`).bind(hash, id).run();
}

export async function touchSellerLogin(db: D1Database, id: number): Promise<void> {
  await db.prepare(`UPDATE sellers SET last_login_at = ${NOW} WHERE id = ?`).bind(id).run();
}

/** Who owns a product (null for the shop's own products). */
export async function productSeller(db: D1Database, productId: number): Promise<{ seller_id: number | null; status: string; review_status: string | null; category_id: number } | null> {
  return db.prepare('SELECT seller_id, status, review_status, category_id FROM products WHERE id = ? AND deleted_at IS NULL').bind(productId).first();
}

export async function assignProductSeller(db: D1Database, productId: number, sellerId: number, brand: string): Promise<void> {
  await db.prepare(`UPDATE products SET seller_id = ?, brand = COALESCE(brand, ?), updated_at = ${NOW} WHERE id = ?`).bind(sellerId, brand, productId).run();
}

export async function setReview(db: D1Database, productId: number, status: 'pending' | 'approved' | 'rejected' | null, note: string | null): Promise<void> {
  await db.prepare(`UPDATE products SET review_status = ?, review_note = ?, updated_at = ${NOW} WHERE id = ?`).bind(status, note, productId).run();
}

export async function sellerProducts(db: D1Database, sellerId: number): Promise<Row[]> {
  return (await db.prepare(
    `SELECT p.id, p.name, p.slug, p.status, p.review_status, p.review_note, p.updated_at, c.name AS category_name,
            (SELECT MIN(price_paisa) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1) AS min_price,
            (SELECT SUM(stock - reserved) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1) AS stock,
            (SELECT url FROM product_media m WHERE m.product_id = p.id AND m.kind = 'image' ORDER BY m.sort_order, m.id LIMIT 1) AS image_url
       FROM products p JOIN categories c ON c.id = p.category_id
      WHERE p.seller_id = ? AND p.deleted_at IS NULL ORDER BY p.updated_at DESC LIMIT 300`,
  ).bind(sellerId).all()).results;
}

/** Seller products waiting for the owner's approval. */
export async function reviewQueue(db: D1Database): Promise<Row[]> {
  return (await db.prepare(
    `SELECT p.id, p.name, p.slug, p.status, p.updated_at, s.id AS seller_id, s.shop_name, c.name AS category_name,
            (SELECT MIN(price_paisa) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1) AS min_price,
            (SELECT url FROM product_media m WHERE m.product_id = p.id AND m.kind = 'image' ORDER BY m.sort_order, m.id LIMIT 1) AS image_url
       FROM products p JOIN sellers s ON s.id = p.seller_id JOIN categories c ON c.id = p.category_id
      WHERE p.review_status = 'pending' AND p.deleted_at IS NULL ORDER BY p.updated_at LIMIT 200`,
  ).all()).results;
}

export async function sellerCounts(db: D1Database): Promise<{ applications: number; productsToReview: number }> {
  const [a, b] = await db.batch([
    db.prepare("SELECT COUNT(*) AS n FROM sellers WHERE status = 'pending'"),
    db.prepare("SELECT COUNT(*) AS n FROM products WHERE review_status = 'pending' AND deleted_at IS NULL"),
  ]);
  return { applications: Number((a.results[0] as { n: number }).n), productsToReview: Number((b.results[0] as { n: number }).n) };
}

/** The seller's sales: every order line of their products (no customer phone or name, only the area). */
export async function sellerOrderLines(db: D1Database, sellerId: number, limit = 200): Promise<Row[]> {
  return (await db.prepare(
    `SELECT o.order_no, o.created_at, o.status, o.district_name, o.upazila_name, i.name, i.variant_label, i.qty, i.unit_price_paisa, i.line_total_paisa
       FROM order_items i JOIN products p ON p.id = i.product_id JOIN orders o ON o.id = i.order_id
      WHERE p.seller_id = ? AND o.is_test = 0 ORDER BY o.id DESC LIMIT ?`,
  ).bind(sellerId, limit).all()).results;
}

export async function sellerSalesTotals(db: D1Database, sellerId: number, sinceIso: string): Promise<{ deliveredPaisa: number; openPaisa: number; unitsMonth: number; salesMonthPaisa: number }> {
  const r = await db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN o.status IN ('delivered','partial_delivered') THEN i.line_total_paisa END), 0) AS delivered,
            COALESCE(SUM(CASE WHEN o.status IN ('new','confirmed','packed','in_courier') THEN i.line_total_paisa END), 0) AS open,
            COALESCE(SUM(CASE WHEN o.created_at >= ? AND o.status NOT IN ('cancelled','returned') THEN i.qty END), 0) AS units,
            COALESCE(SUM(CASE WHEN o.created_at >= ? AND o.status NOT IN ('cancelled','returned') THEN i.line_total_paisa END), 0) AS month
       FROM order_items i JOIN products p ON p.id = i.product_id JOIN orders o ON o.id = i.order_id
      WHERE p.seller_id = ? AND o.is_test = 0`,
  ).bind(sinceIso, sinceIso, sellerId).first<{ delivered: number; open: number; units: number; month: number }>();
  return { deliveredPaisa: Number(r?.delivered ?? 0), openPaisa: Number(r?.open ?? 0), unitsMonth: Number(r?.units ?? 0), salesMonthPaisa: Number(r?.month ?? 0) };
}

/** Public: the seller name and store link for a product page. */
export async function productSellerPublic(db: D1Database, productId: number): Promise<{ shop_name: string; slug: string } | null> {
  return db.prepare("SELECT s.shop_name, s.slug FROM products p JOIN sellers s ON s.id = p.seller_id WHERE p.id = ? AND s.status = 'approved'").bind(productId).first();
}
