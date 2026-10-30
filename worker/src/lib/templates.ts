/**
 * Product templates (build prompt Section 3). A template bundles four separate things:
 *   variant attributes (customer chooses, each combination is a variant with its own price/stock/SKU),
 *   specification fields (admin fills in, customer reads), a shipping profile and the allowed fulfilment modes.
 * Upload forms, product-page panels, card key-spec lines and listing filters are all generated from it.
 */
import { formatDate, isIsoDate } from './dates';
import type { NetUnit } from './money';
import { healthClaimIn } from './claims';
import { attributesKey, SKU_PATTERN } from './sku';

export type SpecFieldType = 'text' | 'longtext' | 'number' | 'date' | 'select' | 'dimensions' | 'file' | 'boolean';
export type ShippingProfile = 'standard' | 'fragile' | 'heavy_bulky' | 'perishable';
export type FulfilmentMode = 'in_stock' | 'pre_order' | 'made_to_order';

export interface SpecField {
  key: string;
  label: string;
  type: SpecFieldType;
  unit?: string | null;
  required: boolean;
  helpText?: string | null;
  placeholder?: string | null;
  options?: string[] | null;
  panel: string;
  showOnProductPage: boolean;
  canBecomeVariant: boolean;
  filterable: boolean;
  cardFormat?: string | null;
}

export interface VariantAttribute {
  attributeTypeId: string;
  label: string;
  required: boolean;
  presetValues: string[];
  allowCustomValues: boolean;
  input: 'chips' | 'swatch' | 'select';
  swatches?: Record<string, string>;
  promoted?: boolean;
}

export interface ProductTemplate {
  id: string;
  name: string;
  explanation: string;
  variantAttributes: VariantAttribute[];
  specFields: SpecField[];
  defaultShippingProfile: ShippingProfile;
  allowedFulfilment: FulfilmentMode[];
  requiresSizeChart: boolean;
  sizeChartColumns: string[];
  requiresBrand: boolean;
  requiresNetQuantity: boolean;
  cardKeySpecs: string[];
  status: 'active' | 'retired';
}

export const PANEL_TITLES: Record<string, string> = {
  food: 'Food details',
  specs: 'Specifications',
  in_box: 'In the box',
  warranty: 'Warranty',
  care: 'Care',
  details: 'Details',
};

export const SHIPPING_PROFILE_LABELS: Record<ShippingProfile, string> = {
  standard: 'Standard parcel',
  fragile: 'Fragile',
  heavy_bulky: 'Heavy / bulky',
  perishable: 'Perishable food',
};

export const parseJsonSafe = <T>(s: unknown, fallback: T): T => {
  if (typeof s !== 'string' || !s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
};

export function rowToSpecField(f: Record<string, unknown>): SpecField {
  return {
    key: String(f.key),
    label: String(f.label),
    type: f.type as SpecFieldType,
    unit: (f.unit as string) ?? null,
    required: Boolean(f.required),
    helpText: (f.help_text as string) ?? null,
    placeholder: (f.placeholder as string) ?? null,
    options: parseJsonSafe<string[] | null>(f.options, null),
    panel: String(f.panel ?? 'details'),
    showOnProductPage: Boolean(f.show_on_product_page),
    canBecomeVariant: Boolean(f.can_become_variant),
    filterable: Boolean(f.filterable),
    cardFormat: (f.card_format as string) ?? null,
  };
}

/** Template variant attributes plus any spec fields this one product promoted with "Customers choose this". */
export function effectiveVariantAttributes(template: ProductTemplate, promotedKeys: string[]): VariantAttribute[] {
  const promoted = template.specFields
    .filter(f => f.canBecomeVariant && promotedKeys.includes(f.key))
    .map<VariantAttribute>(f => ({
      attributeTypeId: f.key, label: f.label, required: true, presetValues: [], allowCustomValues: true, input: 'chips', promoted: true,
    }));
  return [...template.variantAttributes, ...promoted];
}

/** Spec fields still filled in once per product (promoted ones move to the variant table). */
export function effectiveSpecFields(template: ProductTemplate, promotedKeys: string[]): SpecField[] {
  return template.specFields.filter(f => !(f.canBecomeVariant && promotedKeys.includes(f.key)));
}

/** Every combination of the chosen option values: {weight:[500g,1kg]} × {packaging:[Jar]} → 2 variants. */
export function combinations(selections: Array<{ attributeTypeId: string; values: string[] }>): Array<Record<string, string>> {
  const used = selections.filter(s => s.values.length);
  return used.reduce<Array<Record<string, string>>>(
    (acc, sel) => acc.flatMap(combo => sel.values.map(v => ({ ...combo, [sel.attributeTypeId]: v }))),
    [{}],
  );
}

/** "500g" → {500, g}; "1.5 kg" → {1.5, kg}; "100 pcs" → {100, pcs}. */
export function parseNetQuantity(value: string | undefined | null): { value: number; unit: NetUnit } | null {
  if (!value) return null;
  const m = value.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(g|gm|gram|grams|kg|ml|l|ltr|litre|liter|m|metre|meter|metres|meters|pcs|pc|pieces)\b/);
  if (!m) return null;
  const unitMap: Record<string, NetUnit> = { g: 'g', gm: 'g', gram: 'g', grams: 'g', kg: 'kg', ml: 'ml', l: 'l', ltr: 'l', litre: 'l', liter: 'l', m: 'm', metre: 'm', meter: 'm', metres: 'm', meters: 'm', pcs: 'pcs', pc: 'pcs', pieces: 'pcs' };
  return { value: Number(m[1]), unit: unitMap[m[2]] };
}

