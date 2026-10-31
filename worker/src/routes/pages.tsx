/** Server-rendered storefront pages (SEO: real HTML, Product/BreadcrumbList JSON-LD, canonical URLs). */
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../env';
import {
  facets, flatten, getCategoryTree, getProductDetail, getSeasons, getTemplate, queryProducts, seasonalCategoryIds, sitemapEntries, synonymGroups, visibleTree, zoneSummaries,
  type CategoryNode, type ProductCard, type ProductQuery,
} from '../repo/catalog';
import { orderByNo, orderItems, otpRow } from '../repo/orders';
import { loadSettings, settingInt, settingJson } from '../repo/settings';
import { TAG, tagHeader } from '../lib/cache-tags';
import { bdDate, monthName } from '../lib/dates';
import { clientIp, HttpError, parseJson, rateLimit } from '../lib/http';
import { pageCss } from '../lib/page-css';
import { POLICIES } from '../lib/policies';
import { approvedSellerBySlug, productSellerPublic } from '../repo/sellers';
import { checkUnsubscribe } from '../services/email';
import { trackOrders, type TrackResult } from '../services/tracking';
import { unsubscribeCustomer } from '../repo/email';
import { expandQuery } from '../lib/search';
import { isSeasonActive, nextSeason } from '../lib/seasons';
import { DEFAULT_COLORS, parseBrandColors } from '../lib/settings-schema';
import { EDGE_HTML } from '../services/cache';
import { parseListingQuery } from './api';
import { GEO_VERSION } from '../generated/geo-version';
import type { Banner } from '../views/components';
import { Layout, type LayoutProps } from '../views/layout';
import {
  AccountPage, CartPage, CategoriesPage, CheckoutPage, ContactPage, HomePage, ListingPage, NotFoundPage, OrderPage, ProductPage, productPageData, SellPage, SimplePage, TrackPage, WishlistPage,
} from '../views/pages';

export const pages = new Hono<AppEnv>();

interface Shell { settings: Record<string, string>; tree: CategoryNode[]; visible: CategoryNode[]; activeSeason: { slug: string; name: string } | null; activeIds: number[] }

async function shell(c: Context<AppEnv>): Promise<Shell> {
  const [settings, tree, seasons] = await Promise.all([loadSettings(c.env.DB), getCategoryTree(c.env.DB), getSeasons(c.env.DB)]);
  c.set('settings', settings);
  const today = bdDate();
  const active = seasons.filter(s => isSeasonActive(s, today));
  return { settings, tree, visible: visibleTree(tree), activeSeason: active[0] ? { slug: active[0].slug, name: active[0].name } : null, activeIds: active.map(s => s.id) };
}

/** Cache tags for every product shown on a page, so saving one product refreshes every page that lists it. */
const cardTags = (...lists: ProductCard[][]) => lists.flat().map(p => TAG.product(p.id));

async function weakEtag(body: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(body)));
  return `W/"${[...d.slice(0, 10)].map(b => b.toString(16).padStart(2, '0')).join('')}"`;
}

/**
 * Renders a page. `cache` lists the page's tags: those pages are stored at the edge by the Storefront entrypoint and
 * refreshed by tag when an admin saves (Section 2.1). Pages without tags (cart, checkout, orders, tracking) are never cached.
 */
async function render(c: Context<AppEnv>, sh: Shell, props: Omit<LayoutProps, 'settings' | 'categories' | 'siteUrl' | 'activeSeason' | 'css'>, opts: { status?: number; cache?: string[] | null } = {}) {
  const status = opts.status ?? 200;
  const css = await pageCss(c.env.ASSETS);
  const html = `<!DOCTYPE html>${await (
    <Layout {...props} settings={sh.settings} categories={sh.visible} siteUrl={c.env.SITE_URL} activeSeason={sh.activeSeason} css={css} />
  ).toString()}`;
  if (!opts.cache || status !== 200) return c.html(html, status as 200, { 'Cache-Control': 'private, no-store' });
  const etag = await weakEtag(html);
  const headers = { 'Cache-Control': EDGE_HTML.browser, 'CDN-Cache-Control': EDGE_HTML.cdn, 'Cache-Tag': tagHeader([TAG.site, ...opts.cache]), ETag: etag };
  // Revalidation after an invalidate(): unchanged pages answer 304 and the edge keeps the body it has.
  if (c.req.header('if-none-match') === etag) return c.body(null, 304, headers);
  return c.html(html, 200, headers);
}

