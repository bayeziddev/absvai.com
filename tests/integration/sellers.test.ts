/**
 * Marketplace: a seller registers, can't sign in until the owner approves them, adds a product in their own portal,
 * the owner approves the product and it goes live with "Sold by"; the seller sees its sales. Sellers can only ever
 * touch their own products, and a seller session never opens the admin.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from './env';

let t: TestEnv;
const ids: Record<string, number> = {};
const ORIGIN = 'https://absvai.test';

beforeAll(async () => {
  t = await createTestEnv();
  const one = async (sql: string, ...p: unknown[]) => (await t.sql<{ id: number }>(sql, ...p))[0].id;
  ids.accessories = await one("SELECT id FROM categories WHERE slug = 'accessories'");
  ids.division = await one("SELECT id FROM geo_divisions WHERE name = 'Dhaka'");
  ids.tangail = await one("SELECT id FROM geo_districts WHERE name = 'Tangail'");
  ids.kalihati = await one("SELECT id FROM geo_upazilas WHERE name = 'Kalihati'");
});
afterAll(async () => { await t?.dispose(); });

const register = (over: Record<string, unknown> = {}) => t.json('/api/seller/register', {
  method: 'POST', headers: { 'cf-connecting-ip': `10.8.0.${Math.floor(Math.random() * 250)}` },
  body: { shopName: 'Jashore Gur House', ownerName: 'Rafiq Hasan', phone: '01712340001', email: 'rafiq@gurhouse.test', password: 'gur-house-2026', district: 'Jashore', sells: 'Khejur gur', payoutMethod: 'bkash', payoutNumber: '01712340001', ...over },
});

async function signIn(email: string, password: string) {
  const r = await t.fetch('/api/seller/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ email, password }) });
  const body = (await r.json()) as { csrf?: string; error?: string; seller?: { id: number } };
  const cookie = r.headers.getSetCookie().map(c => c.split(';')[0]).find(c => c.startsWith('__Host-absvai_seller=')) ?? '';
  const call = async (path: string, method = 'GET', b?: unknown) => {
    const res = await t.fetch(`/api/seller${path}`, { method, headers: { cookie, 'x-csrf-token': body.csrf ?? '', origin: ORIGIN, ...(b === undefined ? {} : { 'content-type': 'application/json' }) }, body: b === undefined ? undefined : JSON.stringify(b) });
    const text = await res.text();
    let json: any = text;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: json };
  };
  return { status: r.status, body, cookie, call };
}

let seller: Awaited<ReturnType<typeof signIn>>;
let sellerId = 0;
let productId = 0;

describe('step 1: registration and approval', () => {
  it('takes an application and refuses broken ones', async () => {
    expect((await register({ password: 'short' })).body.error).toMatch(/Password/);
    expect((await register({ phone: '12345' })).body.error).toMatch(/mobile number/);
    expect((await register({ website: 'http://spam' })).status).toBe(400);
    const r = await register();
    expect(r.status).toBe(201);
    expect((await register()).body.error).toMatch(/already exists/);
    [{ id: sellerId }] = await t.sql<{ id: number }>("SELECT id FROM sellers WHERE email = 'rafiq@gurhouse.test'");
    expect((await t.adminJson('/dashboard')).body.attention.map((a: { text: string }) => a.text).join(' ')).toMatch(/1 seller application/);
  });

  it('cannot sign in until the owner approves', async () => {
    const r = await signIn('rafiq@gurhouse.test', 'gur-house-2026');
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/waiting for approval/);
    expect((await signIn('rafiq@gurhouse.test', 'wrong-password-1')).status).toBe(401);
  });

  it('the owner approves the seller with a commission', async () => {
    expect((await t.adminJson(`/sellers/${sellerId}/review`, 'POST', { action: 'reject' })).body.error).toMatch(/Write why/);
    expect((await t.adminJson(`/sellers/${sellerId}/review`, 'POST', { action: 'approve', commissionPercent: 15 })).status).toBe(200);
    seller = await signIn('rafiq@gurhouse.test', 'gur-house-2026');
    expect(seller.status).toBe(200);
    expect((await seller.call('/me')).body.seller).toMatchObject({ shopName: 'Jashore Gur House', commissionPercent: 15, status: 'approved' });
  });
});

describe('step 2: seller products need the owner’s approval', () => {
  it('a seller adds a product and sends it for approval', async () => {
    const created = await seller.call('/products', 'POST', { categoryId: ids.accessories, name: 'Palm Leaf Hand Fan' });
    expect(created.status).toBe(201);
    productId = created.body.id;
    const form = await seller.call(`/products/${productId}`);
    expect(form.body.product.seller_id).toBe(sellerId);
    expect(form.body.variants.every((v: { costPaisa?: number }) => v.costPaisa === undefined)).toBe(true);
    const notReady = await seller.call(`/products/${productId}/submit`, 'POST', {});
    expect(notReady.status).toBe(409);
    // A photo, the required details, a price, stock and parcel weight.
    const fd = new FormData();
    fd.append('file', new File([new Uint8Array(400).fill(3)], 'fan.webp', { type: 'image/webp' }));
    fd.append('productId', String(productId)); fd.append('kind', 'image');
    const up = await t.fetch('/api/seller/media', { method: 'POST', body: fd, headers: { cookie: seller.cookie, 'x-csrf-token': seller.body.csrf!, origin: ORIGIN } });
    expect(up.status).toBe(201);
    const saved = await seller.call(`/products/${productId}`, 'PUT', {
      name: 'Palm Leaf Hand Fan', shortDescription: 'Hand-woven in Jashore.', description: 'A light fan woven from palm leaves.',
      specs: { material: 'Palm leaf', dimensions: '30 × 25' }, variants: [{ attributes: {}, pricePaisa: 25000, stock: 40, packedWeightGrams: 150 }],
      showOnHome: true, isOriginal: true, freeDelivery: true,
    });
    expect(saved.status).toBe(200);
    // Sellers can't put their product on the homepage, mark it an Abs Vai Original or give free delivery.
    expect((await t.sql('SELECT show_on_home, is_original, free_delivery, status FROM products WHERE id = ?', productId))[0]).toEqual({ show_on_home: 0, is_original: 0, free_delivery: 0, status: 'draft' });
    const sent = await seller.call(`/products/${productId}/submit`, 'POST', {});
    expect(sent.status).toBe(200);
    expect((await t.adminJson('/seller-products')).body.map((p: { id: number }) => p.id)).toContain(productId);
  });

  it('keeps sellers to their own products and out of the admin', async () => {
    await register({ shopName: 'Other Seller', email: 'other@seller.test', phone: '01712340002' });
    const [{ id: other }] = await t.sql<{ id: number }>("SELECT id FROM sellers WHERE email = 'other@seller.test'");
    await t.adminJson(`/sellers/${other}/review`, 'POST', { action: 'approve' });
    const two = await signIn('other@seller.test', 'gur-house-2026');
    expect((await two.call(`/products/${productId}`)).status).toBe(404);
    expect((await two.call(`/products/${productId}`, 'PUT', { name: 'Stolen' })).status).toBe(404);
    expect((await two.call(`/products/${productId}/stock`, 'PUT', { variants: [] })).status).toBe(404);
    expect((await two.call('/products')).body).toEqual([]);
    const [shopProduct] = await t.sql<{ id: number }>("SELECT id FROM products WHERE seller_id IS NULL AND status = 'published' LIMIT 1");
    expect((await two.call(`/products/${shopProduct.id}`)).status).toBe(404);
    // A seller cookie never opens the admin API, and a missing CSRF token is refused.
    expect((await t.fetch('/api/admin/dashboard', { headers: { cookie: two.cookie } })).status).toBe(401);
    expect((await t.fetch('/api/seller/products', { method: 'POST', headers: { cookie: two.cookie, 'content-type': 'application/json', origin: ORIGIN }, body: '{}' })).status).toBe(403);
  });

  it('the owner approves it: it goes live with "Sold by" and on the seller’s store page', async () => {
    expect((await t.adminJson(`/seller-products/${productId}/approve`, 'POST', {})).body.status).toBe('published');
    const [{ slug }] = await t.sql<{ slug: string }>('SELECT slug FROM products WHERE id = ?', productId);
    const page = await (await t.fetch(`/p/${slug}`)).text();
    expect(page).toMatch(/Sold by <a href="\/store\/jashore-gur-house">Jashore Gur House<\/a>/);
    expect(await (await t.fetch('/store/jashore-gur-house')).text()).toContain('Palm Leaf Hand Fan');
    expect((await t.fetch('/store/other-seller-does-not-exist')).status).toBe(404);
  });

  it('price and stock changes stay live; other changes go back for approval', async () => {
    const form = await seller.call(`/products/${productId}`);
    const v = form.body.variants[0];
    expect((await seller.call(`/products/${productId}/stock`, 'PUT', { variants: [{ id: v.id, pricePaisa: 23000, stock: 35 }] })).status).toBe(200);
    expect((await t.sql('SELECT p.status, pv.price_paisa, pv.stock FROM products p JOIN product_variants pv ON pv.product_id = p.id WHERE p.id = ?', productId))[0]).toEqual({ status: 'published', price_paisa: 23000, stock: 35 });
    const edit = await seller.call(`/products/${productId}`, 'PUT', { ...form.body.product, name: 'Palm Leaf Hand Fan (large)', shortDescription: 'Hand-woven in Jashore.', description: 'Bigger.', specs: form.body.specs, variants: [{ id: v.id, attributes: {}, pricePaisa: 23000, stock: 35, packedWeightGrams: 150 }] });
    expect(edit.body.message).toMatch(/hidden until the shop approves/);
    expect((await t.sql('SELECT status, review_status FROM products WHERE id = ?', productId))[0]).toEqual({ status: 'draft', review_status: 'pending' });
    // The owner sends it back with a note; then approves the fixed version.
    await t.adminJson(`/seller-products/${productId}/reject`, 'POST', { note: 'Please add a photo of the fan in use.' });
    expect((await seller.call('/products')).body[0]).toMatchObject({ review_status: 'rejected', review_note: 'Please add a photo of the fan in use.' });
    await seller.call(`/products/${productId}/submit`, 'POST', {});
    expect((await t.adminJson(`/seller-products/${productId}/approve`, 'POST', {})).status).toBe(200);
  });

  it('shows the seller their sales and earnings after commission', async () => {
    const [variant] = await t.sql<{ id: number }>('SELECT id FROM product_variants WHERE product_id = ?', productId);
    const s = await t.checkoutSession();
    const r = await t.json('/api/checkout/place', {
      method: 'POST', headers: { cookie: s.cookie, 'cf-connecting-ip': '10.8.9.9' },
      body: { phone: '01799900001', name: 'Mitu', paymentMethod: 'cod', lines: [{ variantId: variant.id, qty: 2 }], token: s.token, divisionId: ids.division, districtId: ids.tangail, upazilaId: ids.kalihati, addressLine: 'House 9, Station Road' },
    });
    expect(r.status).toBe(201);
    const orders = await seller.call('/orders');
    expect(orders.body[0]).toMatchObject({ order_no: r.body.orderNo, qty: 2, line_total_paisa: 46000, district_name: 'Tangail' });
    expect(JSON.stringify(orders.body)).not.toContain('01799900001');
    const sum = await seller.call('/summary');
    expect(sum.body).toMatchObject({ live: 1, unitsMonth: 2, salesMonthPaisa: 46000, onTheWayPaisa: 39100, commissionPercent: 15 });
  });

  it('pausing a seller signs them out and takes their products off the shop', async () => {
    expect((await t.adminJson(`/sellers/${sellerId}/review`, 'POST', { action: 'suspend', note: 'Stock check' })).status).toBe(200);
    expect((await t.sql('SELECT status FROM products WHERE id = ?', productId))[0].status).toBe('draft');
    expect((await seller.call('/me')).status).toBe(401);
    expect((await signIn('rafiq@gurhouse.test', 'gur-house-2026')).body.error).toMatch(/paused/);
  });
});