export function formatNetQuantity(value: number | null | undefined, unit: string | null | undefined): string {
  if (!value || !unit) return '';
  return unit === 'pcs' ? `${value} pcs` : `${value}${unit}`;
}

export function formatSpecValue(field: Pick<SpecField, 'type' | 'unit' | 'label'>, value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  switch (field.type) {
    case 'boolean': return value === '1' || value === 'true' ? 'Yes' : 'No';
    case 'date': return isIsoDate(value) ? formatDate(value) : value;
    case 'number': return field.unit ? `${value} ${field.unit}` : value;
    case 'dimensions': return field.unit ? `${value} ${field.unit}` : value;
    default: return value;
  }
}

export function validateSpecValue(field: SpecField, value: string): string | null {
  if (value === '') return null;
  switch (field.type) {
    case 'number': return /^\d+(\.\d+)?$/.test(value) ? null : `${field.label} must be a number.`;
    case 'date': return isIsoDate(value) ? null : `${field.label} must be a date.`;
    case 'boolean': return ['0', '1', 'true', 'false'].includes(value) ? null : `${field.label} must be yes or no.`;
    case 'select': return !field.options || field.options.includes(value) ? null : `${field.label} must be one of: ${field.options.join(', ')}.`;
    case 'dimensions': return /^\d+(\.\d+)?(\s*[×x]\s*\d+(\.\d+)?){1,2}$/.test(value.trim()) ? null : `${field.label} should look like 62 × 20 × 16.`;
    default: return value.length > 5000 ? `${field.label} is too long.` : null;
  }
}

export interface VariantLike {
  attributes: Record<string, string>;
  pricePaisa: number;
  compareAtPricePaisa?: number | null;
  stock: number;
  packedWeightGrams: number;
  netValue?: number | null;
  netUnit?: string | null;
  sku: string;
  isActive?: boolean;
}

export interface ProductLike {
  name?: string | null;
  slug?: string | null;
  shortDescription?: string | null;
  brand?: string | null;
  fulfilmentMode: FulfilmentMode;
  preorderDispatchDate?: string | null;
  preorderAdvanceType?: string | null;
  preorderAdvancePaisa?: number | null;
  madeToOrderLeadDays?: number | null;
  promotedSpecKeys: string[];
  sizeChart?: { columns: string[]; rows: Array<{ size: string; values: string[] }> } | null;
  imageCount: number;
  description?: string | null;
  benefitChips?: string[];
}

export interface ChecklistItem { key: string; ok: boolean; message: string }

