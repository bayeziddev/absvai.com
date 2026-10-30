/** Server-rendered storefront pages (SEO: real HTML, Product/BreadcrumbList JSON-LD, canonical URLs). */
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../env';
import {
  activeSeasonIds, facets, flatten, getCategoryTree, getProductDetail, getSeasons, getTemplate, queryProducts, seasonalCategoryIds, synonymGroups, visibleTree,
  type CategoryNode, type ProductQuery,
} from '../data/catalog';
import { loadSettings, settingInt, settingJson } from '../data/settings';
import { bdDate, monthName } from '../lib/dates';
import { clientIp, parseJson, rateLimit } from '../lib/http';
import { normalizeBdPhone } from '../lib/phone';
import { expandQuery } from '../lib/search';
import { isSeasonActive, nextSeason } from '../lib/seasons';
import { type OrderStatus } from '../lib/order-status';
import { parseListingQuery } from './api';
import { GEO_VERSION } from '../generated/geo-version';
import type { Banner } from '../views/components';
import { Layout, type LayoutProps } from '../views/layout';
import {
  AccountPage, CartPage, CategoriesPage, CheckoutPage, ContactPage, HomePage, ListingPage, NotFoundPage, OrderPage, ProductPage, productPageData, SimplePage, TrackPage, WishlistPage,
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

async function render(c: Context<AppEnv>, sh: Shell, props: Omit<LayoutProps, 'settings' | 'categories' | 'siteUrl' | 'activeSeason'>, status = 200) {
  const html = await (
    <Layout {...props} settings={sh.settings} categories={sh.visible} siteUrl={c.env.SITE_URL} activeSeason={sh.activeSeason} />
  ).toString();
  return c.html(`<!DOCTYPE html>${html}`, status as 200, { 'Cache-Control': 'public, max-age=0, must-revalidate' });
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
  const [inSeason, originals, deals, newest] = await Promise.all([
    queryProducts(c.env.DB, { seasonIds: sh.activeIds, limit: 12 }),
    queryProducts(c.env.DB, { originals: true, limit: 10 }),
    queryProducts(c.env.DB, { deals: true, sort: 'discount', limit: 8 }),
    queryProducts(c.env.DB, { sort: 'newest', limit: 10 }),
  ]);
  const s = sh.settings;
  return render(c, sh, {
    title: s.store_name || 'Abs Vai', description: 'Seasonal food, Abs Vai masala, food-business machines, tools, clothing and gadgets. Cash on Delivery all over Bangladesh.',
    path: '/', tab: 'home',
    jsonLd: [
      { '@context': 'https://schema.org', '@type': 'Organization', name: s.company_name || 'ABS VAI LTD', url: c.env.SITE_URL, logo: `${c.env.SITE_URL}/favicon.svg` },
      { '@context': 'https://schema.org', '@type': 'WebSite', name: s.store_name || 'Abs Vai', url: c.env.SITE_URL, potentialAction: { '@type': 'SearchAction', target: `${c.env.SITE_URL}/search?q={search_term_string}`, 'query-input': 'required name=search_term_string' } },
    ],
    children: <HomePage banners={banners} categories={carousel} seasonal={seasonal} activeSeason={sh.activeSeason} inSeason={inSeason.items} originals={originals.items}
      deals={deals.items} newArrivals={newest.items} promo={settingJson<Banner | null>(s, 'promo_banner', null)} settings={s} />,
  });
});

async function listing(c: Context<AppEnv>, sh: Shell, opts: { title: string; description?: string; path: string; crumbs: Array<{ name: string; href?: string }>; query: Partial<ProductQuery>; templateId?: string; categoryIds?: number[]; subcategories?: CategoryNode[]; banner?: { text: string; tone: 'season' | 'off' } | null; countdownTo?: string | null; emptyText?: string; noindexEmpty?: boolean }) {
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
  });
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
    const links = await c.env.DB.prepare('SELECT season_id FROM category_seasons WHERE category_id = ?').bind(cat.id).all<{ season_id: number }>();
    const seasons = (await getSeasons(c.env.DB)).filter(s => links.results.some(l => l.season_id === s.id));
    const next = nextSeason(seasons, bdDate());
    banner = { text: `Out of season. Back from ${next?.season.starts_on ? monthName(next.season.starts_on) : seasons[0]?.back_in_season_text ?? 'next season'}. Tap “Notify me” on any product.`, tone: 'off' };
  }
  const crumbs = [{ name: 'Home', href: '/' }, ...(parent ? [{ name: parent.name, href: `/c/${parent.slug}` }] : []), { name: cat.name }];
  return listing(c, sh, { title: cat.name, description: cat.description || `Shop ${cat.name} at Abs Vai. Cash on Delivery all over Bangladesh.`, path: `/c/${cat.slug}`, crumbs, query: {}, categoryIds: ids, templateId: cat.templateId, subcategories: cat.children.filter(k => k.visible), banner });
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
    return listing(c, sh, { title: l.title, description: l.description, path: l.path, crumbs: [{ name: 'Home', href: '/' }, { name: l.title }], query: { ...l.query, ...sort } });
  });
}

