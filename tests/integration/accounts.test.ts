/**
 * Customer accounts: open an account with a password (no code), sign in with the email or the mobile number, and
 * "forgot password" with a 6-digit code sent by email (Resend, from the shop's verified domain, replies to the owner's
 * Gmail). The account page (orders, invoices, offers), a checkout that fills itself in, and the customer's invoice page.
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
      const body = JSON.parse(String(init?.body));
      // Until its DNS records are verified, Resend refuses the shop's domain (the test sender still works).
      if (resendFails && String(body.from).includes('@vandarmart.com')) return new Response(JSON.stringify({ statusCode: 403, name: 'validation_error', message: 'The vandarmart.com domain is not verified. Please, add and verify your domain on https://resend.com/domains' }), { status: 403 });
      sent.push(body);
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
const accountCookie = (cookies: string[]) => cookies.filter(c => c.startsWith('__Host-vm_acct=') || c.startsWith('vm_in=')).join('; ');

async function signUp(email: string, phone: string, password = 'gur-2026') {
  const r = await post('/api/account/signup', { name: 'রহিম উদ্দিন', phone, email, password });
  expect(r.status).toBe(201);
  return accountCookie(r.cookies);
}

describe('opening an account and signing in, with a password', () => {
  it('opens the account at once (no code, no email sent) and signs in with the email or the mobile number', async () => {
    const before = sent.length;
    const r = await post('/api/account/signup', { name: 'রহিম উদ্দিন', phone: '০১৭৫৫১২৩৪৫৬', email: 'Rahim@Example.com', password: 'masala1' }); // Bangla digits work
    expect(r.status).toBe(201);
    expect(r.body.account).toMatchObject({ name: 'রহিম উদ্দিন', email: 'rahim@example.com', phone: '01755123456', offers: true });
    expect(r.cookies.some(c => c.startsWith('__Host-vm_acct='))).toBe(true);
    expect(sent.length).toBe(before);
    const [row] = await t.sql<Record<string, any>>("SELECT password_hash, email_verified_at FROM customer_accounts WHERE email = 'rahim@example.com'");
    expect(row.password_hash).toMatch(/^pbkdf2_sha256\$/); // never the password itself
    expect(row.email_verified_at).toBeNull();
    // The offers choice reaches the shop's customer list for that mobile number.
    expect(await t.sql("SELECT email, email_marketing FROM customers WHERE phone = '8801755123456'")).toEqual([{ email: 'rahim@example.com', email_marketing: 1 }]);

    expect((await post('/api/account/login', { login: 'rahim@example.com', password: 'masala1' })).status).toBe(200);
    expect((await post('/api/account/login', { login: '01755123456', password: 'masala1' })).body.account.email).toBe('rahim@example.com');
    const wrong = await post('/api/account/login', { login: 'rahim@example.com', password: 'nope-nope' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toMatch(/পাসওয়ার্ড মেলেনি/);
    // An unknown email gets the same answer as a wrong password.
    expect((await post('/api/account/login', { login: 'ghost@example.com', password: 'masala1' })).body.error).toBe(wrong.body.error);
  });

  it('refuses a second account for the same email or mobile number, and bad details, in Bangla', async () => {
    expect((await post('/api/account/signup', { name: 'Other', phone: '01755123456', email: 'other@example.com', password: 'secret1' })).body.error).toMatch(/মোবাইল নম্বরে আগেই অ্যাকাউন্ট/);
    expect((await post('/api/account/signup', { name: 'Other', phone: '01855000111', email: 'rahim@example.com', password: 'secret1' })).body.error).toMatch(/ইমেইলে আগেই অ্যাকাউন্ট/);
    expect((await post('/api/account/signup', { name: 'X Y', phone: '123', email: 'x@example.com', password: 'secret1' })).body.error).toMatch(/সঠিক মোবাইল নম্বর/);
    expect((await post('/api/account/signup', { name: 'X Y', phone: '01855000112', email: 'not-an-email', password: 'secret1' })).body.error).toMatch(/সঠিক ইমেইল/);
    expect((await post('/api/account/signup', { name: 'X Y', phone: '01855000113', email: 'x@example.com', password: '123' })).body.error).toMatch(/কমপক্ষে ৬ অক্ষর/);
  });
});

describe('forgot password: a code by email, then a new password', () => {
  it('emails the code from the shop domain with replies to the owner, never logs it, and the code sets a new password', async () => {
    const r = await post('/api/account/reset-code', { email: 'rahim@example.com' });
    expect(r.body).toMatchObject({ ok: true, email: 'rahim@example.com' });
    const mail = sent.at(-1)!;
    expect(mail).toMatchObject({ from: 'Vandar Mart <hello@vandarmart.com>', to: ['rahim@example.com'], reply_to: 'absvai1020@gmail.com' });
    expect(mail.subject).toMatch(/^\d{6} · Vandar Mart সাইন ইন কোড$/);
    const [log] = await t.sql<Record<string, string>>("SELECT subject, html, text, status FROM email_log WHERE kind = 'account_code' ORDER BY id DESC LIMIT 1");
    expect(log).toEqual({ subject: '•••••• · Vandar Mart সাইন ইন কোড', html: '', text: '', status: 'sent' });
    // A wrong code says so; the right one (Bangla digits work too) sets the new password and signs in.
    expect((await post('/api/account/reset', { email: 'rahim@example.com', code: '000000', password: 'newpass1' })).body.error).toMatch(/কোডটি মেলেনি/);
    const ok = await post('/api/account/reset', { email: 'rahim@example.com', code: codeIn(mail).replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[Number(d)]), password: 'newpass1' });
    expect(ok.status).toBe(200);
    expect(ok.cookies.some(c => c.startsWith('__Host-vm_acct='))).toBe(true);
    expect((await post('/api/account/login', { login: 'rahim@example.com', password: 'masala1' })).status).toBe(400);
    expect((await post('/api/account/login', { login: 'rahim@example.com', password: 'newpass1' })).status).toBe(200);
    // The email is now proven, and the code works once.
    expect((await t.sql<{ v: string | null }>("SELECT email_verified_at AS v FROM customer_accounts WHERE email = 'rahim@example.com'"))[0].v).not.toBeNull();
    expect((await post('/api/account/reset', { email: 'rahim@example.com', code: codeIn(mail), password: 'again123' })).status).toBe(400);
  });

  it('locks a code after five wrong tries, and says nothing about emails without an account', async () => {
    await post('/api/account/reset-code', { email: 'rahim@example.com' });
    const code = codeIn(sent.at(-1)!);
    for (let i = 0; i < 5; i++) await post('/api/account/reset', { email: 'rahim@example.com', code: '111111', password: 'whatever1' });
    expect((await post('/api/account/reset', { email: 'rahim@example.com', code, password: 'whatever1' })).body.error).toMatch(/নতুন কোড পাঠান/);
    const before = sent.length;
    expect((await post('/api/account/reset-code', { email: 'nobody@example.com' })).body).toEqual({ ok: true, email: 'nobody@example.com' });
    expect(sent.length).toBe(before);
  });

  it('says so when the code cannot be emailed', async () => {
    resendFails = true;
    const r = await post('/api/account/reset-code', { email: 'rahim@example.com' });
    resendFails = false;
    await t.env.KV.delete('email-domain:vandarmart.com');
    expect(r.status).toBe(503);
    expect(r.body.error).toMatch(/ইমেইলে কোড পাঠানো যাচ্ছে না/);
    expect(await t.sql("SELECT email FROM account_codes WHERE email = 'rahim@example.com'")).toEqual([]);
  });
});

describe('the signed-in customer', () => {
  it('orders with the details filled in, sees the order with tracking and the invoice, and gets member offers', async () => {
    const variantId = (await t.sql<{ id: number }>("SELECT id FROM product_variants WHERE sku = 'SPC-MMSL-250G-0001'"))[0].id;
    const zoneId = (await t.sql<{ id: number }>("SELECT id FROM delivery_zones WHERE name = 'রাজবাড়ীর বাইরে'"))[0].id;
    const order = async (cookie: string, email?: string) => {
      const s = await t.checkoutSession();
      const r = await t.json('/api/checkout/place', {
        method: 'POST', headers: { cookie: cookie ? `${s.cookie}; ${cookie}` : s.cookie, 'cf-connecting-ip': `10.7.9.${++ip}` },
        body: { phone: '01866123456', name: 'রহিম উদ্দিন', zoneId, addressLine: 'বাসা ১২, পাংশা, রাজবাড়ী', paymentMethod: 'cod', token: s.token, lines: [{ variantId, qty: 2 }], ...(email ? { email } : {}) },
      });
      expect(r.status).toBe(201);
      return (await t.sql<Record<string, any>>('SELECT id, order_no, access_token, customer_email, account_id FROM orders WHERE id = ?', r.body.orderId))[0];
    };
    // An order placed as a guest with the same email, before the account existed.
    const guest = await order('', 'karim@example.com');
    const cookie = await signUp('karim@example.com', '01866123456');
    const me = await (await t.fetch('/api/account/me', { headers: { cookie } })).json() as Record<string, any>;
    expect(me.account).toMatchObject({ name: 'রহিম উদ্দিন', phone: '01866123456', addressLine: '' });

    // An order while signed in: it belongs to the account, the receipt goes to its email, the address is kept.
    const o = await order(cookie);
    expect(o).toMatchObject({ customer_email: 'karim@example.com', account_id: expect.any(Number) });
    expect(await t.sql("SELECT address_line, zone_id FROM customer_accounts WHERE email = 'karim@example.com'")).toEqual([{ address_line: 'বাসা ১২, পাংশা, রাজবাড়ী', zone_id: zoneId }]);

    // Offers: only the coupons the owner shows to members.
    expect((await t.adminJson('/coupons', 'POST', { code: 'MEMBER50', kind: 'fixed', value: 5000, minSubtotalPaisa: 50000, isActive: true, forMembers: true })).status).toBe(201);
    expect((await t.adminJson('/coupons', 'POST', { code: 'SECRET30', kind: 'percent', value: 30, isActive: true })).status).toBe(201);

    let html = await (await t.fetch('/account', { headers: { cookie } })).text();
    expect(html).toContain('আসসালামু আলাইকুম, রহিম উদ্দিন');
    expect(html).toContain(o.order_no);
    expect(html).toContain(`/order/${o.order_no}/invoice?t=${o.access_token}`);
    // Someone could type another person's email at sign-up, so earlier orders under that email stay hidden until the
    // email is proven with a code.
    expect(html).not.toContain(guest.order_no);
    expect(html).toContain('MEMBER50');
    expect(html).toContain('৳50 ছাড়');
    expect(html).not.toContain('SECRET30');
    await post('/api/account/reset-code', { email: 'karim@example.com' });
    await post('/api/account/reset', { email: 'karim@example.com', code: codeIn(sent.at(-1)!), password: 'gur-2026' });
    html = await (await t.fetch('/account', { headers: { cookie } })).text();
    expect(html).toContain(guest.order_no);

    // Details can be changed; sign out ends it.
    expect((await post('/api/account/me', { name: 'Karim', phone: '01866123456', addressLine: 'Road 2, Rajbari', offers: false }, cookie, 'PUT')).status).toBe(200);
    expect(await t.sql("SELECT email_marketing FROM customers WHERE phone = '8801866123456'")).toEqual([{ email_marketing: 0 }]);
    const out = await post('/api/account/logout', {}, cookie);
    expect(out.cookies).toContain('__Host-vm_acct=');
    expect(await (await t.fetch('/account')).text()).toContain('data-acct-form="signin"');
  });

  it('cannot read anyone else: a forged cookie is ignored', async () => {
    const me = await (await t.fetch('/api/account/me', { headers: { cookie: '__Host-vm_acct=eyJhIjoxLCJleHAiOjk5OTk5OTk5OTl9.forged' } })).json() as Record<string, any>;
    expect(me.account).toBeNull();
  });
});

describe('the customer invoice', () => {
  it('opens with the order link, in Bangla, ready to save as PDF; a wrong link gets nothing', async () => {
    const [o] = await t.sql<Record<string, any>>("SELECT order_no, access_token, total_paisa FROM orders WHERE customer_email = 'karim@example.com' AND account_id IS NOT NULL");
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

describe('before the shop domain is verified in Resend', () => {
  it('keeps emailing the owner from the test sender, still lets customers open accounts, and tries the domain again later', async () => {
    resendFails = true;
    expect((await post('/api/account/reset-code', { email: 'karim@example.com' })).status).toBe(503);
    expect(await t.env.KV.get('email-domain:vandarmart.com')).toBe('unverified');
    // Opening an account and signing in need no email.
    expect((await post('/api/account/signup', { name: 'Early Bird', phone: '01955000222', email: 'early@example.com', password: 'early12' })).status).toBe(201);
    expect(await (await t.fetch('/account')).text()).toContain('data-acct-form="signup"');
    // Owner emails still go out, from Resend's test sender.
    const test = await t.adminJson('/emails/test', 'POST', {});
    expect(test.body.status).toBe('sent');
    expect(sent.at(-1)!.from).toBe('Vandar Mart <onboarding@resend.dev>');
    // Once Resend verifies the domain (here: the note expires), the shop domain is used again by itself.
    resendFails = false;
    await t.env.KV.delete('email-domain:vandarmart.com');
    await t.adminJson('/emails/test', 'POST', {});
    expect(sent.at(-1)!.from).toBe('Vandar Mart <hello@vandarmart.com>');
  });
});
