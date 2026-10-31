/**
 * Order tracking: one box takes the mobile number OR the order number. Every stage, courier update and shop message
 * lands in the order_tracking table, and the tracking page shows the details as tables, without the full name,
 * full number or house address.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from './env';

let t: TestEnv;
const ids: Record<string, number> = {};
let ip = 0;

beforeAll(async () => {
  t = await createTestEnv();
  const one = async (sql: string, ...p: unknown[]) => (await t.sql<{ id: number }>(sql, ...p))[0].id;
  ids.division = await one("SELECT id FROM geo_divisions WHERE name = 'Dhaka'");
  ids.gazipur = await one("SELECT id FROM geo_districts WHERE name = 'Gazipur'");
  ids.upazila = await one('SELECT id FROM geo_upazilas WHERE district_id = ? ORDER BY id LIMIT 1', ids.gazipur);
  ids.variant = await one("SELECT pv.id FROM product_variants pv JOIN products p ON p.id = pv.product_id WHERE p.status = 'published' AND pv.stock > 5 AND pv.is_active = 1 ORDER BY pv.id LIMIT 1");
});
afterAll(async () => { await t?.dispose(); });

async function place(phone: string, qty = 1) {
  const s = await t.checkoutSession();
  const r = await t.json('/api/checkout/place', {
    method: 'POST', headers: { cookie: s.cookie, 'cf-connecting-ip': `10.9.1.${++ip}` },
    body: { phone, name: 'Rafiq Hasan Khan', paymentMethod: 'cod', lines: [{ variantId: ids.variant, qty }], token: s.token, divisionId: ids.division, districtId: ids.gazipur, upazilaId: ids.upazila, addressLine: 'House 7, Road 3, Board Bazar' },
  });
  expect(r.status).toBe(201);
  return r.body as { orderNo: string; orderId: number };
}

const track = (body: Record<string, unknown>) => t.json('/api/orders/track', { method: 'POST', headers: { 'cf-connecting-ip': `10.9.2.${++ip}` }, body });

let first: { orderNo: string; orderId: number };
let second: { orderNo: string; orderId: number };

describe('tracking table', () => {
  it('writes a line when the order is placed and every time it moves', async () => {
    first = await place('01811000001', 2);
    second = await place('01811000001');
    await t.adminJson(`/orders/${first.orderId}/call`, 'POST', { outcome: 'confirmed' });
    expect((await t.adminJson(`/orders/${first.orderId}/status`, 'POST', { to: 'confirmed' })).status).toBe(200);
    await t.adminJson(`/orders/${first.orderId}/status`, 'POST', { to: 'packed' });
    expect((await t.adminJson(`/orders/${first.orderId}/status`, 'POST', { to: 'in_courier', courier: 'steadfast', trackingId: 'SF778899' })).status).toBe(200);
    expect((await t.adminJson(`/orders/${first.orderId}/customer-update`, 'POST', { text: '' })).status).toBe(400);
    expect((await t.adminJson(`/orders/${first.orderId}/customer-update`, 'POST', { text: 'Delayed by rain, it arrives tomorrow.' })).status).toBe(200);
    const rows = await t.sql<{ step: string; title: string; detail: string | null; source: string }>('SELECT step, title, detail, source FROM order_tracking WHERE order_id = ? ORDER BY id', first.orderId);
    expect(rows.map(r => r.step)).toEqual(['new', 'confirmed', 'packed', 'in_courier', 'shop_note']);
    expect(rows[0]).toMatchObject({ title: 'Order placed', source: 'customer' });
    expect(rows[3]).toMatchObject({ title: 'Handed to the courier', detail: 'Steadfast · tracking SF778899', source: 'shop' });
    expect(rows[4].detail).toBe('Delayed by rain, it arrives tomorrow.');
    // Staff-only history (calls, internal notes) never reaches this table.
    expect(rows.some(r => /call/i.test(r.title))).toBe(false);
  });
});

describe('track by mobile number OR order number', () => {
  it('a mobile number alone shows all its recent orders with their details', async () => {
    const r = await track({ query: '01811000001' });
    expect(r.status).toBe(200);
    expect(r.body.by).toBe('phone');
    expect(r.body.orders.map((o: { orderNo: string }) => o.orderNo)).toEqual([second.orderNo, first.orderNo]);
    const o = r.body.orders[1];
    expect(o).toMatchObject({ status: 'in_courier', stage: 3, courier: 'Steadfast', trackingCode: 'SF778899', name: 'Rafiq H. K.', phone: '018XXXXX001', payment: 'Cash on Delivery' });
    expect(o.items[0]).toMatchObject({ qty: 2 });
    expect(o.duePaisa).toBe(o.totalPaisa);
    expect(o.steps.map((s: { title: string }) => s.title)).toContain('Message from the shop');
    // Never the house address or the full number.
    expect(JSON.stringify(r.body)).not.toMatch(/Board Bazar|01811000001|8801811000001/);
    // The same in Bangla digits and with +880.
    expect((await track({ query: '০১৮১১০০০০০১' })).body.orders).toHaveLength(2);
    expect((await track({ query: '+880 1811-000001' })).body.orders).toHaveLength(2);
  });

  it('an order number alone shows that order, however it is typed', async () => {
    const r = await track({ query: first.orderNo });
    expect(r.body).toMatchObject({ by: 'code', orderNo: first.orderNo, status: 'in_courier', trackingId: 'SF778899' });
    expect(r.body.orders).toHaveLength(1);
    const [, day, seq] = first.orderNo.split('-');
    expect((await track({ query: first.orderNo.toLowerCase() })).body.orderNo).toBe(first.orderNo);
    expect((await track({ query: `${day}${seq}` })).body.orderNo).toBe(first.orderNo);
    expect((await track({ query: `av ${day} ${Number(seq)}` })).body.orderNo).toBe(first.orderNo);
    // The invoice number and the courier tracking code work too.
    const [{ invoice_no: inv }] = await t.sql<{ invoice_no: string }>('SELECT invoice_no FROM orders WHERE id = ?', first.orderId);
    expect((await track({ query: inv })).body.orderNo).toBe(first.orderNo);
    expect((await track({ query: 'sf778899' })).body.orderNo).toBe(first.orderNo);
  });

  it('explains what went wrong', async () => {
    expect((await track({ query: '' })).status).toBe(400);
    expect((await track({ query: '<script>' })).status).toBe(400);
    expect((await track({ query: '01999999999' })).body.error).toMatch(/any order on this mobile number/);
    expect((await track({ query: 'AV-990101-0001' })).status).toBe(404);
    // The older two-box form must match both.
    expect((await track({ phone: '01811000001', orderNo: first.orderNo })).body.orderNo).toBe(first.orderNo);
    expect((await track({ phone: '01700000000', orderNo: first.orderNo })).status).toBe(404);
  });

  it('the tracking page shows the details, items and history as tables', async () => {
    const html = await (await t.fetch(`/track?q=${encodeURIComponent('01811000001')}`, { headers: { 'cf-connecting-ip': '10.9.3.1' } })).text();
    expect(html).toContain('2 orders on 018XXXXX001');
    for (const h of ['Order details', 'Items', 'Tracking history', 'To pay on delivery', 'Handed to the courier', 'কুরিয়ারে দেওয়া হয়েছে', 'Delayed by rain']) expect(html).toContain(h);
    expect(html).toContain(`id="o-${first.orderNo}"`);
    expect(html).not.toContain('Board Bazar');
    const one = await (await t.fetch(`/track?q=${first.orderNo}`, { headers: { 'cf-connecting-ip': '10.9.3.2' } })).text();
    expect(one).not.toContain('orders on');
    expect(one).toMatch(/aria-current="step"/);
    const legacy = await (await t.fetch(`/track?phone=01811000001&order=${first.orderNo}`, { headers: { 'cf-connecting-ip': '10.9.3.3' } })).text();
    expect(legacy).toContain('SF778899');
    const miss = await (await t.fetch('/track?q=AV-990101-0009', { headers: { 'cf-connecting-ip': '10.9.3.4' } })).text();
    expect(miss).toContain('We could not find an order with that number');
  });

  it('limits lookups per connection', async () => {
    let last = 200;
    for (let i = 0; i < 22; i++) last = (await t.json('/api/orders/track', { method: 'POST', headers: { 'cf-connecting-ip': '10.9.4.1' }, body: { query: '01811000001' } })).status;
    expect(last).toBe(429);
  });
});
