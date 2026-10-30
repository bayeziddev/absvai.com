// End-to-end: real browser, real local Worker. Three product shapes, a pre-order with advance, notify-me,
// and the admin smart upload form. Run with `npm run test:e2e`.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { launchBrowser, startServer } from './server.mjs';

let server;
let browser;

before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

async function phone() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, geolocation: { latitude: 24.3833, longitude: 90.0167 }, permissions: ['geolocation'] });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|i\.ytimg\.com/, r => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  return { ctx, page, errors };
}

async function fillContact(page, number) {
  await page.waitForSelector('select[name=divisionId] option:nth-child(3)', { state: 'attached' });
  await page.fill('input[name=phone]', number);
  await page.fill('input[name=name]', 'Test Customer');
}

async function placeAndWait(page) {
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
    await page.fill('input[name=postcode]', '1209'); // Jigatala TSO, Dhanmondi: district known, area to choose
    await page.waitForFunction(() => document.querySelector('select[name=districtId]').selectedOptions[0]?.text === 'Dhaka');
    assert.match(await page.textContent('[data-finder-msg]'), /Jigatala TSO post office · Dhaka, Dhaka Division/);
    await page.selectOption('select[name=upazilaId]', { label: 'Dhaka South City Corporation' });
    await page.waitForFunction(() => /Inside Dhaka City/.test(document.querySelector('[data-eta]').textContent));
    assert.equal(await page.textContent('[data-delivery]'), '৳85'); // 1.2kg packed: ৳70 + ৳15 for the extra kg
    await page.fill('input[name=addressLine]', 'House 7, Road 3, Dhanmondi');
    const orderNo = await placeAndWait(page);
    assert.match(await page.textContent('h1'), /Thank you, Test!/);
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
  it('sets up the owner, then blocks publishing a food product until best-before is added', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
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
    await page.waitForSelector('.kpis');

    await page.goto(`${server.base}/admin/#/products?new=1`);
    await page.waitForSelector('.over #cat');
    await page.selectOption('.over #cat', { label: 'Organic & Seasonal Food (Weighed food)' });
    await page.waitForSelector('.over #why:not([hidden])');
    assert.match(await page.textContent('.over #why'), /weight options/);
    await page.fill('.over #name', 'Sundarban Honey');
    await page.click('.over-foot #go');
    await page.waitForSelector('.steps');

    await page.click('.steps button:has-text("Basics")');
    await page.fill('[data-k="shortDescription"]', 'Raw mangrove honey from the Sundarbans.');
    await page.click('.steps button:has-text("Details")');
    const labels = await page.$$eval('.over-body label.f', ls => ls.map(l => l.textContent));
    assert.ok(labels.some(l => /Origin/.test(l)) && labels.some(l => /Best-before date/.test(l)));
    assert.ok(!labels.some(l => /Warranty|Size chart/.test(l)));
    await page.fill('[data-k="spec.origin"]', 'Sundarbans');
    await page.fill('[data-k="spec.batch_no"]', 'Batch S-1');
    await page.fill('[data-k="spec.ingredients"]', '100% raw honey');
    await page.fill('[data-k="spec.storage"]', 'Keep the lid closed.');

    await page.click('.steps button:has-text("Options")');
    await page.click('[data-attr="weight"] .chip[data-val="500g"]');
    await page.click('[data-attr="weight"] [data-custom]'); // the prompt answers "750g"
    await page.click('#gen');
    assert.equal(await page.$$eval('#vt tr[data-i]', r => r.length), 2);
    await page.fill('#bulk-v', '550');
    await page.click('[data-bulk="price"]');
    await page.fill('#bulk-v', '700');
    await page.click('[data-bulk="packed"]');

    await page.click('.steps button:has-text("Photos")');
    await page.setInputFiles('#files', { name: 'honey.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
    await page.waitForSelector('.media-grid img');

    await page.click('.steps button:has-text("Publish")');
    await page.click('.over-foot #save');
    await page.waitForSelector('.checklist');
    assert.match(await page.textContent('.checklist'), /Add a best-before date\. Required for food products\./);
    assert.equal(await page.isDisabled('.over-foot #pub'), true);

    await page.click('.steps button:has-text("Details")');
    await page.fill('[data-k="spec.best_before"]', '2027-12-31');
    await page.click('.steps button:has-text("Publish")');
    await page.click('.over-foot #save');
    await page.waitForSelector('.notice.ok');
    await page.click('.over-foot #pub');
    await page.waitForSelector('.over-head .badge:has-text("published")');

    const skus = server.sql("SELECT sku FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.slug = 'sundarban-honey' ORDER BY v.sort_order").map(r => r.sku);
    assert.deepEqual(skus, ['ORG-SHNY-500G-0008', 'ORG-SHNY-750G-0009']);
    const pdp = await (await fetch(`${server.base}/p/sundarban-honey`)).text();
    assert.match(pdp, /৳1,100 \/ kg/);
    assert.deepEqual(errors, []);
    await ctx.close();
  });
});
