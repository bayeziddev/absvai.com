import { describe, expect, it } from 'vitest';
import { attributesKey, formatSku, productCodeFromName, SKU_PATTERN, valueCode, variantCode } from '../../worker/src/lib/sku';

describe('SKU codes', () => {
  it('produces the worked examples from the build prompt (Section 3.4)', () => {
    expect(formatSku('ORG', 'PTGR', variantCode({ weight: '500g' }), 1)).toBe('ORG-PTGR-500G-0001');
    expect(formatSku('ORG', 'PTGR', variantCode({ weight: '1kg' }), 2)).toBe('ORG-PTGR-1KG-0002');
    expect(formatSku('SPC', 'MMSL', variantCode({ pack_size: '1kg' }), 4)).toBe('SPC-MMSL-1KG-0004');
    expect(formatSku('MCH', 'SEAL', variantCode({ model_size: '300mm' }), 3)).toBe('MCH-SEAL-300MM-0003');
    expect(formatSku('MCH', 'CHNC', variantCode({ model_size: '4-inch' }), 1)).toBe('MCH-CHNC-4IN-0001');
    expect(formatSku('TLS', 'VLPR', variantCode({ finish: 'Colored', tool_size: '8×6 inch' }), 2)).toBe('TLS-VLPR-8X6-COL-0002');
    expect(formatSku('HOM', 'CRCK', variantCode({}), 1)).toBe('HOM-CRCK-STD-0001');
  });

  it('keeps size before colour regardless of key order', () => {
    expect(variantCode({ color: 'Red', apparel_size: 'L' })).toBe('L-RED');
    expect(variantCode({ apparel_size: 'L', color: 'Red' })).toBe('L-RED');
  });

  it('gives different codes to multi-word values that share a first word', () => {
    expect(valueCode('Grade A')).not.toBe(valueCode('Grade B'));
    expect(valueCode('Foil tray')).toBe('FT');
    expect(valueCode('100 pcs')).toBe('100PCS');
    expect(valueCode('2.5kg')).toBe('2P5KG');
  });

  it('suggests a 4-letter product code from the name', () => {
    expect(productCodeFromName('Khejur Patali Gur (foil tray)')).toBe('KPGR');
    expect(productCodeFromName('Sealer')).toHaveLength(4);
  });

  it('canonical attribute key ignores order and case', () => {
    expect(attributesKey({ size: 'L', color: 'Red' })).toBe(attributesKey({ color: 'red', size: 'L' }));
    expect(attributesKey({})).toBe('');
  });

  it('validates the SKU pattern', () => {
    expect(SKU_PATTERN.test('TLS-VLPR-8X6-COL-0002')).toBe(true);
    expect(SKU_PATTERN.test('bad sku')).toBe(false);
  });
});
