/**
 * Seller portal API (/api/seller). Two steps: a seller registers on /sell, the owner approves them in Admin → Sellers,
 * then they sign in at /seller/ and add their products. Each product goes live only after the owner approves it.
 *
 * Sellers have their own sign-in (separate cookie and sessions from staff) and can only ever see or change their own
 * products. Product saving uses exactly the same code as the admin (SKUs, stock held by orders, the publish
 * checklist), after this file limits what a seller may change: no cost price, homepage, seasons, free delivery or
 * shipping profile. Price and stock changes go live at once; other changes on a live product send it back for approval.
 */
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from '../env';
import { hashPassword, passwordProblem, randomToken, verifyPassword } from '../lib/auth';
import { bad, clientIp, forbidden, HttpError, notFound, posInt, rateLimit, readJson, slugify, str } from '../lib/http';
import { localPhone, normalizeBdPhone } from '../lib/phone';
import * as cat from '../repo/catalog-admin';
import { loadSettings, settingInt } from '../repo/settings';
import {
  assignProductSeller, createSeller, productSeller, sellerByEmail, sellerById, sellerOrderLines, sellerProducts, sellerSalesTotals, sellerSlugTaken, setReview,
  setSellerPassword, touchSellerLogin, updateSellerProfile, type SellerRow,
} from '../repo/sellers';
import { ownerAlert, validEmail } from '../services/email';
import { createProduct, deleteMediaItem, loadAdminProduct, reorderProductMedia, unpublishProduct, updateProduct, uploadMedia } from './admin-catalog';

export const seller = new Hono<AppEnv>();

export const SELLER_COOKIE = '__Host-absvai_seller';
const SELLER_TTL = 60 * 60 * 24 * 7;
interface SellerSession { sellerId: number; csrf: string }

const PAYOUT = ['bkash', 'nagad', 'rocket', 'bank'];
const STATUS_TEXT: Record<string, string> = {
  pending: 'Your application is waiting for approval. We will email you (and call if needed) once it is approved.',
  rejected: 'Your application was not approved.',
  suspended: 'Your seller account is paused. Please contact the shop.',
};

function sellerView(s: SellerRow) {
  return {
    id: s.id, shopName: s.shop_name, slug: s.slug, ownerName: s.owner_name, email: s.email, phone: localPhone(s.phone), district: s.district, address: s.address,
    businessType: s.business_type, sells: s.sells, about: s.about, payoutMethod: s.payout_method, payoutNumber: s.payout_number, status: s.status,
    reviewNote: s.review_note, commissionPercent: Number(s.commission_percent),
  };
}

// ───────────── Registration and sign-in (no session needed) ─────────────

/** Step 1: the seller applies. The account can't sign in until the owner approves it. */
seller.post('/register', async c => {
  if (!(await rateLimit(c.env.KV, `seller-reg:${clientIp(c)}`, 5, 3600))) throw new HttpError(429, 'Too many applications from this connection. Try again later.');
  const b = await readJson(c);
  if (str(b.website, 200)) throw bad('Please check your details and try again.'); // honeypot
  const s = await loadSettings(c.env.DB);
  if (s.sellers_open === '0') throw forbidden('Seller applications are closed right now.');
  const shopName = str(b.shopName, 80);
  const ownerName = str(b.ownerName, 100);
  const email = str(b.email, 120).toLowerCase();
  const phone = normalizeBdPhone(str(b.phone, 20));
  const password = str(b.password, 200);
  if (shopName.length < 2) throw bad('Type your shop or business name.');
  if (ownerName.length < 2) throw bad('Type your name.');
  if (!validEmail(email)) throw bad('Type a valid email address. You will sign in with it.');
  if (!phone) throw bad('Type a Bangladeshi mobile number like 01712345678.');
  const pw = passwordProblem(password);
  if (pw) throw bad(`Password: ${pw}`);
  if (await sellerByEmail(c.env.DB, email)) throw bad('A seller with this email already exists. Sign in at /seller/ instead.');
  const payout = PAYOUT.includes(str(b.payoutMethod)) ? str(b.payoutMethod) : null;
  let slug = slugify(shopName) || 'seller';
  for (let i = 2; await sellerSlugTaken(c.env.DB, slug); i++) slug = `${slugify(shopName) || 'seller'}-${i}`;
  const id = await createSeller(c.env.DB, {
    shopName, slug, ownerName, email, phone, passwordHash: await hashPassword(password), district: str(b.district, 60) || null, address: str(b.address, 300) || null,
    businessType: str(b.businessType, 60) || null, sells: str(b.sells, 500) || null, payoutMethod: payout, payoutNumber: str(b.payoutNumber, 40) || null,
    commission: settingInt(s, 'seller_commission_percent', 10),
  });
  await ownerAlert(c.env, 'seller application', [['Shop', shopName], ['Name', ownerName], ['Phone', localPhone(phone)], ['Email', email], ['District', str(b.district, 60)], ['Sells', str(b.sells, 500)]].filter(([, v]) => v) as Array<[string, string]>, `#/sellers?id=${id}`);
  return c.json({ ok: true, message: 'Thank you! Your application is sent. When the shop approves it, you can sign in and add your products.' }, 201);
});

