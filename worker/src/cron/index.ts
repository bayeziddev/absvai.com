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
import { dailySummary, flushEmails, trimOldEmails } from '../services/email';
import { syncCourierStatuses } from '../services/couriers';
import { stageCounts } from '../repo/dashboard';
import { newIncompleteCount } from '../repo/incomplete';
import { lowStock } from '../repo/inventory';

/** What the owner's morning email lists under "Needs your attention". */
export async function attentionToday(env: Env, now = new Date()): Promise<string[]> {
  const [stages, incomplete, low] = await Promise.all([
    stageCounts(env.DB, new Date(now.getTime() - 30 * 86_400_000).toISOString()), newIncompleteCount(env.DB, new Date(now.getTime() - 7 * 86_400_000).toISOString()), lowStock(env.DB),
  ]);
  return [
    stages.new && `${stages.new} new order(s) waiting for confirmation`,
    stages.held && `${stages.held} order(s) on hold for review`,
    stages.confirmed && `${stages.confirmed} confirmed order(s) to pack`,
    stages.packed && `${stages.packed} packed order(s) to hand to the courier`,
    stages.awaitingReturnScan && `${stages.awaitingReturnScan} returned parcel(s) to scan in`,
    incomplete && `${incomplete} incomplete checkout(s) to call`,
    low.length && `${low.length} product option(s) with 5 or fewer in stock`,
  ].filter((x): x is string => Boolean(x));
}

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
    await dailySummary(env, await attentionToday(env)).catch(e => console.warn('daily summary failed', e));
    await trimOldEmails(env);
  }
  // Parcels the courier has not told us about for a few hours: ask the courier.
  await syncCourierStatuses(env).catch(e => console.warn('courier sync failed', e));
  // Emails that could not go out right away (Resend busy, a rate limit) are retried here.
  await flushEmails(env, 40).catch(e => console.warn('email flush failed', e));
  await purge(env, undefined, tags);
  await flushPurges(env, ctx);
}
