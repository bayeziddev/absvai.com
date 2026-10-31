/**
 * Owner-requested features: SMS code off until a gateway is connected, emails through Resend (owner alerts, customer
 * receipt/invoice, offers with unsubscribe), the shop and admin assistants (built-in answers and Workers AI), the
 * popup banner and the shop name in the header.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setOwnerGuide } from '../../worker/src/services/assistant';
import { unsubscribeToken } from '../../worker/src/services/email';
import { createTestEnv, type TestEnv } from './env';

let t: TestEnv;
const ids: Record<string, number> = {};
const realFetch = globalThis.fetch;
const sentToResend: Array<{ headers: Record<string, string>; body: Record<string, unknown> }> = [];

beforeAll(async () => {
  t = await createTestEnv();
  const one = async (sql: string, ...p: unknown[]) => (await t.sql<{ id: number }>(sql, ...p))[0].id;
  ids.division = await one("SELECT id FROM geo_divisions WHERE name = 'Dhaka'");
  ids.tangail = await one("SELECT id FROM geo_districts WHERE name = 'Tangail'");
  ids.kalihati = await one("SELECT id FROM geo_upazilas WHERE name = 'Kalihati'");
  ids.masala = await one("SELECT id FROM product_variants WHERE sku = 'SPC-MMSL-250G-0001'");
  // Resend stand-in: accepts every email and remembers it.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === 'https://api.resend.com/emails') {
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((v, k) => { headers[k] = v; });
      sentToResend.push({ headers, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ id: `re_${sentToResend.length}` }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return realFetch(input, init);
  }) as typeof fetch;
});
afterAll(async () => { globalThis.fetch = realFetch; await t?.dispose(); });

let n = 0;
async function place(over: Record<string, unknown> = {}) {
  const s = await t.checkoutSession();
  const r = await t.json('/api/checkout/place', {
    method: 'POST', headers: { cookie: s.cookie, 'cf-connecting-ip': `10.7.0.${++n}` },
    body: { phone: `0171${String(n).padStart(7, '0')}`, name: 'Rahima Akter', paymentMethod: 'cod', lines: [{ variantId: ids.masala, qty: 1 }], token: s.token, divisionId: ids.division, districtId: ids.tangail, upazilaId: ids.kalihati, addressLine: 'House 3, Bazar Road', ...over },
  });
  await t.settle();
  return r;
}
const log = (orderId: number) => t.sql<{ kind: string; status: string; to_email: string; error: string | null }>('SELECT kind, status, to_email, error FROM email_log WHERE order_id = ? ORDER BY id', orderId);

describe('emails through Resend', () => {
  it('skips (and explains) every email until the Resend key is connected', async () => {
    const r = await place({ email: 'rahima@example.com' });
    expect(r.status).toBe(201);
    expect((await log(r.body.orderId)).map(e => [e.kind, e.status])).toEqual([['owner_new_order', 'skipped'], ['customer_receipt', 'skipped']]);
    expect((await log(r.body.orderId))[0].error).toMatch(/RESEND_API_KEY/);
    expect(sentToResend).toHaveLength(0);
  });

  it('emails the owner every new order; customers only once the shop has its own sender domain', async () => {
    t.env.RESEND_API_KEY = 're_test_key';
    const r = await place({ email: 'Rahima@Example.com' });
    const rows = await log(r.body.orderId);
    expect(rows.find(e => e.kind === 'owner_new_order')).toMatchObject({ status: 'sent', to_email: 'absvai1020@gmail.com' });
    expect(rows.find(e => e.kind === 'customer_receipt')).toMatchObject({ status: 'skipped', to_email: 'rahima@example.com' });
    const owner = sentToResend.at(-1)!;
    expect(owner.headers.authorization).toBe('Bearer re_test_key');
    expect(owner.headers['idempotency-key']).toMatch(/^absvai-email-\d+$/);
    expect(owner.body).toMatchObject({ from: 'Abs Vai <onboarding@resend.dev>', to: ['absvai1020@gmail.com'], reply_to: 'absvai1020@gmail.com' });
    expect(String(owner.body.subject)).toMatch(/^New order AV-\d{6}-\d{4} · ৳/);
    expect(String(owner.body.html)).toContain('Rahima Akter');

    expect((await t.adminJson('/settings', 'PUT', { email_from: 'Abs Vai <orders@absvai.com>' })).status).toBe(200);
    const r2 = await place({ email: 'rahima@example.com', emailOffers: true });
    expect((await log(r2.body.orderId)).map(e => [e.kind, e.status])).toEqual([['owner_new_order', 'sent'], ['customer_receipt', 'sent']]);
    // Confirming sends the invoice; handing to the courier sends "on the way".
    await t.adminJson(`/orders/${r2.body.orderId}/call`, 'POST', { outcome: 'confirmed' });
    expect((await t.adminJson(`/orders/${r2.body.orderId}/status`, 'POST', { to: 'confirmed' })).status).toBe(200);
    await t.settle();
    const inv = (await log(r2.body.orderId)).find(e => e.kind === 'customer_invoice');
    expect(inv).toMatchObject({ status: 'sent', to_email: 'rahima@example.com' });
    expect(String(sentToResend.at(-1)!.body.subject)).toMatch(/^Invoice INV-/);
    // The same event never emails twice.
    await t.adminJson(`/orders/${r2.body.orderId}/status`, 'POST', { to: 'confirmed' });
    await t.settle();
    expect((await log(r2.body.orderId)).filter(e => e.kind === 'customer_invoice')).toHaveLength(1);
  });

  it('refuses a broken email at checkout and a broken alerts address in settings', async () => {
    expect((await place({ email: 'not-an-email' })).body.error).toMatch(/email address/);
    expect((await t.adminJson('/settings', 'PUT', { notify_email: 'owner at gmail' })).status).toBe(400);
  });

  it('sends a test email from the Emails page and lists it', async () => {
    const r = await t.adminJson('/emails/test', 'POST', {});
    expect(r.body.status).toBe('sent');
    const page = await t.adminJson('/emails');
    expect(page.body).toMatchObject({ connected: true, canEmailCustomers: true, offersCount: 1 });
    expect(page.body.recent[0]).toMatchObject({ kind: 'test', status: 'sent' });
  });

  it('sends offers only to customers who asked, each with a working unsubscribe link', async () => {
    const r = await t.adminJson('/emails/offers', 'POST', { subject: 'Winter offer', message: 'Fresh gur is here this week.', ctaText: 'Shop now', ctaHref: '/deals' });
    expect(r.body.queued).toBe(1);
    await t.settle();
    const offer = sentToResend.find(e => e.body.subject === 'Winter offer')!;
    expect(offer.body.to).toEqual(['rahima@example.com']);
    const link = String(offer.body.text).match(/Unsubscribe: (\S+)/)![1];
    const [cust] = await t.sql<{ id: number }>("SELECT id FROM customers WHERE email = 'rahima@example.com' AND email_marketing = 1");
    expect(link).toBe(`https://absvai.test/email/unsubscribe?c=${cust.id}&t=${await unsubscribeToken(t.env, cust.id)}`);
    expect(await (await t.fetch(`/email/unsubscribe?c=${cust.id}&t=wrong`)).text()).toContain('Link not valid');
    expect(await (await t.fetch(link.replace('https://absvai.test', ''))).text()).toContain('You are unsubscribed');
    expect((await t.adminJson('/emails/offers', 'POST', { subject: 'Again', message: 'Another offer for you.' })).body.error).toMatch(/No customer/);
  });
});

describe('shop assistant (chat popup)', () => {
  const ask = (content: string) => t.json('/api/assistant', { method: 'POST', body: { messages: [{ role: 'user', content }] } });

  it('answers from the shop data without AI: delivery charges and matching products', async () => {
    const d = await ask('What is the delivery charge to Tangail?');
    expect(d.body.ai).toBe(false);
    expect(d.body.reply).toMatch(/Outside Dhaka ৳\d+/);
    const p = await ask('do you have masala?');
    expect(p.body.products[0]).toMatchObject({ slug: expect.any(String), pricePaisa: expect.any(Number) });
    expect((await ask('')).status).toBe(400);
  });

  it('uses Workers AI with the shop facts, and shows only the products it mentions', async () => {
    const calls: Array<{ model: string; input: { messages: Array<{ role: string; content: string }> } }> = [];
    t.env.AI = { run: async (model: string, input: { messages: Array<{ role: string; content: string }> }) => { calls.push({ model, input }); return { response: 'Yes! Try our masala: /p/42-item-master-masala' }; } } as unknown as Ai;
    try {
      const r = await ask('masala ache?');
      expect(r.body.ai).toBe(true);
      expect(calls[0].model).toBe('@cf/google/gemma-4-26b-a4b-it');
      expect(calls[0].input.messages[0].content).toMatch(/Use ONLY the facts below[\s\S]*Delivery charges by area/);
      expect(r.body.products.every((p: { slug: string }) => r.body.reply.includes(p.slug))).toBe(true);
      // The owner's daily limit switches the AI off; the built-in answers take over.
      await t.adminJson('/settings', 'PUT', { assistant_daily_limit: '0' });
      expect((await ask('masala ache?')).body.ai).toBe(false);
    } finally {
      delete (t.env as { AI?: unknown }).AI;
      await t.adminJson('/settings', 'PUT', { assistant_daily_limit: '300' });
    }
  });
});

describe('admin assistant', () => {
  it('finds the right part of the owner guide when the AI is off', async () => {
    setOwnerGuide('# Guide\n\n## Add a category\n\nCategories → + Add category: type the name, add a picture.\n\n## Start a season\n\nSeasons → open the season.');
    const r = await t.adminJson('/assistant', 'POST', { messages: [{ role: 'user', content: 'how do I add a new category?' }], page: 'Products' });
    expect(r.body.ai).toBe(false);
    expect(r.body.sections[0]).toMatchObject({ title: 'Add a category' });
  });
});

describe('website: popup banner and shop name', () => {
  it('shows the popup on the homepage only (never on checkout) and the shop name in the header', async () => {
    const popup = { enabled: true, headline: 'Winter offer', cta_text: 'See deals', cta_href: '/deals', theme: 'leaf', delay: 2, frequency: 'day', where: 'home' };
    expect((await t.adminJson('/settings', 'PUT', { popup_banner: JSON.stringify(popup), store_name: 'Rahim Store' })).status).toBe(200);
    const home = await (await t.fetch('/')).text();
    expect(home).toMatch(/<dialog class="popup theme-leaf" data-popup="true" data-key="\w+" data-delay="2" data-freq="day"/);
    expect(home).toContain('Rahim<span>Store</span>');
    expect(await (await t.fetch('/shop')).text()).not.toContain('data-popup');
    expect((await t.adminJson('/settings', 'PUT', { popup_banner: JSON.stringify({ ...popup, where: 'all' }) })).status).toBe(200);
    expect(await (await t.fetch('/shop')).text()).toContain('data-popup');
    expect(await (await t.fetch('/checkout')).text()).not.toContain('data-popup');
    expect((await t.adminJson('/settings', 'PUT', { popup_banner: JSON.stringify({ ...popup, delay: 999 }) })).body.error).toMatch(/0 to 60 seconds/);
    expect((await t.adminJson('/settings', 'PUT', { popup_banner: JSON.stringify({ ...popup, cta_href: 'javascript:alert(1)' }) })).status).toBe(400);
  });
});

describe('couriers: Steadfast and Pathao', () => {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> | null }> = [];
  let courierFetch: typeof fetch;
  let sfSeq = 1424107;
  const statusOf = async (id: number) => (await t.sql<{ status: string; sub_status: string | null; tracking_id: string | null; consignment_id: string | null; courier: string | null }>('SELECT status, sub_status, tracking_id, consignment_id, courier FROM orders WHERE id = ?', id))[0];
  async function packedOrder() {
    const r = await place();
    const id = r.body.orderId as number;
    await t.adminJson(`/orders/${id}/call`, 'POST', { outcome: 'confirmed' });
    expect((await t.adminJson(`/orders/${id}/status`, 'POST', { to: 'confirmed' })).status).toBe(200);
    expect((await t.adminJson(`/orders/${id}/status`, 'POST', { to: 'packed' })).status).toBe(200);
    return { id, orderNo: r.body.orderNo as string };
  }

  beforeAll(() => {
    const before = globalThis.fetch;
    courierFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!/packzy\.com|pathao\.com/.test(url)) return before(input, init);
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((v, k) => { headers[k] = v; });
      calls.push({ url, method: init?.method ?? 'GET', headers, body: init?.body ? JSON.parse(String(init.body)) : null });
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
      if (url.endsWith('/create_order')) { const n = sfSeq++; return json({ status: 200, message: 'Consignment has been created successfully.', consignment: { consignment_id: n, tracking_code: `15BA${n}`, status: 'in_review' } }); }
      if (url.endsWith('/get_balance')) return json({ status: 200, current_balance: 1500 });
      if (url.includes('/status_by_cid/')) return json({ status: 200, delivery_status: 'delivered' });
      if (url.endsWith('/issue-token')) return json({ token_type: 'Bearer', expires_in: 3600, access_token: 'pathao-token' });
      if (url.endsWith('/stores')) return json({ data: { data: [{ store_id: 777, store_name: 'Abs Vai Tangail' }] } });
      if (url.endsWith('/city-list')) return json({ data: { data: [{ city_id: 9, city_name: 'Tangail' }] } });
      if (url.includes('/zone-list')) return json({ data: { data: [{ zone_id: 91, zone_name: 'Kalihati' }] } });
      if (url.endsWith('/aladdin/api/v1/orders')) return json({ data: { consignment_id: 'DL121224VS8TEN', merchant_order_id: 'x', order_status: 'Pending', delivery_fee: 110 } });
      return json({ message: 'not found' }, 404);
    }) as typeof fetch;
    globalThis.fetch = courierFetch;
  });

  it('books a packed order with Steadfast, gets the tracking code and moves it to In Courier', async () => {
    expect((await t.adminJson('/settings', 'PUT', { steadfast_api_key: 'sf-key', steadfast_secret_key: 'sf-secret' })).status).toBe(200);
    expect((await t.adminJson('/couriers/steadfast/test', 'POST', {})).body.message).toMatch(/Balance: ৳1,500/);
    const { id, orderNo } = await packedOrder();
    const r = await t.adminJson(`/orders/${id}/book`, 'POST', { courier: 'steadfast' });
    expect(r.body).toMatchObject({ ok: true, consignmentId: '1424107', trackingId: '15BA1424107' });
    expect(await statusOf(id)).toMatchObject({ status: 'in_courier', courier: 'steadfast', tracking_id: '15BA1424107', consignment_id: '1424107' });
    const sent = calls.find(c => c.url.endsWith('/create_order'))!;
    expect(sent.headers).toMatchObject({ 'api-key': 'sf-key', 'secret-key': 'sf-secret' });
    expect(sent.body).toMatchObject({ invoice: orderNo, recipient_phone: expect.stringMatching(/^01\d{9}$/), cod_amount: expect.any(Number) });
    // Booking again is harmless.
    expect((await t.adminJson(`/orders/${id}/book`, 'POST', { courier: 'steadfast' })).body.trackingId).toBe('15BA1424107');
    // Only packed orders can be booked.
    const fresh = await place();
    expect((await t.adminJson(`/orders/${fresh.body.orderId}/book`, 'POST', { courier: 'steadfast' })).body.error).toMatch(/Pack order/);
  });

  it('takes Steadfast webhooks only with the right token, and delivered parcels close the order', async () => {
    const { id } = await packedOrder();
    const booked = await t.adminJson(`/orders/${id}/book`, 'POST', { courier: 'steadfast' });
    const cid = booked.body.consignmentId as string;
    const [{ order_no: invoice }] = await t.sql<{ order_no: string }>('SELECT order_no FROM orders WHERE id = ?', id);
    const token = (await t.adminJson('/couriers/setup')).body.steadfast.webhookToken;
    const hook = (auth: string, b: object) => t.fetch('/api/webhooks/steadfast', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(b) });
    expect((await hook('Bearer wrong', { consignment_id: cid, status: 'delivered' })).status).toBe(401);
    expect((await hook(`Bearer ${token}`, { consignment_id: cid, invoice, status: 'hold' })).status).toBe(200);
    expect(await statusOf(id)).toMatchObject({ status: 'in_courier', sub_status: 'on_hold' });
    expect((await hook(`Bearer ${token}`, { consignment_id: cid, invoice, status: 'delivered', cod_amount: 500 })).status).toBe(200);
    expect((await statusOf(id)).status).toBe('delivered');
    // A repeat of the same news changes nothing.
    expect((await (await hook(`Bearer ${token}`, { consignment_id: cid, status: 'delivered' })).json() as { result: string }).result).toBe('ignored');
  });

  it('books with Pathao after the area is chosen once, and Pathao webhooks update the order', async () => {
    expect((await t.adminJson('/settings', 'PUT', { pathao_client_id: '1234', pathao_client_secret: 'pa-secret', pathao_username: 'owner@absvai.test', pathao_password: 'pa-pass', pathao_webhook_integration_secret: 'pathao-handshake' })).status).toBe(200);
    const test = await t.adminJson('/couriers/pathao/test', 'POST', {});
    expect(test.body.stores).toEqual([{ id: '777', name: 'Abs Vai Tangail' }]);
    await t.adminJson('/settings', 'PUT', { pathao_store_id: '777' });
    const { id, orderNo } = await packedOrder();
    const first = await t.adminJson(`/orders/${id}/book`, 'POST', { courier: 'pathao' });
    expect(first.status).toBe(409);
    expect(first.body.details.needsArea).toMatchObject({ upazilaId: ids.kalihati, name: 'Kalihati, Tangail' });
    expect((await t.adminJson('/couriers/pathao/cities')).body).toEqual([{ id: '9', name: 'Tangail' }]);
    expect((await t.adminJson('/couriers/pathao/area', 'PUT', { upazilaId: ids.kalihati, cityId: '9', zoneId: '91' })).status).toBe(200);
    const r = await t.adminJson(`/orders/${id}/book`, 'POST', { courier: 'pathao' });
    expect(r.body.trackingId).toBe('DL121224VS8TEN');
    const sent = calls.filter(c => c.url.endsWith('/aladdin/api/v1/orders')).at(-1)!;
    expect(sent.headers.authorization).toBe('Bearer pathao-token');
    expect(sent.body).toMatchObject({ store_id: 777, merchant_order_id: orderNo, recipient_city: 9, recipient_zone: 91, delivery_type: 48, item_type: 2 });
    expect(Number(sent.body!.item_weight)).toBeGreaterThanOrEqual(0.5);

    const url = new URL((await t.adminJson('/couriers/setup')).body.pathao.webhookUrl);
    const hook = (path: string, b: object) => t.fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    expect((await hook('/api/webhooks/pathao/not-the-token', { consignment_id: 'DL121224VS8TEN', event: 'order.delivered' })).status).toBe(401);
    const shake = await hook(url.pathname, { event: 'webhook_integration' });
    expect(shake.status).toBe(202);
    expect(shake.headers.get('x-pathao-merchant-webhook-integration-secret')).toBe('pathao-handshake');
    await hook(url.pathname, { consignment_id: 'DL121224VS8TEN', merchant_order_id: orderNo, event: 'order.in-transit' });
    expect((await statusOf(id)).sub_status).toBe('in_transit');
    await hook(url.pathname, { consignment_id: 'DL121224VS8TEN', merchant_order_id: orderNo, event: 'order.returned' });
    expect(await statusOf(id)).toMatchObject({ status: 'returned', sub_status: 'in_transit_back' });
  });

  it('asks the courier about quiet parcels from the cron', async () => {
    const { id } = await packedOrder();
    await t.adminJson(`/orders/${id}/book`, 'POST', { courier: 'steadfast' });
    await t.sql("UPDATE orders SET last_courier_update_at = '2026-01-01T00:00:00.000Z' WHERE id = ?", id);
    const { syncCourierStatuses } = await import('../../worker/src/services/couriers');
    expect(await syncCourierStatuses(t.env)).toBeGreaterThanOrEqual(1);
    expect((await statusOf(id)).status).toBe('delivered');
  });
});
