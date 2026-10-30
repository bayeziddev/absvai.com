/**
 * Edge-cache tags (Section 2.1). Every cached page carries `site` (layout: menu, announcement, branding, tracking IDs)
 * plus tags for what it shows. An admin save purges only the tags it affects.
 */
export const TAG = {
  site: 'site',
  home: 'home',
  category: (id: number | string) => `cat-${id}`,
  product: (id: number | string) => `prod-${id}`,
  season: (slug: string) => `season-${slug}`,
  landing: (id: number | string) => `lp-${id}`,
  listing: 'listings', // shop, deals, originals, new, free delivery, search-free listings
  policy: 'policies',
};

/** Paths served from the edge cache. Cart, checkout, account, orders, admin and APIs are never cached. */
const CACHEABLE = [/^\/$/, /^\/c\/[\w-]+$/, /^\/p\/[\w-]+$/, /^\/season\/[\w-]+$/, /^\/(shop|deals|originals|free-delivery|new|categories|contact)$/, /^\/policies\/[\w-]+$/, /^\/lp\/[\w-]+$/];

export function isCacheablePath(path: string): boolean {
  return CACHEABLE.some(re => re.test(path));
}

/** Other public GET paths that go through the cached entrypoint: live price/stock, versioned geo JSON, media, SEO files. */
export function isEdgeServed(path: string): boolean {
  return isCacheablePath(path) || path === '/api/live' || (path.startsWith('/api/geo/') && path !== '/api/geo/version') || path.startsWith('/media/')
    || path === '/sitemap.xml' || path === '/robots.txt' || path === '/brand.css';
}

/** Query parameters that change a cached response; everything else (utm_*, fbclid, gclid…) is dropped from the cache key. */
const KEY_PARAMS = /^(page|show|sort|min|max|ids|[fa]\.[a-z0-9_]+)$/;

/**
 * Cache key: path plus the meaningful query parameters in a fixed order. Ad clicks carry a unique fbclid, so without
 * this every click from a Facebook ad would miss the cache.
 */
export function cacheKey(url: URL): string {
  const params = [...url.searchParams.entries()].filter(([k]) => KEY_PARAMS.test(k)).sort(([a, x], [b, y]) => (a + x).localeCompare(b + y));
  const qs = new URLSearchParams(params).toString();
  return `${url.pathname}${qs ? `?${qs}` : ''}`;
}

export function tagHeader(tags: Iterable<string>): string {
  return [...new Set(tags)].filter(t => /^[\w-]{1,100}$/.test(t)).join(',');
}