const crumbLd = (siteUrl: string, items: Array<{ name: string; href?: string }>) => ({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, ...(it.href ? { item: `${siteUrl}${it.href}` } : {}) })),
});

pages.get('/', async c => {
  const sh = await shell(c);
  const seasons = await getSeasons(c.env.DB);
  const activeSeasons = seasons.filter(s => sh.activeIds.includes(s.id));
  const seasonal = await seasonalCategoryIds(c.env.DB, sh.activeIds);
  // In-season categories move to the front of the carousel.
  const cats = [...sh.visible].sort((a, b) => Number(seasonal.has(b.id) || b.children.some(k => seasonal.has(k.id))) - Number(seasonal.has(a.id) || a.children.some(k => seasonal.has(k.id))));
  const carousel = cats.flatMap(cn => (cn.children.some(k => seasonal.has(k.id)) ? [...cn.children.filter(k => seasonal.has(k.id)), cn] : [cn]));
  const seasonBanners = activeSeasons.flatMap(s => parseJson<Banner[]>(s.banners, []).map(b => ({ ...b, kicker: s.accent_label ?? s.name })));
  const banners = seasonBanners.length ? seasonBanners : settingJson<Banner[]>(sh.settings, 'default_banners', []);
  const [inSeason, featured, originals, deals, newest] = await Promise.all([
    queryProducts(c.env.DB, { seasonIds: sh.activeIds, limit: 12 }),
    queryProducts(c.env.DB, { featured: true, limit: 10 }),
    queryProducts(c.env.DB, { originals: true, limit: 10 }),
    queryProducts(c.env.DB, { deals: true, sort: 'discount', limit: 8 }),
    queryProducts(c.env.DB, { sort: 'newest', limit: 10 }),
  ]);
  const s = sh.settings;
  const tags = [TAG.home, TAG.listing, ...activeSeasons.map(x => TAG.season(x.slug)), ...cardTags(inSeason.items, featured.items, originals.items, deals.items, newest.items)];
  return render(c, sh, {
    title: s.store_name || 'Abs Vai', description: 'Seasonal food, Abs Vai masala, food-business machines, tools, clothing and gadgets. Cash on Delivery all over Bangladesh.',
    path: '/', tab: 'home',
    jsonLd: [
      { '@context': 'https://schema.org', '@type': 'Organization', name: s.company_name || 'ABS VAI LTD', url: c.env.SITE_URL, logo: `${c.env.SITE_URL}/favicon.svg` },
      { '@context': 'https://schema.org', '@type': 'WebSite', name: s.store_name || 'Abs Vai', url: c.env.SITE_URL, potentialAction: { '@type': 'SearchAction', target: `${c.env.SITE_URL}/search?q={search_term_string}`, 'query-input': 'required name=search_term_string' } },
    ],
    children: <HomePage banners={banners} categories={carousel} seasonal={seasonal} activeSeason={sh.activeSeason} inSeason={inSeason.items} featured={featured.items} originals={originals.items}
      deals={deals.items} newArrivals={newest.items} promo={settingJson<Banner | null>(s, 'promo_banner', null)} settings={s} />,
  }, { cache: tags });
});

async function listing(c: Context<AppEnv>, sh: Shell, opts: { title: string; description?: string; path: string; crumbs: Array<{ name: string; href?: string }>; query: Partial<ProductQuery>; templateId?: string; categoryIds?: number[]; subcategories?: CategoryNode[]; banner?: { text: string; tone: 'season' | 'off' } | null; countdownTo?: string | null; emptyText?: string; noindexEmpty?: boolean; cache: string[] | null }) {
  const url = new URL(c.req.url);
  const q = parseListingQuery(url);
  const r = await queryProducts(c.env.DB, { ...q, ...opts.query, categoryIds: opts.categoryIds ?? opts.query.categoryIds });
  const template = opts.templateId ? await getTemplate(c.env.DB, opts.templateId) : null;
  const f = template && opts.categoryIds ? await facets(c.env.DB, opts.categoryIds, template) : [];
  const filtered = [...url.searchParams.keys()].some(k => /^(f\.|a\.|min|max|page|show|sort)/.test(k));
  return render(c, sh, {
    title: opts.title, description: opts.description, path: opts.path, tab: 'categories', noindex: filtered || (opts.noindexEmpty && !r.total),
    jsonLd: [crumbLd(c.env.SITE_URL, opts.crumbs)],
    children: <ListingPage title={opts.title} description={opts.description} crumbs={opts.crumbs} items={r.items} total={r.total} page={q.page} perPage={q.limit!} url={url}
      facets={f} subcategories={opts.subcategories} banner={opts.banner} countdownTo={opts.countdownTo} emptyText={opts.emptyText} />,
  }, { cache: opts.cache ? [...opts.cache, ...cardTags(r.items)] : null });
}

