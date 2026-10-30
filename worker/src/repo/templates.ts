/** Template reads. Templates are data: the upload form, product page, card line and filters are generated from them. */
import { parseJsonSafe as parseJson, rowToSpecField, type FulfilmentMode, type ProductTemplate, type ShippingProfile, type VariantAttribute } from '../lib/templates';

/** Loads a template with its attributes, preset values, swatches and spec fields. */
export async function loadTemplate(db: D1Database, id: string): Promise<ProductTemplate | null> {
  const t = await db.prepare('SELECT * FROM product_templates WHERE id = ?').bind(id).first<Record<string, unknown>>();
  if (!t) return null;
  const [attrs, swatches, fields] = await db.batch([
    db.prepare(`SELECT tva.*, at.name AS type_name, at.input FROM template_variant_attributes tva
                JOIN attribute_types at ON at.id = tva.attribute_type_id WHERE tva.template_id = ? ORDER BY tva.sort_order`).bind(id),
    db.prepare(`SELECT av.attribute_type_id, av.value, av.swatch_hex FROM attribute_values av
                JOIN template_variant_attributes tva ON tva.attribute_type_id = av.attribute_type_id
                WHERE tva.template_id = ? AND av.swatch_hex IS NOT NULL`).bind(id),
    db.prepare('SELECT * FROM template_spec_fields WHERE template_id = ? ORDER BY sort_order').bind(id),
  ]);
  const swatchMap = new Map<string, Record<string, string>>();
  for (const s of swatches.results as Array<Record<string, string>>) {
    const m = swatchMap.get(s.attribute_type_id) ?? {};
    m[s.value] = s.swatch_hex;
    swatchMap.set(s.attribute_type_id, m);
  }
  return {
    id: String(t.id),
    name: String(t.name),
    explanation: String(t.explanation),
    variantAttributes: (attrs.results as Array<Record<string, unknown>>).map(a => ({
      attributeTypeId: String(a.attribute_type_id),
      label: String(a.label ?? a.type_name),
      required: Boolean(a.required),
      presetValues: parseJson<string[]>(a.preset_values, []),
      allowCustomValues: Boolean(a.allow_custom_values),
      input: (a.input as VariantAttribute['input']) ?? 'chips',
      swatches: swatchMap.get(String(a.attribute_type_id)),
    })),
    specFields: (fields.results as Array<Record<string, unknown>>).map(rowToSpecField),
    defaultShippingProfile: t.default_shipping_profile as ShippingProfile,
    allowedFulfilment: parseJson<FulfilmentMode[]>(t.allowed_fulfilment, ['in_stock']),
    requiresSizeChart: Boolean(t.requires_size_chart),
    sizeChartColumns: parseJson<string[]>(t.size_chart_columns, []),
    requiresBrand: Boolean(t.requires_brand),
    requiresNetQuantity: Boolean(t.requires_net_quantity),
    cardKeySpecs: parseJson<string[]>(t.card_key_specs, []),
    status: t.status as ProductTemplate['status'],
  };
}

