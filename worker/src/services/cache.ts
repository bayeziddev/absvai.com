/**
 * Edge cache (Section 2.1). Storefront pages are served by the cached `Storefront` entrypoint (worker/src/worker.ts)
 * with a Cache-Tag header. Admin saves queue the affected tags here; the queue is de-duplicated in D1 and flushed in
 * batches through the Storefront entrypoint's invalidate() (mark stale and revalidate, so nobody waits on a cold render).
 */
import type { Env } from '../env';
import { clearPurgeTags, failPurgeTags, pendingPurgeTags, queuePurgeTags } from '../repo/cache';

export interface PurgeTarget { purgeTags(tags: string[]): Promise<{ success: boolean; errors?: unknown[] }> }
type WithExports = { exports?: { Storefront?: PurgeTarget } };

/** Browser revalidates every time; the edge keeps the page for a day and serves it stale while refreshing. */
export const EDGE_HTML = { browser: 'public, max-age=0, must-revalidate', cdn: 'public, max-age=86400, stale-while-revalidate=600' };

export function purgeTarget(ctx: unknown): PurgeTarget | null {
  return (ctx as WithExports | undefined)?.exports?.Storefront ?? null;
}

/** Queue tags and flush in the background. Bulk edits in one request collapse into one batched purge. */
export async function purge(env: Env, ctx: ExecutionContext | undefined, tags: string[]): Promise<void> {
  if (!tags.length) return;
  await queuePurgeTags(env.DB, tags);
  if (ctx) ctx.waitUntil(flushPurges(env, ctx).catch(e => console.error('cache purge failed', e)));
}

export async function flushPurges(env: Env, ctx: unknown): Promise<{ flushed: number; failed: number }> {
  const tags = await pendingPurgeTags(env.DB, 300);
  if (!tags.length) return { flushed: 0, failed: 0 };
  const target = purgeTarget(ctx);
  // No edge cache here (tests, or a runtime without the Storefront entrypoint): nothing is cached, so nothing to purge.
  if (!target) { await clearPurgeTags(env.DB, tags); return { flushed: tags.length, failed: 0 }; }
  let flushed = 0;
  let failed = 0;
  // Purges share the account's purge rate limit, so send few, large calls.
  for (let i = 0; i < tags.length; i += 100) {
    const chunk = tags.slice(i, i + 100);
    const r = await target.purgeTags(chunk).catch(e => ({ success: false, errors: [String(e)] }));
    if (r.success) { await clearPurgeTags(env.DB, chunk); flushed += chunk.length; }
    else { await failPurgeTags(env.DB, chunk); failed += chunk.length; console.error('cache invalidate rejected', r.errors); }
  }
  return { flushed, failed };
}
