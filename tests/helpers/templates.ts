import { ATTRIBUTE_TYPES, TEMPLATES } from '../../scripts/seed-defs';
import type { ProductTemplate } from '../../worker/src/lib/templates';

/** The launch templates exactly as the seed migration stores them, in the shape loadTemplate() returns. */
export function launchTemplate(id: string): ProductTemplate {
  const t = TEMPLATES.find(x => x.id === id);
  if (!t) throw new Error(`no template ${id}`);
  return {
    id: t.id,
    name: t.name,
    explanation: t.explanation,
    variantAttributes: t.variantAttributes.map(a => {
      const type = ATTRIBUTE_TYPES.find(x => x.id === a.attributeTypeId)!;
      return { attributeTypeId: a.attributeTypeId, label: a.label ?? type.name, required: a.required, presetValues: a.presetValues, allowCustomValues: a.allowCustomValues !== false, input: type.input ?? 'chips' };
    }),
    specFields: t.specFields.map(f => ({
      key: f.key, label: f.label, type: f.type, unit: f.unit ?? null, required: Boolean(f.required), helpText: f.helpText ?? null,
      placeholder: f.placeholder ?? null, options: f.options ?? null, panel: f.panel ?? 'details', showOnProductPage: f.showOnProductPage !== false,
      canBecomeVariant: Boolean(f.canBecomeVariant), filterable: Boolean(f.filterable), cardFormat: f.cardFormat ?? null,
    })),
    defaultShippingProfile: t.defaultShippingProfile,
    allowedFulfilment: t.allowedFulfilment,
    requiresSizeChart: Boolean(t.requiresSizeChart),
    sizeChartColumns: t.sizeChartColumns ?? [],
    requiresBrand: Boolean(t.requiresBrand),
    requiresNetQuantity: Boolean(t.requiresNetQuantity),
    cardKeySpecs: t.cardKeySpecs,
    status: 'active',
  };
}
