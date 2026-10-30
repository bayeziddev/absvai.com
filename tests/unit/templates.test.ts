import { describe, expect, it } from 'vitest';
import { cardKeySpecLine, combinations, effectiveSpecFields, effectiveVariantAttributes, infoPanels, parseNetQuantity, publishChecklist, type ProductLike, type VariantLike } from '../../worker/src/lib/templates';
import { launchTemplate } from '../helpers/templates';

const baseProduct = (over: Partial<ProductLike> = {}): ProductLike => ({
  name: 'Khejur Patali Gur', slug: 'khejur-patali-gur', shortDescription: 'Boiled date-palm jaggery.', brand: null,
  fulfilmentMode: 'in_stock', promotedSpecKeys: [], sizeChart: null, imageCount: 1, ...over,
});
const v = (attributes: Record<string, string>, over: Partial<VariantLike> = {}): VariantLike => ({
  attributes, pricePaisa: 72000, stock: 10, packedWeightGrams: 1200, netValue: 1, netUnit: 'kg', sku: 'ORG-PTGR-1KG-0002', ...over,
});
const foodSpecs = { origin: 'Jashore', batch_no: 'B-1', best_before: '2027-03-31', ingredients: '100% date-palm sap', storage: 'Cool, dry place' };

describe('weighed_food template (Organic & Seasonal Food)', () => {
  const t = launchTemplate('weighed_food');

  it('offers Weight presets and food spec fields, never Size, Color or Warranty', () => {
    expect(t.variantAttributes.map(a => a.attributeTypeId)).toEqual(['weight', 'volume', 'packaging']);
    expect(t.variantAttributes[0].presetValues).toEqual(['250g', '500g', '1kg', '2kg', '5kg']);
    const keys = t.specFields.map(f => f.key);
    expect(keys).toEqual(expect.arrayContaining(['origin', 'batch_no', 'best_before', 'storage', 'ingredients']));
    expect(keys.some(k => /warranty|size|color/.test(k))).toBe(false);
  });

  it('cannot be published without a best-before date', () => {
    const { best_before: _omit, ...withoutDate } = foodSpecs;
    const r = publishChecklist(t, baseProduct(), withoutDate, [v({ weight: '1kg' })]);
    expect(r.ready).toBe(false);
    const item = r.items.find(i => i.key === 'spec:best_before')!;
    expect(item.ok).toBe(false);
    expect(item.message).toBe('Add a best-before date. Required for food products.');
    expect(publishChecklist(t, baseProduct(), foodSpecs, [v({ weight: '1kg' })]).ready).toBe(true);
  });

  it('requires net weight and packed weight on every option', () => {
    const r = publishChecklist(t, baseProduct(), foodSpecs, [v({ weight: '1kg' }, { netValue: null, netUnit: null, packedWeightGrams: 0 })]);
    expect(r.items.find(i => i.key === 'net_quantity')!.ok).toBe(false);
    expect(r.items.find(i => i.key === 'packed_weight')!.message).toMatch(/packed weight for delivery/);
  });

  it('allows pre-order but checks the dispatch date and advance rule', () => {
    const r = publishChecklist(t, baseProduct({ fulfilmentMode: 'pre_order' }), foodSpecs, [v({ weight: '1kg' })]);
    expect(r.items.find(i => i.key === 'preorder_date')!.ok).toBe(false);
    const ok = publishChecklist(t, baseProduct({ fulfilmentMode: 'pre_order', preorderDispatchDate: '2026-11-20', preorderAdvanceType: 'delivery_charge' }), foodSpecs, [v({ weight: '1kg' })]);
    expect(ok.ready).toBe(true);
  });

  it('shows "1kg · Jashore" on the card', () => {
    expect(cardKeySpecLine(t, foodSpecs, { attributes: { weight: '1kg' }, netValue: 1, netUnit: 'kg' })).toBe('1kg · Jashore');
  });
});

describe('machinery template (Food Business Machines)', () => {
  const t = launchTemplate('machinery');
  const specs = { model_no: 'PFS-300', body_material: 'Steel', capacity: '10 seals / min', in_the_box: 'Sealer', warranty_period: '6 months', warranty_by: 'Abs Vai' };

  it('has Size/Model plus warranty and in-the-box, with no customer Weight selector', () => {
    expect(t.variantAttributes.map(a => a.attributeTypeId)).toEqual(['model_size', 'power_type']);
    expect(t.variantAttributes.some(a => a.attributeTypeId === 'weight')).toBe(false);
    expect(t.specFields.map(f => f.key)).toEqual(expect.arrayContaining(['warranty_period', 'warranty_by', 'in_the_box']));
  });

  it('still requires packed weight for delivery', () => {
    const r = publishChecklist(t, baseProduct(), specs, [v({ model_size: '300mm' }, { packedWeightGrams: 0, sku: 'MCH-SEAL-300MM-0003', netValue: null, netUnit: null })]);
    expect(r.items.find(i => i.key === 'packed_weight')!.ok).toBe(false);
    expect(r.items.find(i => i.key === 'net_quantity')).toBeUndefined();
  });

  it('formats the warranty on the card line', () => {
    expect(cardKeySpecLine(t, specs, { attributes: { model_size: '300mm' } })).toBe('300mm · 6 months warranty');
  });

  it('groups info panels as Specifications / In the box / Warranty', () => {
    expect(infoPanels(t, specs, []).map(p => p.title)).toEqual(['Specifications', 'In the box', 'Warranty']);
  });
});

