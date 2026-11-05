import { describe, expect, it } from 'vitest';
import { optionValues } from '../../admin/js/lib/variant-options';

describe('admin variant option values', () => {
  const color = { attributeTypeId: 'color', presetValues: [], input: 'swatch' as const };
  const types = [{
    id: 'color',
    values: [
      { value: 'White', hex: '#FFFFFF' },
      { value: 'Navy', hex: '#1E2A4A' },
      { value: 'Invalid swatch', hex: 'red;display:none' },
    ],
  }];

  it('includes registered colors with their saved swatch colors', () => {
    expect(optionValues(color, types)).toEqual([
      { value: 'White', hex: '#FFFFFF' },
      { value: 'Navy', hex: '#1E2A4A' },
      { value: 'Invalid swatch', hex: null },
    ]);
  });

  it('keeps presets and already-selected custom values without duplicates', () => {
    expect(optionValues(
      { ...color, presetValues: ['One size', 'White'] },
      types,
      ['Custom teal', 'Navy'],
    )).toEqual([
      { value: 'One size', hex: null },
      { value: 'White', hex: '#FFFFFF' },
      { value: 'Navy', hex: '#1E2A4A' },
      { value: 'Invalid swatch', hex: null },
      { value: 'Custom teal', hex: null },
    ]);
  });

  it('uses a hex-coded custom choice as its own swatch', () => {
    expect(optionValues(color, [], ['#20A090'])).toEqual([{ value: '#20A090', hex: '#20A090' }]);
  });
});
