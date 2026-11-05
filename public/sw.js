// Service worker (Section 2.4): the app shell and static files open instantly on repeat visits, a page a finger has just
// touched opens instantly (app.js asks for it ahead, see fetchAhead), and recently viewed pages stay browsable offline.
// Cart, account, orders, admin and APIs always use the network.
const VERSION = '__SW_VERSION__';
const STATIC = `absvai-static-${VERSION}`;
const PAGES = `absvai-pages-${VERSION}`;
const SHELL = ['/css/app.css', '/js/app.js', '/offline.html', '/favicon.svg', '/fonts/inter-latin-400-normal.woff2', '/fonts/poppins-latin-800-normal.woff2'];
const MAX_PAGES = 40;
// A page fetched ahead is used once, for the tap that follows within this time; every other visit asks the network
// first, so a change the owner just saved always shows.
const AHEAD_MS = 60_000;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(STATIC).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('absvai-') && k !== STATIC && k !== PAGES).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const NEVER = /^\/(cart|account|order|track|admin|api|wishlist|seller|sell)(\/|$)/;
const STATIC_PATH = /^\/(css|js|img|fonts|vendor|geo|media)\//;
/** Pages that are the same for every customer (the edge caches them too): these may be fetched ahead. */
const SHARED_PAGE = /^\/($|p\/|c\/|season\/|lp\/|policies\/|shop$|deals$|originals$|free-delivery$|new$|categories$|contact$|checkout$)/;

async function trim(cache) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_PAGES))) await cache.delete(k);
}

/** The key a page is kept under: its path and the query that changes it (never the ad-click ids). */
function pageKey(url) {
  const keep = [...url.searchParams].filter(([k]) => /^(page|show|sort|min|max|q|[fa]\.[a-z0-9_]+)$/.test(k));
  return `${url.origin}${url.pathname}${keep.length ? `?${new URLSearchParams(keep)}` : ''}`;
}

// Pages fetched ahead and not used yet (key → when), and the ones still on their way (a tap waits for that answer).
const ready = new Map();
const inflight = new Map();

async function keep(key, r) {
  if (!r.ok || r.type !== 'basic' || r.redirected) return;
  const cache = await caches.open(PAGES);
  await cache.put(key, r);
  trim(cache);
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

  if (!SHARED_PAGE.test(url.pathname)) return;
  const key = pageKey(url);

  // A page asked for ahead by app.js (a finger is on its link): fetch it and keep it for the tap.
  if (req.headers.get('x-vm-ahead') === '1') {
    const p = fetch(url.href, { credentials: 'same-origin' }).then(async r => {
      if (r.ok && r.type === 'basic' && !r.redirected) { await keep(key, r.clone()); ready.set(key, Date.now()); }
      return r;
    }).finally(() => inflight.delete(key));
    inflight.set(key, p);
    e.respondWith(p.then(r => r.clone()).catch(() => new Response('', { status: 504 })));
    return;
  }

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      // The page this tap was touched for: still on its way, or just arrived.
      if (inflight.has(key)) {
        try { const r = await inflight.get(key); if (r.ok && !r.redirected) { ready.delete(key); return r.clone(); } } catch { /* ask the network below */ }
      }
      const at = ready.get(key);
      ready.delete(key);
      if (at && Date.now() - at < AHEAD_MS) {
        const hit = await caches.match(key);
        if (hit) return hit;
      }
      // Network first (prices change), keeping a copy for offline; the last copy, then the offline page, without network.
      try {
        const r = await fetch(req);
        e.waitUntil(keep(key, r.clone()));
        return r;
      } catch {
        return (await caches.match(key)) || (await caches.match('/offline.html')) || Response.error();
      }
    })());
  }
});
