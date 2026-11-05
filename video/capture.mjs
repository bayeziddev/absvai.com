// Screens for the tutorial video (run from the repo root: node video/capture.mjs video/work/shots).
// A throwaway local copy of the site (the same code as vandarmart.com, demo products),
// filled with sample orders, then every storefront and admin page photographed with Playwright. Each shot also records
// where its key parts are (CSS boxes), so the video can zoom to them and ring them.
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, startServer } from '../tests/e2e/server.mjs';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const meta = {};
const sleep = ms => new Promise(r => setTimeout(r, ms));
// The local dev server sometimes closes a kept-alive socket: try again on a fresh one.
const rawFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  for (let k = 0; ; k++) {
    try { return await rawFetch(url, { ...init, headers: { ...(init.headers ?? {}), connection: 'close' } }); } catch (e) { if (k >= 3) throw e; await sleep(800); }
  }
};
const server = await startServer(8791);
const base = server.base;
console.log('server', base);

// ── Owner account ──
const EMAIL = 'owner@vandarmart.com';
const PASSWORD = 'Video-guide-2026';
let r = await fetch(`${base}/api/admin/setup`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ token: 'e2e-setup-token', name: 'Owner', email: EMAIL, password: PASSWORD }) });
const adminCookie = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
const { csrf } = await r.json();
async function admin(path, method = 'GET', body) {
  const res = await fetch(`${base}/api/admin${path}`, { method, headers: { 'content-type': 'application/json', cookie: adminCookie, 'x-csrf-token': csrf, origin: base }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) console.warn('admin', method, path, res.status, j.error);
  return j;
}
await admin('/settings', 'PUT', { store_name: 'Vandar Mart', support_phone: '01700000000', manual_wallets: JSON.stringify([{ wallet: 'bKash', number: '01700000000', type: 'Personal' }, { wallet: 'Nagad', number: '01700000000', type: 'Personal' }]) });

// ── Sample orders from many districts ──
const zones = Object.fromEntries(server.sql('SELECT id, name FROM delivery_zones').map(z => [z.name.includes('ভিতরে') ? 'inside' : 'outside', z.id]));
const variants = server.sql("SELECT v.id, v.sku, p.name FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.status = 'published' AND p.fulfilment_mode = 'in_stock' AND v.is_active = 1 AND v.price_paisa < 150000 AND v.stock - v.reserved > 5 ORDER BY p.sold_count DESC, v.id LIMIT 14");
const people = [
  ['রহিম উদ্দিন', 'বাসা ১২, পাংশা, রাজবাড়ী', 'inside'], ['Fatema Akter', 'House 8, Road 3, Mirpur 10, Dhaka', 'outside'],
  ['করিম শেখ', 'বালিয়াকান্দি বাজার, রাজবাড়ী', 'inside'], ['Nusrat Jahan', 'Agrabad, Chittagong', 'outside'],
  ['সাকিব হাসান', 'গোয়ালন্দ, রাজবাড়ী', 'inside'], ['Tanvir Ahmed', 'Kalihati, Tangail', 'outside'],
  ['মাহমুদা খাতুন', 'Sonadanga, Khulna', 'outside'], ['Rafiq Islam', 'Zindabazar, Sylhet', 'outside'],
  ['আয়েশা সিদ্দিকা', 'রাজবাড়ী সদর, রাজবাড়ী', 'inside'], ['Imran Hossain', 'Boalia, Rajshahi', 'outside'],
  ['শারমিন সুলতানা', 'Kotwali, Faridpur', 'outside'], ['Jamal Uddin', 'Sadar, Cumilla', 'outside'],
  ['নাসির আহমেদ', 'পাংশা, রাজবাড়ী', 'inside'], ['Sumaiya Rahman', 'Dhanmondi, Dhaka', 'outside'],
  ['হাবিবুর রহমান', 'Sadar, Bogura', 'outside'], ['Liza Khatun', 'Kushtia Sadar, Kushtia', 'outside'],
  ['মিজানুর রহমান', 'কালুখালী, রাজবাড়ী', 'inside'], ['Anika Tabassum', 'Uttara, Dhaka', 'outside'],
  ['জাহিদ হাসান', 'Sadar, Jashore', 'outside'], ['Rumana Akter', 'Gazipur Sadar, Gazipur', 'outside'],
];
async function session() {
  const res = await fetch(`${base}/api/checkout/session`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: '{}' });
  return { cookie: res.headers.getSetCookie().map(c => c.split(';')[0]).join('; '), token: (await res.json()).token };
}
const sessions = [];
for (let i = 0; i < people.length + 3; i++) sessions.push(await session());
await sleep(4000); // the checkout refuses forms sent faster than a person could type
const orders = [];
for (let i = 0; i < people.length; i++) {
  const [name, addressLine, zone] = people[i];
  const s = sessions[i];
  const a = variants[i % variants.length];
  const b = variants[(i * 3 + 5) % variants.length];
  const lines = i % 3 === 0 ? [{ variantId: a.id, qty: 1 }, { variantId: b.id, qty: 1 }] : [{ variantId: a.id, qty: 1 + (i % 2) }];
  const res = await fetch(`${base}/api/checkout/place`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: s.cookie, origin: base },
    body: JSON.stringify({ phone: `017${String(11000000 + i * 7919).padStart(8, '0')}`, name, zoneId: zones[zone], addressLine, paymentMethod: 'cod', token: s.token, lines, note: i === 0 ? 'বিকেলে দিলে ভালো হয়' : '' }),
  });
  const j = await res.json();
  if (!res.ok) { console.warn('place', i, res.status, j.error); continue; }
  orders.push({ i, id: j.orderId, no: j.orderNo });
}
console.log('orders', orders.length);
// Stages: the oldest are delivered, then on the way, packed, confirmed; the newest are new.
const plan = { 0: 'delivered', 1: 'delivered', 2: 'delivered', 3: 'delivered', 4: 'delivered', 5: 'returned', 6: 'delivered', 7: 'cancelled', 8: 'delivered', 9: 'in_courier', 10: 'in_courier', 11: 'packed', 12: 'packed', 13: 'confirmed', 14: 'confirmed' };
const path = { confirmed: ['confirmed'], packed: ['confirmed', 'packed'], in_courier: ['confirmed', 'packed', 'in_courier'], delivered: ['confirmed', 'packed', 'in_courier', 'delivered'], returned: ['confirmed', 'packed', 'in_courier', 'returned'], cancelled: ['cancelled'] };
for (const o of orders) {
  const target = plan[o.i];
  if (!target) continue;
  for (const to of path[target]) {
    await admin(`/orders/${o.id}/status`, 'POST', { to, courier: o.i % 2 ? 'steadfast' : 'own_delivery', trackingId: o.i % 2 ? `SFR2611${String(o.id).padStart(4, '0')}` : null, cancelReason: 'Customer changed their mind', returnReason: 'refused' });
  }
}
// Spread the orders over the last two weeks, so the charts have a shape.
for (const o of orders) {
  const hoursAgo = Math.max(1, (orders.length - 1 - o.i) * 16 + (o.i % 3) * 3);
  const at = `strftime('%Y-%m-%dT%H:%M:%fZ','now','-${hoursAgo} hours')`;
  const later = `strftime('%Y-%m-%dT%H:%M:%fZ','now','-${Math.max(0, hoursAgo - 30)} hours')`;
  server.sql(`UPDATE orders SET created_at = ${at}, confirmed_at = CASE WHEN confirmed_at IS NULL THEN NULL ELSE ${at} END, delivered_at = CASE WHEN delivered_at IS NULL THEN NULL ELSE ${later} END WHERE id = ${o.id}`);
}
// Incomplete checkouts: two typed and left, one sent on WhatsApp instead.
for (const [k, via] of [[0, null], [1, null], [2, 'whatsapp']]) {
  const s = sessions[people.length + k];
  await fetch(`${base}/api/checkout/capture`, { method: 'POST', headers: { 'content-type': 'text/plain', cookie: s.cookie, origin: base }, body: JSON.stringify({ token: s.token, phone: `018${String(22000000 + k * 104729).padStart(8, '0')}`, name: ['Sabbir', 'মরিয়ম বেগম', 'Hasan Mahmud'][k], lines: [{ variantId: variants[k].id, qty: 1 }], addressLine: ['Pangsa, Rajbari', 'রাজবাড়ী সদর', 'Mirpur, Dhaka'][k], ...(via ? { via } : {}) }) });
}
await admin('/coupons', 'POST', { code: 'WELCOME50', kind: 'fixed', value: 5000, minSubtotalPaisa: 50000, isActive: true, forMembers: true });
await admin('/coupons', 'POST', { code: 'FREEDEL', kind: 'free_delivery', value: 0, minSubtotalPaisa: 100000, isActive: true });
const gur = server.sql("SELECT id FROM products WHERE slug = 'khejur-patali-gur'")[0];
await admin('/landing-pages', 'POST', { title: 'খেজুর গুড় শীতের অফার', slug: 'khejur-gur-offer', productId: gur.id, status: 'published', content: { badge: 'শীতের স্পেশাল', headline: 'খাঁটি খেজুরের পাটালি গুড়', subheadline: 'সরাসরি গাছির কাছ থেকে, কোনো ভেজাল নেই। ক্যাশ অন ডেলিভারি।', points: ['১০০% খাঁটি', 'সারা বাংলাদেশে ডেলিভারি', 'হাতে পেয়ে টাকা'], ctaText: 'এখনই অর্ডার করুন' } });

