import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GEO_VERSION } from '../../worker/src/generated/geo-version';
import { publishScheduled, seasonSwitch } from '../../worker/src/cron';
import { createTestEnv, type TestEnv } from './env';

let t: TestEnv;
const ids: Record<string, number> = {};

beforeAll(async () => {
  t = await createTestEnv();
  const one = async (sql: string, ...p: unknown[]) => (await t.sql<{ id: number }>(sql, ...p))[0].id;
  ids.dhakaDivision = await one("SELECT id FROM geo_divisions WHERE name = 'Dhaka'");
  ids.dhaka = await one("SELECT id FROM geo_districts WHERE name = 'Dhaka'");
  ids.dhakaSouth = await one("SELECT id FROM geo_upazilas WHERE name = 'Dhaka South City Corporation'");
  ids.savar = await one("SELECT id FROM geo_upazilas WHERE name = 'Savar'");
  ids.tangail = await one("SELECT id FROM geo_districts WHERE name = 'Tangail'");
  ids.kalihati = await one("SELECT id FROM geo_upazilas WHERE name = 'Kalihati'");
  ids.chattogramDivision = await one("SELECT id FROM geo_divisions WHERE name = 'Chattagram'");
});
afterAll(async () => { await t?.dispose(); });

const variant = async (sku: string) => (await t.sql<{ id: number }>('SELECT id FROM product_variants WHERE sku = ?', sku))[0].id;
const productId = async (slug: string) => (await t.sql<{ id: number }>('SELECT id FROM products WHERE slug = ?', slug))[0].id;

let ipCounter = 0;
async function order(lines: Array<{ variantId: number; qty: number }>, over: Record<string, unknown> = {}) {
  return t.json('/api/checkout/place', {
    method: 'POST',
    headers: { 'cf-connecting-ip': `10.0.0.${++ipCounter}` }, // each simulated customer has their own connection (rate limit is per IP)
    body: {
      phone: '01712345678', name: 'Rahim Uddin', divisionId: ids.dhakaDivision, districtId: ids.tangail, upazilaId: ids.kalihati,
      postcode: null, addressLine: 'House 12, Road 5, Kalihati Bazar', landmark: 'Near the high school', paymentMethod: 'cod', lines, ...over,
    },
  });
}

describe('geo data and address detection', () => {
  it('serves versioned postcode data where 1000 (Dhaka GPO) auto-fills the Dhaka district', async () => {
    const v = (await t.json('/api/geo/version')).body.version as string;
    expect(v.startsWith(GEO_VERSION)).toBe(true);
    const r = await t.fetch(`/api/geo/${v}/postcodes.json`);
    expect(r.headers.get('cache-control')).toContain('immutable');
    const map = (await r.json()) as Record<string, Array<[string, number, number, number | null]>>;
    expect(map['1000'][0][0]).toBe('Dhaka GPO');
    expect(map['1000'][0][1]).toBe(ids.dhakaDivision);
    expect(map['1000'][0][2]).toBe(ids.dhaka);
    expect(map['0000']).toBeUndefined(); // unknown postcode → the page falls back to dropdowns
  });

  it('hierarchy includes the city-corporation areas so Dhaka city customers can pick one', async () => {
    const v = (await t.json('/api/geo/version')).body.version;
    const h = (await t.json(`/api/geo/${v}/hierarchy.json`)).body;
    expect(h.divisions).toHaveLength(8);
    expect(h.districts).toHaveLength(64);
    expect(h.upazilas.filter((u: [number, number, string]) => u[1] === ids.dhaka).map((u: [number, number, string]) => u[2])).toContain('Dhaka South City Corporation');
  });

  it('the server rejects a district that does not belong to the submitted division', async () => {
    const r = await order([{ variantId: await variant('SPC-MMSL-250G-0001'), qty: 1 }], { divisionId: ids.chattogramDivision });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/not in the chosen division/);
  });

  it('a postcode from another district is a risk signal, not a block', async () => {
    const r = await order([{ variantId: await variant('SPC-MMSL-250G-0001'), qty: 1 }], { postcode: '1000', phone: '01811111111' });
    expect(r.status).toBe(201);
    const [o] = await t.sql('SELECT risk_level, risk_reasons FROM orders WHERE order_no = ?', r.body.orderNo);
    expect(o.risk_level).not.toBe('low');
    expect(o.risk_reasons).toContain('postcode_mismatch');
  });
});