/** Plain-language publish checklist. Drafts can always be saved; Publish stays disabled until every item is ok. */
export function publishChecklist(template: ProductTemplate, product: ProductLike, specs: Record<string, string>, variants: VariantLike[]): { ready: boolean; items: ChecklistItem[] } {
  const items: ChecklistItem[] = [];
  const add = (key: string, ok: boolean, message: string) => items.push({ key, ok, message });
  const kind = `${template.name.toLowerCase()} products`;

  add('name', Boolean(product.name?.trim()), 'Add a product name.');
  add('short_description', Boolean(product.shortDescription?.trim()), 'Add a short description. It shows on product cards.');
  add('slug', Boolean(product.slug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(product.slug)), 'Add a web address (URL slug) using lowercase letters, numbers and dashes.');
  add('photo', product.imageCount > 0, 'Add at least one photo.');
  const claim = [product.name, product.shortDescription, product.description, ...(product.benefitChips ?? [])].map(healthClaimIn).find(Boolean);
  if (claim) add('health_claims', false, `Remove the health claim "${claim}". Products cannot claim to cure, treat or boost health.`);
  if (template.requiresBrand) add('brand', Boolean(product.brand?.trim()), `Add the brand. Required for ${kind}.`);

  for (const field of effectiveSpecFields(template, product.promotedSpecKeys)) {
    const value = (specs[field.key] ?? '').trim();
    if (field.required) {
      const lower = field.label.charAt(0).toLowerCase() + field.label.slice(1);
      const what = field.type === 'date' ? `a ${lower}${/date$/i.test(lower) ? '' : ' date'}` : `the ${lower}`;
      const help = field.helpText && /^Required/.test(field.helpText) ? field.helpText : `Required for ${kind}.`;
      add(`spec:${field.key}`, value !== '', `Add ${what}. ${help}`);
    }
    if (value) {
      const err = validateSpecValue(field, value);
      if (err) add(`spec_valid:${field.key}`, false, err);
    }
  }

  const active = variants.filter(v => v.isActive !== false);
  add('variants', active.length > 0, 'Add at least one option with a price.');
  const attrs = effectiveVariantAttributes(template, product.promotedSpecKeys);
  for (const a of attrs.filter(x => x.required)) {
    const missing = active.filter(v => !v.attributes[a.attributeTypeId]?.trim()).length;
    add(`attr:${a.attributeTypeId}`, active.length > 0 && missing === 0, `Choose ${a.label.toLowerCase()} for every option. Customers pick it before ordering.`);
  }
  const keys = active.map(v => attributesKey(v.attributes));
  add('unique_options', new Set(keys).size === keys.length, 'Two options have exactly the same choices. Remove the duplicate.');
  add('prices', active.every(v => Number.isInteger(v.pricePaisa) && v.pricePaisa > 0), 'Every option needs a price.');
  add('compare_at', active.every(v => !v.compareAtPricePaisa || v.compareAtPricePaisa > v.pricePaisa), 'The original (struck-through) price must be higher than the selling price.');
  add('packed_weight', active.every(v => Number.isInteger(v.packedWeightGrams) && v.packedWeightGrams > 0), 'Add the packed weight for delivery to every option. Courier charges depend on it.');
  if (template.requiresNetQuantity) {
    add('net_quantity', active.every(v => (v.netValue ?? 0) > 0 && v.netUnit), `Add the net weight or quantity to every option. Required for ${kind}.`);
  }
  add('skus', active.every(v => SKU_PATTERN.test(v.sku)), 'Every option needs a valid SKU like ORG-PTGR-500G-0001.');
  const skus = active.map(v => v.sku);
  add('unique_skus', new Set(skus).size === skus.length, 'Two options share the same SKU.');

  if (template.requiresSizeChart) {
    const sizeAttr = attrs.find(a => /size/.test(a.attributeTypeId));
    const sizes = sizeAttr ? [...new Set(active.map(v => v.attributes[sizeAttr.attributeTypeId]).filter(Boolean))] : [];
    const rows = product.sizeChart?.rows ?? [];
    const covered = rows.length > 0 && sizes.every(s => rows.some(r => r.size === s && r.values.some(x => x.trim())));
    add('size_chart', covered, `Add a size chart with measurements for every size. Required for ${kind}.`);
  }

  add('fulfilment_allowed', template.allowedFulfilment.includes(product.fulfilmentMode), `This category does not allow "${product.fulfilmentMode.replace(/_/g, ' ')}".`);
  if (product.fulfilmentMode === 'pre_order') {
    add('preorder_date', isIsoDate(product.preorderDispatchDate), 'Add the expected dispatch date for this pre-order.');
    add('preorder_advance', product.preorderAdvanceType === 'delivery_charge' || (product.preorderAdvanceType === 'fixed' && (product.preorderAdvancePaisa ?? 0) > 0), 'Choose the pre-order advance: the delivery charge or a fixed amount.');
  }
  if (product.fulfilmentMode === 'made_to_order') {
    add('lead_time', (product.madeToOrderLeadDays ?? 0) > 0, 'Add how many days it takes to make this item.');
  }

  return { ready: items.every(i => i.ok), items };
}

/** Short spec line under the product name on cards: "1kg · Jashore", "300mm · 6 months warranty". */
export function cardKeySpecLine(template: Pick<ProductTemplate, 'cardKeySpecs' | 'specFields'>, specs: Record<string, string>, variant: { attributes: Record<string, string>; netValue?: number | null; netUnit?: string | null } | null): string {
  const parts: string[] = [];
  for (const key of template.cardKeySpecs) {
    if (key === 'net_weight') {
      const s = formatNetQuantity(variant?.netValue, variant?.netUnit);
      if (s) parts.push(s);
    } else if (key.startsWith('variant.')) {
      const v = variant?.attributes[key.slice(8)];
      if (v) parts.push(v);
    } else {
      const field = template.specFields.find(f => f.key === key);
      const raw = specs[key];
      if (!field || !raw) continue;
      if (field.type === 'boolean') { if (raw === '1') parts.push(field.label); continue; }
      const val = formatSpecValue(field, raw);
      parts.push(field.cardFormat ? field.cardFormat.replace('{value}', val) : val);
    }
  }
  return parts.join(' · ');
}

export interface InfoPanel { panel: string; title: string; rows: Array<{ key: string; label: string; value: string; type: SpecFieldType }> }

/** Product-page info panels, in template order, only for fields that have a value and are shown on the page. */
export function infoPanels(template: ProductTemplate, specs: Record<string, string>, promotedKeys: string[]): InfoPanel[] {
  const panels = new Map<string, InfoPanel>();
  for (const field of effectiveSpecFields(template, promotedKeys)) {
    const raw = specs[field.key];
    if (!field.showOnProductPage || raw === undefined || raw === '') continue;
    const panel = panels.get(field.panel) ?? { panel: field.panel, title: PANEL_TITLES[field.panel] ?? 'Details', rows: [] };
    panel.rows.push({ key: field.key, label: field.label, value: field.type === 'file' ? raw : formatSpecValue(field, raw), type: field.type });
    panels.set(field.panel, panel);
  }
  return [...panels.values()];
}