// ── Photographs ──
const browser = await launchBrowser();
async function shot(page, name, selectors = {}, opts = {}) {
  await page.waitForTimeout(opts.wait ?? 500);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: Boolean(opts.full) });
  const boxes = await page.evaluate(sel => Object.fromEntries(Object.entries(sel).map(([k, s]) => {
    const el = document.querySelector(s);
    if (!el) return [k, null];
    const b = el.getBoundingClientRect();
    return [k, { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }];
  })), selectors);
  const missing = Object.entries(boxes).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) console.warn(name, 'missing', missing.join(', '));
  meta[name] = { viewport: page.viewportSize(), boxes };
  console.log('shot', name);
}

// Storefront on a phone
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'bn-BD' });
let p = await phone.newPage();
await p.goto(`${base}/`);
await p.waitForLoadState('networkidle');
await shot(p, 'm-home', { header: 'header', search: 'form[role=search], .search, input[type=search]', hero: '.hero, .banner, .hero-slide', tabs: '.tabbar, nav.tabs, .bottom-nav' });
await p.evaluate(() => window.scrollTo(0, 700));
await shot(p, 'm-home-2', { grid: '.grid, .product-grid, .cards' });
await p.goto(`${base}/p/khejur-patali-gur`);
await p.click('[data-pdp-form] label:has-text("1kg")');
await shot(p, 'm-product', { price: '.pdp-price', options: '[data-pdp-form] fieldset, [data-pdp-form] .opts', order: '[data-pdp-order]' });
await p.evaluate(() => document.querySelector('[data-wa-product]')?.scrollIntoView({ block: 'center' }));
await shot(p, 'm-product-2', { order: '[data-pdp-order]', add: '[data-pdp-add]', wa: '[data-wa-product]' });
await p.click('[data-pdp-form] [data-pdp-order]');
await p.waitForURL(/\/checkout\?buy=/);
await p.waitForSelector('[data-co-lines] .co-line');
await shot(p, 'm-checkout-1', { head: '.co-head', you: '.co-step:nth-of-type(1)' });
await p.fill('input[name=phone]', '01711223344');
await p.fill('input[name=name]', 'রাশেদ করিম');
await p.fill('textarea[name=addressLine]', 'বাসা ৭, রোড ৩, পাংশা, রাজবাড়ী');
await p.click('.area-option:has-text("রাজবাড়ীর ভিতরে")');
await p.waitForFunction(() => !document.querySelector('[data-co-delivery]').hidden);
await p.evaluate(() => document.querySelector('[data-co-lines]').scrollIntoView({ block: 'start' }));
await shot(p, 'm-checkout-2', { lines: '[data-co-lines]', areas: '.co-areas, [data-areas]', total: '[data-total]' });
await p.evaluate(() => document.querySelector('[data-place]').scrollIntoView({ block: 'center' }));
await shot(p, 'm-checkout-3', { place: '[data-place]', wa: '[data-wa-order]', total: '[data-total]' });
await p.waitForFunction(() => performance.now() > 4000);
await p.click('[data-place]');
await p.waitForURL(/\/order\//, { timeout: 15000 });
await shot(p, 'm-done', { head: 'h1', actions: '.done-actions', invoice: '[data-invoice]' });
const orderUrl = p.url();
await p.goto(`${orderUrl.replace(/\?/, '/invoice?')}`);
await shot(p, 'm-invoice', {});
await p.goto(`${base}/account`);
await shot(p, 'm-account', { forms: 'main' });
await p.goto(`${base}/track?q=${encodeURIComponent(orders[9]?.no ?? '')}`);
await shot(p, 'm-track', { result: 'main' });
await p.goto(`${base}/lp/khejur-gur-offer`);
await p.waitForLoadState('networkidle');
await shot(p, 'm-landing', {});
await phone.close();

// Storefront on a computer
const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
p = await desk.newPage();
await p.goto(`${base}/`);
await p.waitForLoadState('networkidle');
await shot(p, 'd-home', { header: 'header' });
await p.goto(`${base}/p/khejur-patali-gur`);
await shot(p, 'd-product', {});
await p.evaluate(() => document.querySelector('.site-footer')?.scrollIntoView({ block: 'end' }));
await shot(p, 'd-footer', { credit: '.dev-credit' });

// Admin
await p.goto(`${base}/admin/`);
await p.waitForSelector('input[name=email]');
await p.fill('input[name=email]', EMAIL);
await p.fill('input[name=password]', PASSWORD);
await shot(p, 'a-login', { form: '#auth' });
await p.click('#auth button');
await p.waitForSelector('.stages');
await p.waitForSelector('#ch-sales svg');
await shot(p, 'a-dashboard', { stages: '.stages', nav: '.nav' }, { wait: 1200 });
await p.evaluate(() => document.querySelector('#ch-sales')?.scrollIntoView({ block: 'start' }));
await shot(p, 'a-dashboard-2', { sales: '#ch-sales', orders: '#ch-orders' }, { wait: 800 });
await p.evaluate(() => document.querySelector('#ch-map')?.scrollIntoView({ block: 'center' }));
await shot(p, 'a-dashboard-3', { map: '#ch-map', places: '#ch-places' }, { wait: 800 });

async function page(route, name, selectors = {}, wait = 900) {
  // A full page load each time, so no panel from the last screen is left open.
  await p.goto('about:blank');
  await p.goto(`${base}/admin/#/${route}`);
  await p.waitForSelector('.page-head, .over', { timeout: 15000 }).catch(() => {});
  await p.waitForFunction(() => !document.querySelector('.skel'), null, { timeout: 15000 }).catch(() => {});
  await shot(p, name, selectors, { wait });
}
await page('orders', 'a-orders', { tabs: 'nav.tabs', search: '#of', table: '.table-wrap' });
const fresh = orders.find(o => o.i === 19) ?? orders[orders.length - 1];
await page(`orders/${fresh.id}`, 'a-order', { items: '.over .card', wa: '.over .wa-card', customer: '.over .split > div:nth-child(2) .card' }, 1200);
await p.evaluate(() => document.querySelector('.over .wa-card').scrollIntoView({ block: 'start' }));
await shot(p, 'a-order-wa', { wa: '.over .wa-card', chips: '.over .wa-card .chips', text: '#wa-text', send: '#wa-send', yes: '#wa-yes' });
await p.evaluate(() => document.querySelector('.over #move')?.scrollIntoView({ block: 'center' }));
await shot(p, 'a-order-move', { move: '.over #move', call: '.over #call-go' });
await p.evaluate(() => document.querySelector('.over .over-body').scrollTo(0, 0));
await p.click('.over #edit-order');
await p.waitForSelector('.over #ef [data-q="0"]');
await shot(p, 'a-edit', { customer: '#ef .card:nth-of-type(1)', items: '#ef .card:nth-of-type(2)' });
await p.evaluate(() => document.querySelector('#esum').scrollIntoView({ block: 'center' }));
await p.check('.over #efree');
await shot(p, 'a-edit-2', { money: '#ef .card:nth-of-type(3)', free: '#efree', sum: '#esum', save: '#esave' });
await p.keyboard.press('Escape');
await p.keyboard.press('Escape');
const packed = orders.find(o => o.i === 11);
if (packed) {
  await page(`orders/${packed.id}`, 'a-order-packed', {}, 1200);
  await p.evaluate(() => document.querySelector('.over .book-card')?.scrollIntoView({ block: 'center' }));
  await shot(p, 'a-courier-book', { book: '.over .book-card' });
  await p.keyboard.press('Escape');
}
const shipped = orders.find(o => o.i === 9);
if (shipped) {
  await page(`orders/${shipped.id}`, 'a-order-shipped', {}, 1200);
  await p.evaluate(() => document.querySelector('.over .wa-card')?.scrollIntoView({ block: 'start' }));
  await shot(p, 'a-order-shipped-wa', { wa: '.over .wa-card' });
  await p.keyboard.press('Escape');
}
await page('incomplete', 'a-incomplete', { table: '.table-wrap' });
await page('manual', 'a-manual', { form: '#mo' });
await page('returns', 'a-returns', {});
await page('reports', 'a-reports', {}, 1500);
await page('products', 'a-products', { table: '.table-wrap' });
await page('products?new=1', 'a-product-new', { form: '.over' }, 1500);
await p.keyboard.press('Escape');
await page('quick-update', 'a-quick-update', { table: '.table-wrap' }, 1200);
await page('categories', 'a-categories', {});
await page('inventory', 'a-inventory', { table: '.table-wrap' });
await page('courier', 'a-couriers', {});
await page('landing', 'a-landing', {});
await page('coupons', 'a-coupons', {});
await page('reviews', 'a-reviews', {});
await page('website', 'a-website', {}, 1500);
await page('emails', 'a-emails', {});
await page('customers', 'a-customers', {});
await page('sellers', 'a-sellers', {});
await page('settings', 'a-settings', {}, 1200);
await p.evaluate(() => document.querySelector('#zone-rows')?.scrollIntoView({ block: 'center' }));
await shot(p, 'a-settings-zones', { zones: '#zone-rows' });
await page('help', 'a-help', {});
await desk.close();
await browser.close();
writeFileSync(`${OUT}/meta.json`, JSON.stringify(meta, null, 1));
server.stop();
console.log('done', Object.keys(meta).length);
process.exit(0);
