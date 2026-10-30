/** Inventory: the stock movements ledger, manual adjustments and stock reads for admin. */
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export const ADJUST_REASONS: Record<string, string> = {
  received: 'Stock received',
  count_correction: 'Stock count correction',
  damaged_in_transit: 'Damaged in transit',
  damaged_in_storage: 'Damaged in storage',
  expired: 'Expired',
  missing: 'Missing',
  lost_by_courier: 'Lost by courier',
};

/** One movement per change; the CHECK constraints refuse stock below zero or below what confirmed orders hold. */
export async function adjustStock(db: D1Database, a: { variantId: number; change: number; reason: string; batchNo: string | null; note: string | null; adminId: string }): Promise<void> {
  await db.batch([
    db.prepare(`UPDATE product_variants SET stock = stock + ?, updated_at = ${NOW} WHERE id = ?`).bind(a.change, a.variantId),
    db.prepare(`INSERT INTO stock_movements (variant_id, change, kind, reason, batch_no, note, admin_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(a.variantId, a.change, a.reason === 'received' ? 'purchase_received' : 'adjustment', a.reason, a.batchNo, a.note, a.adminId),
  ]);
}

export async function variantProduct(db: D1Database, variantId: number): Promise<{ product_id: number; category_id: number } | null> {
  return db.prepare('SELECT v.product_id, p.category_id FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?').bind(variantId).first();
}

export async function inventoryList(db: D1Database, withCost: boolean) {
  return (await db.prepare(
    `SELECT v.id, v.sku, v.stock, v.reserved, v.stock - v.reserved AS available, v.attributes, v.shelf_location, ${withCost ? 'v.cost_paisa, v.cost_paisa * v.stock AS stock_value_paisa,' : ''}
            p.name, p.id AS product_id, p.status, p.fulfilment_mode FROM product_variants v JOIN products p ON p.id = v.product_id
      WHERE v.is_active = 1 AND p.deleted_at IS NULL ORDER BY available ASC, p.name LIMIT 300`,
  ).all<Record<string, unknown>>()).results;
}

export async function stockValue(db: D1Database): Promise<{ valuePaisa: number; unitsWithoutCost: number }> {
  const r = await db.prepare(
    `SELECT COALESCE(SUM(v.stock * v.cost_paisa), 0) AS value, SUM(CASE WHEN v.cost_paisa IS NULL AND v.stock > 0 THEN 1 ELSE 0 END) AS missing
       FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.is_active = 1 AND p.deleted_at IS NULL`,
  ).first<{ value: number; missing: number }>();
  return { valuePaisa: Number(r?.value ?? 0), unitsWithoutCost: Number(r?.missing ?? 0) };
}

export async function movements(db: D1Database, f: { variantId?: number | null; batchNo?: string | null; cursorId?: number | null }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.variantId) { where.push('m.variant_id = ?'); params.push(f.variantId); }
  else if (f.batchNo) { where.push('m.batch_no = ?'); params.push(f.batchNo); }
  if (f.cursorId) { where.push('m.id < ?'); params.push(f.cursorId); }
  return (await db.prepare(
    `SELECT m.*, v.sku, a.name AS admin_name, o.order_no FROM stock_movements m JOIN product_variants v ON v.id = m.variant_id
       LEFT JOIN admins a ON a.id = m.admin_id LEFT JOIN orders o ON o.id = m.order_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY m.id DESC LIMIT 200`,
  ).bind(...params).all()).results;
}

export async function lowStock(db: D1Database, threshold = 5) {
  return (await db.prepare(
    `SELECT v.id, v.sku, v.stock - v.reserved AS stock, p.name, p.id AS product_id FROM product_variants v JOIN products p ON p.id = v.product_id
      WHERE v.is_active = 1 AND p.status = 'published' AND p.deleted_at IS NULL AND p.fulfilment_mode = 'in_stock' AND v.stock - v.reserved <= ? ORDER BY v.stock - v.reserved LIMIT 20`,
  ).bind(threshold).all()).results;
}

/** Variants for labels (Section 13.2): name, variant, price, SKU and barcode. */
export async function variantsForLabels(db: D1Database, ids: number[]) {
  if (!ids.length) return [];
  return (await db.prepare(
    `SELECT v.id, v.sku, v.gtin, v.attributes, v.price_paisa, p.name FROM product_variants v JOIN products p ON p.id = v.product_id
      WHERE v.id IN (${ids.map(() => '?').join(',')}) ORDER BY p.name, v.sort_order`,
  ).bind(...ids).all<Record<string, unknown>>()).results;
}

/** Manual order / POS product search by name, SKU or barcode (GTIN). */
export async function searchVariants(db: D1Database, q: string, nowIso: string) {
  const like = `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`;
  return (await db.prepare(
    `SELECT v.id, v.sku, v.gtin, v.attributes, v.price_paisa, v.stock, v.reserved, v.stock - v.reserved AS available, v.packed_weight_grams,
            p.id AS product_id, p.name, p.slug, p.fulfilment_mode,
            (SELECT url FROM product_media m WHERE m.product_id = p.id AND m.kind = 'image' ORDER BY m.sort_order, m.id LIMIT 1) AS image_url
       FROM product_variants v JOIN products p ON p.id = v.product_id
      WHERE v.is_active = 1 AND p.deleted_at IS NULL AND (p.status = 'published' OR (p.status = 'scheduled' AND p.publish_at <= ?1))
        AND (v.sku = ?2 OR v.gtin = ?2 OR p.name LIKE ?3 ESCAPE '\\' OR v.sku LIKE ?3 ESCAPE '\\')
      ORDER BY (v.sku = ?2 OR v.gtin = ?2) DESC, p.sold_count DESC LIMIT 20`,
  ).bind(nowIso, q.toUpperCase(), like).all<Record<string, unknown>>()).results;
}

/** variant id → stock − reserved, for "not enough stock" messages. */
export async function variantAvailability(db: D1Database, ids: number[]): Promise<Map<number, number>> {
  if (!ids.length) return new Map();
  const rows = await db.prepare(`SELECT id, stock - reserved AS available FROM product_variants WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<{ id: number; available: number }>();
  return new Map(rows.results.map(r => [r.id, r.available]));
}

export async function productAvailable(db: D1Database, productId: number): Promise<number> {
  return Number((await db.prepare('SELECT COALESCE(SUM(stock - reserved), 0) AS n FROM product_variants WHERE product_id = ? AND is_active = 1').bind(productId).first<{ n: number }>())?.n ?? 0);
}
