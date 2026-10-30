/** Public JSON API used by the storefront scripts. Prices, stock and delivery charges are always computed here. */
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { GEO_VERSION } from '../generated/geo-version';
import { getProductDetail, queryProducts, synonymGroups, type ProductQuery } from '../data/catalog';
import { loadSettings } from '../data/settings';
import { bad, clientIp, int, notFound, posInt, rateLimit, readJson, str, HttpError } from '../lib/http';
import { normalizeBdPhone } from '../lib/phone';
import { expandQuery } from '../lib/search';
import { effectiveVariantAttributes } from '../lib/templates';
import { STATUS_LABELS, type OrderStatus } from '../lib/order-status';
import { priceCart, sanitizeLines } from '../services/cart';
import { quote } from '../services/checkout';
import { issueOtp, placeOrder, verifyOtp } from '../services/orders';

export const api = new Hono<AppEnv>();

async function settings(c: { var: { settings?: Record<string, string> }; env: AppEnv['Bindings']; set: (k: 'settings', v: Record<string, string>) => void }) {
  if (!c.var.settings) c.set('settings', await loadSettings(c.env.DB));
  return c.var.settings!;
}

export function parseListingQuery(url: URL): ProductQuery & { page: number } {
  const p = url.searchParams;
  const limit = [10, 20, 30, 40].includes(Number(p.get('show'))) ? Number(p.get('show')) : 20;
  const page = Math.max(1, Number(p.get('page')) || 1);
  const sorts = ['default', 'price_asc', 'price_desc', 'newest', 'best_selling', 'discount'] as const;
  const sort = (sorts as readonly string[]).includes(p.get('sort') ?? '') ? (p.get('sort') as ProductQuery['sort']) : 'default';
  const specFilters: Record<string, string[]> = {};
  const attrFilters: Record<string, string[]> = {};
  for (const [k, v] of p.entries()) {
    if (k.startsWith('f.') && v) (specFilters[k.slice(2)] ??= []).push(v.slice(0, 100));
    if (k.startsWith('a.') && v) (attrFilters[k.slice(2)] ??= []).push(v.slice(0, 100));
  }
  const taka = (s: string | null) => (s && /^\d{1,7}$/.test(s) ? Number(s) * 100 : undefined);
  return { limit, offset: (page - 1) * limit, page, sort, specFilters, attrFilters, minPricePaisa: taka(p.get('min')), maxPricePaisa: taka(p.get('max')) };
}

