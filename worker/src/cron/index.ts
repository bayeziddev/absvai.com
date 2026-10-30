/** Scheduled work: scheduled publishing, season start notifications and cache refresh at season boundaries. */
import type { Env } from '../env';
import { getSeasons } from '../data/catalog';
import { bumpCatalogVersion } from '../data/settings';
import { bdDate } from '../lib/dates';
import { isSeasonActive } from '../lib/seasons';
import { sendBackInSeason } from '../routes/admin-ops';

export async function publishScheduled(env: Env, now = new Date()): Promise<number> {
  const r = await env.DB.prepare("UPDATE products SET status = 'published', publish_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE status = 'scheduled' AND publish_at <= ? AND deleted_at IS NULL")
    .bind(now.toISOString()).run();
  return r.meta.changes ?? 0;
}

/** When a season goes live, people who asked "Notify me" for its products get one message. */
export async function seasonSwitch(env: Env, now = new Date()): Promise<{ started: string[]; notified: number }> {
  const today = bdDate(now);
  const started: string[] = [];
  let notified = 0;
  for (const s of await getSeasons(env.DB)) {
    if (!isSeasonActive(s, today) || (s as { started_notified_on?: string | null }).started_notified_on) continue;
    started.push(s.name);
    const products = await env.DB.prepare("SELECT DISTINCT n.product_id FROM notify_requests n JOIN product_seasons ps ON ps.product_id = n.product_id WHERE ps.season_id = ? AND n.status = 'waiting'").bind(s.id).all<{ product_id: number }>();
    for (const p of products.results) {
      try { notified += await sendBackInSeason(env, p.product_id); } catch { /* not buyable yet (e.g. no stock): staff can send later */ }
    }
    await env.DB.prepare('UPDATE seasons SET started_notified_on = ? WHERE id = ?').bind(today, s.id).run();
  }
  return { started, notified };
}

export async function scheduled(controller: ScheduledController, env: Env): Promise<void> {
  const published = await publishScheduled(env);
  if (controller.cron === '5 18 * * *') {
    await seasonSwitch(env);
    await bumpCatalogVersion(env.DB);
  } else if (published) {
    await bumpCatalogVersion(env.DB);
  }
}
