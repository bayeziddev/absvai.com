/**
 * Deployed entry point (wrangler.toml `main`). Two entrypoints:
 *   default    — a thin gateway with caching OFF: admin, checkout, cart, account and API writes run here on every request.
 *   Storefront — caching ON: public pages, /api/live, geo JSON and media. Cloudflare's Workers Cache sits in front of it,
 *                so a cached page is answered at the edge without running any code (Section 2.1, the ISR equivalent).
 * The gateway strips ad-click parameters from the cache key and forwards through ctx.exports.
 */
import { WorkerEntrypoint } from 'cloudflare:workers';
import type { Env } from './env';
import { scheduled } from './cron';
import { cacheKey, isEdgeServed } from './lib/cache-tags';
import { app } from './index';

interface CacheContext { invalidate(o: { tags: string[] }): Promise<{ success: boolean; errors?: unknown[] }> }

export class Storefront extends WorkerEntrypoint<Env> {
  fetch(request: Request): Response | Promise<Response> {
    return app.fetch(request, this.env, this.ctx);
  }

  /** Marks pages with these tags stale (revalidated with an ETag, so unchanged pages cost a 304). Scoped to this entrypoint's cache. */
  async purgeTags(tags: string[]): Promise<{ success: boolean; errors?: unknown[] }> {
    const cache = (this.ctx as unknown as { cache?: CacheContext }).cache;
    if (!cache) return { success: true };
    return cache.invalidate({ tags });
  }
}

type Exports = { Storefront?: { fetch(req: Request, init?: RequestInit & { cf?: Record<string, unknown> }): Promise<Response> } };

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    const url = new URL(request.url);
    const storefront = (ctx as unknown as { exports?: Exports }).exports?.Storefront;
    if (storefront && (request.method === 'GET' || request.method === 'HEAD') && url.hostname !== 'www.absvai.com' && isEdgeServed(url.pathname)) {
      return storefront.fetch(request, { cf: { cacheKey: cacheKey(url) } });
    }
    return app.fetch(request, env, ctx);
  },
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(scheduled(controller, env, ctx));
  },
} satisfies ExportedHandler<Env>;