seller.post('/login', async c => {
  const b = await readJson(c);
  const email = str(b.email, 120).toLowerCase();
  if (!(await rateLimit(c.env.KV, `seller-login:${clientIp(c)}`, 10, 900)) || !(await rateLimit(c.env.KV, `seller-login:${email}`, 8, 900))) throw new HttpError(429, 'Too many sign-in attempts. Wait 15 minutes and try again.');
  const s = await sellerByEmail(c.env.DB, email);
  const ok = s ? await verifyPassword(str(b.password, 200), s.password_hash) : (await hashPassword('timing-equaliser'), false);
  if (!s || !ok) throw new HttpError(401, 'Email or password is not right.');
  if (s.status !== 'approved') throw new HttpError(403, `${STATUS_TEXT[s.status] ?? 'Your account cannot sign in.'}${s.status === 'rejected' && s.review_note ? ` Reason: ${s.review_note}` : ''}`, { status: s.status });
  const token = randomToken();
  const session: SellerSession = { sellerId: s.id, csrf: randomToken(16) };
  await c.env.KV.put(`ssess:${token}`, JSON.stringify(session), { expirationTtl: SELLER_TTL });
  setCookie(c, SELLER_COOKIE, token, { path: '/', httpOnly: true, secure: true, sameSite: 'Strict', maxAge: SELLER_TTL });
  await touchSellerLogin(c.env.DB, s.id);
  return c.json({ ok: true, csrf: session.csrf, seller: sellerView(s) });
});

seller.post('/logout', async c => {
  const token = getCookie(c, SELLER_COOKIE);
  if (token) await c.env.KV.delete(`ssess:${token}`);
  deleteCookie(c, SELLER_COOKIE, { path: '/', secure: true });
  return c.json({ ok: true });
});

// ───────────── Everything below needs an approved seller ─────────────

seller.use('*', async (c, next) => {
  const token = getCookie(c, SELLER_COOKIE);
  const session = token ? await c.env.KV.get<SellerSession>(`ssess:${token}`, 'json') : null;
  if (!session) throw new HttpError(401, 'Please sign in.');
  const s = await sellerById(c.env.DB, session.sellerId);
  // A seller paused by the owner is signed out at once.
  if (!s || s.status !== 'approved') { if (token) await c.env.KV.delete(`ssess:${token}`); throw new HttpError(401, s ? STATUS_TEXT[s.status] ?? 'Please sign in.' : 'Please sign in.'); }
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const origin = c.req.header('origin');
    if (origin && new URL(origin).host !== new URL(c.req.url).host) throw forbidden('Cross-site request blocked.');
    if (c.req.header('x-csrf-token') !== session.csrf) throw forbidden('Your session expired. Reload the page.');
  }
  // The shared product code records who did what: "seller:<id>" in the audit log and stock history.
  c.set('session', { adminId: `seller:${s.id}`, role: 'seller', name: s.shop_name, email: s.email, csrf: session.csrf });
  c.set('sellerId', s.id);
  await next();
});

