export interface OptionAttribute {
  attributeTypeId: string;
  presetValues?: string[];
  input?: 'chips' | 'swatch' | 'select';
  swatches?: Record<string, string>;
}

export interface RegisteredOptionType {
  id: string;
  values?: Array<{ value: string; hex: string | null }>;
}

export interface OptionValue {
  value: string;
  hex: string | null;
}

export function optionValues(
  attribute: OptionAttribute,
  attributeTypes?: RegisteredOptionType[],
  selected?: string[],
): OptionValue[];
