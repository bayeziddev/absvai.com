// Service worker (Section 2.4): the app shell and static files open instantly on repeat visits, and recently viewed
// product and category pages stay browsable offline. Cart, checkout, account, orders, admin and APIs always use the network.
const VERSION = '__SW_VERSION__';
const STATIC = `absvai-static-${VERSION}`;
const PAGES = `absvai-pages-${VERSION}`;
const SHELL = ['/css/app.css', '/js/app.js', '/offline.html', '/favicon.svg', '/fonts/inter-latin-400-normal.woff2', '/fonts/poppins-latin-800-normal.woff2'];
const MAX_PAGES = 30;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(STATIC).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('absvai-') && k !== STATIC && k !== PAGES).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const NEVER = /^\/(cart|checkout|account|order|track|admin|api|wishlist)(\/|$)/;
const STATIC_PATH = /^\/(css|js|img|fonts|vendor|geo|media)\//;

async function trim(cache) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_PAGES))) await cache.delete(k);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || NEVER.test(url.pathname)) return;

  if (STATIC_PATH.test(url.pathname)) {
    // Stale-while-revalidate for static files.
    e.respondWith(caches.open(STATIC).then(async cache => {
      const hit = await cache.match(req);
      const net = fetch(req).then(r => { if (r.ok) cache.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }

  if (req.mode === 'navigate') {
    // Network first (prices change); fall back to the last copy of this page, then the offline page.
    e.respondWith(fetch(req).then(async r => {
      if (r.ok && /^\/(p|c)\/|^\/$/.test(url.pathname)) {
        const cache = await caches.open(PAGES);
        await cache.put(req, r.clone());
        trim(cache);
      }
      return r;
    }).catch(async () => (await caches.match(req)) || (await caches.match('/offline.html'))));
  }
});
