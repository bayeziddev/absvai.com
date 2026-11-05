/**
 * The simple Bangla checkout: the customer picks a delivery area (each shows its charge, the total follows) and types the
 * address in Bangla or English; the server reads the district out of it for the dashboard map. Also the owner's tools
 * that go with it: delivery areas the owner names and prices, the one-table price and stock update, and the shop's name.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { guessArea } from '../../worker/src/lib/area-guess';
import { geoNames } from '../../worker/src/repo/geo';
import { createTestEnv, type TestEnv } from './env';

let t: TestEnv;
beforeAll(async () => { t = await createTestEnv(); });
afterAll(async () => { await t?.dispose(); });

const variant = async (sku: string) => (await t.sql<{ id: number }>('SELECT id FROM product_variants WHERE sku = ?', sku))[0].id;
const zoneId = async (name: string) => (await t.sql<{ id: number }>('SELECT id FROM delivery_zones WHERE name = ?', name))[0].id;
let ip = 0;
async function place(body: Record<string, unknown>) {
  const s = await t.checkoutSession();
  return t.json('/api/checkout/place', {
    method: 'POST',
    headers: { 'cf-connecting-ip': `10.9.0.${++ip}`, cookie: s.cookie },
    body: { phone: `0181${String(ip).padStart(7, '0')}`, name: 'রহিম উদ্দিন', paymentMethod: 'cod', token: s.token, ...body },
  });
}

describe('reading the district out of a typed address', () => {
  it('understands Bangla and English, thana names, Dhaka city areas and other spellings', async () => {
    const geo = await geoNames(t.env.DB);
    expect(guessArea('বাসা ১২, পাংশা, রাজবাড়ী', geo)).toMatchObject({ district: 'Rajbari', upazila: 'Pangsa' });
    expect(guessArea('House 12, Road 5, Mirpur 10, Dhaka', geo)).toMatchObject({ district: 'Dhaka' });
    expect(guessArea('মিরপুর ১০', geo)).toMatchObject({ district: 'Dhaka' });
    expect(guessArea('Agrabad, Chittagong', geo)).toMatchObject({ district: 'Chattogram' });
    expect(guessArea('Kalihati bazar, Tangail', geo)).toMatchObject({ district: 'Tangail', upazila: 'Kalihati' });
    expect(guessArea('near the big mosque', geo)).toBeNull();
    // Nothing named: the chosen delivery area's only district fills in.
    const tangail = geo.districts.find(d => d.name === 'Tangail')!.id;
    expect(guessArea('near the big mosque', geo, { districtIds: [tangail] })).toMatchObject({ district: 'Tangail', upazila: null });
  });
});

describe('checkout by delivery area', () => {
  it('starts with Bangla area names and delivery times', async () => {
    const zones = await t.sql<{ name: string; eta_text: string }>('SELECT name, eta_text FROM delivery_zones ORDER BY sort_order, id');
    expect(zones).toEqual([
      { name: 'ঢাকা সিটির ভিতরে', eta_text: '১–২ দিন' },
      { name: 'ঢাকার আশেপাশে (সাভার, গাজীপুর, নারায়ণগঞ্জ)', eta_text: '২–৩ দিন' },
      { name: 'ঢাকার বাইরে', eta_text: '৩–৫ দিন' },
    ]);
  });

  it('prices every area for the cart and adds the chosen one to the total', async () => {
    const lines = [{ variantId: await variant('SPC-MMSL-250G-0001'), qty: 1 }];
    const outside = await zoneId('ঢাকার বাইরে');
    const q = (await t.json('/api/checkout/quote', { method: 'POST', body: { lines, zoneId: outside, withAreas: true, paymentMethod: 'cod' } })).body;
    expect(q.areas.map((a: { name: string; chargePaisa: number }) => [a.name, a.chargePaisa])).toEqual([
      ['ঢাকা সিটির ভিতরে', 7000], ['ঢাকার আশেপাশে (সাভার, গাজীপুর, নারায়ণগঞ্জ)', 10000], ['ঢাকার বাইরে', 13000],
    ]);
    expect(q.delivery).toMatchObject({ zoneName: 'ঢাকার বাইরে', chargePaisa: 13000 });
    expect(q.totalPaisa).toBe(q.subtotalPaisa + 13000);
    // No area chosen yet: every charge still shows, the total waits.
    const none = (await t.json('/api/checkout/quote', { method: 'POST', body: { lines, withAreas: true, paymentMethod: 'cod' } })).body;
    expect(none.delivery).toBeNull();
    expect(none.totalPaisa).toBeNull();
    expect(none.areas).toHaveLength(3);
  });

  it('places an order with only an area and a typed address, and files it under the district named', async () => {
    const lines = [{ variantId: await variant('SPC-MMSL-250G-0001'), qty: 1 }];
    const outside = await zoneId('ঢাকার বাইরে');
    const r = await place({ lines, zoneId: outside, addressLine: 'বাসা ১২, পাংশা, রাজবাড়ী' });
    expect(r.status).toBe(201);
    const [o] = await t.sql<Record<string, unknown>>('SELECT district_id, upazila_id, district_name, upazila_name, address_line, delivery_charge_paisa FROM orders WHERE id = ?', r.body.orderId);
    expect(o).toMatchObject({ district_name: 'Rajbari', upazila_name: 'Pangsa', address_line: 'বাসা ১২, পাংশা, রাজবাড়ী', delivery_charge_paisa: 13000 });
    // An address that names no place still goes through; the map just cannot place it.
    const r2 = await place({ lines, zoneId: outside, addressLine: 'Near the big mosque, main road' });
    expect(r2.status).toBe(201);
    const [o2] = await t.sql<Record<string, unknown>>('SELECT district_id, district_name FROM orders WHERE id = ?', r2.body.orderId);
    expect(o2).toMatchObject({ district_id: 0, district_name: '' });
    // No area, or a made-up one: a clear message.
    expect((await place({ lines, addressLine: 'House 1, Road 2, Pangsha, Rajbari' })).body.error).toBe('Choose your delivery area.');
    expect((await place({ lines, zoneId: 999, addressLine: 'House 1, Road 2, Pangsha, Rajbari' })).body.error).toBe('Choose your delivery area.');
  });

  it('shows where customers are on the dashboard: by district and by delivery area', async () => {
    const ch = (await t.adminJson('/dashboard')).body.charts;
    expect(ch.places.find((p: { district: string }) => p.district === 'Rajbari')).toMatchObject({ orders: 1, id: expect.any(Number) });
    expect(ch.areas.find((a: { area: string }) => a.area === 'ঢাকার বাইরে')).toMatchObject({ orders: 2, unplaced: 1 });
  });
});

describe('delivery areas the owner names and prices', () => {
  it('adds an area with its own charge, links a district to it, renames it and removes it', async () => {
    const add = await t.adminJson('/zones', 'POST', { name: 'রাজবাড়ী', baseChargePaisa: 7000, extraPerKgPaisa: 2000, bulkyChargePaisa: 50000, etaText: '২–৩ দিন' });
    expect(add.status).toBe(201);
    const id = add.body.id as number;
    expect(id).toBeGreaterThan(0);
    const rajbari = (await t.sql<{ id: number }>("SELECT id FROM geo_districts WHERE name = 'Rajbari'"))[0].id;
    expect((await t.adminJson('/zones/assign-district', 'PUT', { districtId: rajbari, zoneId: id })).status).toBe(200);
    expect(await t.sql('SELECT zone_id FROM zone_districts WHERE district_id = ?', rajbari)).toEqual([{ zone_id: id }]);
    // The checkout offers it straight away, with its charge.
    const lines = [{ variantId: await variant('SPC-MMSL-250G-0001'), qty: 1 }];
    const q = (await t.json('/api/checkout/quote', { method: 'POST', body: { lines, zoneId: id, withAreas: true, paymentMethod: 'cod' } })).body;
    expect(q.delivery).toMatchObject({ zoneName: 'রাজবাড়ী', chargePaisa: 7000 });
    expect(await (await t.fetch('/checkout')).text()).toContain('রাজবাড়ী');
    // Rename and new rate, any time.
    expect((await t.adminJson(`/zones/${id}`, 'PUT', { name: 'রাজবাড়ী জেলা', baseChargePaisa: 8000, extraPerKgPaisa: 2000, bulkyChargePaisa: 50000, etaText: '২–৩ দিন' })).status).toBe(200);
    expect(await t.sql('SELECT name, base_charge_paisa FROM delivery_zones WHERE id = ?', id)).toEqual([{ name: 'রাজবাড়ী জেলা', base_charge_paisa: 8000 }]);
    // A name already taken gets a clear message.
    expect((await t.adminJson('/zones', 'POST', { name: 'ঢাকার বাইরে', baseChargePaisa: 1, extraPerKgPaisa: 0, bulkyChargePaisa: 0 })).body.error).toMatch(/already a delivery area/);
    expect((await t.adminJson(`/zones/${id}`, 'DELETE')).status).toBe(200);
    expect(await t.sql('SELECT id FROM delivery_zones WHERE id = ?', id)).toEqual([]);
  });

  it('keeps an area that orders went to (rename it instead)', async () => {
    const outside = await zoneId('ঢাকার বাইরে');
    expect((await t.adminJson(`/zones/${outside}`, 'DELETE')).status).toBe(400);
  });
});

describe('prices and stock in one table', () => {
  it('lists every option and saves only real changes, refusing a wrong old price', async () => {
    const rows = (await t.adminJson('/quick-update')).body as Array<Record<string, any>>;
    const r = rows.find(x => x.sku === 'SPC-MMSL-250G-0001')!;
    expect(r).toMatchObject({ name: expect.any(String), price_paisa: expect.any(Number), stock: expect.any(Number) });
    const save = await t.adminJson('/quick-update', 'PUT', { rows: [
      { variantId: r.id, pricePaisa: 21000, compareAtPricePaisa: 25000, stock: Number(r.stock) + 5 },
      { variantId: rows[1].id, pricePaisa: rows[1].price_paisa, compareAtPricePaisa: rows[1].compare_at_price_paisa, stock: rows[1].stock },
    ] });
    expect(save.body).toEqual({ ok: true, saved: 1 });
    expect(await t.sql('SELECT price_paisa, compare_at_price_paisa, stock FROM product_variants WHERE id = ?', r.id)).toEqual([{ price_paisa: 21000, compare_at_price_paisa: 25000, stock: Number(r.stock) + 5 }]);
    const bad = await t.adminJson('/quick-update', 'PUT', { rows: [{ variantId: r.id, pricePaisa: 21000, compareAtPricePaisa: 20000, stock: Number(r.stock) }] });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/old price must be higher/);
  });
});

describe('the shop is Vandar Mart', () => {
  it('names the shop everywhere, keeps the owner’s own email, and shows the checkout in Bangla', async () => {
    expect(await t.sql("SELECT value FROM settings WHERE key = 'store_name'")).toEqual([{ value: 'Vandar Mart' }]);
    const home = await (await t.fetch('/')).text();
    expect(home).toContain('Vandar Mart');
    expect(home).not.toMatch(/Abs Vai|ABS VAI/); // (the test site's own address is absvai.test)
    expect(home).toContain('placeholder="Search products"');
    const co = await (await t.fetch('/checkout')).text();
    for (const text of ['মোবাইল নম্বর', 'আপনার নাম', 'ডেলিভারি এলাকা', 'পুরো ঠিকানা', 'পেমেন্ট', 'ক্যাশ অন ডেলিভারি', 'সর্বমোট', 'অর্ডার কনফার্ম করুন']) expect(co).toContain(text);
    expect(co).not.toContain('কাছের পরিচিত স্থান');
    expect(co).not.toContain('name="landmark"');
    expect(await t.sql("SELECT value FROM settings WHERE key = 'notify_email'")).toEqual([{ value: 'absvai1020@gmail.com' }]);
  });
});