describe('delivery charge quotes', () => {
  const quote = async (lines: Array<{ variantId: number; qty: number }>, districtId: number, upazilaId: number | null) =>
    (await t.json('/api/checkout/quote', { method: 'POST', body: { lines, districtId, upazilaId, paymentMethod: 'cod' } })).body;

  it('charges Inside Dhaka City, Dhaka Suburbs and Outside Dhaka by zone', async () => {
    const lines = [{ variantId: await variant('SPC-MMSL-250G-0001'), qty: 1 }];
    expect((await quote(lines, ids.dhaka, ids.dhakaSouth)).delivery).toMatchObject({ zoneName: 'Inside Dhaka City', chargePaisa: 7000 });
    expect((await quote(lines, ids.dhaka, ids.savar)).delivery).toMatchObject({ zoneName: 'Dhaka Suburbs', chargePaisa: 10000 });
    expect((await quote(lines, ids.tangail, ids.kalihati)).delivery).toMatchObject({ zoneName: 'Outside Dhaka', chargePaisa: 13000 });
  });

  it('asks for the area in Dhaka before the charge is final', async () => {
    const q = await quote([{ variantId: await variant('SPC-MMSL-250G-0001'), qty: 1 }], ids.dhaka, null);
    expect(q.needsArea).toBe(true);
  });

  it('uses packed weight × quantity, the free threshold and the bulky rule', async () => {
    const heavyFood = await quote([{ variantId: await variant('ORG-PTGR-2KG-0003'), qty: 1 }], ids.tangail, ids.kalihati); // 2.3kg packed, ৳1,400
    expect(heavyFood.delivery.chargePaisa).toBe(13000 + 2 * 2500);
    const free = await quote([{ variantId: await variant('ORG-PTGR-2KG-0003'), qty: 2 }], ids.tangail, ids.kalihati); // ৳2,800 ≥ ৳1,500
    expect(free.delivery.chargePaisa).toBe(0);
    const press = await quote([{ variantId: await variant('MCH-CHNC-4IN-0004'), qty: 1 }], ids.tangail, ids.kalihati);
    expect(press.delivery.chargePaisa).toBe(80000); // bulky charge; the threshold does not cover large items
    expect(press.advance).toMatchObject({ required: true, amountPaisa: 80000 });
  });

  it('gives a free-delivery bulky item (clothes rack) free delivery, but still asks for an advance only when there is a charge', async () => {
    const q = await quote([{ variantId: await variant('HOM-CRCK-STD-0001'), qty: 1 }], ids.tangail, ids.kalihati);
    expect(q.delivery.chargePaisa).toBe(0);
    expect(q.advance.required).toBe(false);
  });
});

