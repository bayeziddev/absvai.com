// End-to-end: real browser, real local Worker. Three product shapes, a pre-order with advance, notify-me,
// and the admin smart upload form. Run with `npm run test:e2e`.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { launchBrowser, startServer } from './server.mjs';

let server;
let browser;

before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

// No ctx.route() here: Playwright request interception makes Chromium skip cross-document view transitions and report it
// as a page error. Fonts are self-hosted, so nothing external needs blocking.
async function phone() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, geolocation: { latitude: 24.3833, longitude: 90.0167 }, permissions: ['geolocation'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  return { ctx, page, errors };
}

async function waitFor(fn, ms = 8000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 250))) { const v = fn(); if (v) return v; }
  throw new Error('timed out');
}

async function fillContact(page, number) {
  await page.waitForSelector('select[name=divisionId] option:nth-child(3)', { state: 'attached' });
  await page.fill('input[name=phone]', number);
  await page.fill('input[name=name]', 'Test Customer');
}

async function placeAndWait(page) {
  // The server silently rejects forms submitted within 3 seconds of the checkout session starting (bot check).
  await page.waitForFunction(() => performance.now() > 3500);
  await page.click('[data-place]');
  await page.waitForURL(/\/order\/(AV|PRE)-\d{6}-\d{4}\?t=/, { timeout: 15000 });
  return decodeURIComponent(new URL(page.url()).pathname.split('/').pop());
}

