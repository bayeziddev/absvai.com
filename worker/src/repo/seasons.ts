/** Seasons (admin) and the scheduled-publish job. Storefront season reads are in repo/catalog.ts (getSeasons). */
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export async function seasonsWithCounts(db: D1Database) {
  return (await db.prepare(
    `SELECT s.*, (SELECT COUNT(*) FROM product_seasons ps WHERE ps.season_id = s.id) AS product_count,
            (SELECT COUNT(*) FROM category_seasons cs WHERE cs.season_id = s.id) AS category_count FROM seasons s ORDER BY COALESCE(s.starts_on, '9999'), s.sort_order`,
  ).all<Record<string, unknown>>()).results;
}

export interface SeasonInput { name: string; startsOn: string | null; endsOn: string | null; accentLabel: string | null; accentColor: string | null; banners: unknown[]; landingIntro: string | null; backInSeasonText: string | null; isEnabled: boolean }

export async function updateSeason(db: D1Database, id: number, s: SeasonInput): Promise<string | null> {
  const r = await db.prepare(`UPDATE seasons SET name = ?, starts_on = ?, ends_on = ?, accent_label = ?, accent_color = ?, banners = ?, landing_intro = ?, back_in_season_text = ?, is_enabled = ?, updated_at = ${NOW} WHERE id = ? RETURNING slug`)
    .bind(s.name, s.startsOn, s.endsOn, s.accentLabel, s.accentColor, JSON.stringify(s.banners), s.landingIntro, s.backInSeasonText, s.isEnabled ? 1 : 0, id).first<{ slug: string }>();
  return r?.slug ?? null;
}

export async function createSeason(db: D1Database, slug: string, s: SeasonInput): Promise<number> {
  const r = await db.prepare('INSERT INTO seasons (name, starts_on, ends_on, accent_label, accent_color, banners, landing_intro, back_in_season_text, is_enabled, slug) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id')
    .bind(s.name, s.startsOn, s.endsOn, s.accentLabel, s.accentColor, JSON.stringify(s.banners), s.landingIntro, s.backInSeasonText, s.isEnabled ? 1 : 0, slug).first<{ id: number }>();
  return r!.id;
}

export async function deleteSeason(db: D1Database, id: number): Promise<string | null> {
  return (await db.prepare('DELETE FROM seasons WHERE id = ? RETURNING slug').bind(id).first<{ slug: string }>())?.slug ?? null;
}

export async function resetEndedSeasons(db: D1Database, todayBd: string): Promise<number> {
  const r = await db.prepare(`UPDATE seasons SET starts_on = NULL, ends_on = NULL, started_notified_on = NULL, updated_at = ${NOW} WHERE ends_on IS NOT NULL AND ends_on < ?`).bind(todayBd).run();
  return r.meta.changes ?? 0;
}

export async function markSeasonStarted(db: D1Database, id: number, todayBd: string): Promise<void> {
  await db.prepare('UPDATE seasons SET started_notified_on = ? WHERE id = ?').bind(todayBd, id).run();
}

export async function seasonsOfProduct(db: D1Database, productId: number) {
  return (await db.prepare('SELECT s.* FROM seasons s JOIN product_seasons ps ON ps.season_id = s.id WHERE ps.product_id = ?').bind(productId).all()).results;
}

export async function seasonReadiness(db: D1Database, seasonId: number): Promise<{ hidden: number; empty: number }> {
  const r = await db.prepare(
    `SELECT SUM(CASE WHEN p.status != 'published' THEN 1 ELSE 0 END) AS hidden,
            SUM(CASE WHEN (SELECT COALESCE(SUM(stock - reserved),0) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1) = 0 AND p.fulfilment_mode = 'in_stock' THEN 1 ELSE 0 END) AS empty
       FROM products p JOIN product_seasons ps ON ps.product_id = p.id WHERE ps.season_id = ? AND p.deleted_at IS NULL`,
  ).bind(seasonId).first<{ hidden: number; empty: number }>();
  return { hidden: Number(r?.hidden ?? 0), empty: Number(r?.empty ?? 0) };
}

/** Publishes products whose scheduled time has passed. Returns their IDs so the right cache tags are purged. */
export async function publishDue(db: D1Database, nowIso: string): Promise<number[]> {
  return (await db.prepare(`UPDATE products SET status = 'published', publish_at = NULL, updated_at = ${NOW} WHERE status = 'scheduled' AND publish_at <= ? AND deleted_at IS NULL RETURNING id`)
    .bind(nowIso).all<{ id: number }>()).results.map(r => r.id);
}