api.get('/catalog/products', async c => {
  const url = new URL(c.req.url);
  const q = parseListingQuery(url);
  const ids = (url.searchParams.get('ids') ?? '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 60);
  if (ids.length) q.productIds = ids;
  const query = url.searchParams.get('q');
  if (query) q.terms = expandQuery(query, await synonymGroups(c.env.DB));
  const r = await queryProducts(c.env.DB, q);
  return c.json({ ...r, page: q.page });
});

/** Variant data for the quick-pick sheet and the product page. */
api.get('/catalog/products/:slug', async c => {
  const d = await getProductDetail(c.env.DB, c.req.param('slug'));
  if (!d) throw notFound('This product is not available.');
  const attrs = effectiveVariantAttributes(d.template, d.promotedSpecKeys).filter(a => d.variants.some(v => v.attributes[a.attributeTypeId]));
  return c.json({
    id: d.product.id, slug: d.product.slug, name: d.product.name, image: d.media.find(m => m.kind === 'image')?.url ?? null,
    attributes: attrs.map(a => ({ id: a.attributeTypeId, label: a.label, input: a.input, swatches: a.swatches ?? {}, values: [...new Set(d.variants.map(v => v.attributes[a.attributeTypeId]).filter(Boolean))] })),
    variants: d.variants.map(v => ({
      id: v.id, sku: v.sku, attributes: v.attributes, pricePaisa: v.pricePaisa, compareAtPricePaisa: v.compareAtPricePaisa, stock: v.stock,
      netValue: v.netValue, netUnit: v.netUnit, imageIds: v.imageIds, wholesaleTiers: v.wholesaleTiers, availability: d.availabilityByVariant[v.id],
    })),
    media: d.media.filter(m => m.kind === 'image'),
    availability: d.availability,
  });
});

api.get('/search/suggest', async c => {
  const q = c.req.query('q') ?? '';
  if (q.trim().length < 2) return c.json({ products: [], categories: [] });
  const terms = expandQuery(q, await synonymGroups(c.env.DB));
  const [products, cats] = await Promise.all([
    queryProducts(c.env.DB, { terms, limit: 6, sort: 'best_selling' }),
    c.env.DB.prepare(`SELECT slug, name FROM categories WHERE is_active = 1 AND deleted_at IS NULL AND (${terms.map(() => 'name LIKE ?').join(' OR ')}) LIMIT 4`).bind(...terms.map(t => `%${t}%`)).all(),
  ]);
  return c.json({
    products: products.items.map(p => ({ slug: p.slug, name: p.name, image: p.image, pricePaisa: p.pricePaisa, keySpecs: p.keySpecs })),
    categories: cats.results,
  });
});

api.post('/cart/price', async c => {
  const body = await readJson(c);
  const r = await priceCart(c.env.DB, sanitizeLines(body.lines));
  return c.json(r);
});

// ───────────── Geo data (versioned, cache forever) ─────────────

async function geoVersion(c: Parameters<typeof settings>[0]): Promise<string> {
  const s = await settings(c);
  return `${GEO_VERSION}-${s.geo_postcode_version ?? '1'}`;
}

api.get('/geo/version', async c => c.json({ version: await geoVersion(c) }, 200, { 'Cache-Control': 'no-store' }));

api.get('/geo/:version/hierarchy.json', async c => {
  const version = await geoVersion(c);
  if (c.req.param('version') !== version) return c.redirect(`/api/geo/${version}/hierarchy.json`, 302);
  const key = `geo:hierarchy:${version}`;
  let body = await c.env.KV.get(key);
  if (!body) {
    const [dv, ds, up] = await c.env.DB.batch([
      c.env.DB.prepare('SELECT id, name FROM geo_divisions ORDER BY name'),
      c.env.DB.prepare('SELECT id, division_id, name, lat, lon FROM geo_districts ORDER BY name'),
      c.env.DB.prepare('SELECT id, district_id, name, kind FROM geo_upazilas ORDER BY kind ASC, name'),
    ]);
    body = JSON.stringify({
      divisions: (dv.results as Array<{ id: number; name: string }>).map(r => [r.id, r.name]),
      districts: (ds.results as Array<{ id: number; division_id: number; name: string; lat: number; lon: number }>).map(r => [r.id, r.division_id, r.name, r.lat, r.lon]),
      upazilas: (up.results as Array<{ id: number; district_id: number; name: string }>).map(r => [r.id, r.district_id, r.name]),
    });
    await c.env.KV.put(key, body, { expirationTtl: 60 * 60 * 24 * 30 });
  }
  return c.body(body, 200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=31536000, immutable' });
});

api.get('/geo/:version/postcodes.json', async c => {
  const version = await geoVersion(c);
  if (c.req.param('version') !== version) return c.redirect(`/api/geo/${version}/postcodes.json`, 302);
  const key = `geo:postcodes:${version}`;
  let body = await c.env.KV.get(key);
  if (!body) {
    const rows = await c.env.DB.prepare('SELECT postcode, post_office, division_id, district_id, upazila_id FROM geo_postcodes ORDER BY postcode').all<{ postcode: string; post_office: string; division_id: number; district_id: number; upazila_id: number | null }>();
    const map: Record<string, Array<[string, number, number, number | null]>> = {};
    for (const r of rows.results) (map[r.postcode] ??= []).push([r.post_office, r.division_id, r.district_id, r.upazila_id]);
    body = JSON.stringify(map);
    await c.env.KV.put(key, body, { expirationTtl: 60 * 60 * 24 * 30 });
  }
  return c.body(body, 200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=31536000, immutable' });
});

api.get('/geo/:version/unions/:upazilaId', async c => {
  const id = posInt(c.req.param('upazilaId').replace(/\.json$/, ''));
  if (!id) throw bad('Bad area.');
  const rows = await c.env.DB.prepare('SELECT id, name FROM geo_unions WHERE upazila_id = ? ORDER BY name').bind(id).all<{ id: number; name: string }>();
  return c.json(rows.results.map(r => [r.id, r.name]), 200, { 'Cache-Control': 'public, max-age=31536000, immutable' });
});

// ───────────── Checkout ─────────────

api.post('/checkout/quote', async c => {
  const body = await readJson(c);
  const phone = normalizeBdPhone(str(body.phone));
  let customerIsNewOrRisky = true;
  if (phone) {
    const cust = await c.env.DB.prepare('SELECT delivered_count, returned_count FROM customers WHERE phone = ?').bind(phone).first<{ delivered_count: number; returned_count: number }>();
    customerIsNewOrRisky = !cust || cust.delivered_count === 0 || cust.returned_count > 0;
  }
  const q = await quote(c.env.DB, await settings(c), {
    lines: sanitizeLines(body.lines), districtId: posInt(body.districtId), upazilaId: posInt(body.upazilaId),
    paymentMethod: body.paymentMethod === 'manual_mobile' ? 'manual_mobile' : 'cod', customerIsNewOrRisky,
  });
  return c.json(q);
});

/** Abandoned-checkout capture: details are saved as the customer types (phone first), so staff can follow up. */
api.post('/checkout/draft', async c => {
  if (!(await rateLimit(c.env.KV, `draft:${clientIp(c)}`, 60, 600))) return c.json({ ok: false }, 429);
  const body = await readJson(c);
  const token = str(body.token, 64);
  if (!/^[a-f0-9]{32}$/.test(token)) throw bad('Bad token.');
  const phone = normalizeBdPhone(str(body.phone));
  if (!phone) return c.json({ ok: true, saved: false });
  const lines = sanitizeLines(body.lines);
  const priced = await priceCart(c.env.DB, lines);
  const address = {
    divisionId: posInt(body.divisionId), districtId: posInt(body.districtId), upazilaId: posInt(body.upazilaId),
    postcode: str(body.postcode, 4), addressLine: str(body.addressLine, 300), landmark: str(body.landmark, 200),
  };
  await c.env.DB.prepare(
    `INSERT INTO abandoned_checkouts (token, phone, name, address, cart, subtotal_paisa) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(token) DO UPDATE SET phone = excluded.phone, name = excluded.name, address = excluded.address, cart = excluded.cart,
       subtotal_paisa = excluded.subtotal_paisa, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE abandoned_checkouts.status = 'open'`,
  ).bind(token, phone, str(body.name, 120) || null, JSON.stringify(address), JSON.stringify(priced.lines.map(l => ({ variantId: l.variantId, qty: l.qty, name: l.name, sku: l.sku }))), priced.subtotalPaisa).run();
  return c.json({ ok: true, saved: true });
});

async function verifyTurnstile(c: { env: AppEnv['Bindings'] }, token: string, ip: string): Promise<boolean> {
  if (!c.env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  const form = new FormData();
  form.append('secret', c.env.TURNSTILE_SECRET);
  form.append('response', token);
  form.append('remoteip', ip);
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const j = (await r.json()) as { success?: boolean };
  return Boolean(j.success);
}

api.post('/checkout/place', async c => {
  const ip = clientIp(c);
  if (!(await rateLimit(c.env.KV, `place:${ip}`, 8, 600))) throw new HttpError(429, 'Too many orders from this connection. Please wait a few minutes or call us.');
  const body = await readJson(c);
  if (!(await verifyTurnstile(c, str(body.turnstileToken, 2048), ip))) throw bad('Please complete the "I am human" check.');
  const utm: Record<string, string> = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid']) {
    const v = str((body.utm as Record<string, unknown> | undefined)?.[k], 200);
    if (v) utm[k] = v;
  }
  const placed = await placeOrder(c.env, await settings(c), {
    phone: str(body.phone, 20), name: str(body.name, 120),
    divisionId: int(body.divisionId) ?? 0, districtId: int(body.districtId) ?? 0, upazilaId: int(body.upazilaId) ?? 0, unionId: posInt(body.unionId),
    postcode: str(body.postcode, 4) || null, addressLine: str(body.addressLine, 300), landmark: str(body.landmark, 200) || null, note: str(body.note, 500) || null,
    paymentMethod: body.paymentMethod === 'manual_mobile' ? 'manual_mobile' : 'cod',
    advanceTrxId: str(body.advanceTrxId, 40) || null, advanceWallet: str(body.advanceWallet, 20) || null,
    lines: sanitizeLines(body.lines), source: str(body.source, 80) || 'web', utm, abandonedToken: /^[a-f0-9]{32}$/.test(str(body.token, 64)) ? str(body.token, 64) : null,
  });
  return c.json(placed, 201);
});

// ───────────── Order self-service ─────────────

async function orderByToken(c: { env: AppEnv['Bindings'] }, orderNo: string, token: string) {
  const o = await c.env.DB.prepare('SELECT * FROM orders WHERE order_no = ?').bind(orderNo).first<Record<string, unknown>>();
  if (!o || !token || o.access_token !== token) throw notFound('Order not found.');
  return o;
}

api.post('/orders/:orderNo/otp/verify', async c => {
  const body = await readJson(c);
  const o = await orderByToken(c, c.req.param('orderNo'), str(body.t, 64));
  if (!(await rateLimit(c.env.KV, `otpv:${o.id}`, 10, 900))) throw new HttpError(429, 'Too many tries. We will call you to confirm.');
  const r = await verifyOtp(c.env, Number(o.id), str(body.code, 8));
  return c.json(r, r.ok ? 200 : 400);
});

api.post('/orders/:orderNo/otp/resend', async c => {
  const body = await readJson(c);
  const o = await orderByToken(c, c.req.param('orderNo'), str(body.t, 64));
  if (o.otp_verified_at) return c.json({ ok: true, message: 'Already verified.' });
  const sent = await issueOtp(c.env, Number(o.id), String(o.order_no), String(o.phone));
  return c.json({ ok: sent, message: sent ? 'A new code is on its way.' : 'You have asked for the code too many times. We will call you instead.' }, sent ? 200 : 429);
});

api.post('/orders/:orderNo/advance', async c => {
  const body = await readJson(c);
  const o = await orderByToken(c, c.req.param('orderNo'), str(body.t, 64));
  const trx = str(body.trxId, 40);
  if (!/^[A-Za-z0-9]{6,30}$/.test(trx)) throw bad('Enter the transaction ID exactly as it appears in the SMS from your wallet.');
  if (!o.advance_required || !['pending', 'submitted'].includes(String(o.advance_status))) throw bad('No advance is due on this order.');
  const wallet = str(body.wallet, 20) || 'mobile';
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE orders SET advance_trx_id = ?, advance_wallet = ?, advance_status = 'submitted', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").bind(trx, wallet, o.id),
    c.env.DB.prepare("INSERT INTO payments (order_id, kind, method, amount_paisa, trx_id, status) VALUES (?, 'advance', ?, ?, ?, 'submitted')").bind(o.id, wallet, o.advance_amount_paisa ?? 0, trx),
    c.env.DB.prepare("INSERT INTO order_events (order_id, kind, note) VALUES (?, 'payment', ?)").bind(o.id, `Customer submitted advance TrxID ${trx} (${wallet})`),
  ]);
  return c.json({ ok: true, message: 'Thank you. We will check the payment and confirm your order.' });
});

api.post('/orders/track', async c => {
  if (!(await rateLimit(c.env.KV, `track:${clientIp(c)}`, 20, 600))) throw new HttpError(429, 'Too many lookups. Please try again in a few minutes.');
  const body = await readJson(c);
  const phone = normalizeBdPhone(str(body.phone));
  const orderNo = str(body.orderNo, 20).toUpperCase();
  if (!phone || !orderNo) throw bad('Enter your phone number and order number.');
  const o = await c.env.DB.prepare('SELECT * FROM orders WHERE order_no = ? AND phone = ?').bind(orderNo, phone).first<Record<string, unknown>>();
  if (!o) throw notFound('We could not find an order with that phone number and order number.');
  const events = await c.env.DB.prepare("SELECT to_status, created_at FROM order_events WHERE order_id = ? AND kind = 'status' ORDER BY id").bind(o.id).all<{ to_status: OrderStatus; created_at: string }>();
  return c.json({
    orderNo: o.order_no, status: o.status, statusLabel: STATUS_LABELS[o.status as OrderStatus], totalPaisa: o.total_paisa, courier: o.courier, trackingId: o.tracking_id,
    etaText: o.eta_text, timeline: events.results.map(e => ({ status: e.to_status, label: STATUS_LABELS[e.to_status], at: e.created_at })),
  });
});

api.post('/notify', async c => {
  if (!(await rateLimit(c.env.KV, `notify:${clientIp(c)}`, 20, 3600))) throw new HttpError(429, 'Too many requests.');
  const body = await readJson(c);
  const phone = normalizeBdPhone(str(body.phone));
  const productId = posInt(body.productId);
  if (!phone || !productId) throw bad('Enter a Bangladeshi mobile number like 01712345678.');
  const p = await c.env.DB.prepare('SELECT id FROM products WHERE id = ? AND deleted_at IS NULL').bind(productId).first();
  if (!p) throw notFound();
  await c.env.DB.prepare(
    "INSERT INTO notify_requests (product_id, phone, channel) VALUES (?, ?, ?) ON CONFLICT(product_id, phone) DO UPDATE SET status = 'waiting', channel = excluded.channel",
  ).bind(productId, phone, body.channel === 'whatsapp' ? 'whatsapp' : 'sms').run();
  return c.json({ ok: true, message: 'Done! We will text you when it is back in season.' });
});

api.post('/wholesale-inquiry', async c => {
  if (!(await rateLimit(c.env.KV, `ws:${clientIp(c)}`, 5, 3600))) throw new HttpError(429, 'Too many requests.');
  const body = await readJson(c);
  const phone = normalizeBdPhone(str(body.phone));
  const name = str(body.name, 120);
  if (!phone || name.length < 2) throw bad('Enter your name and a Bangladeshi mobile number.');
  await c.env.DB.prepare('INSERT INTO wholesale_inquiries (name, phone, business, district, message) VALUES (?, ?, ?, ?, ?)')
    .bind(name, phone, str(body.business, 120) || null, str(body.district, 60) || null, str(body.message, 1000) || null).run();
  return c.json({ ok: true, message: 'Thank you! Our wholesale team will call you within one working day.' });
});