const me = (c: Context<AppEnv>) => c.var.sellerId!;

seller.get('/me', async c => {
  const token = getCookie(c, SELLER_COOKIE);
  const session = await c.env.KV.get<SellerSession>(`ssess:${token}`, 'json');
  return c.json({ seller: sellerView((await sellerById(c.env.DB, me(c)))!), csrf: session?.csrf });
});

seller.put('/profile', async c => {
  const b = await readJson(c);
  const phone = normalizeBdPhone(str(b.phone, 20));
  if (!phone) throw bad('Type a Bangladeshi mobile number like 01712345678.');
  await updateSellerProfile(c.env.DB, me(c), {
    phone, district: str(b.district, 60) || null, address: str(b.address, 300) || null, about: str(b.about, 600) || null,
    payoutMethod: PAYOUT.includes(str(b.payoutMethod)) ? str(b.payoutMethod) : null, payoutNumber: str(b.payoutNumber, 40) || null,
  });
  return c.json({ ok: true, seller: sellerView((await sellerById(c.env.DB, me(c)))!) });
});

seller.put('/password', async c => {
  const b = await readJson(c);
  const s = await sellerByEmail(c.env.DB, c.var.session.email);
  if (!s || !(await verifyPassword(str(b.current, 200), s.password_hash))) throw bad('Your current password is not right.');
  const pw = passwordProblem(str(b.next, 200));
  if (pw) throw bad(pw);
  await setSellerPassword(c.env.DB, s.id, await hashPassword(str(b.next, 200)));
  return c.json({ ok: true });
});

/** Overview: products by state, this month's sales and what the seller will be paid (after commission). */
seller.get('/summary', async c => {
  const s = (await sellerById(c.env.DB, me(c)))!;
  const products = await sellerProducts(c.env.DB, s.id);
  const monthStart = `${new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 8)}01T00:00:00+06:00`;
  const t = await sellerSalesTotals(c.env.DB, s.id, new Date(Date.parse(monthStart)).toISOString());
  const keep = (paisa: number) => Math.round((paisa * (100 - Number(s.commission_percent))) / 100);
  return c.json({
    live: products.filter(p => p.status === 'published').length, waiting: products.filter(p => p.review_status === 'pending').length,
    changesNeeded: products.filter(p => p.review_status === 'rejected').length, drafts: products.filter(p => p.status === 'draft' && !p.review_status).length,
    salesMonthPaisa: t.salesMonthPaisa, unitsMonth: t.unitsMonth, commissionPercent: Number(s.commission_percent),
    earnedPaisa: keep(t.deliveredPaisa), onTheWayPaisa: keep(t.openPaisa),
  });
});

seller.get('/orders', async c => c.json(await sellerOrderLines(c.env.DB, me(c))));

// ───────────── Products ─────────────

/** Categories a seller can list in, with the kind of form each uses. */
seller.get('/categories', async c => {
  const rows = await cat.categoryRows(c.env.DB);
  return c.json(rows.map(r => ({ id: r.id, name: r.name, parentId: r.parent_id })));
});
seller.get('/attribute-types', async c => c.json(await cat.listAttributeTypes(c.env.DB)));
seller.get('/products', async c => c.json(await sellerProducts(c.env.DB, me(c))));

/** Loads a product only if it belongs to this seller (otherwise "not found", never "forbidden"). */
async function ownProduct(c: Context<AppEnv>, id: number) {
  const p = await productSeller(c.env.DB, id);
  if (!p || p.seller_id !== me(c)) throw notFound('Product not found.');
  return p;
}