pages.get('/c/:slug', async c => {
  const sh = await shell(c);
  const all = flatten(sh.tree);
  const cat = all.find(x => x.slug === c.req.param('slug'));
  if (!cat) return notFound(c, sh);
  const parent = cat.parentId ? all.find(x => x.id === cat.parentId) : null;
  const ids = [cat.id, ...flatten(cat.children).map(k => k.id)];
  let banner: { text: string; tone: 'season' | 'off' } | null = null;
  if (!cat.visible) {
    // Seasonal category outside its season: the page stays live (keeps its Google ranking) with a clear note.
    const seasons = (await getSeasons(c.env.DB)).filter(s => cat.seasonIds.includes(s.id));
    const next = nextSeason(seasons, bdDate());
    banner = { text: `Out of season. Back from ${next?.season.starts_on ? monthName(next.season.starts_on) : seasons[0]?.back_in_season_text ?? 'next season'}. Tap “Notify me” on any product.`, tone: 'off' };
  }
  const crumbs = [{ name: 'Home', href: '/' }, ...(parent ? [{ name: parent.name, href: `/c/${parent.slug}` }] : []), { name: cat.name }];
  const grand = parent?.parentId ? all.find(x => x.id === parent.parentId) : null;
  if (grand) crumbs.splice(1, 0, { name: grand.name, href: `/c/${grand.slug}` });
  return listing(c, sh, {
    title: cat.name, description: cat.description || `Shop ${cat.name} at Abs Vai. Cash on Delivery all over Bangladesh.`, path: `/c/${cat.slug}`, crumbs, query: {}, categoryIds: ids,
    templateId: cat.templateId, subcategories: cat.children.filter(k => k.visible), banner, cache: [TAG.category(cat.id), ...ids.map(TAG.category), TAG.listing],
  });
});

const simpleListings: Array<{ path: string; title: string; description: string; query: Partial<ProductQuery> }> = [
  { path: '/shop', title: 'All products', description: 'Everything in the Abs Vai store.', query: {} },
  { path: '/deals', title: 'Hot Deals', description: 'Real discounts on real prices. Offers end when the stock or the date runs out.', query: { deals: true } },
  { path: '/originals', title: 'Abs Vai Originals', description: 'Products made and packed by ABS VAI LTD, starting with our 42 Item Master Masala.', query: { originals: true } },
  { path: '/free-delivery', title: 'Free Delivery', description: 'Products that ship free anywhere in Bangladesh.', query: { freeDelivery: true } },
  { path: '/new', title: 'New Arrivals', description: 'The latest additions to the store.', query: { sort: 'newest' } },
];
for (const l of simpleListings) {
  pages.get(l.path, async c => {
    const sh = await shell(c);
    const sort = new URL(c.req.url).searchParams.get('sort') ? {} : l.query.sort ? { sort: l.query.sort } : {};
    return listing(c, sh, { title: l.title, description: l.description, path: l.path, crumbs: [{ name: 'Home', href: '/' }, { name: l.title }], query: { ...l.query, ...sort }, cache: [TAG.listing] });
  });
}

/** A marketplace seller's store: their live products. */
pages.get('/store/:slug', async c => {
  const sh = await shell(c);
  const s = await approvedSellerBySlug(c.env.DB, c.req.param('slug'));
  if (!s) return notFound(c, sh);
  return listing(c, sh, {
    title: String(s.shop_name), description: String(s.about ?? `Products from ${s.shop_name}${s.district ? `, ${s.district}` : ''}, sold on ${sh.settings.store_name || 'Abs Vai'} with Cash on Delivery.`),
    path: `/store/${s.slug}`, crumbs: [{ name: 'Home', href: '/' }, { name: 'Sellers' }, { name: String(s.shop_name) }], query: { sellerId: Number(s.id) },
    emptyText: 'This seller’s products will show here soon.', cache: [TAG.listing],
  });
});

