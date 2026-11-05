/**
 * Customer accounts: open an account or sign in with a 6-digit code sent by email (Resend, from the shop's verified
 * domain, replies to the owner's Gmail), the account page (orders, invoices, offers), a checkout that fills itself in,
 * and the customer's invoice page.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from './env';

let t: TestEnv;
const realFetch = globalThis.fetch;
const sent: Array<Record<string, any>> = [];
let resendFails = false;

beforeAll(async () => {
  t = await createTestEnv();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input instanceof Request ? input.url : input).startsWith('https://api.resend.com/')) {
      if (resendFails) return new Response(JSON.stringify({ message: 'The vandarmart.com domain is not verified.' }), { status: 403 });
      sent.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ id: `re_${sent.length}` }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  t.env.RESEND_API_KEY = 're_test_key';
  t.env.EMAIL_DOMAIN = 'vandarmart.com';
});
afterAll(async () => { globalThis.fetch = realFetch; await t?.dispose(); });

let ip = 0;
async function post(path: string, body: unknown, cookie = '', method = 'POST') {
  const r = await t.fetch(path, { method, headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.7.0.${++ip}`, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as Record<string, any>, cookies: r.headers.getSetCookie().map(c => c.split(';')[0]) };
}
const codeIn = (mail: Record<string, any>) => String(mail.text).match(/\b(\d{6})\b/)![1];

async function signUp(email: string, phone = '01755123456') {
  expect((await post('/api/account/code', { mode: 'signup', email, name: 'রহিম উদ্দিন', phone })).status).toBe(200);
  const r = await post('/api/account/verify', { email, code: codeIn(sent.at(-1)!) });
  expect(r.status).toBe(200);
  return r.cookies.filter(c => c.startsWith('__Host-vm_acct=') || c.startsWith('vm_in=')).join('; ');
}

describe('opening an account with an email code', () => {
  it('emails the code from the shop domain with replies to the owner, and never keeps it in the log', async () => {
    const r = await post('/api/account/code', { mode: 'signup', email: 'Rahim@Example.com', name: 'রহিম উদ্দিন', phone: '01755123456' });
    expect(r.body).toMatchObject({ ok: true, email: 'rahim@example.com', signUp: true });
    expect(r.body.devCode).toBeUndefined();
    const mail = sent.at(-1)!;
    expect(mail).toMatchObject({ from: 'Vandar Mart <hello@vandarmart.com>', to: ['rahim@example.com'], reply_to: 'absvai1020@gmail.com' });
    expect(mail.subject).toMatch(/^\d{6} · Vandar Mart অ্যাকাউন্ট খোলার কোড$/);
    const [log] = await t.sql<Record<string, string>>("SELECT subject, html, text, status FROM email_log WHERE kind = 'account_code' ORDER BY id DESC LIMIT 1");
    expect(log).toEqual({ subject: '•••••• · Vandar Mart অ্যাকাউন্ট খোলার কোড', html: '', text: '', status: 'sent' });
    // No account until the right code is typed.
    expect(await t.sql("SELECT id FROM customer_accounts WHERE email = 'rahim@example.com'")).toEqual([]);
    // A wrong code says so in Bangla; the right one opens the account and signs in.
    const wrong = await post('/api/account/verify', { email: 'rahim@example.com', code: '000000' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toMatch(/কোডটি মেলেনি/);
    const ok = await post('/api/account/verify', { email: 'rahim@example.com', code: codeIn(mail).replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[Number(d)]) }); // Bangla digits work too
    expect(ok.status).toBe(200);
    expect(ok.body.account).toMatchObject({ name: 'রহিম উদ্দিন', email: 'rahim@example.com', phone: '01755123456', offers: true });
    expect(ok.cookies.some(c => c.startsWith('__Host-vm_acct='))).toBe(true);
    // The offers choice reaches the shop's customer list for that mobile number.
    expect(await t.sql("SELECT email, email_marketing FROM customers WHERE phone = '8801755123456'")).toEqual([{ email: 'rahim@example.com', email_marketing: 1 }]);
    // The code works once.
    expect((await post('/api/account/verify', { email: 'rahim@example.com', code: codeIn(mail) })).status).toBe(400);
  });

  it('locks a code after five wrong tries', async () => {
    await post('/api/account/code', { mode: 'signin', email: 'try@example.com' });
    for (let i = 0; i < 5; i++) await post('/api/account/verify', { email: 'try@example.com', code: '111111' });
    const r = await post('/api/account/verify', { email: 'try@example.com', code: codeIn(sent.at(-1)!) });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/নতুন কোড পাঠান/);
  });

  it('sends a sign-in code to any email (it never tells who has an account) and signs in', async () => {
    const r = await post('/api/account/code', { mode: 'signin', email: 'new-person@example.com' });
    expect(r.body).toMatchObject({ ok: true, signUp: false });
    const v = await post('/api/account/verify', { email: 'new-person@example.com', code: codeIn(sent.at(-1)!) });
    expect(v.body.account).toMatchObject({ email: 'new-person@example.com', name: 'new-person' });
  });

  it('refuses a bad email or mobile number, and says so when email cannot go out', async () => {
    expect((await post('/api/account/code', { mode: 'signin', email: 'not-an-email' })).body.error).toMatch(/সঠিক ইমেইল/);
    expect((await post('/api/account/code', { mode: 'signup', email: 'x@example.com', name: 'X Y', phone: '123' })).body.error).toMatch(/সঠিক মোবাইল নম্বর/);
    resendFails = true;
    const r = await post('/api/account/code', { mode: 'signin', email: 'down@example.com' });
    resendFails = false;
    expect(r.status).toBe(503);
    expect(r.body.error).toMatch(/ইমেইলে কোড পাঠানো যাচ্ছে না/);
    expect(await t.sql("SELECT email FROM account_codes WHERE email = 'down@example.com'")).toEqual([]);
    // Without the shop's own domain, customers cannot be emailed at all (Resend's test sender only reaches the owner).
    t.env.EMAIL_DOMAIN = undefined;
    expect((await post('/api/account/code', { mode: 'signin', email: 'nodomain@example.com' })).status).toBe(503);
    t.env.EMAIL_DOMAIN = 'vandarmart.com';
  });
});

describe('the signed-in customer', () => {
  it('orders with the details filled in, sees the order with tracking and the invoice, and gets member offers', async () => {
    const cookie = await signUp('karim@example.com', '01866123456');
    const me = await (await t.fetch('/api/account/me', { headers: { cookie } })).json() as Record<string, any>;
    expect(me.account).toMatchObject({ name: 'রহিম উদ্দিন', phone: '01866123456', addressLine: '' });

    // An order while signed in: the receipt goes to the account email, the address is kept for next time.
    const s = await t.checkoutSession();
    const variantId = (await t.sql<{ id: number }>("SELECT id FROM product_variants WHERE sku = 'SPC-MMSL-250G-0001'"))[0].id;
    const zoneId = (await t.sql<{ id: number }>("SELECT id FROM delivery_zones WHERE name = 'ঢাকার বাইরে'"))[0].id;
    const placed = await t.json('/api/checkout/place', {
      method: 'POST', headers: { cookie: `${s.cookie}; ${cookie}`, 'cf-connecting-ip': '10.7.9.1' },
      body: { phone: '01866123456', name: 'রহিম উদ্দিন', zoneId, addressLine: 'বাসা ১২, পাংশা, রাজবাড়ী', paymentMethod: 'cod', token: s.token, lines: [{ variantId, qty: 2 }] },
    });
    expect(placed.status).toBe(201);
    const [o] = await t.sql<Record<string, any>>('SELECT order_no, access_token, customer_email FROM orders WHERE id = ?', placed.body.orderId);
    expect(o.customer_email).toBe('karim@example.com');
    expect(await t.sql("SELECT address_line, zone_id FROM customer_accounts WHERE email = 'karim@example.com'")).toEqual([{ address_line: 'বাসা ১২, পাংশা, রাজবাড়ী', zone_id: zoneId }]);

    // Offers: only the coupons the owner shows to members.
    expect((await t.adminJson('/coupons', 'POST', { code: 'MEMBER50', kind: 'fixed', value: 5000, minSubtotalPaisa: 50000, isActive: true, forMembers: true })).status).toBe(201);
    expect((await t.adminJson('/coupons', 'POST', { code: 'SECRET30', kind: 'percent', value: 30, isActive: true })).status).toBe(201);

    const html = await (await t.fetch('/account', { headers: { cookie } })).text();
    expect(html).toContain('আসসালামু আলাইকুম, রহিম উদ্দিন');
    expect(html).toContain(o.order_no);
    expect(html).toContain(`/order/${o.order_no}/invoice?t=${o.access_token}`);
    expect(html).toContain('MEMBER50');
    expect(html).toContain('৳50 ছাড়');
    expect(html).not.toContain('SECRET30');
    expect(html).not.toContain('Turnstile');

    // Details can be changed; sign out ends it.
    expect((await post('/api/account/me', { name: 'Karim', phone: '01866123456', addressLine: 'Road 2, Rajbari', offers: false }, cookie, 'PUT')).status).toBe(200);
    expect(await t.sql("SELECT email_marketing FROM customers WHERE phone = '8801866123456'")).toEqual([{ email_marketing: 0 }]);
    const out = await post('/api/account/logout', {}, cookie);
    expect(out.cookies).toContain('__Host-vm_acct=');
    expect(await (await t.fetch('/account')).text()).toContain('ইমেইলে কোড পাঠান');
  });

  it('cannot read anyone else: a forged cookie is ignored', async () => {
    const me = await (await t.fetch('/api/account/me', { headers: { cookie: '__Host-vm_acct=eyJhIjoxLCJleHAiOjk5OTk5OTk5OTl9.forged' } })).json() as Record<string, any>;
    expect(me.account).toBeNull();
  });
});

describe('the customer invoice', () => {
  it('opens with the order link, in Bangla, ready to save as PDF; a wrong link gets nothing', async () => {
    const [o] = await t.sql<Record<string, any>>("SELECT order_no, access_token, total_paisa FROM orders WHERE customer_email = 'karim@example.com'");
    const r = await t.fetch(`/order/${o.order_no}/invoice?t=${o.access_token}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    const html = await r.text();
    for (const text of ['অর্ডার রসিদ', o.order_no, 'রহিম উদ্দিন', 'বাসা ১২, পাংশা, রাজবাড়ী (Pangsa, Rajbari)', 'ডাউনলোড / প্রিন্ট (PDF)', 'সর্বমোট', '<svg']) expect(html).toContain(text);
    expect((await t.fetch(`/order/${o.order_no}/invoice?t=wrong`)).status).toBe(404);
    expect((await t.fetch(`/order/${o.order_no}/invoice`)).status).toBe(404);
    // The order page links to it.
    expect(await (await t.fetch(`/order/${o.order_no}?t=${o.access_token}`)).text()).toContain('ইনভয়েস ডাউনলোড করুন');
  });
});