function forSeller(d: Awaited<ReturnType<typeof loadAdminProduct>>) {
  const p = d.product as Record<string, unknown>;
  return { ...d, product: { ...p, cost_paisa: undefined }, review: { status: p.review_status ?? null, note: p.review_note ?? null }, variants: d.variants.map(v => ({ ...v, costPaisa: undefined })) };
}

seller.post('/products', async c => {
  const b = await readJson(c);
  const s = (await sellerById(c.env.DB, me(c)))!;
  const id = await createProduct(c, { categoryId: b.categoryId, name: b.name, isOriginal: false });
  await assignProductSeller(c.env.DB, id, s.id, s.shop_name);
  return c.json({ id }, 201);
});

seller.get('/products/:id', async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  await ownProduct(c, id);
  return c.json(forSeller(await loadAdminProduct(c, id)));
});

/** The full current form of a product, so a seller's save only changes what sellers may change. */
function currentForm(d: Awaited<ReturnType<typeof loadAdminProduct>>) {
  const pr = d.product as Record<string, unknown>;
  return {
    categoryId: pr.category_id, name: pr.name, slug: pr.slug, code: pr.code, shortDescription: pr.short_description ?? '', description: pr.description ?? '', brand: pr.brand ?? '',
    isOriginal: false, showOnHome: Boolean(pr.show_on_home), benefitChips: pr.benefit_chips ?? [], specs: { ...d.specs }, promotedSpecKeys: pr.promoted_spec_keys ?? [], seasonIds: d.seasonIds,
    fulfilmentMode: pr.fulfilment_mode, preorderDispatchDate: pr.preorder_dispatch_date ?? '', preorderAdvanceType: pr.preorder_advance_type ?? 'delivery_charge', preorderAdvancePaisa: pr.preorder_advance_paisa,
    madeToOrderLeadDays: pr.made_to_order_lead_days, shippingProfile: pr.shipping_profile, bulkyDeliveryMode: pr.bulky_delivery_mode, freeDelivery: Boolean(pr.free_delivery), videoUrl: pr.video_url ?? '',
    sizeChart: pr.size_chart ?? null, metaTitle: pr.meta_title ?? '', metaDescription: pr.meta_description ?? '', searchKeywords: pr.search_keywords ?? '',
    variants: d.variants.filter(v => v.isActive).map(v => ({ ...v })),
  };
}

type SellerVariant = { id?: number | null; attributes?: Record<string, string>; pricePaisa?: number; compareAtPricePaisa?: number | null; stock?: number; packedWeightGrams?: number };

/** Saves the product's details. On a live product this sends it back for the owner's approval. */
seller.put('/products/:id', async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const own = await ownProduct(c, id);
  const b = await readJson(c);
  const base = currentForm(await loadAdminProduct(c, id));
  const old = new Map(base.variants.map(v => [v.id, v]));
  const variants = (Array.isArray(b.variants) ? (b.variants as SellerVariant[]) : []).slice(0, 60).map(v => {
    const before = v.id ? old.get(Number(v.id)) : undefined;
    if (v.id && !before) throw bad('An option belongs to another product. Reload the page.');
    return { ...(before ?? { sku: '', isActive: true }), id: before?.id ?? null, attributes: v.attributes ?? before?.attributes ?? {}, pricePaisa: v.pricePaisa, compareAtPricePaisa: v.compareAtPricePaisa ?? null, stock: v.stock, packedWeightGrams: v.packedWeightGrams, costPaisa: null };
  });
  const fulfil = ['in_stock', 'made_to_order'].includes(String(b.fulfilmentMode)) ? String(b.fulfilmentMode) : base.fulfilmentMode;
  const body = {
    ...base,
    categoryId: own.status === 'draft' ? (posInt(b.categoryId) ?? base.categoryId) : base.categoryId,
    name: str(b.name, 160) || base.name, shortDescription: str(b.shortDescription, 300), description: str(b.description, 10000), brand: str(b.brand, 80) || base.brand,
    benefitChips: Array.isArray(b.benefitChips) ? b.benefitChips : base.benefitChips, specs: b.specs && typeof b.specs === 'object' ? b.specs : base.specs,
    fulfilmentMode: fulfil, madeToOrderLeadDays: fulfil === 'made_to_order' ? posInt(b.madeToOrderLeadDays) : base.madeToOrderLeadDays,
    videoUrl: str(b.videoUrl, 300), sizeChart: b.sizeChart ?? base.sizeChart, searchKeywords: str(b.searchKeywords, 300), variants,
  };
  // Sellers only change their own product content; the shop decides homepage, seasons, delivery and SEO.
  if (own.status === 'published' || own.status === 'scheduled') {
    // A live product must keep its checklist; check by saving first, then take it off the shop until it is re-approved.
    const saved = await updateProduct(c, id, body);
    await unpublishProduct(c, id);
    await setReview(c.env.DB, id, 'pending', null);
    await ownerAlert(c.env, 'seller product change to approve', [['Seller', c.var.session.name], ['Product', String(saved.product.name)]], '#/sellers?tab=products');
    return c.json({ ...forSeller(await loadAdminProduct(c, id)), message: 'Saved. The product is hidden until the shop approves the change.' });
  }
  const saved = await updateProduct(c, id, body);
  return c.json({ ...forSeller(saved), message: 'Saved.' });
});

