/**
 * Scheduled work (Section 20): scheduled publishing, season switching with cache refresh and back-in-season SMS,
 * incomplete-order purges, and a sweep of the edge-cache purge queue.
 */
import type { Env } from '../env';
import { TAG } from '../lib/cache-tags';
import { bdDate } from '../lib/dates';
import { isSeasonActive } from '../lib/seasons';
import { getSeasons } from '../repo/catalog';
import { purgeIncomplete } from '../repo/incomplete';
import { productsWaitingForSeason } from '../repo/misc';
import { markSeasonStarted, publishDue } from '../repo/seasons';
import { loadSettings, settingInt } from '../repo/settings';
import { sendBackInSeason } from '../routes/admin-ops';
import { flushPurges, purge } from '../services/cache';

export async function publishScheduled(env: Env, now = new Date()): Promise<number[]> {
  return publishDue(env.DB, now.toISOString());
}

/** When a season goes live, people who asked "Notify me" for its products get one message. */
export async function seasonSwitch(env: Env, now = new Date()): Promise<{ started: string[]; notified: number }> {
  const today = bdDate(now);
  const started: string[] = [];
  let notified = 0;
  for (const s of await getSeasons(env.DB)) {
    if (!isSeasonActive(s, today) || (s as { started_notified_on?: string | null }).started_notified_on) continue;
    started.push(s.name);
    for (const productId of await productsWaitingForSeason(env.DB, s.id)) {
      try { notified += await sendBackInSeason(env, productId); } catch { /* not buyable yet (e.g. no stock): staff can send later */ }
    }
    await markSeasonStarted(env.DB, s.id, today);
  }
  return { started, notified };
}

/** Data minimisation (Section 8.3): unconverted incomplete checkouts are deleted after the retention period. */
export async function purgeOldIncomplete(env: Env, now = new Date()): Promise<number> {
  const days = settingInt(await loadSettings(env.DB), 'incomplete_retention_days', 60);
  return purgeIncomplete(env.DB, new Date(now.getTime() - days * 86_400_000).toISOString());
}

export async function scheduled(controller: ScheduledController, env: Env, ctx?: ExecutionContext): Promise<void> {
  const published = await publishScheduled(env);
  const tags: string[] = published.length ? [TAG.listing, TAG.home, ...published.map(TAG.product)] : [];
  if (controller.cron === '5 18 * * *') {
    // 00:05 Bangladesh time: seasons start and end at midnight, so the menu, homepage and season pages change.
    await seasonSwitch(env);
    await purgeOldIncomplete(env);
    tags.push(TAG.site);
  }
  await purge(env, undefined, tags);
  await flushPurges(env, ctx);
}