describe('seasons, pre-orders and notify-me', () => {
  it('keeps out-of-season product pages live with "Back in season" and Notify me', async () => {
    const r = await t.fetch('/p/langra-mango');
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('Back in season from May');
    expect(html).toContain('data-notify=');
    expect(html).toContain('"@type":"Product"');
    expect(html).toContain('https://schema.org/OutOfStock');
  });

  it('blocks out-of-season items at checkout', async () => {
    const r = await order([{ variantId: await variant('ORG-LNGR-5KG-0007'), qty: 1 }]);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/Back in season/);
  });

  it('records a notify-me request', async () => {
    const r = await t.json('/api/notify', { method: 'POST', body: { productId: await productId('langra-mango'), phone: '01912345678', channel: 'whatsapp' } });
    expect(r.status).toBe(200);
    expect((await t.sql('SELECT * FROM notify_requests'))[0]).toMatchObject({ phone: '01912345678', channel: 'whatsapp', status: 'waiting' });
  });

  it('takes pre-orders only with an advance, under a PRE- reference', async () => {
    const lines = [{ variantId: await variant('ORG-HMSG-5KG-0006'), qty: 2 }];
    const noAdvance = await order(lines, { phone: '01512345678' });
    expect(noAdvance.status).toBe(400);
    expect(noAdvance.body.error).toMatch(/advance of ৳400/);
    const ok = await order(lines, { phone: '01512345678', paymentMethod: 'manual_mobile', advanceTrxId: 'TRX9KJ2L7Q', advanceWallet: 'bKash' });
    expect(ok.status).toBe(201);
    expect(ok.body.orderNo).toMatch(/^PRE-\d{6}-\d{4}$/);
    expect(ok.body.advance).toEqual({ required: true, amountPaisa: 40000 });
    const list = await t.adminJson('/preorders');
    expect(list.body[0]).toMatchObject({ name: 'Himsagar Mango (pre-order)', qty: 2, advance_due: 1 });
  });

  it('cron: when the mango season starts, waiting notify-me requests get one message', async () => {
    await t.sql("UPDATE seasons SET starts_on = '2026-01-01', ends_on = '2099-12-31' WHERE slug = 'mango'");
    await t.sql("UPDATE product_variants SET stock = 30 WHERE sku = 'ORG-LNGR-5KG-0007'");
    const r = await seasonSwitch(t.env);
    expect(r.started).toContain('Mango season');
    expect(r.notified).toBe(1);
    const [sms] = await t.sql("SELECT * FROM sms_outbox WHERE kind = 'back_in_season'");
    expect(sms.body).toContain('Langra Mango is back in season');
    expect((await seasonSwitch(t.env)).notified).toBe(0); // only once per season start
    await t.sql("UPDATE seasons SET starts_on = '2027-05-20', ends_on = '2027-07-31', started_notified_on = NULL WHERE slug = 'mango'");
  });

  it('hides a seasonal category from navigation outside its season but keeps its page live', async () => {
    await t.sql("UPDATE seasons SET starts_on = '2027-11-01', ends_on = '2028-02-28' WHERE slug = 'winter'");
    const home = await (await t.fetch('/')).text();
    expect(home).not.toContain('href="/c/khejur-gur"');
    const page = await t.fetch('/c/khejur-gur');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Out of season');
    await t.sql("UPDATE seasons SET starts_on = '2026-10-25', ends_on = '2027-02-28' WHERE slug = 'winter'");
    expect(await (await t.fetch('/')).text()).toContain('href="/c/khejur-gur"');
  });
});

