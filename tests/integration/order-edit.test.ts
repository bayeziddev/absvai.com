/**
 * The order screen's two helpers for the shop: editing an order before it ships (customer, address, area, delivery
 * charge, discount, items, with the stock it holds and the invoice kept right), and the Bangla WhatsApp messages the
 * shop sends the customer from the order ("we got your order, please check it" before confirming, then confirmed,
 * shipped, delivered). Also the customer's "Order on WhatsApp" tap, which the shop's Incomplete orders list shows.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bnTaka } from '../../worker/src/lib/whatsapp';
import { createTestEnv, type TestEnv } from './env';

let t: TestEnv;
const ids: Record<string, number> = {};
beforeAll(async () => {
  t = await createTestEnv();
  const one = async (sql: string) => (await t.sql<{ id: number }>(sql))[0].id;
  ids.masala = await one("SELECT id FROM product_variants WHERE sku = 'SPC-MMSL-250G-0001'");
  ids.gur = await one("SELECT id FROM product_variants WHERE sku = 'ORG-PTGR-1KG-0002'");
  ids.inside = await one("SELECT id FROM delivery_zones WHERE name = 'রাজবাড়ীর ভিতরে'");
  ids.outside = await one("SELECT id FROM delivery_zones WHERE name = 'রাজবাড়ীর বাইরে'");
});
afterAll(async () => { await t?.dispose(); });

let n = 0;
async function place(lines: Array<{ variantId: number; qty: number }>, extra: Record<string, unknown> = {}) {
  const s = await t.checkoutSession();
  n += 1;
  const r = await t.json('/api/checkout/place', {
    method: 'POST',
    headers: { 'cf-connecting-ip': `10.7.0.${n}`, cookie: s.cookie },
    body: { phone: `0171${String(n).padStart(7, '0')}`, name: 'Rahim Uddin', paymentMethod: 'cod', token: s.token, zoneId: ids.outside, addressLine: 'House 5, Pangsa, Rajbari', lines, ...extra },
  });
  expect(r.status).toBe(201);
  return { id: r.body.orderId as number, orderNo: r.body.orderNo as string, phone: `0171${String(n).padStart(7, '0')}` };
}
const variant = async (id: number) => (await t.sql<{ price_paisa: number; reserved: number; stock: number; product_id: number }>('SELECT price_paisa, reserved, stock, product_id FROM product_variants WHERE id = ?', id))[0];
const sold = async (productId: number) => (await t.sql<{ sold_count: number }>('SELECT sold_count FROM products WHERE id = ?', productId))[0].sold_count;
const order = async (id: number) => (await t.sql<Record<string, unknown>>('SELECT * FROM orders WHERE id = ?', id))[0];
const items = async (id: number) => t.sql<Record<string, unknown>>('SELECT id, variant_id, qty, unit_price_paisa, line_total_paisa FROM order_items WHERE order_id = ? ORDER BY id', id);

describe('WhatsApp messages from the order screen', () => {
  it('writes the “we got your order, please check it” message in Bangla, with everything the customer needs to check', async () => {
    const o = await place([{ variantId: ids.masala, qty: 2 }], { note: 'বিকেলে দিবেন' });
    const d = (await t.adminJson(`/orders/${o.id}`)).body;
    expect(d.whatsapp.number).toBe(`88${o.phone}`);
    expect(d.whatsapp.drafts.map((x: { kind: string }) => x.kind)).toEqual(['verify', 'no_answer', 'confirmed']);
    const verify = d.whatsapp.drafts.find((x: { suggested: boolean }) => x.suggested);
    expect(verify.kind).toBe('verify');
    expect(verify.label).toBe('অর্ডার যাচাই');
    const total = Number(d.order.total_paisa);
    for (const part of ['আসসালামু আলাইকুম Rahim', 'আপনার অর্ডারটি আমরা পেয়েছি', o.orderNo, 'Master Masala', '× ২', 'ডেলিভারি চার্জ* (রাজবাড়ীর বাইরে): ৳১৩০', `সর্বমোট: ${bnTaka(total)}`,
      'ক্যাশ অন ডেলিভারি', `মোবাইল:* ${o.phone}`, 'House 5, Pangsa, Rajbari', 'বিকেলে দিবেন', '"হ্যাঁ"']) {
      expect(verify.text).toContain(part);
    }
    // Confirmed: links the customer to their own order page, where the invoice downloads.
    const confirmed = d.whatsapp.drafts.find((x: { kind: string }) => x.kind === 'confirmed');
    expect(confirmed.text).toContain(`/order/${o.orderNo}?t=${d.order.access_token}`);
  });

  it('suggests the next message as the order moves: confirmed, then shipped with the courier and the cash to collect', async () => {
    const o = await place([{ variantId: ids.gur, qty: 1 }]);
    expect((await t.adminJson(`/orders/${o.id}/status`, 'POST', { to: 'confirmed' })).status).toBe(200);
    let d = (await t.adminJson(`/orders/${o.id}`)).body;
    expect(d.whatsapp.drafts.find((x: { suggested: boolean }) => x.suggested).kind).toBe('confirmed');
    expect((await t.adminJson(`/orders/${o.id}/status`, 'POST', { to: 'packed' })).status).toBe(200);
    expect((await t.adminJson(`/orders/${o.id}/status`, 'POST', { to: 'in_courier', courier: 'steadfast', trackingId: 'SFR123TEST' })).status).toBe(200);
    d = (await t.adminJson(`/orders/${o.id}`)).body;
    const shipped = d.whatsapp.drafts.find((x: { suggested: boolean }) => x.suggested);
    expect(shipped.kind).toBe('shipped');
    expect(shipped.text).toContain('Steadfast');
    expect(shipped.text).toContain('SFR123TEST');
    expect(shipped.text).toContain(`ডেলিভারির সময় দিতে হবে: ${bnTaka(Number(d.order.total_paisa))}`);
  });

  it('notes in the history that the customer was messaged, and that they said yes on WhatsApp', async () => {
    const o = await place([{ variantId: ids.masala, qty: 1 }]);
    expect((await t.adminJson(`/orders/${o.id}/whatsapp`, 'POST', { kind: 'verify' })).status).toBe(200);
    expect((await t.adminJson(`/orders/${o.id}/whatsapp`, 'POST', { kind: 'spam' })).status).toBe(400);
    expect((await t.adminJson(`/orders/${o.id}/call`, 'POST', { outcome: 'confirmed', note: 'Customer confirmed on WhatsApp' })).status).toBe(200);
    const ev = await t.sql<Record<string, unknown>>("SELECT kind, outcome, note FROM order_events WHERE order_id = ? AND kind IN ('whatsapp', 'call') ORDER BY id", o.id);
    expect(ev).toEqual([
      { kind: 'whatsapp', outcome: null, note: 'WhatsApp message: অর্ডার যাচাই' },
      { kind: 'call', outcome: 'confirmed', note: 'Customer confirmed on WhatsApp' },
    ]);
  });
});

describe('editing an order', () => {
  it('changes a new order’s items, area, free delivery, discount and customer, and recomputes the total', async () => {
    const o = await place([{ variantId: ids.masala, qty: 1 }]);
    const masala = await variant(ids.masala);
    const gur = await variant(ids.gur);
    const soldBefore = { masala: await sold(masala.product_id), gur: await sold(gur.product_id) };
    const [line] = await items(o.id);
    const d = (await t.adminJson(`/orders/${o.id}`)).body;
    expect(d.edit).toMatchObject({ editable: true, holdsStock: false, canPrice: true });
    expect(d.edit.areas.map((a: { name: string }) => a.name)).toEqual(['রাজবাড়ীর ভিতরে', 'রাজবাড়ীর বাইরে']);

    const r = await t.adminJson(`/orders/${o.id}`, 'PUT', {
      name: 'Rahim Mia', phone: '01811111111', addressLine: 'বাসা ৭, রাজবাড়ী সদর', note: '', zoneId: ids.inside, deliveryChargePaisa: 0, discountPaisa: 1000,
      items: [{ itemId: line.id, qty: 3 }, { variantId: ids.gur, qty: 1 }],
    });
    expect(r.status).toBe(200);
    const subtotal = masala.price_paisa * 3 + gur.price_paisa;
    expect(r.body.totalPaisa).toBe(subtotal - 1000);
    expect(r.body.changed.join(' | ')).toMatch(/Name: Rahim Uddin → Rahim Mia.*Mobile.*Address.*Delivery area: রাজবাড়ীর ভিতরে.*: 1 → 3.*Added.*Delivery charge: ৳130 → free.*Discount: ৳0 → ৳10.*Total/);

    expect(await order(o.id)).toMatchObject({
      customer_name: 'Rahim Mia', phone: '8801811111111', address_line: 'বাসা ৭, রাজবাড়ী সদর', delivery_zone_id: ids.inside, district_name: 'Rajbari',
      subtotal_paisa: subtotal, delivery_charge_paisa: 0, delivery_charge_status: 'final', discount_paisa: 1000, total_paisa: subtotal - 1000,
    });
    expect((await items(o.id)).map(i => [i.variant_id, i.qty, i.line_total_paisa])).toEqual([[ids.masala, 3, masala.price_paisa * 3], [ids.gur, 1, gur.price_paisa]]);
    // A new order holds no stock, so nothing is held; the sold counts follow the items.
    expect((await variant(ids.masala)).reserved).toBe(masala.reserved);
    expect(await sold(masala.product_id)).toBe(soldBefore.masala + 2);
    expect(await sold(gur.product_id)).toBe(soldBefore.gur + 1);
    // The order moved to the new number's customer; tracking by the new number finds it.
    expect(await t.sql('SELECT c.phone, c.order_count FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?', o.id)).toEqual([{ phone: '8801811111111', order_count: 1 }]);
    const [ev] = await t.sql<{ note: string }>("SELECT note FROM order_events WHERE order_id = ? AND kind = 'edit'", o.id);
    expect(ev.note).toMatch(/^Edited: Name: Rahim Uddin → Rahim Mia/);
    // The WhatsApp message follows the edit.
    const verify = (await t.adminJson(`/orders/${o.id}`)).body.whatsapp.drafts[0].text as string;
    expect(verify).toContain('ডেলিভারি চার্জ* (রাজবাড়ীর ভিতরে): ফ্রি');
    expect(verify).toContain(`সর্বমোট: ${bnTaka(subtotal - 1000)}`);
    // Saving the same thing again changes nothing.
    const again = await t.adminJson(`/orders/${o.id}`, 'PUT', { name: 'Rahim Mia', items: (await items(o.id)).map(i => ({ itemId: i.id, qty: i.qty })) });
    expect(again.body.changed).toEqual([]);
  });

  it('uses the new area’s own charge when only the area changes', async () => {
    const o = await place([{ variantId: ids.masala, qty: 1 }]);
    const r = await t.adminJson(`/orders/${o.id}`, 'PUT', { zoneId: ids.inside });
    expect(r.status).toBe(200);
    expect(await order(o.id)).toMatchObject({ delivery_zone_id: ids.inside, delivery_charge_paisa: 7000 });
    // The admin quote prices an area for the edit form too.
    const q = await t.adminJson('/orders/quote', 'POST', { lines: [{ variantId: ids.masala, qty: 1 }], zoneId: ids.outside });
    expect(q.body.delivery.chargePaisa).toBe(13000);
  });

  it('moves the stock a confirmed order holds with its items, and keeps the invoice total right', async () => {
    const o = await place([{ variantId: ids.gur, qty: 2 }]);
    expect((await t.adminJson(`/orders/${o.id}/status`, 'POST', { to: 'confirmed' })).status).toBe(200);
    const gur0 = await variant(ids.gur);
    const masala0 = await variant(ids.masala);
    const [line] = await items(o.id);
    expect((await t.adminJson(`/orders/${o.id}`)).body.edit.holdsStock).toBe(true);
    const r = await t.adminJson(`/orders/${o.id}`, 'PUT', { items: [{ itemId: line.id, qty: 1 }, { variantId: ids.masala, qty: 2 }] });
    expect(r.status).toBe(200);
    expect((await variant(ids.gur)).reserved).toBe(gur0.reserved - 1);
    expect((await variant(ids.masala)).reserved).toBe(masala0.reserved + 2);
    const moves = await t.sql("SELECT variant_id, reserved_change, kind FROM stock_movements WHERE order_id = ? AND reason = 'order edited' ORDER BY id", o.id);
    expect(moves).toEqual([{ variant_id: ids.gur, reserved_change: -1, kind: 'release' }, { variant_id: ids.masala, reserved_change: 2, kind: 'reserve' }]);
    const after = await order(o.id);
    expect(await t.sql('SELECT total_paisa FROM invoices WHERE order_id = ?', o.id)).toEqual([{ total_paisa: after.total_paisa }]);

    // More than is on the shelf: refused, and nothing changes.
    await t.sql('UPDATE product_variants SET stock = reserved WHERE id = ?', ids.masala);
    const [, m] = await items(o.id);
    const short = await t.adminJson(`/orders/${o.id}`, 'PUT', { items: [{ itemId: line.id, qty: 1 }, { itemId: m.id, qty: 5 }] });
    expect(short.status).toBe(409);
    expect(short.body.error).toMatch(/Not enough stock/);
    expect((await items(o.id)).map(i => i.qty)).toEqual([1, 2]);
    expect((await order(o.id)).total_paisa).toBe(after.total_paisa);
    await t.sql('UPDATE product_variants SET stock = ? WHERE id = ?', masala0.stock, ids.masala);

    // Cancelling afterwards lets go of exactly what the order holds now.
    expect((await t.adminJson(`/orders/${o.id}/status`, 'POST', { to: 'cancelled', cancelReason: 'test' })).status).toBe(200);
    expect((await variant(ids.gur)).reserved).toBe(gur0.reserved - 2);
    expect((await variant(ids.masala)).reserved).toBe(masala0.reserved);
  });

  it('checks what it is given', async () => {
    const o = await place([{ variantId: ids.masala, qty: 1 }]);
    const [line] = await items(o.id);
    expect((await t.adminJson(`/orders/${o.id}`, 'PUT', { items: [] })).status).toBe(400);
    expect((await t.adminJson(`/orders/${o.id}`, 'PUT', { items: [{ itemId: line.id, qty: 0 }] })).status).toBe(400);
    expect((await t.adminJson(`/orders/${o.id}`, 'PUT', { phone: '12345' })).status).toBe(400);
    expect((await t.adminJson(`/orders/${o.id}`, 'PUT', { addressLine: 'x' })).status).toBe(400);
    expect((await t.adminJson(`/orders/${o.id}`, 'PUT', { deliveryChargePaisa: -5 })).status).toBe(400);
    expect((await t.adminJson(`/orders/${o.id}`, 'PUT', { items: [{ itemId: 999999, qty: 1 }] })).status).toBe(409);
    expect((await t.adminJson('/orders/999999', 'PUT', { name: 'X Y' })).status).toBe(404);
  });

  it('is closed once the parcel is with the courier', async () => {
    const o = await place([{ variantId: ids.masala, qty: 1 }]);
    for (const to of ['confirmed', 'packed']) expect((await t.adminJson(`/orders/${o.id}/status`, 'POST', { to })).status).toBe(200);
    expect((await t.adminJson(`/orders/${o.id}/status`, 'POST', { to: 'in_courier', courier: 'own_delivery' })).status).toBe(200);
    expect((await t.adminJson(`/orders/${o.id}`)).body.edit.editable).toBe(false);
    const r = await t.adminJson(`/orders/${o.id}`, 'PUT', { name: 'Someone Else' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/can no longer be changed here/);
  });
});

describe('sales agents editing orders', () => {
  let agent = { cookie: '', csrf: '' };
  const as = (path: string, method = 'GET', body?: unknown) => t.json(`/api/admin${path}`, { method, body, headers: { cookie: agent.cookie, 'x-csrf-token': agent.csrf, origin: 'https://absvai.test' } });
  beforeAll(async () => {
    await t.adminJson('/staff', 'POST', { name: 'Agent', email: 'agent-edit@absvai.test', role: 'order_processor', password: 'agent-pass-123' });
    const r = await t.fetch('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'agent-edit@absvai.test', password: 'agent-pass-123' }) });
    agent = { cookie: (r.headers.get('set-cookie') ?? '').split(';')[0], csrf: ((await r.json()) as { csrf: string }).csrf };
  });

  it('cannot change prices, give more than their discount limit, or change a number they cannot see', async () => {
    const o = await place([{ variantId: ids.gur, qty: 1 }]);
    const [line] = await items(o.id);
    const d = (await as(`/orders/${o.id}`)).body;
    expect(d.order.phone).toContain('X');
    // The number is masked, so there is no WhatsApp draft until the order is theirs.
    expect(d.whatsapp).toBeNull();
    expect(d.edit).toMatchObject({ editable: true, canPrice: false });
    expect((await as(`/orders/${o.id}`, 'PUT', { items: [{ itemId: line.id, qty: 1, unitPaisa: 100 }] })).status).toBe(403);
    expect((await as(`/orders/${o.id}`, 'PUT', { discountPaisa: Number(line.unit_price_paisa) })).status).toBe(400);
    // Their masked copy of the number counts as "not changed"; a different number needs the order assigned to them.
    expect((await as(`/orders/${o.id}`, 'PUT', { phone: d.order.phone, name: 'Rahim Agent' })).status).toBe(200);
    expect((await as(`/orders/${o.id}`, 'PUT', { phone: '01822222222' })).status).toBe(403);
    expect((await as(`/orders/${o.id}`, 'PUT', { items: [{ itemId: line.id, qty: 2, unitPaisa: line.unit_price_paisa }] })).status).toBe(200);
    expect((await order(o.id)).customer_name).toBe('Rahim Agent');
  });
});

describe('the customer’s “Order on WhatsApp” tap', () => {
  it('marks their checkout in Incomplete orders as sent on WhatsApp', async () => {
    const s = await t.checkoutSession();
    const send = (extra: Record<string, unknown>) => t.fetch('/api/checkout/capture', {
      method: 'POST', headers: { 'content-type': 'text/plain', cookie: s.cookie, 'cf-connecting-ip': '10.7.9.9' },
      body: JSON.stringify({ token: s.token, phone: '01733333333', name: 'Karim', lines: [{ variantId: ids.masala, qty: 1 }], addressLine: 'Pangsa, Rajbari', utm: { utm_source: 'facebook' }, ...extra }),
    });
    expect((await send({})).status).toBe(200);
    expect((await send({ via: 'whatsapp' })).status).toBe(200);
    const [row] = await t.sql<{ source: string }>("SELECT source FROM abandoned_checkouts WHERE phone = '8801733333333'");
    expect(JSON.parse(row.source)).toMatchObject({ utm: { utm_source: 'facebook' }, via: 'whatsapp' });
  });
});