/** Step 1 of selling here: the application form (the owner approves it in Admin → Sellers). */
pages.get('/sell', async c => {
  const sh = await shell(c);
  return render(c, sh, {
    title: `Sell on ${sh.settings.store_name || 'Abs Vai'}`, description: 'Register as a seller: add your products, we handle orders, Cash on Delivery and delivery all over Bangladesh.',
    path: '/sell', tab: 'account', scripts: ['/js/sell.js'], children: <SellPage settings={sh.settings} open={sh.settings.sellers_open !== '0'} />,
  }, { cache: [] });
});

pages.get('/search', async c => {
  const sh = await shell(c);
  const q = (c.req.query('q') ?? '').trim().slice(0, 80);
  const terms = q ? expandQuery(q, await synonymGroups(c.env.DB)) : [];
  if (!terms.length) return c.redirect('/shop', 302);
  return listing(c, sh, { title: `Results for “${q}”`, path: `/search?q=${encodeURIComponent(q)}`, crumbs: [{ name: 'Home', href: '/' }, { name: 'Search' }], query: { terms }, emptyText: 'Try a different spelling, e.g. “phuchka” or “fuchka”, “patali” or “khejur gur”.', noindexEmpty: true, cache: null });
});

pages.get('/season/:slug', async c => {
  const sh = await shell(c);
  const season = (await getSeasons(c.env.DB)).find(s => s.slug === c.req.param('slug') && s.is_enabled);
  if (!season) return notFound(c, sh);
  const today = bdDate();
  const active = isSeasonActive(season, today);
  const back = season.starts_on && season.starts_on > today ? monthName(season.starts_on) : season.back_in_season_text ?? 'next season';
  const s = season as typeof season & { landing_intro?: string };
  return listing(c, sh, {
    title: `${season.name} collection`, description: s.landing_intro ?? undefined, path: `/season/${season.slug}`, crumbs: [{ name: 'Home', href: '/' }, { name: season.name }],
    query: { seasonIds: [season.id] }, banner: active ? { text: `In season now · until ${season.ends_on}`, tone: 'season' } : { text: `Out of season. Back from ${back}.`, tone: 'off' },
    countdownTo: active ? season.ends_on : null, cache: [TAG.season(season.slug), TAG.listing],
  });
});

pages.get('/p/:slug', async c => {
  const sh = await shell(c);
  const d = await getProductDetail(c.env.DB, c.req.param('slug'));
  if (!d) return notFound(c, sh);
  const prod = d.product as Record<string, string | number | null>;
  const [related, zones, soldBy] = await Promise.all([
    queryProducts(c.env.DB, { categoryIds: [d.category.id], excludeId: Number(prod.id), limit: 8 }),
    zoneSummaries(c.env.DB),
    prod.seller_id ? productSellerPublic(c.env.DB, Number(prod.id)) : Promise.resolve(null),
  ]);
  const crumbs = [{ name: 'Home', href: '/' }, ...(d.category.parent ? [{ name: d.category.parent.name, href: `/c/${d.category.parent.slug}` }] : []), { name: d.category.name, href: `/c/${d.category.slug}` }, { name: String(prod.name) }];
  const image = d.media.find(m => m.kind === 'image')?.url;
  const url = `${c.env.SITE_URL}/p/${prod.slug}`;
  const schemaAvailability = (state: string) => ({ available: 'InStock', made_to_order: 'InStock', pre_order: 'PreOrder', out_of_season: 'OutOfStock', out_of_stock: 'OutOfStock' })[state] ?? 'InStock';
  const offers = d.variants.map(v => ({
    '@type': 'Offer', sku: v.sku, priceCurrency: 'BDT', price: (v.pricePaisa / 100).toFixed(2), url,
    availability: `https://schema.org/${schemaAvailability(d.availabilityByVariant[v.id]?.state ?? 'available')}`, itemCondition: 'https://schema.org/NewCondition',
  }));
  const productLd = {
    '@context': 'https://schema.org', '@type': 'Product', name: prod.name, description: prod.short_description ?? prod.meta_description ?? undefined,
    image: image ? [image.startsWith('http') ? image : `${c.env.SITE_URL}${image}`] : undefined, sku: d.variants[0]?.sku, brand: prod.brand ? { '@type': 'Brand', name: prod.brand } : undefined,
    category: d.category.name, offers: offers.length === 1 ? offers[0] : { '@type': 'AggregateOffer', priceCurrency: 'BDT', lowPrice: Math.min(...d.variants.map(v => v.pricePaisa)) / 100, highPrice: Math.max(...d.variants.map(v => v.pricePaisa)) / 100, offerCount: offers.length, offers },
  };
  return render(c, sh, {
    title: String(prod.meta_title ?? prod.name), description: String(prod.meta_description ?? prod.short_description ?? ''), path: `/p/${prod.slug}`, image,
    jsonLd: [productLd, crumbLd(c.env.SITE_URL, crumbs)], pageData: productPageData(d), scripts: ['/js/product.js'], bodyClass: 'pdp-page',
    children: <ProductPage d={d} related={related.items} zones={zones} freeThresholdPaisa={settingInt(sh.settings, 'free_delivery_threshold_paisa')} settings={sh.settings} soldBy={soldBy} />,
  }, { cache: [TAG.product(Number(prod.id)), TAG.category(d.category.id), 'zones', ...d.seasons.map(x => TAG.season(x.slug)), ...cardTags(related.items)] });
});

