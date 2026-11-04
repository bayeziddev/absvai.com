const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function safeHex(value) {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value : null;
}

/**
 * Merge template presets, registered admin values, and already-saved values for one option.
 * Registered values carry their swatch hex; selected custom values are kept even if they
 * are not in the shared palette.
 */
export function optionValues(attribute, attributeTypes = [], selected = []) {
  const registered = attributeTypes.find(type => type.id === attribute.attributeTypeId)?.values ?? [];
  const hexByValue = new Map(registered.map(({ value, hex }) => [value, safeHex(hex)]));
  const values = [...new Set([
    ...(attribute.presetValues ?? []),
    ...registered.map(option => option.value),
    ...selected,
  ].filter(value => typeof value === 'string' && value.length > 0))];

  return values.map(value => ({
    value,
    hex: safeHex(attribute.swatches?.[value]) ?? hexByValue.get(value) ?? safeHex(value),
  }));
}