/** Price and stock only: live at once, no new approval needed. */
seller.put('/products/:id/stock', async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  await ownProduct(c, id);
  const b = await readJson(c);
  const base = currentForm(await loadAdminProduct(c, id));
  const changes = new Map((Array.isArray(b.variants) ? (b.variants as SellerVariant[]) : []).map(v => [Number(v.id), v]));
  const variants = base.variants.map(v => {
    const ch = changes.get(Number(v.id));
    return ch ? { ...v, pricePaisa: ch.pricePaisa ?? v.pricePaisa, compareAtPricePaisa: ch.compareAtPricePaisa === undefined ? v.compareAtPricePaisa : ch.compareAtPricePaisa, stock: ch.stock ?? v.stock } : v;
  });
  return c.json({ ...forSeller(await updateProduct(c, id, { ...base, variants })), message: 'Price and stock saved.' });
});

/** Sends a finished product to the owner for approval. */
seller.post('/products/:id/submit', async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const own = await ownProduct(c, id);
  if (own.status === 'published') throw bad('This product is already live.');
  const d = await loadAdminProduct(c, id);
  if (!d.checklist.ready) throw new HttpError(409, `Not ready yet: ${d.checklist.items.find(i => !i.ok)!.message}`, { checklist: d.checklist });
  await setReview(c.env.DB, id, 'pending', null);
  await ownerAlert(c.env, 'seller product to approve', [['Seller', c.var.session.name], ['Product', String(d.product.name)]], '#/sellers?tab=products');
  return c.json({ ok: true, message: 'Sent for approval. You will see it here when the shop approves it.' });
});

seller.delete('/products/:id', async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const own = await ownProduct(c, id);
  if (own.status !== 'draft') throw bad('Live products can’t be deleted here. Set the stock to 0, or ask the shop to remove it.');
  await cat.trashProduct(c.env.DB, id);
  return c.json({ ok: true });
});

seller.post('/media', async c => {
  const form = await c.req.formData();
  await ownProduct(c, posInt(form.get('productId')) ?? 0);
  if (String(form.get('kind') ?? 'image') !== 'image') throw bad('Upload product photos only.');
  return c.json(await uploadMedia(c, form), 201);
});

seller.delete('/products/:id/media/:mediaId', async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  await ownProduct(c, id);
  await deleteMediaItem(c, posInt(c.req.param('mediaId')) ?? 0, id);
  return c.json({ ok: true });
});

seller.put('/products/:id/media-order', async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  await ownProduct(c, id);
  await reorderProductMedia(c, id, (await readJson(c)).ids);
  return c.json({ ok: true });
});
