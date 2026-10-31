/** Public JSON API used by the storefront scripts. Prices, stock and delivery charges are always computed here. */
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../env';
import { GEO_VERSION } from '../generated/geo-version';
import { bad, clientIp, int, notFound, posInt, rateLimit, readJson, str, HttpError } from '../lib/http';
import { asciiDigits, maskPhone, normalizeBdPhone } from '../lib/phone';
import { expandQuery } from '../lib/search';
import { effectiveVariantAttributes } from '../lib/templates';
import { activeSeasonIds, getProductDetail, getSeasons, liveProducts, productExists, queryProducts, suggestCategories, synonymGroups, type ProductQuery } from '../repo/catalog';
import { settingInt } from '../repo/settings';
import { smallOf } from '../lib/images';
import { askModel, builtInShopReply, cleanTurns, shopFacts, shopSystemPrompt } from '../services/assistant';
import { geoHierarchy, postcodeMap, unionsOf } from '../repo/geo';
import { sessionStatus } from '../repo/incomplete';
import { addNotifyRequest, addWholesaleInquiry } from '../repo/misc';
import { customerByPhone, orderByNo, submitAdvance } from '../repo/orders';
import { priceCart, sanitizeLines } from '../services/cart';
import { quote } from '../services/checkout';
import { recordAttempt } from '../services/fraud';
import { captureIncomplete, checkCheckoutToken, issueCheckoutToken, MIN_FILL_SECONDS, newSessionId } from '../services/incomplete';
import { issueOtp, placeOrder, verifyOtp } from '../services/orders';
import { otpActive } from '../services/sms';
import { inquiryEmail } from '../services/email';
import { trackOrders } from '../services/tracking';
import { addLandingView, landingById } from '../repo/landing';
import { addReview, deliveredPurchase, reviewExists } from '../repo/reviews';
import { purge } from '../services/cache';
import { TAG } from '../lib/cache-tags';
import { checkoutSessionId, ensureDeviceId, limiterKeys, requestIdentity, setCheckoutSession, settingsOf } from './context';

export const api = new Hono<AppEnv>();

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
      id: v.id, sku: v.sku, attributes: v.attributes, pricePaisa: v.pricePaisa, compareAtPricePaisa: v.compareAtPricePaisa, stock: v.available,
      netValue: v.netValue, netUnit: v.netUnit, imageIds: v.imageIds, wholesaleTiers: v.wholesaleTiers, availability: d.availabilityByVariant[v.id],
    })),
    media: d.media.filter(m => m.kind === 'image'),
    availability: d.availability,
  });
});

/**
 * Live price and stock for edge-cached pages (Section 2.2). Served through the cached Storefront entrypoint for 15 s,
 * so a busy product page costs one database read per edge location every 15 seconds.
 */
