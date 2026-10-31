/**
 * v2 flows end to end against the real app and a fresh local D1: checkout session + bot checks, the incomplete-order
 * engine, baseline fraud, the 8-stage pipeline with stock reserve/ship/return scan, manual orders, printing, the edge
 * cache headers and purge queue, encrypted settings, and query plans for the hot order list.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetPageCss } from '../../worker/src/lib/page-css';
import { listOrdersQuery } from '../../worker/src/repo/orders';
import { createTestEnv, type TestEnv } from './env';

let t: TestEnv;
const ids: Record<string, number> = {};

beforeAll(async () => {
  t = await createTestEnv();
  const one = async (sql: string, ...p: unknown[]) => (await t.sql<{ id: number }>(sql, ...p))[0].id;
  ids.division = await one("SELECT id FROM geo_divisions WHERE name = 'Dhaka'");
  ids.tangail = await one("SELECT id FROM geo_districts WHERE name = 'Tangail'");
  ids.kalihati = await one("SELECT id FROM geo_upazilas WHERE name = 'Kalihati'");
  ids.gur = await one("SELECT id FROM product_variants WHERE sku = 'ORG-PTGR-1KG-0002'");
  ids.masala = await one("SELECT id FROM product_variants WHERE sku = 'SPC-MMSL-250G-0001'");
  ids.gurProduct = await one("SELECT id FROM products WHERE slug = 'khejur-patali-gur'");
});
afterAll(async () => { await t?.dispose(); });

let n = 0;
const address = () => ({ divisionId: ids.division, districtId: ids.tangail, upazilaId: ids.kalihati, addressLine: 'House 7, College Road, Kalihati', landmark: 'Opposite the mosque' });
async function place(over: Record<string, unknown> = {}, session?: { cookie: string; token: string }) {
  const s = session ?? (await t.checkoutSession());
  return t.json('/api/checkout/place', {
    method: 'POST', headers: { cookie: s.cookie, 'cf-connecting-ip': `10.1.0.${++n}` },
    body: { phone: `0181${String(n).padStart(7, '0')}`, name: 'Karim Mia', paymentMethod: 'cod', lines: [{ variantId: ids.masala, qty: 1 }], token: s.token, ...address(), ...over },
  });
}
const stockOf = async (id: number) => (await t.sql<{ stock: number; reserved: number }>('SELECT stock, reserved FROM product_variants WHERE id = ?', id))[0];
const attempts = (layer: string) => t.sql('SELECT * FROM blocked_attempts WHERE layer = ? ORDER BY id DESC', layer);

describe('checkout session token, honeypot and timing (Section 11)', () => {
  it('refuses an order without a session token and logs the attempt', async () => {
    const r = await t.json('/api/checkout/place', { method: 'POST', body: { phone: '01811111111', name: 'X', lines: [{ variantId: ids.masala, qty: 1 }], ...address() } });
    expect(r.status).toBe(401);
    expect((await attempts('token'))[0]).toMatchObject({ action: 'blocked', route: '/api/checkout/place' });
  });

  it('refuses a token issued to another browser', async () => {
    const a = await t.checkoutSession();
    const b = await t.checkoutSession();
    expect((await place({}, { cookie: a.cookie, token: b.token })).status).toBe(401);
  });

  it('silently rejects a form submitted faster than a person could fill it', async () => {
    const r = await place({}, await t.checkoutSession(0));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('Please check your details and try again.');
    expect((await attempts('bot'))[0]).toMatchObject({ action: 'silently_rejected' });
  });

  it('silently rejects a filled honeypot field', async () => {
    const r = await place({ website: 'http://spam.example' });
    expect(r.status).toBe(400);
    expect((await attempts('honeypot'))).toHaveLength(1);
  });
});

describe('incomplete orders (Section 8.3)', () => {
  let s: { cookie: string; token: string; sid: string };
  const capture = (body: Record<string, unknown>, token = s.token) => t.fetch('/api/checkout/capture', {
    method: 'POST', headers: { cookie: s.cookie, 'content-type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ token, ...body }), // sendBeacon sends text/plain
  });
  const rows = () => t.sql('SELECT * FROM abandoned_checkouts WHERE checkout_session_id = ?', s.sid);

  beforeAll(async () => { s = await t.checkoutSession(); });

  it('creates nothing until the phone number is valid', async () => {
    const r = await capture({ phone: '0171', name: 'Shila', lines: [{ variantId: ids.gur, qty: 1 }] });
    expect(await r.json()).toEqual({ ok: true, saved: false });
    expect(await rows()).toHaveLength(0);
  });

  it('keeps one row per checkout session, updated as the customer types', async () => {
    await capture({ phone: '01912345670', name: 'Shila', lines: [{ variantId: ids.gur, qty: 1 }] });
    await capture({ phone: '01912345670', name: 'Shila Akter', lines: [{ variantId: ids.gur, qty: 2 }], ...address(), postcode: '1970' });
    const r = await rows();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ phone: '8801912345670', name: 'Shila Akter', status: 'new', subtotal_paisa: 144000 });
    expect(JSON.parse(r[0].cart)).toEqual([expect.objectContaining({ variantId: ids.gur, qty: 2 })]);
    expect(JSON.parse(r[0].address)).toMatchObject({ districtId: ids.tangail, line: 'House 7, College Road, Kalihati' });
  });

  it('needs the session token', async () => {
    expect((await capture({ phone: '01912345670' }, 'forged')).status).toBe(401);
  });

  it('shows up for staff, with the recovery report', async () => {
    const list = await t.adminJson('/incomplete?status=new');
    expect(list.body.items.find((a: { phone: string }) => a.phone === '01912345670')).toMatchObject({ name: 'Shila Akter', cart: [expect.objectContaining({ qty: 2 })] });
    const rep = await t.adminJson('/incomplete/report?days=7');
    expect(Number(rep.body.totals.captured)).toBeGreaterThanOrEqual(1);
  });

  it('is marked converted when the same checkout places the order', async () => {
    const r = await place({ phone: '01912345670', lines: [{ variantId: ids.gur, qty: 2 }] }, s);
    expect(r.status).toBe(201);
    expect((await rows())[0]).toMatchObject({ status: 'converted', converted_order_id: r.body.orderId });
    // Converted rows cannot be re-opened by hand.
    const id = (await rows())[0].id;
    expect((await t.adminJson(`/incomplete/${id}/status`, 'POST', { status: 'new' })).status).toBe(400);
  });
});

describe('baseline fraud: block list, repeat orders, OTP caps', () => {
  it('holds a second order from the same phone within the interval instead of rejecting it', async () => {
    const a = await place({ phone: '01755500001' });
    const b = await place({ phone: '01755500001' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.held).toBe(true);
    const [o] = await t.sql('SELECT status, hold_reason FROM orders WHERE id = ?', b.body.orderId);
    expect(o.status).toBe('new');
    expect(o.hold_reason).toMatch(/Another order \(AV-\d{6}-\d{4}\)/);
    await t.adminJson(`/orders/${b.body.orderId}/call`, 'POST', { outcome: 'confirmed' });
    expect((await t.adminJson(`/orders/${b.body.orderId}/status`, 'POST', { to: 'confirmed' })).body.error).toMatch(/on hold/);
    expect((await t.adminJson(`/orders/${b.body.orderId}/release-hold`, 'POST', { note: 'Called: wants both, second is a gift' })).status).toBe(200);
    expect((await t.adminJson(`/orders/${b.body.orderId}/status`, 'POST', { to: 'confirmed' })).status).toBe(200);
    expect((await attempts('interval'))[0]).toMatchObject({ action: 'held' });
  });

  it('blocks a phone number with a reason, logs the attempt and unblocks in one step', async () => {
    const blk = await t.adminJson('/security/blocks', 'POST', { phone: '01766600002', reason: 'Refused 3 parcels' });
    expect(blk.status).toBe(201);
    const r = await place({ phone: '01766600002' });
    expect(r.status).toBe(403);
    expect(r.body.error).not.toMatch(/block/i); // the customer is told to call, not that they are blocked
    const [att] = await attempts('phone');
    expect(att).toMatchObject({ action: 'blocked', phone_hint: '017XXXXX002', block_id: blk.body.id });
    expect((await t.adminJson(`/security/attempts/${att.id}/review`, 'POST', { note: 'Real customer, called to confirm', unblock: true })).body).toEqual({ ok: true, unblocked: true });
    expect((await place({ phone: '01766600002' })).status).toBe(201);
  });

  it('refuses an IP block without an expiry or a written reason', async () => {
    await expect(t.sql("INSERT INTO block_list (type, value_hash, reason) VALUES ('ip', 'h1', 'spam')")).rejects.toThrow(/CHECK/);
    await t.sql("INSERT INTO block_list (type, value_hash, reason, expires_at) VALUES ('ip', 'h2', 'spam', '2099-01-01T00:00:00Z')");
  });

  it('does not ask for an SMS code while no SMS gateway is connected; the page says we will call', async () => {
    const r = await place({ phone: '01877700009' });
    expect(r.status).toBe(201);
    expect(r.body.otpSent).toBe(false);
    expect(await t.sql("SELECT kind FROM sms_outbox WHERE order_id = ? AND kind = 'otp'", r.body.orderId)).toEqual([]);
    const page = await (await t.fetch(`/order/${r.body.orderNo}?t=${r.body.accessToken}`)).text();
    expect(page).toContain('data-call-confirm');
    expect(page).not.toContain('data-otp');
    // Even with the setting on, no code is sent until a gateway is connected.
    await t.adminJson('/settings', 'PUT', { otp_enabled: '1' });
    expect((await place({ phone: '01877700008' })).body.otpSent).toBe(false);
    const resend = await t.json(`/api/orders/${r.body.orderNo}/otp/resend`, { method: 'POST', body: { t: r.body.accessToken } });
    expect(resend.status).toBe(409);
  });

  it('caps SMS codes per phone per hour', async () => {
    Object.assign(t.env, { SMS_PROVIDER: 'test-gateway', SMS_API_KEY: 'test-key' });
    await t.adminJson('/settings', 'PUT', { otp_enabled: '1' });
    const r = await place({ phone: '01877700003' });
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const x = await t.json(`/api/orders/${r.body.orderNo}/otp/resend`, { method: 'POST', body: { t: r.body.accessToken }, headers: { 'cf-connecting-ip': '10.9.9.9' } });
      results.push(Boolean(x.body.sent));
    }
    expect(results.filter(Boolean).length).toBeLessThanOrEqual(2); // 1 at placement + at most 2 resends = 3 per hour
    expect(results.at(-1)).toBe(false);
    const log = await t.sql<{ status: string }>("SELECT status FROM otp_log WHERE phone = '8801877700003' ORDER BY id");
    expect(log.filter(l => l.status === 'sent').length).toBeLessThanOrEqual(3);
    Object.assign(t.env, { SMS_PROVIDER: undefined, SMS_API_KEY: undefined });
    await t.adminJson('/settings', 'PUT', { otp_enabled: '0' });
  });
});

describe('8 stages: stock is held at confirmation, leaves with the courier, returns on scan (Section 9.1)', () => {
  let orderId = 0;
  let before = { stock: 0, reserved: 0 };

  it('creates a Messenger order by hand, credited to the staff member', async () => {
    const noSource = await t.adminJson('/orders/manual', 'POST', { phone: '01688800004', name: 'Nasima', lines: [{ variantId: ids.gur, qty: 2 }], ...address() });
    expect(noSource.status).toBe(400);
    before = await stockOf(ids.gur);
    const r = await t.adminJson('/orders/manual', 'POST', { phone: '01688800004', name: 'Nasima', source: 'messenger', sourceDetail: 'Page inbox', lines: [{ variantId: ids.gur, qty: 2 }], ...address() });
    expect(r.status).toBe(201);
    orderId = r.body.orderId;
    const [o] = await t.sql('SELECT status, source, created_by, assigned_to FROM orders WHERE id = ?', orderId);
    expect(o).toMatchObject({ status: 'new', source: 'messenger' });
    expect(o.created_by).toBeTruthy();
    expect(o.assigned_to).toBe(o.created_by);
  });

  it('reserves at confirmation, takes stock at In Courier', async () => {
    await t.adminJson(`/orders/${orderId}/call`, 'POST', { outcome: 'confirmed' });
    expect((await t.adminJson(`/orders/${orderId}/status`, 'POST', { to: 'confirmed' })).status).toBe(200);
    expect(await stockOf(ids.gur)).toEqual({ stock: before.stock, reserved: before.reserved + 2 });
    expect((await t.adminJson(`/orders/${orderId}/status`, 'POST', { to: 'packed' })).status).toBe(200);
    const bulk = await t.adminJson('/orders/bulk', 'POST', { ids: [orderId], to: 'in_courier', courier: 'steadfast', trackingIds: { [orderId]: 'SFX778899' } });
    expect(bulk.body.results[0]).toMatchObject({ ok: true });
    expect(await stockOf(ids.gur)).toEqual({ stock: before.stock - 2, reserved: before.reserved });
    expect((await t.sql('SELECT kind FROM stock_movements WHERE order_id = ? ORDER BY id', orderId)).map(m => m.kind)).toEqual(['reserve', 'sale']);
  });

  it('refuses illegal moves and logs them', async () => {
    expect((await t.adminJson(`/orders/${orderId}/status`, 'POST', { to: 'cancelled' })).status).toBe(409);
    expect((await t.sql("SELECT COUNT(*) AS n FROM order_events WHERE order_id = ? AND kind = 'rejected_transition'", orderId))[0].n).toBe(1);
  });

  it('a returned parcel restocks only when the warehouse scans it', async () => {
    expect((await t.adminJson(`/orders/${orderId}/status`, 'POST', { to: 'returned', returnReason: 'refused' })).status).toBe(200);
    expect((await stockOf(ids.gur)).stock).toBe(before.stock - 2);
    expect((await t.adminJson('/dashboard')).body.awaitingReturnScan).toBeGreaterThanOrEqual(1);
    const scan = await t.adminJson('/returns/scan', 'POST', { code: 'SFX778899' });
    expect(scan.status).toBe(200);
    expect(scan.body.restocked).toEqual([{ sku: 'ORG-PTGR-1KG-0002', qty: 2 }]);
    expect((await stockOf(ids.gur)).stock).toBe(before.stock);
    expect((await t.adminJson('/returns/scan', 'POST', { code: 'SFX778899' })).status).toBe(409); // never twice
  });

  it('cancelling a confirmed order releases the hold', async () => {
    const s0 = await stockOf(ids.gur);
    const r = await t.adminJson('/orders/manual', 'POST', { phone: '01688800005', name: 'Rubel', source: 'phone_call', lines: [{ variantId: ids.gur, qty: 1 }], ...address() });
    await t.adminJson(`/orders/${r.body.orderId}/call`, 'POST', { outcome: 'confirmed' });
    await t.adminJson(`/orders/${r.body.orderId}/status`, 'POST', { to: 'confirmed' });
    expect((await stockOf(ids.gur)).reserved).toBe(s0.reserved + 1);
    expect((await t.adminJson(`/orders/${r.body.orderId}/status`, 'POST', { to: 'cancelled', cancelReason: 'Customer changed mind' })).status).toBe(200);
    expect(await stockOf(ids.gur)).toEqual(s0);
  });

  it('partial delivery: only the returned items come back on scan', async () => {
    const r = await t.adminJson('/orders/manual', 'POST', { phone: '01688800006', name: 'Mitu', source: 'whatsapp', lines: [{ variantId: ids.gur, qty: 2 }], ...address() });
    const id = r.body.orderId;
    await t.adminJson(`/orders/${id}/call`, 'POST', { outcome: 'confirmed' });
    for (const to of ['confirmed', 'packed']) await t.adminJson(`/orders/${id}/status`, 'POST', { to });
    await t.adminJson(`/orders/${id}/status`, 'POST', { to: 'in_courier', courier: 'own_delivery' });
    const afterShip = await stockOf(ids.gur);
    const [item] = await t.sql('SELECT id FROM order_items WHERE order_id = ?', id);
    expect((await t.adminJson(`/orders/${id}/status`, 'POST', { to: 'partial_delivered', returnReason: 'damaged', returned: { [item.id]: 1 } })).status).toBe(200);
    const [o] = await t.sql('SELECT invoice_no FROM orders WHERE id = ?', id);
    expect((await t.adminJson('/returns/scan', 'POST', { code: o.invoice_no })).body.restocked).toEqual([{ sku: 'ORG-PTGR-1KG-0002', qty: 1 }]);
    expect((await stockOf(ids.gur)).stock).toBe(afterShip.stock + 1);
  });
});

describe('sales agents (Section 14)', () => {
  let agent = { cookie: '', csrf: '' };
  const as = (path: string, method = 'GET', body?: unknown) => t.json(`/api/admin${path}`, { method, body, headers: { cookie: agent.cookie, 'x-csrf-token': agent.csrf, origin: 'https://absvai.test' } });

  beforeAll(async () => {
    await t.adminJson('/staff', 'POST', { name: 'Agent', email: 'agent@absvai.test', role: 'order_processor', password: 'agent-pass-123' });
    const r = await t.fetch('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'agent@absvai.test', password: 'agent-pass-123' }) });
    agent = { cookie: (r.headers.get('set-cookie') ?? '').split(';')[0], csrf: ((await r.json()) as { csrf: string }).csrf };
  });

  it('sees masked numbers on orders not assigned to them', async () => {
    const list = await as('/orders');
    expect(list.status).toBe(200);
    expect(list.body.items.every((o: { phone: string; assigned_to: string | null }) => o.phone.includes('XXXXX'))).toBe(true);
  });

  it('gives discounts only up to the configured limit', async () => {
    const body = { phone: '01699900007', name: 'Tania', source: 'facebook_comment', lines: [{ variantId: ids.gur, qty: 1 }], ...address() };
    expect((await as('/orders/manual', 'POST', { ...body, discountPaisa: 36000 })).status).toBe(400); // 50% of ৳720
    const ok = await as('/orders/manual', 'POST', { ...body, discountPaisa: 7000 });
    expect(ok.status).toBe(201);
    const [o] = await t.sql('SELECT discount_paisa, assigned_to FROM orders WHERE id = ?', ok.body.orderId);
    expect(o.discount_paisa).toBe(7000);
    // Their own manual order is assigned to them, so they see the number.
    expect((await as(`/orders/${ok.body.orderId}`)).body.order.phone).toBe('01699900007');
  });

  it('cannot change settings or credentials', async () => {
    expect((await as('/settings', 'PUT', { store_name: 'X' })).status).toBe(403);
    expect((await as('/security/blocks', 'POST', { phone: '01700000000', reason: 'x' })).status).toBe(403);
  });
});

describe('printing (Section 13)', () => {
  it('prints a picking list, 4×6 slips and barcode labels', async () => {
    const [o] = await t.sql("SELECT o.id FROM orders o JOIN order_items i ON i.order_id = o.id WHERE o.invoice_no IS NOT NULL AND i.sku = 'ORG-PTGR-1KG-0002' ORDER BY o.id LIMIT 1");
    const pick = await t.fetch(`/api/admin/print/picking-list?ids=${o.id}`, { headers: { cookie: t.admin.cookie } });
    expect(pick.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(await pick.text()).toContain('ORG-PTGR-1KG-0002');
    const pdf = await t.fetch(`/api/admin/print/slips.pdf?ids=${o.id}&layout=thermal`, { headers: { cookie: t.admin.cookie } });
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    const labels = await (await t.fetch(`/api/admin/print/labels?variants=${ids.gur}&copies=3`, { headers: { cookie: t.admin.cookie } })).text();
    expect(labels.match(/<svg/g)).toHaveLength(3);
  });
});

describe('dashboard stage cards (Section 31)', () => {
  it('shows all eight stages with counts', async () => {
    const d = (await t.adminJson('/dashboard')).body;
    expect(d.stages.map((s: { value: string }) => s.value)).toEqual(['new', 'confirmed', 'packed', 'in_courier', 'delivered', 'partial_delivered', 'cancelled', 'returned']);
    expect(d.stages.find((s: { value: string }) => s.value === 'new').count).toBeGreaterThan(0);
    expect(d.kpis.stockValuePaisa).toBeGreaterThan(0); // Owner sees cost
  });
});

describe('edge cache (Section 2.1)', () => {
  it('tags public pages and answers revalidation with 304', async () => {
    const r = await t.fetch('/p/khejur-patali-gur');
    expect(r.headers.get('cache-tag')?.split(',')).toEqual(expect.arrayContaining(['site', `prod-${ids.gurProduct}`]));
    expect(r.headers.get('cdn-cache-control')).toMatch(/max-age=\d+/);
    const etag = r.headers.get('etag')!;
    expect((await t.fetch('/p/khejur-patali-gur', { headers: { 'if-none-match': etag } })).status).toBe(304);
  });

  it('never caches carts, checkout or admin', async () => {
    for (const p of ['/cart', '/checkout']) {
      const r = await t.fetch(p);
      expect(r.headers.get('cache-control')).toContain('no-store');
      expect(r.headers.get('cache-tag')).toBeNull();
    }
  });

  it('a stock change refreshes the product page tag through the Storefront entrypoint', async () => {
    t.purged.length = 0;
    expect((await t.adminJson('/inventory/adjust', 'POST', { variantId: ids.gur, change: 5, reason: 'received', batchNo: 'B-2026-11' })).status).toBe(200);
    await t.settle();
    expect(t.purged.flat()).toContain(`prod-${ids.gurProduct}`);
    expect(await t.sql('SELECT * FROM cache_purges')).toEqual([]);
  });

  it('serves live price and stock separately from the cached HTML', async () => {
    const r = await t.fetch(`/api/live?ids=${ids.gurProduct}`);
    expect(r.headers.get('cache-control')).toBe('public, max-age=10');
    const body = (await r.json()) as { products: Record<string, { variants: Array<{ id: number; available: number }> }> };
    expect(body.products[ids.gurProduct].variants.find(v => v.id === ids.gur)!.available).toBeGreaterThan(0);
  });
});

describe('owner-friendly admin: charts and easy categories', () => {
  it('returns 30-day charts from real orders: sales per day, funnel, districts, customers, channels', async () => {
    const ch = (await t.adminJson('/dashboard')).body.charts;
    expect(ch.daily.length).toBeGreaterThan(0);
    expect(ch.daily[0]).toEqual(expect.objectContaining({ day: expect.stringMatching(/^\d{4}-\d\d-\d\d$/), orders: expect.any(Number), revenue: expect.any(Number) }));
    expect(ch.funnel.started).toBeGreaterThanOrEqual(ch.funnel.placed);
    expect(ch.funnel.placed).toBeGreaterThanOrEqual(ch.funnel.confirmed);
    expect(ch.funnel.confirmed).toBeGreaterThanOrEqual(ch.funnel.shipped);
    expect(ch.places[0]).toMatchObject({ district: 'Tangail' }); // every test order ships to Kalihati, Tangail
    expect(ch.customers[0].phone).toMatch(/^01\d{9}$/);
    expect(ch.channels.map((c: { label: string }) => c.label)).toEqual(expect.arrayContaining(['Website', 'Messenger']));
  });

  it('creates a category with just a name and a picture; the short code is made for you', async () => {
    const form = new FormData();
    form.append('file', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'shawl.png', { type: 'image/png' }));
    const up = await t.fetch('/api/admin/category-image', { method: 'POST', body: form, headers: { cookie: t.admin.cookie, 'x-csrf-token': t.admin.csrf, origin: 'https://absvai.test' } });
    expect(up.status).toBe(201);
    const { url } = (await up.json()) as { url: string };
    expect(url).toMatch(/^\/media\/c\/[\w-]+\.png$/);
    expect((await t.fetch(url)).status).toBe(200);
    const top = await t.adminJson('/categories', 'POST', { name: 'Organic Baby Care', templateId: 'simple', iconUrl: url });
    expect(top.status).toBe(201);
    const [parent] = await t.sql('SELECT id, code, icon_url FROM categories WHERE id = ?', top.body.id);
    expect(parent).toMatchObject({ code: 'OBC', icon_url: url });
    const sub = await t.adminJson('/categories', 'POST', { name: 'Baby Soap', parentId: parent.id });
    expect(sub.status).toBe(201);
    expect((await t.sql('SELECT code, template_id, depth FROM categories WHERE id = ?', sub.body.id))[0]).toEqual({ code: 'OBC', template_id: null, depth: 2 });
  });
});

describe('settings without code: banners with pictures and social links', () => {
  const upload = async (path: string, name: string) => {
    const form = new FormData();
    form.append('file', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: 'image/png' }));
    return t.fetch(path, { method: 'POST', body: form, headers: { cookie: t.admin.cookie, 'x-csrf-token': t.admin.csrf, origin: 'https://absvai.test' } });
  };

  it('uploads a banner picture and shows the banner on the homepage', async () => {
    const up = await upload('/api/admin/banner-image', 'gur.png');
    expect(up.status).toBe(201);
    const { url } = (await up.json()) as { url: string };
    expect(url).toMatch(/^\/media\/b\/[\w-]+\.png$/);
    expect((await t.fetch(url)).status).toBe(200);
    const promo = { headline: 'Pitha week', subline: 'Rice flour and gur', cta_text: 'See deals', cta_href: '/deals', theme: 'leaf', image: url };
    const r = await t.adminJson('/settings', 'PUT', { promo_banner: JSON.stringify(promo), default_banners: JSON.stringify([{ ...promo, headline: 'Gur is here' }]) });
    expect(r.status).toBe(200);
    const html = await (await t.fetch('/')).text();
    expect(html).toContain('Pitha week');
    expect(html).toContain(url);
  });

  it('refuses unsafe or broken banners with a plain message', async () => {
    const put = (b: object) => t.adminJson('/settings', 'PUT', { default_banners: JSON.stringify([b]) });
    expect((await put({ headline: 'X', cta_href: 'javascript:alert(1)' })).body.error).toMatch(/button link should be a page of the store/);
    expect((await put({ headline: 'X', image: '/media/../secret.png' })).body.error).toMatch(/upload the picture again/);
    expect((await put({ headline: '' })).body.error).toBe('Banner 1: add a headline.');
    expect((await put({ headline: 'X', theme: 'neon' })).body.error).toMatch(/choose one of the colours/);
    const [season] = await t.sql<{ id: number; name: string }>('SELECT id, name FROM seasons ORDER BY id LIMIT 1');
    const bad = await t.adminJson(`/seasons/${season.id}`, 'PUT', { name: season.name, banners: [{ headline: 'Y', cta_href: 'javascript:alert(1)' }] });
    expect(bad.status).toBe(400);
  });

  it('saves social links from plain fields and shows them in the footer', async () => {
    expect((await t.adminJson('/settings', 'PUT', { social_links: JSON.stringify({ facebook: 'http://facebook.com/absvai' }) })).status).toBe(400);
    expect((await t.adminJson('/settings', 'PUT', { social_links: JSON.stringify({ facebook: 'https://evil.example/absvai' }) })).status).toBe(400);
    expect((await t.adminJson('/settings', 'PUT', { social_links: JSON.stringify({ myspace: 'https://myspace.com/x' }) })).status).toBe(400);
    const ok = await t.adminJson('/settings', 'PUT', { social_links: JSON.stringify({ facebook: 'https://www.facebook.com/absvai', tiktok: 'https://www.tiktok.com/@absvai' }) });
    expect(ok.status).toBe(200);
    const html = await (await t.fetch('/shop')).text();
    expect(html).toMatch(/class="footer-social"[\s\S]*href="https:\/\/www\.facebook\.com\/absvai"[\s\S]*href="https:\/\/www\.tiktok\.com\/@absvai"/);
  });
});

describe('fast first load', () => {
  const form = (fields: Record<string, string | File>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };
  const webp = (name: string, n: number) => new File([new Uint8Array(n).fill(7)], name, { type: 'image/webp' });
  const post = (path: string, body: FormData) => t.fetch(path, { method: 'POST', body, headers: { cookie: t.admin.cookie, 'x-csrf-token': t.admin.csrf, origin: 'https://absvai.test' } });

  it('puts the stylesheet and brand colours inside the page, and links the file only if it cannot', async () => {
    const assets = t.env.ASSETS;
    try {
      (t.env as { ASSETS: unknown }).ASSETS = { fetch: async () => new Response('.card{color:red}</style><script>') };
      resetPageCss();
      expect((await t.adminJson('/settings', 'PUT', { brand_colors: { chili: '#A0201A' } })).status).toBe(200);
      const html = await (await t.fetch('/')).text();
      expect(html).toContain('<style>.card{color:red}<\\/style><script></style>');
      expect(html).toContain('<style>:root{--chili:#A0201A}</style>');
      expect(html).not.toMatch(/<link rel="stylesheet"/);
      // Cart badges start hidden, so "0" never flashes before the cart is read.
      expect(html.match(/<span class="badge" data-cart-count="true" hidden="">0<\/span>/g)).toHaveLength(2);
      (t.env as { ASSETS: unknown }).ASSETS = { fetch: async () => new Response('', { status: 404 }) };
      resetPageCss();
      expect(await (await t.fetch('/shop')).text()).toContain('<link rel="stylesheet" href="/css/app.css"/>');
    } finally {
      (t.env as { ASSETS: unknown }).ASSETS = assets;
      resetPageCss();
      await t.adminJson('/settings', 'PUT', { brand_colors: {} });
    }
  });

  it('stores 480 and 960 px copies of a photo and phones get them through srcset', async () => {
    const up = await post('/api/admin/media', form({ file: webp('gur.webp', 9000), file_480: webp('gur-480.webp', 900), file_960: webp('gur-960.webp', 3000), productId: String(ids.gurProduct), kind: 'image', width: '1600', height: '1200' }));
    expect(up.status).toBe(201);
    const { id, url } = (await up.json()) as { id: number; url: string };
    expect((await (await t.fetch(url.replace('.webp', '-480.webp'))).arrayBuffer()).byteLength).toBe(900);
    expect((await (await t.fetch(url.replace('.webp', '-960.webp'))).arrayBuffer()).byteLength).toBe(3000);
    const others = await t.sql<{ id: number }>("SELECT id FROM product_media WHERE product_id = ? AND kind = 'image' AND id != ?", ids.gurProduct, id);
    await t.adminJson(`/products/${ids.gurProduct}/media-order`, 'PUT', { ids: [id, ...others.map(o => o.id)] });
    const pdp = await (await t.fetch('/p/khejur-patali-gur')).text();
    expect(pdp).toContain(`srcset="${url.replace('.webp', '-480.webp')} 480w, ${url.replace('.webp', '-960.webp')} 960w, ${url} 1600w"`);
    expect(await (await t.fetch('/c/khejur-gur')).text()).toContain(`${url.replace('.webp', '-480.webp')} 480w`);
    // Removing the photo removes its copies.
    expect((await t.adminJson(`/media/${id}`, 'DELETE')).status).toBe(200);
    expect((await t.fetch(url.replace('.webp', '-480.webp'))).status).toBe(404);
    expect(await t.env.MEDIA!.head(url.slice('/media/'.length).replace('.webp', '-960.webp'))).toBeNull();
  });

  it('serves the original for a photo uploaded before copies existed', async () => {
    await t.env.MEDIA!.put(`p/${ids.gurProduct}/older-photo.webp`, new Uint8Array(1234));
    const r = await t.fetch(`/media/p/${ids.gurProduct}/older-photo-480.webp`);
    expect(r.status).toBe(200);
    expect((await r.arrayBuffer()).byteLength).toBe(1234);
    expect((await t.fetch(`/media/p/${ids.gurProduct}/missing-480.webp`)).status).toBe(404);
  });

  it('category and banner pictures keep their copies too', async () => {
    const up = await post('/api/admin/banner-image', form({ file: webp('b.webp', 5000), file_480: webp('b-480.webp', 500) }));
    const { url } = (await up.json()) as { url: string };
    expect((await (await t.fetch(url.replace('.webp', '-480.webp'))).arrayBuffer()).byteLength).toBe(500);
    // A copy of another type, or a PNG original (whose name has no copy form), is ignored.
    const png = await post('/api/admin/category-image', form({ file: new File([new Uint8Array([0x89, 0x50])], 'c.png', { type: 'image/png' }), file_480: webp('c-480.webp', 50) }));
    const c = (await png.json()) as { url: string };
    expect((await (await t.fetch(c.url)).arrayBuffer()).byteLength).toBe(2);
  });
});

describe('deploying before R2 is switched on', () => {
  it('keeps the store working and explains uploads are off', async () => {
    const media = t.env.MEDIA;
    delete (t.env as { MEDIA?: unknown }).MEDIA;
    try {
      const form = new FormData();
      form.append('file', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'logo.png', { type: 'image/png' }));
      const r = await t.fetch('/api/admin/brand-asset', { method: 'POST', body: form, headers: { cookie: t.admin.cookie, 'x-csrf-token': t.admin.csrf, origin: 'https://absvai.test' } });
      expect(r.status).toBe(503);
      expect(((await r.json()) as { error: string }).error).toMatch(/R2 Object Storage/);
      expect((await t.fetch('/media/brand/logo-x.png')).status).toBe(404);
      expect((await t.fetch('/')).status).toBe(200);
      expect((await t.adminJson('/dashboard')).body.health.find((h: { label: string }) => h.label === 'Photo storage').ok).toBe(false);
    } finally {
      (t.env as { MEDIA?: unknown }).MEDIA = media;
    }
  });
});

describe('settings: tracking IDs, encrypted credentials, audit (Section 19)', () => {
  it('rejects script in a tracking ID and accepts a well-formed one, which then opens the CSP', async () => {
    expect((await t.adminJson('/settings', 'PUT', { gtm_id: '<script>alert(1)</script>' })).status).toBe(400);
    expect((await t.adminJson('/settings', 'PUT', { gtm_id: 'GTM-AB12CD3' })).status).toBe(200);
    expect((await t.fetch('/')).headers.get('content-security-policy')).toContain('https://www.googletagmanager.com');
  });

  it('stores credentials encrypted, shows them masked and keeps them out of the audit log', async () => {
    expect((await t.adminJson('/settings', 'PUT', { steadfast_api_key: 'sf_live_9f8e7d6c5b4a' })).status).toBe(200);
    const [raw] = await t.sql("SELECT value, is_secret FROM settings WHERE key = 'steadfast_api_key'");
    expect(raw.is_secret).toBe(1);
    expect(raw.value).toMatch(/^v1:/);
    expect(raw.value).not.toContain('9f8e7d6c5b4a');
    const got = (await t.adminJson('/settings')).body.values.steadfast_api_key;
    expect(got).toMatchObject({ set: true, masked: '••••5b4a' });
    const audit = await t.sql("SELECT detail FROM audit_log WHERE action = 'settings.update'");
    expect(audit.map(a => a.detail).join(' ')).not.toContain('9f8e7d6c5b4a');
  });

  it('warns when brand colours would be hard to read', async () => {
    const r = await t.adminJson('/settings', 'PUT', { brand_colors: { chili: '#FFC0C0' } });
    expect(r.body.contrastWarnings.join(' ')).toMatch(/White text on chili/);
  });
});

describe('scale: the order list uses indexes, never a full scan (Section 21)', () => {
  const plan = async (f: Parameters<typeof listOrdersQuery>[0], cursor: Parameters<typeof listOrdersQuery>[1] = null) => {
    const q = listOrdersQuery(f, cursor, 50);
    return (await t.sql<{ detail: string }>(`EXPLAIN QUERY PLAN ${q.sql}`, ...q.params)).map(r => r.detail);
  };
  it.each([
    ['default list', {}],
    ['a stage tab', { status: 'confirmed' as const }],
    ['a phone prefix', { phoneRange: ['88017', '88018'] as [string, string] }],
    ['an order number', { numberPrefix: ['AV-2610', 'AV-2610￿', 'order_no'] as [string, string, 'order_no'] }],
    ['my orders', { assignedTo: 'x' }],
    ['unassigned', { assignedTo: '' }],
    ['high risk', { risk: 'high' }],
    ['advances to verify', { advance: 'submitted' }],
    ['pre-orders', { preOrder: true }],
    ['on hold', { status: 'held' as const }],
  ])('%s', async (_name, f) => {
    const details = await plan(f as never, { createdAt: '2026-10-30T00:00:00Z', id: 999 });
    expect(details.filter(d => /^SCAN o\b/.test(d) && !/USING (COVERING )?INDEX/.test(d))).toEqual([]);
  });
});