describe('COD orders: OTP, confirmation call, invoice', () => {
  let orderNo = '';
  let token = '';
  let orderId = 0;

  it('places a COD order, takes stock and sends an English SMS with an OTP', async () => {
    const v = await variant('MCH-SEAL-300MM-0002');
    const before = (await t.sql('SELECT stock FROM product_variants WHERE id = ?', v))[0].stock;
    const r = await order([{ variantId: v, qty: 1 }], { phone: '01611111111', districtId: ids.dhaka, upazilaId: ids.dhakaSouth });
    expect(r.status).toBe(201);
    ({ orderNo, accessToken: token, orderId } = r.body);
    expect(orderNo).toMatch(/^AV-\d{6}-\d{4}$/);
    expect(r.body.totalPaisa).toBe(185000); // over the ৳1,500 threshold, so delivery is free
    expect((await t.sql('SELECT stock FROM product_variants WHERE id = ?', v))[0].stock).toBe(before - 1);
    const sms = await t.sql('SELECT kind, body FROM sms_outbox WHERE order_id = ? ORDER BY id', orderId);
    expect(sms.map(s => s.kind)).toEqual(['order_received', 'otp']);
    for (const s of sms) expect(/^[\x20-\x7E]*$/.test(s.body) && s.body.length <= 160).toBe(true);
  });

  it('cannot be confirmed without OTP or a logged confirmation call', async () => {
    const r = await t.adminJson(`/orders/${orderId}/status`, 'POST', { to: 'confirmed' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/Verify the customer/);
  });

  it('confirms after the customer enters the SMS code, and issues a sequential invoice + PDF', async () => {
    const otpSms = (await t.sql("SELECT body FROM sms_outbox WHERE order_id = ? AND kind = 'otp'", orderId))[0].body as string;
    const code = otpSms.match(/is (\d{6})/)![1];
    const wrong = await t.json(`/api/orders/${orderNo}/otp/verify`, { method: 'POST', body: { t: token, code: '000000' === code ? '111111' : '000000' } });
    expect(wrong.status).toBe(400);
    const ok = await t.json(`/api/orders/${orderNo}/otp/verify`, { method: 'POST', body: { t: token, code } });
    expect(ok.status).toBe(200);
    const conf = await t.adminJson(`/orders/${orderId}/status`, 'POST', { to: 'confirmed' });
    expect(conf.status).toBe(200);
    expect(conf.body.invoiceNo).toMatch(/^INV-\d{8}-0001$/);
    const pdf = await t.fetch(`/api/admin/orders/${orderId}/invoice.pdf`, { headers: { cookie: t.admin.cookie } });
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(new TextDecoder().decode((await pdf.arrayBuffer()).slice(0, 8))).toBe('%PDF-1.4');
  });

  it('a logged confirmation call also allows confirmation; the next invoice number follows on', async () => {
    const r = await order([{ variantId: await variant('SPC-MMSL-500G-0002'), qty: 1 }], { phone: '01622222222' });
    const id = r.body.orderId;
    expect((await t.adminJson(`/orders/${id}/call`, 'POST', { outcome: 'no_answer' })).status).toBe(200);
    expect((await t.sql('SELECT status FROM orders WHERE id = ?', id))[0].status).toBe('confirmation_attempted');
    expect((await t.adminJson(`/orders/${id}/status`, 'POST', { to: 'confirmed' })).status).toBe(409);
    await t.adminJson(`/orders/${id}/call`, 'POST', { outcome: 'confirmed', note: 'Customer confirmed address' });
    const conf = await t.adminJson(`/orders/${id}/status`, 'POST', { to: 'confirmed' });
    expect(conf.body.invoiceNo).toMatch(/-0002$/);
    expect((await t.adminJson(`/orders/${id}/status`, 'POST', { to: 'shipped' })).status).toBe(400); // must be packed first
    await t.adminJson(`/orders/${id}/status`, 'POST', { to: 'packed' });
    expect((await t.adminJson(`/orders/${id}/status`, 'POST', { to: 'shipped' })).body.error).toMatch(/tracking ID/);
    expect((await t.adminJson(`/orders/${id}/status`, 'POST', { to: 'shipped', courier: 'Steadfast', trackingId: 'SF123456' })).status).toBe(200);
    const track = await t.json('/api/orders/track', { method: 'POST', body: { phone: '01622222222', orderNo: r.body.orderNo } });
    expect(track.body).toMatchObject({ status: 'shipped', courier: 'Steadfast', trackingId: 'SF123456' });
  });

  it('flags a double tap as a possible duplicate and lets staff merge it', async () => {
    const lines = [{ variantId: await variant('SPC-MMSL-1KG-0003'), qty: 2 }];
    const a = await order(lines, { phone: '01733333333' });
    const b = await order(lines, { phone: '01733333333' });
    expect(b.status).toBe(201);
    const [dup] = await t.sql('SELECT duplicate_of_order_id, risk_reasons FROM orders WHERE id = ?', b.body.orderId);
    expect(dup.duplicate_of_order_id).toBe(a.body.orderId);
    expect(dup.risk_reasons).toContain('possible_duplicate');
    expect((await t.adminJson(`/orders/${b.body.orderId}/merge`, 'POST', {})).status).toBe(200);
    expect((await t.sql('SELECT status FROM orders WHERE id = ?', b.body.orderId))[0].status).toBe('cancelled');
  });

  it('applies wholesale tier prices from 5 packs', async () => {
    const q = await t.json('/api/cart/price', { method: 'POST', body: { lines: [{ variantId: await variant('SPC-MMSL-1KG-0003'), qty: 5 }] } });
    expect(q.body.lines[0].unitPaisa).toBe(60000);
  });

  it('refuses more than the real stock', async () => {
    const r = await order([{ variantId: await variant('MCH-CHNC-6IN-0005'), qty: 4 }], { paymentMethod: 'manual_mobile', advanceTrxId: 'X1Y2Z3W4' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/Only 3 left/);
  });
});

describe('admin: templates drive the upload form', () => {
  const catId = async (slug: string) => (await t.sql<{ id: number }>('SELECT id FROM categories WHERE slug = ?', slug))[0].id;

  it('Organic & Seasonal Food shows Weight presets and food fields; publishing is blocked without a best-before date', async () => {
    const created = await t.adminJson('/products', 'POST', { categoryId: await catId('organic-seasonal-food'), name: 'Sundarban Honey' });
    const id = created.body.id;
    const p = (await t.adminJson(`/products/${id}`)).body;
    expect(p.effectiveVariantAttributes.map((a: { attributeTypeId: string }) => a.attributeTypeId)).toEqual(['weight', 'packaging']);
    expect(p.effectiveSpecFields.map((f: { key: string }) => f.key)).toEqual(expect.arrayContaining(['origin', 'batch_no', 'best_before', 'storage']));
    expect(p.effectiveSpecFields.some((f: { key: string }) => /warranty/.test(f.key))).toBe(false);

    const media = new FormData();
    media.append('file', new File([new Uint8Array([0x52, 0x49, 0x46, 0x46])], 'honey.webp', { type: 'image/webp' }));
    media.append('productId', String(id));
    const up = await t.fetch('/api/admin/media', { method: 'POST', body: media, headers: { cookie: t.admin.cookie, 'x-csrf-token': t.admin.csrf } });
    expect(up.status).toBe(201);

    const save = (specs: Record<string, string>) => t.adminJson(`/products/${id}`, 'PUT', {
      name: 'Sundarban Honey', shortDescription: 'Raw mangrove honey.', specs,
      variants: [{ attributes: { weight: '500g' }, pricePaisa: 55000, stock: 10, packedWeightGrams: 700 }],
    });
    const saved = await save({ origin: 'Sundarbans', batch_no: 'B-7', ingredients: 'Raw honey', storage: 'Keep closed' });
    expect(saved.status).toBe(200);
    expect(saved.body.variants[0].sku).toBe('ORG-SHNY-500G-0008');
    expect(saved.body.variants[0].netValue).toBe(500); // filled from the "500g" weight
    const blocked = await t.adminJson(`/products/${id}/publish`, 'POST', {});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('Add a best-before date. Required for food products.');
    await save({ origin: 'Sundarbans', batch_no: 'B-7', ingredients: 'Raw honey', storage: 'Keep closed', best_before: '2027-12-31' });
    expect((await t.adminJson(`/products/${id}/publish`, 'POST', {})).body.status).toBe('published');
    expect((await t.fetch('/p/sundarban-honey')).status).toBe(200);
  });

  it('Food Business Machines has Size/Model and warranty but no Weight selector, and still needs packed weight', async () => {
    const id = (await t.adminJson('/products', 'POST', { categoryId: await catId('sealers'), name: 'Hand Sealer' })).body.id;
    const p = (await t.adminJson(`/products/${id}`)).body;
    expect(p.effectiveVariantAttributes.map((a: { attributeTypeId: string }) => a.attributeTypeId)).toEqual(['model_size', 'power_type']);
    const bad = await t.adminJson(`/products/${id}`, 'PUT', { name: 'Hand Sealer', variants: [{ attributes: { weight: '1kg' }, pricePaisa: 90000, packedWeightGrams: 1000 }] });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/"weight" is not a choice/);
    const saved = await t.adminJson(`/products/${id}`, 'PUT', { name: 'Hand Sealer', variants: [{ attributes: { model_size: '200mm' }, pricePaisa: 90000, packedWeightGrams: 0 }] });
    expect(saved.body.checklist.items.find((i: { key: string }) => i.key === 'packed_weight').ok).toBe(false);
  });

  it('"Customers choose this" promotes a spec to a variant for one product only', async () => {
    const cat = await catId('home-furniture');
    const a = (await t.adminJson('/products', 'POST', { categoryId: cat, name: 'Shoe Rack' })).body.id;
    const b = (await t.adminJson('/products', 'POST', { categoryId: cat, name: 'Book Shelf' })).body.id;
    const r = await t.adminJson(`/products/${a}`, 'PUT', {
      name: 'Shoe Rack', promotedSpecKeys: ['material'],
      variants: [{ attributes: { material: 'Teak' }, pricePaisa: 300000, packedWeightGrams: 9000 }, { attributes: { material: 'Mahogany' }, pricePaisa: 280000, packedWeightGrams: 9000 }],
    });
    expect(r.status).toBe(200);
    expect(r.body.variants.map((v: { sku: string }) => v.sku)).toEqual(['HOM-SRCK-TEAK-0002', 'HOM-SRCK-MAH-0003']);
    expect(r.body.effectiveSpecFields.some((f: { key: string }) => f.key === 'material')).toBe(false);
    const other = (await t.adminJson(`/products/${b}`)).body;
    expect(other.effectiveVariantAttributes.some((x: { attributeTypeId: string }) => x.attributeTypeId === 'material')).toBe(false);
    expect(other.effectiveSpecFields.some((f: { key: string }) => f.key === 'material')).toBe(true);
  });

  it('an admin can create a new template and category (Mango season: Weight + Grade) without a developer', async () => {
    const tpl = await t.adminJson('/templates', 'POST', {
      id: 'fresh_produce', name: 'Fresh produce', explanation: 'Fresh fruit needs weight, grade and the harvest date.',
      defaultShippingProfile: 'perishable', allowedFulfilment: ['in_stock', 'pre_order'], requiresNetQuantity: true, cardKeySpecs: ['net_weight', 'origin'],
      variantAttributes: [{ attributeTypeId: 'weight', required: true, presetValues: ['5kg', '10kg'] }, { attributeTypeId: 'grade', required: true, presetValues: ['Premium', 'Grade A'] }],
      specFields: [{ label: 'Origin', type: 'text', required: true, filterable: true }, { key: 'harvest_date', label: 'Harvest date', type: 'date', required: true }],
    });
    expect(tpl.status).toBe(201);
    const cat = await t.adminJson('/categories', 'POST', { name: 'Fresh Mango', code: 'MNG', templateId: 'fresh_produce' });
    expect(cat.status).toBe(201);
    const id = (await t.adminJson('/products', 'POST', { categoryId: cat.body.id, name: 'Fazli Mango' })).body.id;
    const r = await t.adminJson(`/products/${id}`, 'PUT', {
      name: 'Fazli Mango', specs: { origin: 'Rajshahi', harvest_date: '2027-06-01' },
      variants: [{ attributes: { weight: '5kg', grade: 'Premium' }, pricePaisa: 90000, packedWeightGrams: 5600 }, { attributes: { weight: '5kg', grade: 'Grade A' }, pricePaisa: 75000, packedWeightGrams: 5600 }],
    });
    expect(r.body.variants.map((v: { sku: string }) => v.sku)).toEqual(['MNG-FMNG-5KG-PRE-0001', 'MNG-FMNG-5KG-GA-0002']);
    expect(r.body.template.specFields.map((f: { key: string }) => f.key)).toEqual(['origin', 'harvest_date']);
    // A template in use cannot be deleted, only retired.
    expect((await t.adminJson('/templates/fresh_produce', 'DELETE')).status).toBe(409);
    expect((await t.adminJson('/templates/fresh_produce/retire', 'POST', {})).status).toBe(200);
  });

  it('keeps every SKU unique across the store', async () => {
    const id = (await t.adminJson('/products', 'POST', { categoryId: await catId('spices-masala'), name: 'Chili Powder' })).body.id;
    const r = await t.adminJson(`/products/${id}`, 'PUT', { name: 'Chili Powder', variants: [{ attributes: { pack_size: '250g' }, pricePaisa: 9000, packedWeightGrams: 300, sku: 'SPC-MMSL-250G-0001' }] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/already used by another product/);
  });

  it('downloads one CSV layout per template and imports drafts from it', async () => {
    const r = await t.fetch('/api/admin/templates/packaged_food/csv', { headers: { cookie: t.admin.cookie } });
    const csv = await r.text();
    expect(csv.split('\r\n')[0]).toContain('option_pack_size');
    expect(csv).toContain('spec_best_before');
    const header = csv.split('\r\n')[0];
    const row = (pack: string, price: string) => header.split(',').map(col => ({ product_name: 'Turmeric Powder', option_pack_size: pack, price_taka: price, stock: '20', packed_weight_grams: '300', spec_best_before: '2027-08-01' } as Record<string, string>)[col] ?? '').join(',');
    const imp = await t.adminJson('/products/import', 'POST', { categoryId: await catId('spices-masala'), csv: [header, row('100g', '60'), row('250g', '140')].join('\n') });
    expect(imp.body).toMatchObject({ created: 1, errors: [] });
    const [p] = await t.sql("SELECT status, (SELECT COUNT(*) FROM product_variants v WHERE v.product_id = products.id) AS n FROM products WHERE name = 'Turmeric Powder'");
    expect(p).toMatchObject({ status: 'draft', n: 2 });
  });

  it('blocks health claims and requires a document for claim badges', async () => {
    const id = await productId('khejur-patali-gur');
    const noDoc = await t.adminJson(`/products/${id}/claims`, 'POST', { claim: 'Organic', documentMediaId: 999 });
    expect(noDoc.status).toBe(400);
    expect(noDoc.body.error).toMatch(/supporting document/);
    const detail = (await t.adminJson(`/products/${id}`)).body;
    const r = await t.adminJson(`/products/${id}`, 'PUT', { ...toPayload(detail), description: 'Boosts immunity and cures colds.' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/health claim/);
  });
});

function toPayload(d: any) {
  return {
    categoryId: d.product.category_id, name: d.product.name, slug: d.product.slug, code: d.product.code, shortDescription: d.product.short_description, description: d.product.description,
    brand: d.product.brand, specs: d.specs, seasonIds: d.seasonIds, fulfilmentMode: d.product.fulfilment_mode, shippingProfile: d.product.shipping_profile,
    variants: d.variants.map((v: any) => ({ id: v.id, attributes: v.attributes, pricePaisa: v.pricePaisa, compareAtPricePaisa: v.compareAtPricePaisa, stock: v.stock, packedWeightGrams: v.packedWeightGrams, netValue: v.netValue, netUnit: v.netUnit, sku: v.sku })),
  };
}

describe('admin security', () => {
  it('refuses a second setup and requires the CSRF token on writes', async () => {
    const again = await t.json('/api/admin/setup', { method: 'POST', body: { token: 'setup-token-for-tests', name: 'X', email: 'x@y.z', password: 'another-pass-99' } });
    expect(again.status).toBe(403);
    const noCsrf = await t.json('/api/admin/seasons', { method: 'POST', body: { name: 'Test' }, headers: { cookie: t.admin.cookie } });
    expect(noCsrf.status).toBe(403);
    expect((await t.json('/api/admin/orders')).status).toBe(401);
  });

  it('enforces roles on the server', async () => {
    await t.adminJson('/staff', 'POST', { name: 'Viewer', email: 'viewer@absvai.test', role: 'viewer', password: 'viewer-pass-123' });
    const login = await t.fetch('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'viewer@absvai.test', password: 'viewer-pass-123' }) });
    const csrf = ((await login.json()) as { csrf: string }).csrf;
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    expect((await t.json('/api/admin/orders', { headers: { cookie } })).status).toBe(200);
    expect((await t.json('/api/admin/categories', { method: 'POST', body: { name: 'X' }, headers: { cookie, 'x-csrf-token': csrf } })).status).toBe(403);
    expect((await t.json('/api/admin/settings', { method: 'PUT', body: { tagline: 'x' }, headers: { cookie, 'x-csrf-token': csrf } })).status).toBe(403);
  });

  it('logs admin actions in the audit log', async () => {
    const r = await t.adminJson('/audit');
    expect(r.body.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['setup', 'product.publish', 'template.create', 'order.status']));
  });
});

describe('storefront pages and SEO', () => {
  it('renders the homepage with the active season first and real deals', async () => {
    const html = await (await t.fetch('/')).text();
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('Fresh khejur gur is here');
    expect(html).toContain('In Season Now');
    expect(html).toContain('Abs Vai Originals');
    expect(html).not.toMatch(/people (are )?viewing/i);
  });

  it('uses template-driven filters on category listings', async () => {
    const html = await (await t.fetch('/c/clothing')).text();
    expect(html).toContain('name="a.apparel_size"');
    expect(html).toContain('name="a.color"');
    const food = await (await t.fetch('/c/organic-seasonal-food')).text();
    expect(food).toContain('name="f.origin"');
    expect(food).not.toContain('a.apparel_size');
  });

  it('finds products by transliterated names', async () => {
    const html = await (await t.fetch('/search?q=nolen%20gur')).text();
    expect(html).toContain('Khejur Patali Gur');
    const masala = await (await t.fetch('/search?q=moshla')).text();
    expect(masala).toContain('42 Item Master Masala');
  });

  it('lists seasonal pages in the sitemap all year', async () => {
    const xml = await (await t.fetch('/sitemap.xml')).text();
    expect(xml).toContain('/season/mango');
    expect(xml).toContain('/p/khejur-patali-gur');
  });

  it('sends security headers', async () => {
    const r = await t.fetch('/');
    expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(r.headers.get('strict-transport-security')).toContain('max-age=');
  });

  it('cron publishes scheduled products', async () => {
    await t.sql("UPDATE products SET status = 'scheduled', publish_at = '2020-01-01T00:00:00.000Z' WHERE slug = 'wooden-hand-masher'");
    expect(await publishScheduled(t.env)).toBe(1);
    expect((await t.sql("SELECT status FROM products WHERE slug = 'wooden-hand-masher'"))[0].status).toBe('published');
  });
});