describe('clothing, shoes and accessories', () => {
  it('clothing needs Size + Color and a size chart covering every size', () => {
    const t = launchTemplate('apparel');
    expect(t.variantAttributes.filter(a => a.required).map(a => a.attributeTypeId)).toEqual(['apparel_size', 'color']);
    const specs = { fabric: 'Cotton', care: 'Wash cold', gender_age: 'Men' };
    const variants = [v({ apparel_size: 'M', color: 'White' }, { sku: 'CLO-PNJB-M-WHI-0001', netValue: null, netUnit: null }), v({ apparel_size: 'L', color: 'White' }, { sku: 'CLO-PNJB-L-WHI-0002', netValue: null, netUnit: null })];
    const partial = publishChecklist(t, baseProduct({ sizeChart: { columns: ['Chest'], rows: [{ size: 'M', values: ['40'] }] } }), specs, variants);
    expect(partial.items.find(i => i.key === 'size_chart')!.ok).toBe(false);
    const full = publishChecklist(t, baseProduct({ sizeChart: { columns: ['Chest'], rows: [{ size: 'M', values: ['40'] }, { size: 'L', values: ['42'] }] } }), specs, variants);
    expect(full.ready).toBe(true);
  });

  it('shoes use a foot-length chart', () => {
    const t = launchTemplate('footwear');
    expect(t.requiresSizeChart).toBe(true);
    expect(t.sizeChartColumns).toEqual(['Foot length (cm)']);
  });

  it('accessories can be published with no variant attributes at all', () => {
    const t = launchTemplate('simple');
    const r = publishChecklist(t, baseProduct(), { material: 'Leather', dimensions: '10 × 4' }, [v({}, { sku: 'ACC-BELT-STD-0001', netValue: null, netUnit: null })]);
    expect(r.ready).toBe(true);
  });
});

describe('promote a spec to a variant ("Customers choose this")', () => {
  const t = launchTemplate('bulky_home');

  it('turns Material into a variant attribute for one product only', () => {
    const promoted = effectiveVariantAttributes(t, ['material']);
    expect(promoted.map(a => a.attributeTypeId)).toContain('material');
    expect(effectiveSpecFields(t, ['material']).some(f => f.key === 'material')).toBe(false);
    // Another product using the same template is unaffected.
    expect(effectiveVariantAttributes(t, []).some(a => a.attributeTypeId === 'material')).toBe(false);
    expect(effectiveSpecFields(t, []).some(f => f.key === 'material')).toBe(true);
  });

  it('ignores fields that are not allowed to become variants', () => {
    expect(effectiveVariantAttributes(t, ['dimensions']).some(a => a.attributeTypeId === 'dimensions')).toBe(false);
  });

  it('then requires a material on every option instead of in the specs', () => {
    const specs = { dimensions: '62 × 20 × 16', assembly_required: '1', max_load: '25', item_weight: '9' };
    const variants = [v({ material: 'Teak' }, { sku: 'HOM-CRCK-TEA-0001', netValue: null, netUnit: null }), v({ material: '' }, { sku: 'HOM-CRCK-MAH-0002', netValue: null, netUnit: null })];
    const r = publishChecklist(t, baseProduct({ promotedSpecKeys: ['material'] }), specs, variants);
    expect(r.items.find(i => i.key === 'attr:material')!.ok).toBe(false);
    expect(r.items.find(i => i.key === 'spec:material')).toBeUndefined();
  });
});

describe('variant combinations', () => {
  it('creates one variant per combination', () => {
    expect(combinations([{ attributeTypeId: 'apparel_size', values: ['M', 'L'] }, { attributeTypeId: 'color', values: ['Red', 'Black', 'White'] }])).toHaveLength(6);
    expect(combinations([{ attributeTypeId: 'weight', values: ['500g'] }, { attributeTypeId: 'packaging', values: [] }])).toEqual([{ weight: '500g' }]);
    expect(combinations([])).toEqual([{}]);
  });

  it('flags duplicate options', () => {
    const t = launchTemplate('weighed_food');
    const r = publishChecklist(t, baseProduct(), foodSpecs, [v({ weight: '1kg' }), v({ weight: '1KG' }, { sku: 'ORG-PTGR-1KG-0009' })]);
    expect(r.items.find(i => i.key === 'unique_options')!.ok).toBe(false);
  });

  it('parses net quantity from preset labels', () => {
    expect(parseNetQuantity('500g')).toEqual({ value: 500, unit: 'g' });
    expect(parseNetQuantity('1.5 kg')).toEqual({ value: 1.5, unit: 'kg' });
    expect(parseNetQuantity('100 pcs')).toEqual({ value: 100, unit: 'pcs' });
    expect(parseNetQuantity('8×6 inch')).toBeNull();
  });
});