pages.get('/categories', async c => {
  const sh = await shell(c);
  return render(c, sh, { title: 'All categories', path: '/categories', tab: 'categories', children: <CategoriesPage categories={sh.visible} /> }, { cache: [TAG.listing] });
});

pages.get('/cart', async c => {
  const sh = await shell(c);
  return render(c, sh, { title: 'Your cart', path: '/cart', tab: 'cart', noindex: true, scripts: ['/js/cart.js'], pageData: { freeThresholdPaisa: settingInt(sh.settings, 'free_delivery_threshold_paisa') }, children: <CartPage /> });
});

pages.get('/checkout', async c => {
  const sh = await shell(c);
  const wallets = settingJson<Array<{ wallet: string; number: string; type?: string }>>(sh.settings, 'manual_wallets', []);
  return render(c, sh, {
    title: 'Checkout', path: '/checkout', noindex: true, scripts: ['/js/checkout.js'], turnstileSiteKey: c.env.TURNSTILE_SITE_KEY,
    pageData: { outlinesBase: `/geo/${GEO_VERSION}`, mapTileUrl: sh.settings.map_tile_url || null, mapAttribution: sh.settings.map_tile_attribution || '', freeThresholdPaisa: settingInt(sh.settings, 'free_delivery_threshold_paisa'), turnstile: Boolean(c.env.TURNSTILE_SITE_KEY) },
    children: <CheckoutPage wallets={wallets} turnstileSiteKey={c.env.TURNSTILE_SITE_KEY} />,
  });
});

pages.get('/order/:orderNo', async c => {
  const sh = await shell(c);
  const o = await orderByNo(c.env.DB, c.req.param('orderNo'));
  if (!o || o.access_token !== c.req.query('t')) return notFound(c, sh);
  const items = await orderItems(c.env.DB, Number(o.id));
  // The code form shows only if a code was actually sent for this order (SMS codes are off until a gateway is connected).
  const codeSent = Boolean(await otpRow(c.env.DB, Number(o.id)));
  return render(c, sh, {
    title: `Order ${o.order_no}`, path: `/order/${o.order_no}`, noindex: true, scripts: ['/js/order.js'],
    children: <OrderPage o={o} items={items} codeSent={codeSent} wallets={settingJson(sh.settings, 'manual_wallets', [])} />,
  });
});

pages.get('/track', async c => {
  const sh = await shell(c);
  // One box: mobile number OR order number. The older links (?phone=…&order=…) still work.
  const q = (c.req.query('q') ?? '').trim();
  const phone = (c.req.query('phone') ?? '').trim();
  const order = (c.req.query('order') ?? '').trim();
  const asked = q || phone || order;
  let result: TrackResult | null = null;
  let error: string | undefined;
  if (asked) {
    if (!(await rateLimit(c.env.KV, `track:${clientIp(c)}`, 20, 600))) error = 'Too many lookups. Please try again in a few minutes.';
    else {
      try { result = await trackOrders(c.env, { q, phone, orderNo: order }); } catch (e) {
        if (!(e instanceof HttpError) || e.status >= 500) throw e;
        error = e.message;
      }
    }
  }
  return render(c, sh, { title: 'Track your order', path: '/track', noindex: Boolean(asked), tab: 'account', children: <TrackPage q={q || order || phone} result={result} error={error} /> });
});