pages.get('/search', async c => {
  const sh = await shell(c);
  const q = (c.req.query('q') ?? '').trim().slice(0, 80);
  const terms = q ? expandQuery(q, await synonymGroups(c.env.DB)) : [];
  if (!terms.length) return c.redirect('/shop', 302);
  return listing(c, sh, { title: `Results for “${q}”`, path: `/search?q=${encodeURIComponent(q)}`, crumbs: [{ name: 'Home', href: '/' }, { name: 'Search' }], query: { terms }, emptyText: 'Try a different spelling, e.g. “phuchka” or “fuchka”, “patali” or “khejur gur”.', noindexEmpty: true });
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
    countdownTo: active ? season.ends_on : null,
  });
});

pages.get('/p/:slug', async c => {
  const sh = await shell(c);
  const d = await getProductDetail(c.env.DB, c.req.param('slug'));
  if (!d) return notFound(c, sh);
  const prod = d.product as Record<string, string | number | null>;
  const [related, zones] = await Promise.all([
    queryProducts(c.env.DB, { categoryIds: [d.category.id], excludeId: Number(prod.id), limit: 8 }),
    c.env.DB.prepare('SELECT name, eta_text, base_charge_paisa FROM delivery_zones ORDER BY sort_order').all<{ name: string; eta_text: string; base_charge_paisa: number }>(),
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
    children: <ProductPage d={d} related={related.items} zones={zones.results} freeThresholdPaisa={settingInt(sh.settings, 'free_delivery_threshold_paisa')} settings={sh.settings} />,
  });
});

pages.get('/categories', async c => {
  const sh = await shell(c);
  return render(c, sh, { title: 'All categories', path: '/categories', tab: 'categories', children: <CategoriesPage categories={sh.visible} /> });
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
  const o = await c.env.DB.prepare('SELECT * FROM orders WHERE order_no = ?').bind(c.req.param('orderNo')).first<Record<string, unknown>>();
  if (!o || o.access_token !== c.req.query('t')) return notFound(c, sh);
  const items = await c.env.DB.prepare('SELECT * FROM order_items WHERE order_id = ?').bind(o.id).all<Record<string, unknown>>();
  return render(c, sh, {
    title: `Order ${o.order_no}`, path: `/order/${o.order_no}`, noindex: true, scripts: ['/js/order.js'],
    children: <OrderPage o={o} items={items.results} wallets={settingJson(sh.settings, 'manual_wallets', [])} />,
  });
});

pages.get('/track', async c => {
  const sh = await shell(c);
  const phoneRaw = c.req.query('phone');
  const orderNo = (c.req.query('order') ?? '').trim().toUpperCase();
  let result: Parameters<typeof TrackPage>[0]['result'] = null;
  let error: string | undefined;
  if (phoneRaw || orderNo) {
    const phone = normalizeBdPhone(phoneRaw);
    if (!(await rateLimit(c.env.KV, `track:${clientIp(c)}`, 20, 600))) error = 'Too many lookups. Please try again in a few minutes.';
    else if (!phone || !orderNo) error = 'Enter your mobile number and order number.';
    else {
      const o = await c.env.DB.prepare('SELECT * FROM orders WHERE order_no = ? AND phone = ?').bind(orderNo, phone).first<Record<string, unknown>>();
      if (!o) error = 'We could not find an order with that mobile number and order number.';
      else {
        const ev = await c.env.DB.prepare("SELECT to_status, created_at FROM order_events WHERE order_id = ? AND kind = 'status' ORDER BY id").bind(o.id).all<{ to_status: OrderStatus; created_at: string }>();
        result = { orderNo: String(o.order_no), status: o.status as OrderStatus, courier: (o.courier as string) ?? null, trackingId: (o.tracking_id as string) ?? null, eta: (o.eta_text as string) ?? null, timeline: ev.results.map(e => ({ status: e.to_status, at: e.created_at })) };
      }
    }
  }
  return render(c, sh, { title: 'Track your order', path: '/track', noindex: Boolean(phoneRaw), tab: 'account', children: <TrackPage phone={phoneRaw} orderNo={orderNo} result={result} error={error} /> });
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
  return render(c, sh, { title: 'Contact & wholesale', description: 'Call, WhatsApp or message Abs Vai. Dealer and bulk inquiries for Master Masala, machines and packaging.', path: '/contact', tab: 'account', children: <ContactPage settings={sh.settings} /> });
});

