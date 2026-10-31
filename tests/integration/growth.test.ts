/**
 * Marketing tools: coupons (checkout and order), landing pages (builder, public page with the order form, stats),
 * reviews (customer form, verified buyers, approval, reply, Google rating) and the sales report.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from './env';

let t: TestEnv;
const ids: Record<string, number> = {};
let ip = 0;
let productSlug = '';

beforeAll(async () => {
  t = await createTestEnv();
  const one = async (sql: string, ...p: unknown[]) => (await t.sql<{ id: number }>(sql, ...p))[0].id;
  ids.division = await one("SELECT id FROM geo_divisions WHERE name = 'Dhaka'");
  ids.gazipur = await one("SELECT id FROM geo_districts WHERE name = 'Gazipur'");
  ids.upazila = await one('SELECT id FROM geo_upazilas WHERE district_id = ? ORDER BY id LIMIT 1', ids.gazipur);
  ids.variant = await one("SELECT pv.id FROM product_variants pv JOIN products p ON p.id = pv.product_id WHERE p.status = 'published' AND pv.stock > 20 AND pv.is_active = 1 AND pv.price_paisa BETWEEN 20000 AND 200000 ORDER BY pv.id LIMIT 1");
  ids.product = await one('SELECT product_id AS id FROM product_variants WHERE id = ?', ids.variant);
  productSlug = (await t.sql<{ slug: string }>('SELECT slug FROM products WHERE id = ?', ids.product))[0].slug;
});
afterAll(async () => { await t?.dispose(); });

const address = { divisionId: () => ids.division, districtId: () => ids.gazipur, upazilaId: () => ids.upazila };
async function place(phone: string, extra: Record<string, unknown> = {}, qty = 1) {
  const s = await t.checkoutSession();
  return t.json('/api/checkout/place', {
    method: 'POST', headers: { cookie: s.cookie, 'cf-connecting-ip': `10.7.1.${++ip}` },
    body: { phone, name: 'Shirin Akter', paymentMethod: 'cod', lines: [{ variantId: ids.variant, qty }], token: s.token, divisionId: address.divisionId(), districtId: address.districtId(), upazilaId: address.upazilaId(), addressLine: 'House 3, Road 8, Tongi', ...extra },
  });
}
const quote = (body: Record<string, unknown>) => t.json('/api/checkout/quote', { method: 'POST', headers: { 'cf-connecting-ip': `10.7.2.${++ip}` }, body: { lines: [{ variantId: ids.variant, qty: 1 }], districtId: ids.gazipur, upazilaId: ids.upazila, paymentMethod: 'cod', ...body } });

describe('coupons', () => {
  it('the owner makes coupons; broken ones are refused in plain words', async () => {
    expect((await t.adminJson('/coupons', 'POST', { code: 'x', kind: 'percent', value: 10 })).body.error).toMatch(/3 to 30 letters/);
    expect((await t.adminJson('/coupons', 'POST', { code: 'BIG', kind: 'percent', value: 95 })).body.error).toMatch(/1 to 90/);
    expect((await t.adminJson('/coupons', 'POST', { code: 'late', kind: 'fixed', value: 10000, startsOn: '2026-12-10', endsOn: '2026-12-01' })).body.error).toMatch(/end date is before/);
    expect((await t.adminJson('/coupons', 'POST', { code: 'winter20', kind: 'percent', value: 20, maxDiscountPaisa: 5000, perPhoneLimit: 1 })).status).toBe(201);
    expect((await t.adminJson('/coupons', 'POST', { code: 'WINTER20', kind: 'fixed', value: 10000 })).body.error).toMatch(/already used/);
    expect((await t.adminJson('/coupons', 'POST', { code: 'BIGORDER', kind: 'fixed', value: 10000, minSubtotalPaisa: 9_999_900 })).status).toBe(201);
    expect((await t.adminJson('/coupons', 'POST', { code: 'FREEDEL', kind: 'free_delivery', usageLimit: 1 })).status).toBe(201);
    expect((await t.adminJson('/coupons', 'POST', { code: 'OLD', kind: 'fixed', value: 10000, startsOn: '2025-01-01', endsOn: '2025-01-31' })).status).toBe(201);
  });

  it('the checkout quote shows the discount, or why the code does not work', async () => {
    const base = (await quote({})).body;
    const pct = (await quote({ couponCode: ' winter20 ' })).body;
    expect(pct.coupon).toMatchObject({ code: 'WINTER20', label: '20% off' });
    expect(pct.coupon.discountPaisa).toBe(Math.min(5000, Math.floor(base.subtotalPaisa * 0.2)));
    expect(pct.totalPaisa).toBe(base.totalPaisa - pct.coupon.discountPaisa);
    const free = (await quote({ couponCode: 'FREEDEL' })).body;
    expect(free.coupon.discountPaisa).toBe(base.delivery.chargePaisa);
    expect(free.totalPaisa).toBe(base.subtotalPaisa + base.delivery.codFeePaisa);
    expect((await quote({ couponCode: 'BIGORDER' })).body.couponError).toMatch(/at least/);
    expect((await quote({ couponCode: 'OLD' })).body.couponError).toMatch(/expired/);
    expect((await quote({ couponCode: 'NOPE' })).body.couponError).toMatch(/not a valid coupon/);
  });

  it('an order keeps the coupon, counts its use, and the per-customer limit holds', async () => {
    const r = await place('01911000101', { couponCode: 'WINTER20' });
    expect(r.status).toBe(201);
    const [o] = await t.sql<{ coupon_code: string; discount_paisa: number }>('SELECT coupon_code, discount_paisa FROM orders WHERE id = ?', r.body.orderId);
    expect(o.coupon_code).toBe('WINTER20');
    expect(o.discount_paisa).toBeGreaterThan(0);
    expect((await t.sql('SELECT discount_paisa FROM coupon_redemptions WHERE order_id = ?', r.body.orderId))[0]).toEqual({ discount_paisa: o.discount_paisa });
    // The same number again: refused (and the quote says so before ordering).
    expect((await quote({ couponCode: 'WINTER20', phone: '01911000101' })).body.couponError).toMatch(/already used/);
    const again = await place('01911000101', { couponCode: 'WINTER20' });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already used this coupon/);
    // Free delivery for one order only.
    expect((await place('01911000102', { couponCode: 'FREEDEL' })).status).toBe(201);
    expect((await place('01911000103', { couponCode: 'FREEDEL' })).body.error).toMatch(/used up/);
    const list = (await t.adminJson('/coupons')).body as Array<{ code: string; used_count: number; orders: number; discount_paisa: number }>;
    expect(list.find(c => c.code === 'WINTER20')).toMatchObject({ used_count: 1, orders: 1, discount_paisa: o.discount_paisa });
  });

  it('a used coupon is switched off instead of deleted', async () => {
    const list = (await t.adminJson('/coupons')).body as Array<{ id: number; code: string }>;
    const used = list.find(c => c.code === 'WINTER20')!;
    expect((await t.adminJson(`/coupons/${used.id}`, 'DELETE')).body.switchedOff).toBe(true);
    expect((await quote({ couponCode: 'WINTER20' })).body.couponError).toMatch(/not a valid/);
    const unused = list.find(c => c.code === 'BIGORDER')!;
    expect((await t.adminJson(`/coupons/${unused.id}`, 'DELETE')).body.switchedOff).toBeUndefined();
  });
});

let landingId = 0;
describe('landing pages', () => {
  it('the owner builds a page; only real photos and YouTube links get in', async () => {
    expect((await t.adminJson('/landing-pages', 'POST', { title: 'Gur offer', content: {} })).body.error).toMatch(/Choose the product/);
    expect((await t.adminJson('/landing-pages', 'POST', { title: 'Gur offer', productId: ids.product, content: { video: { url: 'https://vimeo.com/1' } } })).body.error).toMatch(/YouTube/);
    expect((await t.adminJson('/landing-pages', 'POST', { title: 'Gur offer', productId: ids.product, status: 'published', content: {} })).body.error).toMatch(/headline/);
    await t.adminJson('/coupons', 'POST', { code: 'LP100', kind: 'fixed', value: 10000 });
    const r = await t.adminJson('/landing-pages', 'POST', {
      title: 'Winter gur offer', slug: 'Winter Gur Offer!', productId: ids.product, status: 'draft',
      content: {
        badge: 'আজকের অফার', headline: 'খাঁটি খেজুর গুড়', subheadline: 'যশোরের গাছ থেকে', heroImage: 'javascript:alert(1)', gallery: ['/media/lp/a.webp', 'http://evil.test/x.png', '/media/lp/b.webp'],
        description: 'প্রথম অনুচ্ছেদ।\n\nদ্বিতীয় অনুচ্ছেদ।', points: ['১০০% খাঁটি', 'ভেজাল নেই'], details: [{ label: 'ওজন', value: '১ কেজি' }, { label: '', value: 'x' }],
        video: { title: 'কীভাবে তৈরি হয়', url: 'https://youtu.be/dQw4w9WgXcQ', description: 'দেখুন' },
        reviews: [{ name: 'Karim', place: 'Dhaka', rating: 5, text: 'অসাধারণ স্বাদ' }], faq: [{ q: 'টাকা কখন দেব?', a: 'পণ্য হাতে পেয়ে।' }],
        ctaText: 'অর্ডার করুন', couponCode: 'lp100', regularPricePaisa: 9_999_900, accent: 'leaf',
      },
    });
    expect(r.status).toBe(201);
    expect(r.body.slug).toBe('winter-gur-offer');
    landingId = r.body.id;
    const saved = (await t.adminJson(`/landing-pages/${landingId}`)).body;
    expect(saved.content.heroImage).toBeNull();
    expect(saved.content.gallery).toEqual(['/media/lp/a.webp', '/media/lp/b.webp']);
    expect(saved.content.details).toEqual([{ label: 'ওজন', value: '১ কেজি' }]);
    expect(saved.content.couponCode).toBe('LP100');
    expect((await t.adminJson('/landing-pages', 'POST', { title: 'Another', slug: 'winter-gur-offer', productId: ids.product, content: {} })).body.error).toMatch(/already uses the address/);
  });

  it('a draft opens only for signed-in staff; once published everyone sees every section', async () => {
    expect((await t.fetch('/lp/winter-gur-offer')).status).toBe(404);
    const preview = await t.fetch('/lp/winter-gur-offer', { headers: { cookie: t.admin.cookie } });
    expect(preview.status).toBe(200);
    expect(await preview.text()).toContain('this page is a draft');
    const pageNow = await t.adminJson(`/landing-pages/${landingId}`);
    expect((await t.adminJson(`/landing-pages/${landingId}`, 'PUT', { title: pageNow.body.title, slug: pageNow.body.slug, productId: ids.product, status: 'published', content: pageNow.body.content })).status).toBe(200);
    const res = await t.fetch('/lp/winter-gur-offer');
    expect(res.status).toBe(200);
    const html = await res.text();
    for (const s of ['আজকের অফার', 'খাঁটি খেজুর গুড়', 'দ্বিতীয় অনুচ্ছেদ।', '১০০% খাঁটি', 'ওজন', 'কীভাবে তৈরি হয়', 'data-youtube="dQw4w9WgXcQ"', 'অসাধারণ স্বাদ', 'টাকা কখন দেব?', 'id="checkout-form"', 'name="couponCode" value="LP100"', 'href="#order"', 'data-lp-sticky', '/css/landing.css', 'lp-page lp-focus', 'accent-leaf']) expect(html).toContain(s);
    expect(html.match(/data-lp-cta/g)!.length).toBeGreaterThanOrEqual(4);
    expect(html).toMatch(/"landingPageId":\d+/);
    expect(res.headers.get('cache-tag')).toContain(`lp-${landingId}`);
  });

  it('orders from the page are marked with it, use its coupon, and the page counts visits', async () => {
    const r = await place('01911000201', { landingPageId: landingId, couponCode: 'LP100' });
    expect(r.status).toBe(201);
    const [o] = await t.sql<Record<string, unknown>>('SELECT source, source_detail, landing_page_id, coupon_code, discount_paisa FROM orders WHERE id = ?', r.body.orderId);
    expect(o).toMatchObject({ source: 'landing', landing_page_id: landingId, coupon_code: 'LP100', discount_paisa: 10000 });
    expect(String(o.source_detail)).toContain('/lp/winter-gur-offer');
    for (let i = 0; i < 2; i++) await t.fetch(`/api/lp/${landingId}/view`, { method: 'POST', headers: { 'cf-connecting-ip': `10.7.3.${i}` } });
    const row = ((await t.adminJson('/landing-pages')).body as Array<Record<string, unknown>>).find(x => x.id === landingId)!;
    expect(row).toMatchObject({ views: 2, orders: 1, status: 'published' });
  });

  it('copies and deletes pages', async () => {
    const copy = await t.adminJson(`/landing-pages/${landingId}/copy`, 'POST', {});
    expect(copy.body.slug).toBe('winter-gur-offer-copy');
    expect((await t.adminJson(`/landing-pages/${copy.body.id}`)).body.status).toBe('draft');
    expect((await t.adminJson(`/landing-pages/${copy.body.id}`, 'DELETE')).status).toBe(200);
    expect((await t.fetch('/lp/winter-gur-offer-copy', { headers: { cookie: t.admin.cookie } })).status).toBe(404);
  });
});

describe('reviews', () => {
  let buyerOrder = 0;
  it('customers review from the product page; buyers are marked verified', async () => {
    const r = await place('01911000301');
    buyerOrder = r.body.orderId;
    await t.adminJson(`/orders/${buyerOrder}/call`, 'POST', { outcome: 'confirmed' });
    for (const step of [{ to: 'confirmed' }, { to: 'packed' }, { to: 'in_courier', courier: 'own_delivery' }, { to: 'delivered' }]) expect((await t.adminJson(`/orders/${buyerOrder}/status`, 'POST', step)).status).toBe(200);
    const send = (b: Record<string, unknown>) => t.json('/api/reviews', { method: 'POST', headers: { 'cf-connecting-ip': `10.7.4.${++ip}` }, body: { productId: ids.product, name: 'Shirin', rating: 5, body: 'Excellent quality, fast delivery.', phone: '01911000301', ...b } });
    expect((await send({ rating: 9 })).body.error).toMatch(/1 to 5/);
    expect((await send({ phone: '123' })).body.error).toMatch(/mobile number/);
    const ok = await send({});
    expect(ok.status).toBe(201);
    expect(ok.body.live).toBe(false);
    expect((await send({})).body.error).toMatch(/already reviewed/);
    expect((await send({ phone: '01911000399', name: 'Rana', rating: 3, body: 'It was fine.' })).status).toBe(201);
    const waiting = (await t.adminJson('/reviews?status=pending')).body;
    expect(waiting.reviews.map((x: { name: string; verified: number; phone: string }) => [x.name, x.verified, x.phone])).toEqual([['Rana', 0, '019XXXXX399'], ['Shirin', 1, '019XXXXX301']]);
    expect((await t.adminJson('/dashboard')).body.attention.map((a: { text: string }) => a.text).join(' ')).toMatch(/2 customer review\(s\) waiting/);
  });

  it('published reviews show on the product page with the rating, the reply and Google stars', async () => {
    const waiting = (await t.adminJson('/reviews?status=pending')).body.reviews as Array<{ id: number; name: string }>;
    const shirin = waiting.find(r => r.name === 'Shirin')!;
    expect((await t.adminJson(`/reviews/${shirin.id}/status`, 'POST', { status: 'approved' })).status).toBe(200);
    await t.adminJson(`/reviews/${shirin.id}/reply`, 'POST', { reply: 'Thank you, Shirin!' });
    await t.adminJson(`/reviews/${waiting.find(r => r.name === 'Rana')!.id}/status`, 'POST', { status: 'rejected' });
    expect((await t.adminJson('/reviews', 'POST', { productId: ids.product, name: 'Facebook customer', rating: 4, body: 'Ordered twice already.' })).status).toBe(201);
    const html = await (await t.fetch(`/p/${productSlug}`)).text();
    expect(html).toContain('Customer reviews');
    expect(html).toContain('Excellent quality, fast delivery.');
    expect(html).toContain('✓ Verified buyer');
    expect(html).toContain('Thank you, Shirin!');
    expect(html).toContain('Ordered twice already.');
    expect(html).not.toContain('It was fine.');
    expect(html).toContain('"aggregateRating":{"@type":"AggregateRating","ratingValue":4.5,"reviewCount":2');
    expect(html).toContain('data-review-form');
  });

  it('verified buyers can be published at once, and the form can be switched off', async () => {
    await t.adminJson('/reviews/settings', 'PUT', { enabled: true, autoPublishVerified: true });
    const r2 = await place('01911000302');
    await t.adminJson(`/orders/${r2.body.orderId}/call`, 'POST', { outcome: 'confirmed' });
    for (const step of [{ to: 'confirmed' }, { to: 'packed' }, { to: 'in_courier', courier: 'own_delivery' }, { to: 'delivered' }]) await t.adminJson(`/orders/${r2.body.orderId}/status`, 'POST', step);
    const live = await t.json('/api/reviews', { method: 'POST', headers: { 'cf-connecting-ip': '10.7.5.1' }, body: { productId: ids.product, name: 'Nila', rating: 5, body: 'Second order, still great.', phone: '01911000302' } });
    expect(live.body).toMatchObject({ live: true });
    await t.adminJson('/reviews/settings', 'PUT', { enabled: false, autoPublishVerified: false });
    expect((await t.json('/api/reviews', { method: 'POST', headers: { 'cf-connecting-ip': '10.7.5.2' }, body: { productId: ids.product, name: 'X', rating: 5, body: 'Hello there', phone: '01911000303' } })).body.error).toMatch(/switched off/);
    expect(await (await t.fetch(`/p/${productSlug}`)).text()).not.toContain('data-review-form');
    await t.adminJson('/reviews/settings', 'PUT', { enabled: true, autoPublishVerified: false });
  });
});

describe('sales report', () => {
  it('adds up the dates in Bangladesh time, with products, channels, landing pages and coupons', async () => {
    const today = new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10);
    expect((await t.adminJson(`/reports/sales?from=${today}&to=2020-01-01`)).body.error).toMatch(/before the start/);
    const r = await t.adminJson(`/reports/sales?from=${today}&to=${today}`);
    expect(r.status).toBe(200);
    const kept = await t.sql<{ n: number; s: number }>("SELECT COUNT(*) AS n, SUM(total_paisa) AS s FROM orders WHERE status != 'cancelled' AND is_test = 0");
    expect(r.body.totals).toMatchObject({ kept: kept[0].n, sales_paisa: kept[0].s });
    expect(r.body.totals.delivered).toBe(2);
    expect(r.body.products[0]).toMatchObject({ product_id: ids.product });
    expect(r.body.withCost).toBe(true);
    expect(r.body.sources.map((x: { name: string }) => x.name)).toEqual(expect.arrayContaining(['web', 'landing']));
    expect(r.body.landingPages[0]).toMatchObject({ id: landingId, orders: 1 });
    expect(r.body.coupons.map((x: { name: string }) => x.name)).toEqual(expect.arrayContaining(['WINTER20', 'LP100', 'FREEDEL']));
    expect(r.body.couriers.find((x: { name: string }) => x.name === 'own_delivery').delivered).toBe(2);
  });
});
