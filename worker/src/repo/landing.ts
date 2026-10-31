/** Landing pages (landing_pages; content in `blocks`, see lib/landing.ts) and how each one sells. */
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export interface LandingRow {
  id: number; slug: string; title: string; status: 'draft' | 'published'; product_id: number | null; blocks: string; views: number; created_at: string; updated_at: string | null;
}

export async function landingById(db: D1Database, id: number): Promise<LandingRow | null> {
  return db.prepare('SELECT id, slug, title, status, product_id, blocks, views, created_at, updated_at FROM landing_pages WHERE id = ? AND deleted_at IS NULL').bind(id).first<LandingRow>();
}

export async function landingBySlug(db: D1Database, slug: string): Promise<LandingRow | null> {
  return db.prepare('SELECT id, slug, title, status, product_id, blocks, views, created_at, updated_at FROM landing_pages WHERE slug = ? AND deleted_at IS NULL').bind(slug).first<LandingRow>();
}

export async function landingSlugTaken(db: D1Database, slug: string, exceptId: number | null): Promise<boolean> {
  return Boolean(await db.prepare('SELECT 1 FROM landing_pages WHERE slug = ? AND id != ?').bind(slug, exceptId ?? 0).first());
}

/** Every page with its product and results: views, orders (not cancelled), money and delivered orders. */
export async function listLanding(db: D1Database): Promise<Array<Record<string, unknown>>> {
  return (await db.prepare(
    `SELECT l.id, l.slug, l.title, l.status, l.product_id, l.views, l.created_at, l.updated_at, p.name AS product_name, p.status AS product_status,
            (SELECT url FROM product_media m WHERE m.product_id = l.product_id AND m.kind = 'image' ORDER BY m.sort_order, m.id LIMIT 1) AS image_url,
            (SELECT COUNT(*) FROM orders o WHERE o.landing_page_id = l.id AND o.status != 'cancelled' AND o.is_test = 0) AS orders,
            (SELECT COALESCE(SUM(o.total_paisa), 0) FROM orders o WHERE o.landing_page_id = l.id AND o.status != 'cancelled' AND o.is_test = 0) AS revenue_paisa,
            (SELECT COUNT(*) FROM orders o WHERE o.landing_page_id = l.id AND o.status = 'delivered' AND o.is_test = 0) AS delivered
       FROM landing_pages l LEFT JOIN products p ON p.id = l.product_id
      WHERE l.deleted_at IS NULL ORDER BY l.id DESC LIMIT 500`,
  ).all()).results;
}

export async function saveLanding(db: D1Database, id: number | null, l: { slug: string; title: string; status: 'draft' | 'published'; productId: number; blocks: string }): Promise<number> {
  if (id) {
    await db.prepare(`UPDATE landing_pages SET slug = ?, title = ?, status = ?, product_id = ?, blocks = ?, updated_at = ${NOW} WHERE id = ? AND deleted_at IS NULL`)
      .bind(l.slug, l.title, l.status, l.productId, l.blocks, id).run();
    return id;
  }
  const r = await db.prepare(`INSERT INTO landing_pages (slug, title, template, status, product_id, blocks, updated_at) VALUES (?, ?, 'ad_match', ?, ?, ?, ${NOW}) RETURNING id`)
    .bind(l.slug, l.title, l.status, l.productId, l.blocks).first<{ id: number }>();
  return r!.id;
}

/** Deleted pages keep their row (orders point at it) but free their address. */
export async function deleteLanding(db: D1Database, id: number): Promise<void> {
  await db.prepare(`UPDATE landing_pages SET deleted_at = ${NOW}, status = 'draft', slug = slug || '-deleted-' || id WHERE id = ?`).bind(id).run();
}

export async function addLandingView(db: D1Database, id: number): Promise<void> {
  await db.prepare("UPDATE landing_pages SET views = views + 1 WHERE id = ? AND status = 'published' AND deleted_at IS NULL").bind(id).run();
}

/** The product's slug (the landing page reuses the product page's data). */
export async function productSlugById(db: D1Database, id: number): Promise<string | null> {
  return (await db.prepare('SELECT slug FROM products WHERE id = ? AND deleted_at IS NULL').bind(id).first<{ slug: string }>())?.slug ?? null;
}