pages.get('/wishlist', async c => {
  const sh = await shell(c);
  const idsParam = c.req.query('ids');
  let items = null;
  if (idsParam !== undefined) {
    const ids = idsParam.split(',').map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 60);
    items = ids.length ? (await queryProducts(c.env.DB, { productIds: ids, limit: 60 })).items : [];
  }
  return render(c, sh, { title: 'Wishlist', path: '/wishlist', tab: 'wishlist', noindex: true, children: <WishlistPage items={items} /> });
});

pages.get('/account', async c => {
  const sh = await shell(c);
  return render(c, sh, { title: 'Your account', path: '/account', tab: 'account', children: <AccountPage /> });
});

pages.get('/contact', async c => {
  const sh = await shell(c);
  return render(c, sh, { title: 'Contact & wholesale', description: 'Call, WhatsApp or message Abs Vai. Dealer and bulk inquiries for Master Masala, machines and packaging.', path: '/contact', tab: 'account', children: <ContactPage settings={sh.settings} /> }, { cache: [] });
});


/** One-tap unsubscribe from offer emails (signed link, so nobody can unsubscribe someone else). */
pages.get('/email/unsubscribe', async c => {
  const sh = await shell(c);
  const id = Number(c.req.query('c'));
  const ok = Number.isInteger(id) && id > 0 && (await checkUnsubscribe(c.env, id, c.req.query('t') ?? ''));
  if (ok) await unsubscribeCustomer(c.env.DB, id);
  return render(c, sh, { title: 'Email offers', path: '/email/unsubscribe', noindex: true, children: <SimplePage title={ok ? 'You are unsubscribed' : 'Link not valid'}>{ok ? <p>You will not get offer emails from us any more. Order emails (receipt, invoice, delivery) still come when you order.</p> : <p>This unsubscribe link is not valid. Reply to any of our emails and we will remove you.</p>}</SimplePage> });
});

pages.get('/policies/:slug', async c => {
  const sh = await shell(c);
  const p = POLICIES[c.req.param('slug')];
  if (!p) return notFound(c, sh);
  return render(c, sh, { title: p.title, path: `/policies/${c.req.param('slug')}`, children: <SimplePage title={p.title}>{p.body.map(t => <p>{t}</p>)}</SimplePage> }, { cache: [TAG.policy] });
});

pages.get('/robots.txt', c => c.text(`User-agent: *\nDisallow: /admin/\nDisallow: /api/\nDisallow: /checkout\nDisallow: /cart\nDisallow: /order/\nSitemap: ${c.env.SITE_URL}/sitemap.xml\n`, 200, { 'Cache-Control': 'public, max-age=86400' }));

pages.get('/sitemap.xml', async c => {
  const { products, categories } = await sitemapEntries(c.env.DB, new Date().toISOString());
  const seasons = (await getSeasons(c.env.DB)).filter(s => s.is_enabled);
  const u = (path: string, mod?: string) => `<url><loc>${c.env.SITE_URL}${path}</loc>${mod ? `<lastmod>${mod.slice(0, 10)}</lastmod>` : ''}</url>`;
  const body = [
    ...['/', '/shop', '/deals', '/originals', '/new', '/free-delivery', '/categories', '/contact'].map(p => u(p)),
    ...categories.map(r => u(`/c/${r.slug}`, r.updated_at)),
    // Seasonal pages stay in the sitemap all year so they keep their ranking.
    ...seasons.map(r => u(`/season/${r.slug}`, (r as { updated_at?: string }).updated_at)),
    ...products.map(r => u(`/p/${r.slug}`, r.updated_at)),
  ].join('');
  return c.body(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`, 200, { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=3600', 'CDN-Cache-Control': 'public, max-age=3600', 'Cache-Tag': 'sitemap' });
});

/** Brand colours from Settings → Store & Branding, as CSS variables on top of app.css (cached, purged with `site`). */
pages.get('/brand.css', async c => {
  const colors = parseBrandColors(settingJson(await loadSettings(c.env.DB), 'brand_colors', {}));
  const css = `:root{${Object.entries(colors).filter(([k, v]) => DEFAULT_COLORS[k as keyof typeof DEFAULT_COLORS] !== v).map(([k, v]) => `--${k}:${v}`).join(';')}}\n`;
  return c.body(css, 200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'CDN-Cache-Control': 'public, max-age=86400', 'Cache-Tag': TAG.site });
});

export async function notFound(c: Context<AppEnv>, sh?: Shell) {
  const s = sh ?? (await shell(c));
  return render(c, s, { title: 'Page not found', path: new URL(c.req.url).pathname, noindex: true, children: <NotFoundPage /> }, { status: 404 });
}