api.get('/live', async c => {
  const ids = [...new Set((c.req.query('ids') ?? '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0))].sort((a, b) => a - b).slice(0, 60);
  const data = await liveProducts(c.env.DB, ids);
  return c.json({ products: data, at: new Date().toISOString() }, 200, { 'Cache-Control': 'public, max-age=10', 'CDN-Cache-Control': 'public, max-age=15' });
});

api.get('/search/suggest', async c => {
  const q = c.req.query('q') ?? '';
  if (q.trim().length < 2) return c.json({ products: [], categories: [] });
  if (!(await rateLimit(c.env.KV, limiterKeys(c, 'suggest').ip, 300, 60))) throw new HttpError(429, 'Too many searches. Please slow down.');
  const terms = expandQuery(q, await synonymGroups(c.env.DB));
  const [products, cats] = await Promise.all([queryProducts(c.env.DB, { terms, limit: 6, sort: 'best_selling' }), suggestCategories(c.env.DB, terms)]);
  return c.json({ products: products.items.map(p => ({ slug: p.slug, name: p.name, image: p.image, pricePaisa: p.pricePaisa, keySpecs: p.keySpecs })), categories: cats });
});

/**
 * Shop assistant (the chat popup): answers from the shop's own products and rules, on Workers AI when it is
 * available and within the daily limit, otherwise with the built-in answers. Nothing is stored.
 */
api.post('/assistant', async c => {
  if (!(await rateLimit(c.env.KV, limiterKeys(c, 'assist').ip, 20, 600))) throw new HttpError(429, 'You are sending messages very fast. Please wait a minute, or WhatsApp us.');
  const turns = cleanTurns((await readJson(c)).messages);
  if (!turns.length) throw bad('Type your question.');
  const settings = await settingsOf(c);
  const seasons = await getSeasons(c.env.DB);
  const live = activeSeasonIds(seasons);
  const question = turns[turns.length - 1].content;
  const facts = await shopFacts(c.env.DB, settings, question, seasons.find(s => live.includes(s.id))?.name ?? null);
  const ai = await askModel(c.env, shopSystemPrompt(facts), turns, { budgetKey: 'shop', dailyLimit: settingInt(settings, 'assistant_daily_limit', 300) });
  const reply = ai ?? builtInShopReply(question, facts, settings);
  // Product cards under the answer: the ones it mentions (all matches for the built-in answer).
  const shown = facts.products.filter(p => !ai || reply.includes(`/p/${p.slug}`)).slice(0, 3);
  return c.json({ reply, ai: Boolean(ai), products: shown.map(p => ({ slug: p.slug, name: p.name, image: smallOf(p.image), pricePaisa: p.pricePaisa })) }, 200, { 'Cache-Control': 'private, no-store' });
});

api.post('/cart/price', async c => {
  const body = await readJson(c);
  return c.json(await priceCart(c.env.DB, sanitizeLines(body.lines)));
});

// ───────────── Geo data (versioned, cache forever) ─────────────

async function geoVersion(c: Context<AppEnv>): Promise<string> {
  const s = await settingsOf(c);
  return `${GEO_VERSION}-${s.geo_postcode_version ?? '1'}`;
}

const IMMUTABLE = { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=31536000, immutable' };

api.get('/geo/version', async c => c.json({ version: await geoVersion(c) }, 200, { 'Cache-Control': 'no-store' }));

api.get('/geo/:version/hierarchy.json', async c => {
  const version = await geoVersion(c);
  if (c.req.param('version') !== version) return c.redirect(`/api/geo/${version}/hierarchy.json`, 302);
  const key = `geo:hierarchy:${version}`;
  let body = await c.env.KV.get(key);
  if (!body) {
    body = JSON.stringify(await geoHierarchy(c.env.DB));
    await c.env.KV.put(key, body, { expirationTtl: 60 * 60 * 24 * 30 });
  }
  return c.body(body, 200, IMMUTABLE);
});

api.get('/geo/:version/postcodes.json', async c => {
  const version = await geoVersion(c);
  if (c.req.param('version') !== version) return c.redirect(`/api/geo/${version}/postcodes.json`, 302);
  const key = `geo:postcodes:${version}`;
  let body = await c.env.KV.get(key);
  if (!body) {
    body = JSON.stringify(await postcodeMap(c.env.DB));
    await c.env.KV.put(key, body, { expirationTtl: 60 * 60 * 24 * 30 });
  }
  return c.body(body, 200, IMMUTABLE);
});

api.get('/geo/:version/unions/:upazilaId', async c => {
  const id = posInt(c.req.param('upazilaId').replace(/\.json$/, ''));
  if (!id) throw bad('Bad area.');
  return c.json(await unionsOf(c.env.DB, id), 200, { 'Cache-Control': IMMUTABLE['Cache-Control'] });
});

// ───────────── Checkout ─────────────

async function verifyTurnstile(c: Context<AppEnv>, token: string): Promise<boolean> {
  if (!c.env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  const form = new FormData();
  form.append('secret', c.env.TURNSTILE_SECRET);
  form.append('response', token);
  form.append('remoteip', clientIp(c));
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  return Boolean(((await r.json()) as { success?: boolean }).success);
}

/**
 * Called once when checkout (or a landing-page order form) opens, after an invisible Turnstile check. Sets the
 * HttpOnly checkout-session and device cookies and returns a short-lived signed token for capture and placement.
 */
api.post('/checkout/session', async c => {
  const keys = limiterKeys(c, 'session');
  if (!(await rateLimit(c.env.KV, keys.ip, 60, 600))) throw new HttpError(429, 'Too many requests. Please wait a minute.');
  const body = await readJson(c);
  if (!(await verifyTurnstile(c, str(body.turnstileToken, 2048)))) {
    await recordAttempt(c.env, { layer: 'bot', action: 'blocked', route: '/api/checkout/session', reason: 'Turnstile check failed', ...(await requestIdentity(c)) });
    throw new HttpError(403, 'Please complete the "I am human" check.');
  }
  ensureDeviceId(c);
  let sid = checkoutSessionId(c);
  // A finished checkout starts a fresh session, so the next order gets its own incomplete-order row.
  if (!sid || (await sessionStatus(c.env.DB, sid)) === 'converted') { sid = newSessionId(); setCheckoutSession(c, sid); }
  return c.json(await issueCheckoutToken(c.env, sid), 200, { 'Cache-Control': 'private, no-store' });
});

/**
 * Incomplete-order capture: debounced while the customer types, plus a final navigator.sendBeacon snapshot on
 * pagehide. Beacons send text/plain, so the body is parsed by hand. One row per session, never one per keystroke.
 */
api.post('/checkout/capture', async c => {
  const keys = limiterKeys(c, 'capture');
  if (!(await rateLimit(c.env.KV, keys.device, 120, 600)) || !(await rateLimit(c.env.KV, keys.ip, 1200, 600))) return c.json({ ok: false }, 429);
  let body: Record<string, unknown>;
  try { body = JSON.parse(await c.req.text()) as Record<string, unknown>; } catch { throw bad('Send the details as JSON.'); }
  const sid = checkoutSessionId(c);
  if (!(await checkCheckoutToken(c.env, str(body.token, 1024), sid))) {
    await recordAttempt(c.env, { layer: 'token', action: 'blocked', route: '/api/checkout/capture', reason: 'Missing or invalid checkout token', ...(await requestIdentity(c)) });
    throw new HttpError(401, 'Your checkout session expired. Reload the page.');
  }
  const r = await captureIncomplete(c.env, sid!, await requestIdentity(c), body as never);
  return c.json({ ok: true, saved: r.saved });
});

api.post('/checkout/quote', async c => {
  const body = await readJson(c);
  const phone = normalizeBdPhone(str(body.phone));
  let customerIsNewOrRisky = true;
  if (phone) {
    const cust = await customerByPhone(c.env.DB, phone);
    customerIsNewOrRisky = !cust || cust.delivered_count === 0 || cust.returned_count > 0;
  }
  return c.json(await quote(c.env.DB, await settingsOf(c), {
    lines: sanitizeLines(body.lines), districtId: posInt(body.districtId), upazilaId: posInt(body.upazilaId),
    paymentMethod: body.paymentMethod === 'manual_mobile' ? 'manual_mobile' : 'cod', customerIsNewOrRisky,
    couponCode: str(body.couponCode, 30) || null, phone,
  }));
});

api.post('/checkout/place', async c => {
  const keys = limiterKeys(c, 'place');
  if (!(await rateLimit(c.env.KV, keys.device, 8, 600)) || !(await rateLimit(c.env.KV, keys.ip, 60, 600))) {
    throw new HttpError(429, 'Too many orders from this device. Please wait a few minutes or call us.');
  }
  const body = await readJson(c);
  const id = await requestIdentity(c);
  const sid = checkoutSessionId(c);
  const token = await checkCheckoutToken(c.env, str(body.token, 1024), sid);
  if (!token) {
    await recordAttempt(c.env, { layer: 'token', action: 'blocked', route: '/api/checkout/place', reason: 'Missing or invalid checkout token', ...id });
    throw new HttpError(401, 'Your checkout session expired. Reload the page and try again.');
  }
  // Honeypot field and timing check: bots fill hidden fields and submit instantly. Rejected without saying why.
  const tooFast = Date.now() / 1000 - token.iat < MIN_FILL_SECONDS;
  if (str(body.website, 200) || tooFast) {
    await recordAttempt(c.env, { layer: tooFast ? 'bot' : 'honeypot', action: 'silently_rejected', route: '/api/checkout/place', reason: tooFast ? 'Submitted faster than a person could fill the form' : 'Hidden field was filled in', phoneHint: normalizeBdPhone(str(body.phone)) ? maskPhone(normalizeBdPhone(str(body.phone))!) : null, ...id });
    throw bad('Please check your details and try again.');
  }
  const utm: Record<string, string> = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid']) {
    const v = str((body.utm as Record<string, unknown> | undefined)?.[k], 200);
    if (v) utm[k] = v;
  }
  const landingId = posInt(body.landingPageId);
  const landing = landingId ? await landingById(c.env.DB, landingId) : null;
  const placed = await placeOrder(c.env, await settingsOf(c), {
    phone: str(body.phone, 20), name: str(body.name, 120),
    divisionId: int(body.divisionId) ?? 0, districtId: int(body.districtId) ?? 0, upazilaId: int(body.upazilaId) ?? 0, unionId: posInt(body.unionId),
    postcode: asciiDigits(str(body.postcode, 4)) || null, addressLine: str(body.addressLine, 300), landmark: str(body.landmark, 200) || null, note: str(body.note, 500) || null,
    paymentMethod: body.paymentMethod === 'manual_mobile' ? 'manual_mobile' : 'cod',
    advanceTrxId: str(body.advanceTrxId, 40) || null, advanceWallet: str(body.advanceWallet, 20) || null,
    lines: sanitizeLines(body.lines), source: landing ? 'landing' : 'web', sourceDetail: landing ? `Landing page: ${landing.title} (/lp/${landing.slug})` : null, utm,
    email: str(body.email, 120) || null, emailOffers: body.emailOffers === true,
    couponCode: str(body.couponCode, 30) || null, landingPageId: landing?.id ?? null,
  }, { channel: 'web', identity: id, checkoutSessionId: sid, route: '/api/checkout/place' });
  return c.json(placed, 201);
});

// ───────────── Order self-service ─────────────

async function orderByToken(c: Context<AppEnv>, orderNo: string, token: string) {
  const o = await orderByNo(c.env.DB, orderNo);
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
  const settings = await settingsOf(c);
  if (!otpActive(c.env, settings)) return c.json({ ok: false, message: 'We will call you to confirm your order.' }, 409);
  const r = await issueOtp(c.env, settings, { orderId: Number(o.id), orderNo: String(o.order_no), phone: String(o.phone), identity: await requestIdentity(c), route: '/api/orders/otp/resend' });
  return c.json({ ok: r.sent, message: r.message }, r.sent ? 200 : 429);
});

api.post('/orders/:orderNo/advance', async c => {
  const body = await readJson(c);
  const o = await orderByToken(c, c.req.param('orderNo'), str(body.t, 64));
  const trx = str(body.trxId, 40);
  if (!/^[A-Za-z0-9]{6,30}$/.test(trx)) throw bad('Enter the transaction ID exactly as it appears in the SMS from your wallet.');
  if (!o.advance_required || !['pending', 'submitted'].includes(String(o.advance_status))) throw bad('No advance is due on this order.');
  await submitAdvance(c.env.DB, Number(o.id), trx, str(body.wallet, 20) || 'mobile', Number(o.advance_amount_paisa ?? 0));
  return c.json({ ok: true, message: 'Thank you. We will check the payment and confirm your order.' });
});

api.post('/orders/track', async c => {
  if (!(await rateLimit(c.env.KV, limiterKeys(c, 'track').ip, 20, 600))) throw new HttpError(429, 'Too many lookups. Please try again in a few minutes.');
  const body = await readJson(c);
  const r = await trackOrders(c.env, { q: str(body.query ?? body.q, 60), phone: str(body.phone, 30), orderNo: str(body.orderNo, 40) });
  // The first order's main facts stay at the top level for older callers.
  const first = r.orders[0];
  return c.json({
    by: r.by, orders: r.orders,
    orderNo: first.orderNo, status: first.status, statusLabel: first.statusLabel, totalPaisa: first.totalPaisa, courier: first.courier, trackingId: first.trackingCode,
    etaText: first.eta, timeline: first.steps,
  });
});

// ───────────── Reviews and landing page views ─────────────

/**
 * A customer's review. One per product per mobile number; "Verified buyer" when that number received the product.
 * Reviews wait for the shop's approval (verified buyers' reviews can go live at once: Admin → Reviews).
 */
api.post('/reviews', async c => {
  if (!(await rateLimit(c.env.KV, limiterKeys(c, 'review').ip, 6, 3600))) throw new HttpError(429, 'Too many reviews from this connection. Please try again later.');
  const body = await readJson(c);
  if (str(body.website, 100)) throw bad('Please check your review and try again.'); // honeypot
  const settings = await settingsOf(c);
  if (settings.reviews_enabled === '0') throw bad('Reviews are switched off right now.');
  const productId = posInt(body.productId);
  if (!productId || !(await productExists(c.env.DB, productId))) throw notFound('Product not found.');
  const phone = normalizeBdPhone(str(body.phone, 20));
  if (!phone) throw bad('Type the mobile number you ordered with (it is not shown).');
  const name = str(body.name, 60);
  const rating = int(body.rating) ?? 0;
  const text = str(body.body, 1000);
  if (name.length < 2) throw bad('Type your name.');
  if (!(rating >= 1 && rating <= 5)) throw bad('Choose 1 to 5 stars.');
  if (text.length < 5) throw bad('Write a few words about the product.');
  if (await reviewExists(c.env.DB, productId, phone)) throw bad('You have already reviewed this product. Thank you!');
  const orderId = await deliveredPurchase(c.env.DB, productId, phone);
  const live = Boolean(orderId) && settings.reviews_auto_publish_verified === '1';
  const id = (await requestIdentity(c));
  await addReview(c.env.DB, { productId, name, rating, body: text, phone, verified: Boolean(orderId), status: live ? 'approved' : 'pending', source: 'customer', ipHash: id.ipHash, orderId });
  if (live) {
    let ctx: ExecutionContext | undefined;
    try { ctx = c.executionCtx as unknown as ExecutionContext; } catch { ctx = undefined; }
    await purge(c.env, ctx, [TAG.product(productId)]);
  }
  return c.json({ ok: true, live, message: live ? 'Thank you! Your review is live.' : 'Thank you! Your review shows on the page after the shop checks it.' }, 201);
});

/** Counts a landing page visit (sent once per visit by the page; pages themselves are cached at the edge). */
api.post('/lp/:id/view', async c => {
  const id = posInt(c.req.param('id'));
  if (id && (await rateLimit(c.env.KV, `lpv:${id}:${limiterKeys(c, 'lpv').ip}`, 3, 3600))) await addLandingView(c.env.DB, id);
  return c.body(null, 204);
});

api.post('/notify', async c => {
  if (!(await rateLimit(c.env.KV, limiterKeys(c, 'notify').ip, 20, 3600))) throw new HttpError(429, 'Too many requests.');
  const body = await readJson(c);
  const phone = normalizeBdPhone(str(body.phone));
  const productId = posInt(body.productId);
  if (!phone || !productId) throw bad('Enter a Bangladeshi mobile number like 01712345678.');
  if (!(await productExists(c.env.DB, productId))) throw notFound();
  await addNotifyRequest(c.env.DB, productId, phone, body.channel === 'whatsapp' ? 'whatsapp' : 'sms');
  return c.json({ ok: true, message: 'Done! We will text you when it is back in season.' });
});

api.post('/wholesale-inquiry', async c => {
  if (!(await rateLimit(c.env.KV, limiterKeys(c, 'ws').ip, 5, 3600))) throw new HttpError(429, 'Too many requests.');
  const body = await readJson(c);
  const phone = normalizeBdPhone(str(body.phone));
  const name = str(body.name, 120);
  if (!phone || name.length < 2) throw bad('Enter your name and a Bangladeshi mobile number.');
  await addWholesaleInquiry(c.env.DB, { name, phone, business: str(body.business, 120) || null, district: str(body.district, 60) || null, message: str(body.message, 1000) || null });
  await inquiryEmail(c.env, 'wholesale inquiry', [['Name', name], ['Phone', `0${phone.slice(3)}`], ['Business', str(body.business, 120)], ['District', str(body.district, 60)], ['Message', str(body.message, 1000)]].filter(([, v]) => v) as Array<[string, string]>);
  return c.json({ ok: true, message: 'Thank you! Our wholesale team will call you within one working day.' });
});