const POLICIES: Record<string, { title: string; body: string[] }> = {
  delivery: { title: 'Delivery & payment', body: [
    'We deliver to all 64 districts of Bangladesh. The delivery charge depends on your area and the packed weight of your parcel, and is shown at checkout before you order.',
    'Cash on Delivery is available everywhere. Pre-orders, large items and some high-value orders need an advance (usually the delivery charge) by bKash, Nagad or Rocket. The amount is always shown before you pay, and it is deducted from your total.',
    'We confirm every Cash on Delivery order by an SMS code or a short phone call before we ship it.',
  ] },
  returns: { title: 'Returns & refunds', body: [
    'Please check your parcel in front of the delivery person. If something is wrong, damaged or not what you ordered, you can return it on the spot.',
    'Food items cannot be returned once opened, except when they are spoiled or damaged on arrival. Tell us within 24 hours with a photo.',
    'Refunds for advances and returns are sent to the wallet you paid from, usually within 3 working days. (Final policy to be confirmed by ABS VAI LTD.)',
  ] },
  privacy: { title: 'Privacy', body: [
    'We use your phone number, name and address only to deliver your order, confirm it and tell you about it. We do not sell your details.',
    'If you tap “Use my location” at checkout, your browser’s location is used on your phone to pick your district and is never sent to or stored by us.',
    'Checkout details are saved as you type so our team can help you if an order does not go through. You can ask us to delete them at any time.',
  ] },
  credits: { title: 'Credits & data sources', body: [
    'Divisions, districts, upazilas, unions, district coordinates and outlines: Bangladesh-geocode by Sayad Md Bayezid Hosan (MIT licence).',
    'Postcodes: the postcode-bd list in Bangladesh-geocode, compiled from Wikipedia’s “List of postal codes in Bangladesh” (CC BY-SA 4.0).',
    'Product photos are the shop’s own or supplied with permission by its suppliers.',
  ] },
};

pages.get('/policies/:slug', async c => {
  const sh = await shell(c);
  const p = POLICIES[c.req.param('slug')];
  if (!p) return notFound(c, sh);
  return render(c, sh, { title: p.title, path: `/policies/${c.req.param('slug')}`, children: <SimplePage title={p.title}>{p.body.map(t => <p>{t}</p>)}</SimplePage> });
});

pages.get('/robots.txt', c => c.text(`User-agent: *\nDisallow: /admin/\nDisallow: /api/\nDisallow: /checkout\nDisallow: /cart\nDisallow: /order/\nSitemap: ${c.env.SITE_URL}/sitemap.xml\n`));

pages.get('/sitemap.xml', async c => {
  const now = new Date().toISOString();
  const [products, cats, seasons] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT slug, updated_at FROM products WHERE deleted_at IS NULL AND (status = 'published' OR (status = 'scheduled' AND publish_at <= ?))").bind(now),
    c.env.DB.prepare('SELECT slug, updated_at FROM categories WHERE is_active = 1 AND deleted_at IS NULL'),
    c.env.DB.prepare('SELECT slug, updated_at FROM seasons WHERE is_enabled = 1'),
  ]);
  const u = (path: string, mod?: string) => `<url><loc>${c.env.SITE_URL}${path}</loc>${mod ? `<lastmod>${mod.slice(0, 10)}</lastmod>` : ''}</url>`;
  const body = [
    ...['/', '/shop', '/deals', '/originals', '/new', '/free-delivery', '/categories', '/contact'].map(p => u(p)),
    ...(cats.results as Array<{ slug: string; updated_at: string }>).map(r => u(`/c/${r.slug}`, r.updated_at)),
    // Seasonal pages stay in the sitemap all year so they keep their ranking.
    ...(seasons.results as Array<{ slug: string; updated_at: string }>).map(r => u(`/season/${r.slug}`, r.updated_at)),
    ...(products.results as Array<{ slug: string; updated_at: string }>).map(r => u(`/p/${r.slug}`, r.updated_at)),
  ].join('');
  return c.body(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`, 200, { 'Content-Type': 'application/xml' });
});

export async function notFound(c: Context<AppEnv>, sh?: Shell) {
  const s = sh ?? (await shell(c));
  return render(c, s, { title: 'Page not found', path: new URL(c.req.url).pathname, noindex: true, children: <NotFoundPage /> }, 404);
}