describe('storefront checkout', () => {
  it('weighed food: 1kg patali gur, postcode auto-fill, COD', async () => {
    const { ctx, page, errors } = await phone();
    await page.goto(`${server.base}/p/khejur-patali-gur`);
    await page.click('[data-pdp-form] label:has-text("1kg")');
    assert.match(await page.textContent('.pdp-price [data-price]'), /৳720/);
    assert.match(await page.textContent('[data-unit]'), /৳720 \/ kg/);
    await page.click('[data-pdp-form] [data-pdp-order]');
    await page.waitForURL(/\/checkout\?buy=/);
    await fillContact(page, '01710000001');
    await page.fill('input[name=postcode]', '১২০৯'); // Bangla digits for 1209 (Jigatala TSO, Dhanmondi): district known, area to choose
    await page.waitForFunction(() => document.querySelector('select[name=districtId]').selectedOptions[0]?.text === 'Dhaka');
    assert.equal(await page.inputValue('input[name=postcode]'), '1209');
    assert.match(await page.textContent('[data-finder-msg]'), /Jigatala TSO \(জিগাতলা TSO\) post office · Dhaka, Dhaka Division/);
    await page.selectOption('select[name=upazilaId]', { label: 'Dhaka South City Corporation' });
    await page.waitForFunction(() => /Inside Dhaka City/.test(document.querySelector('[data-eta]').textContent));
    assert.equal(await page.textContent('[data-delivery]'), '৳85'); // 1.2kg packed: ৳70 + ৳15 for the extra kg
    await page.fill('input[name=addressLine]', 'House 7, Road 3, Dhanmondi');
    await page.locator('input[name=addressLine]').blur();
    // Incomplete-order capture: one row for this checkout as soon as the phone is valid.
    // The row starts on the phone blur and fills in as the customer keeps typing (debounced).
    const [row] = await waitFor(() => { const r = server.sql("SELECT status, name, subtotal_paisa FROM abandoned_checkouts WHERE phone = '8801710000001' AND name IS NOT NULL"); return r.length ? r : null; });
    assert.deepEqual(row, { status: 'new', name: 'Test Customer', subtotal_paisa: 72000 });
    const orderNo = await placeAndWait(page);
    assert.match(await page.textContent('h1'), /Thank you, Test!/);
    assert.equal(server.sql("SELECT COUNT(*) AS n FROM abandoned_checkouts WHERE phone = '8801710000001'")[0].n, 1);
    assert.equal(server.sql("SELECT status FROM abandoned_checkouts WHERE phone = '8801710000001'")[0].status, 'converted');
    const [o] = server.sql(`SELECT total_paisa, district_name, upazila_name, postcode, post_office FROM orders WHERE order_no = '${orderNo}'`);
    assert.deepEqual(o, { total_paisa: 80500, district_name: 'Dhaka', upazila_name: 'Dhaka South City Corporation', postcode: '1209', post_office: 'Jigatala TSO' });
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  it('clothing: size + colour on the product page, cart, then location detection', async () => {
    const { ctx, page, errors } = await phone();
    await page.goto(`${server.base}/p/mens-cotton-panjabi`);
    await page.click('[data-pdp-form] label:has-text("XL")');
    await page.click('[data-pdp-form] label:has-text("Navy")');
    await page.click('[data-pdp-form] [data-pdp-add]');
    await page.waitForSelector('[data-toast]:not([hidden])');
    await page.goto(`${server.base}/cart`);
    await page.waitForSelector('.cart-line');
    assert.match(await page.textContent('.cart-line'), /XL · Navy/);
    await page.click('.cart-summary a:has-text("Checkout")');
    await fillContact(page, '01710000002');
    await page.click('[data-locate]');
    await page.waitForFunction(() => /set your district: Tangail/.test(document.querySelector('[data-finder-msg]').textContent));
    await page.selectOption('select[name=upazilaId]', { label: 'Kalihati' });
    await page.waitForSelector('[data-map-card]:not([hidden]) .leaflet-container');
    await page.fill('input[name=addressLine]', 'Village Bashail, Kalihati');
    const orderNo = await placeAndWait(page);
    const [item] = server.sql(`SELECT i.sku, i.variant_label FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.order_no = '${orderNo}'`);
    assert.deepEqual(item, { sku: 'CLO-PNJB-XL-NAVY-0006', variant_label: 'XL · Navy' });
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('absvai.cart')).length), 0); // cart cleared
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  it('machine with model options: Order Now from the card option picker', async () => {
    const { ctx, page, errors } = await phone();
    await page.goto(`${server.base}/c/sealers`);
    await page.click('[data-product="electronic-impulse-sealer-pfs"] [data-action="order"]');
    await page.waitForSelector('#pick-sheet:not([hidden]) [data-s-order]');
    await page.click('#pick-sheet label:has-text("300mm")');
    await page.click('#pick-sheet [data-s-order]');
    await page.waitForURL(/\/checkout\?buy=/);
    await fillContact(page, '01710000003');
    await page.selectOption('select[name=divisionId]', { label: 'Khulna' });
    await page.selectOption('select[name=districtId]', { label: 'Jashore' });
    await page.selectOption('select[name=upazilaId]', { index: 1 });
    await page.fill('input[name=addressLine]', 'Shop 4, Rail Road Market');
    await page.waitForFunction(() => document.querySelector('[data-delivery]').textContent === 'Free'); // ৳1,850 is over the threshold
    const orderNo = await placeAndWait(page);
    const [item] = server.sql(`SELECT i.sku FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.order_no = '${orderNo}'`);
    assert.equal(item.sku, 'MCH-SEAL-300MM-0002');
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  it('pre-order with an advance by bKash transaction ID', async () => {
    const { ctx, page, errors } = await phone();
    await page.goto(`${server.base}/p/himsagar-mango-pre-order`);
    assert.match(await page.textContent('[data-avail]'), /Pre-order · ships from 2027-05-25/);
    await page.click('[data-pdp-form] [data-pdp-order]');
    await fillContact(page, '01710000004');
    await page.fill('input[name=postcode]', '6300'); // Chapainawabganj Sadar
    await page.waitForFunction(() => document.querySelector('select[name=upazilaId]').value !== '');
    await page.waitForSelector('[data-advance]:not([hidden])');
    assert.match(await page.textContent('[data-advance-title]'), /advance of ৳200/);
    assert.equal(await page.isChecked('input[value=manual_mobile]'), true);
    await page.fill('input[name=addressLine]', 'Mohalla Baliadanga, Sadar');
    await page.fill('input[name=advanceTrxId]', 'BK7Q2M9X1Z');
    const orderNo = await placeAndWait(page);
    assert.match(orderNo, /^PRE-/);
    const [o] = server.sql(`SELECT advance_status, advance_amount_paisa, advance_trx_id FROM orders WHERE order_no = '${orderNo}'`);
    assert.deepEqual(o, { advance_status: 'submitted', advance_amount_paisa: 20000, advance_trx_id: 'BK7Q2M9X1Z' });
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  it('out-of-season product: no buy buttons, Notify me works', async () => {
    const { ctx, page } = await phone();
    await page.goto(`${server.base}/p/langra-mango`);
    assert.equal(await page.isVisible('[data-pdp-form] [data-pdp-add]'), false);
    await page.fill('#notify-phone', '01710000005');
    await page.click('#notify button[type=submit]');
    await page.waitForFunction(() => /back in season/.test(document.querySelector('#notify [data-msg]').textContent));
    await ctx.close();
  });
});

describe('admin smart upload form', () => {
  it('sets up the owner, adds a food product on one page, and only publishes it once best-before is filled in', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept('750g'));
    await page.goto(`${server.base}/admin/`);
    await page.fill('input[name=token]', 'e2e-setup-token');
    await page.fill('input[name=name]', 'Owner');
    await page.fill('input[name=email]', 'owner@absvai.test');
    await page.fill('input[name=password]', 'correct-horse-42');
    await page.click('#auth button');
    await page.waitForSelector('.stages');
    // Simple menu by default, with charts on the overview.
    const menu = await page.$$eval('.nav a', a => a.map(x => x.textContent.trim()));
    assert.ok(menu.includes('Products') && menu.includes('Categories') && !menu.includes('Audit log'));
    await page.waitForSelector('#ch-sales svg');

    await page.goto(`${server.base}/admin/#/products?new=1`);
    await page.waitForSelector('.over #q-cat');
    await page.selectOption('.over #q-cat', { label: 'Organic & Seasonal Food' });
    await page.waitForSelector('.over [data-attr="weight"] .chip');
    await page.setInputFiles('.over #q-files', { name: 'honey.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
    await page.fill('.over #q-name', 'Sundarban Honey');
    await page.fill('.over #q-short', 'Raw mangrove honey from the Sundarbans.');
    await page.click('.over [data-attr="weight"] .chip[data-val="500g"]');
    await page.click('.over [data-attr="weight"] [data-custom]'); // the prompt answers "750g"
    assert.equal(await page.$$eval('.over tr[data-row]', r => r.length), 2);
    await page.fill('.over #q-same', '550');
    await page.click('.over #q-same-go');
    for (const i of [0, 1]) await page.fill(`.over tr[data-row] [data-r=stock] >> nth=${i}`, '10');
    await page.fill('.over #q-parcel', '700');
    // Only the details food needs, never Size, Colour or Warranty.
    const asked = await page.$$eval('.over [data-spec]', x => x.map(i => i.dataset.spec));
    assert.deepEqual(asked.sort(), ['batch_no', 'best_before', 'ingredients', 'origin', 'storage']);
    await page.fill('.over [data-spec="origin"]', 'Sundarbans');
    await page.fill('.over [data-spec="batch_no"]', 'Batch S-1');
    await page.fill('.over [data-spec="ingredients"]', '100% raw honey');
    await page.fill('.over [data-spec="storage"]', 'Keep the lid closed.');

    await page.click('.over-foot #q-pub');
    await page.waitForFunction(() => /best-before/.test(document.getElementById('toast').textContent));
    assert.match(await page.textContent('#q-status'), /draft/);
    await page.fill('.over [data-spec="best_before"]', '2027-12-31');
    await page.click('.over-foot #q-pub');
    await page.waitForFunction(() => /published/.test(document.getElementById('q-status').textContent));

    const rows = server.sql("SELECT v.sku, v.price_paisa, v.packed_weight_grams FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.slug = 'sundarban-honey' ORDER BY v.sort_order");
    assert.equal(rows.length, 2);
    assert.match(rows[0].sku, /^ORG-SHNY-500G-\d{4}$/);
    assert.deepEqual(rows.map(r => [r.price_paisa, r.packed_weight_grams]), [[55000, 700], [55000, 700]]);
    const pdp = await (await fetch(`${server.base}/p/sundarban-honey`)).text();
    assert.match(pdp, /৳1,100 \/ kg/);
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  it('enters a Messenger order by hand, confirms, packs and sends it to the courier', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept('SF-E2E-12345'));
    await page.goto(`${server.base}/admin/`);
    await page.fill('input[name=email]', 'owner@absvai.test');
    await page.fill('input[name=password]', 'correct-horse-42');
    await page.click('#auth button');
    await page.waitForSelector('.stages');
    assert.equal(await page.$$eval('.stages .stage', s => s.length), 11); // 8 stages + on hold, returns to scan, incomplete

    await page.goto(`${server.base}/admin/#/manual`);
    await page.waitForSelector('#mo');
    await page.click('summary:has-text("Paste chat")');
    await page.fill('#chat', 'Customer: amar number 01799-887766, please send 1kg gur');
    await page.click('#find');
    await page.click('#found [data-ph="01799887766"]');
    assert.equal(await page.inputValue('input[name=phone]'), '01799887766');
    await page.fill('input[name=name]', 'Messenger Buyer');
    await page.selectOption('select[name=source]', 'messenger');
    await page.fill('#psearch', 'patali');
    await page.click('#presults .result:has-text("1kg")');
    await page.fill('input[name=postcode]', '1209');
    await page.waitForFunction(() => document.querySelector('select[name=districtId]').value !== '');
    await page.selectOption('select[name=upazilaId]', { label: 'Dhaka South City Corporation' });
    await page.fill('input[name=addressLine]', 'Flat 3B, Road 9, Dhanmondi');
    await page.waitForFunction(() => /Total ৳/.test(document.querySelector('#quote').textContent));
    await page.click('#place');
    await page.waitForURL(/#\/orders\/\d+$/);
    const id = Number(page.url().split('/').pop());
    const [o] = server.sql(`SELECT status, source, phone FROM orders WHERE id = ${id}`);
    assert.deepEqual(o, { status: 'new', source: 'messenger', phone: '8801799887766' });

    // Confirm via a logged call, then pack and hand to Steadfast from the order panel.
    await page.waitForSelector('.over #call-go');
    await page.selectOption('.over #call-out', 'confirmed');
    await page.click('.over #call-go');
    await page.waitForFunction(() => !document.querySelector('.over .notice') || !/Before confirming/.test(document.querySelector('.over').textContent));
    for (const to of ['confirmed', 'packed']) {
      await page.selectOption('.over #to', to);
      await page.click('.over #move');
      await page.waitForFunction(st => document.querySelector('.over-head h2').textContent.includes(st), to);
    }
    await page.selectOption('.over #to', 'in_courier');
    await page.selectOption('.over #courier', 'steadfast');
    await page.fill('.over #tracking', 'SF-E2E-12345');
    await page.click('.over #move');
    await page.waitForFunction(() => document.querySelector('.over-head h2').textContent.includes('in courier'));
    const [shipped] = server.sql(`SELECT status, courier, tracking_id, invoice_no IS NOT NULL AS invoiced FROM orders WHERE id = ${id}`);
    assert.deepEqual(shipped, { status: 'in_courier', courier: 'steadfast', tracking_id: 'SF-E2E-12345', invoiced: 1 });
    assert.deepEqual(server.sql(`SELECT kind FROM stock_movements WHERE order_id = ${id} ORDER BY id`).map(r => r.kind), ['reserve', 'sale']);
    assert.deepEqual(errors, []);
    await ctx.close();
  });
});
