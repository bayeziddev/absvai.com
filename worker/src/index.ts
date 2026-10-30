/**
 * Abs Vai: one Cloudflare Worker serves the storefront (server-rendered), the admin app (static assets)
 * and every /api/* route. Static files in dist/ are served by Workers Static Assets before this code runs.
 */
import { Hono } from 'hono';
import type { AppEnv, Env } from './env';
import { scheduled } from './cron';
import { HttpError } from './lib/http';
import { admin } from './routes/admin';
import { api } from './routes/api';
import { notFound, pages } from './routes/pages';

const app = new Hono<AppEnv>();

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self'",
  'frame-src https://www.youtube-nocookie.com https://challenges.cloudflare.com',
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

app.use('*', (c, next) => {
  const url = new URL(c.req.url);
  return url.hostname === 'www.absvai.com' ? Promise.resolve(c.redirect(`https://absvai.com${url.pathname}${url.search}`, 301)) : next();
});

app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  await next();
  c.header('Content-Security-Policy', CSP);
  c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'geolocation=(self), camera=(), microphone=(), payment=()');
  if (url.pathname.startsWith('/api/')) c.header('Cache-Control', c.res.headers.get('Cache-Control') ?? 'no-store');
});

app.onError(async (err, c) => {
  const status = err instanceof HttpError ? err.status : 500;
  if (status === 500) console.error(err);
  if (c.req.path.startsWith('/api/')) {
    return c.json({ error: status === 500 ? 'Something went wrong on our side. Please try again.' : err.message, details: err instanceof HttpError ? err.details : undefined }, status as 400);
  }
  if (status === 404) return notFound(c);
  return c.text(status === 500 ? 'Something went wrong on our side. Please try again in a minute.' : err.message, status as 400);
});

app.route('/api/admin', admin);
app.route('/api', api);

// Product photos and documents uploaded to R2.
app.get('/media/*', async c => {
  const key = c.req.path.slice('/media/'.length);
  if (!/^p\/\d+\/[\w-]+\.(webp|jpg|png|avif|pdf)$/.test(key)) return c.notFound();
  const obj = await c.env.MEDIA.get(key);
  if (!obj) return c.notFound();
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  return new Response(obj.body, { headers });
});

app.route('/', pages);
app.notFound(c => (c.req.path.startsWith('/api/') ? c.json({ error: 'Not found' }, 404) : notFound(c)));

export default {
  fetch: app.fetch,
  scheduled: (controller: ScheduledController, env: Env, ctx: ExecutionContext) => ctx.waitUntil(scheduled(controller, env)),
} satisfies ExportedHandler<Env>;

export { app };
