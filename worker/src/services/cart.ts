/** Server-side cart pricing. The browser cart only holds variant IDs and quantities; prices always come from here. */
import { cartVariantRows, getSeasons, getTemplate, rowToVariant } from '../repo/catalog';
import { bdDate } from '../lib/dates';
import { parseJson } from '../lib/http';
import { tierPrice } from '../lib/money';
import { productAvailability, type Availability } from '../lib/seasons';
import { effectiveVariantAttributes } from '../lib/templates';

export interface CartLineIn { variantId: number; qty: number }

export interface PricedLine {
  variantId: number;
  productId: number;
  slug: string;
  name: string;
  variantLabel: string;
  sku: string;
  image: string;
  qty: number;
  basePaisa: number;
  unitPaisa: number;
  lineTotalPaisa: number;
  packedWeightGrams: number;
  freeDelivery: boolean;
  shippingProfile: 'standard' | 'fragile' | 'heavy_bulky' | 'perishable';
  bulkyDeliveryMode: 'zone_fixed' | 'confirm_by_phone';
  fulfilmentMode: 'in_stock' | 'pre_order' | 'made_to_order';
  preorder: { advanceType: string | null; advancePaisa: number; dispatchDate: string | null } | null;
  availability: Availability;
  maxQty: number;
  problem: string | null;
}

export const MAX_LINES = 30;
export const MAX_QTY = 99;

export function sanitizeLines(input: unknown): CartLineIn[] {
  if (!Array.isArray(input)) return [];
  const merged = new Map<number, number>();
  for (const l of input.slice(0, MAX_LINES)) {
    const id = Number((l as CartLineIn)?.variantId);
    const qty = Number((l as CartLineIn)?.qty);
    if (Number.isInteger(id) && id > 0 && Number.isInteger(qty) && qty > 0) merged.set(id, Math.min(MAX_QTY, (merged.get(id) ?? 0) + qty));
  }
  return [...merged].map(([variantId, qty]) => ({ variantId, qty }));
}

export async function priceCart(db: D1Database, lines: CartLineIn[], now = new Date()): Promise<{ lines: PricedLine[]; subtotalPaisa: number; problems: string[] }> {
  if (!lines.length) return { lines: [], subtotalPaisa: 0, problems: [] };
  const ids = lines.map(l => l.variantId);
  const rows = await cartVariantRows(db, ids);
  const byId = new Map(rows.map(r => [Number(r.id), r]));
  const seasons = await getSeasons(db);
  const today = bdDate(now);
  const out: PricedLine[] = [];
  const problems: string[] = [];

  for (const l of lines) {
    const r = byId.get(l.variantId);
    const published = r && !r.deleted_at && Number(r.is_active) === 1 && (r.status === 'published' || (r.status === 'scheduled' && String(r.publish_at) <= now.toISOString()));
    if (!r || !published) { problems.push('An item in your cart is no longer available and was removed.'); continue; }
    const v = rowToVariant(r);
    const template = await getTemplate(db, String(r.template_id));
    const promoted: string[] = [];
    const order = template ? effectiveVariantAttributes(template, promoted).map(a => a.attributeTypeId) : [];
    const label = [...order.filter(k => v.attributes[k]), ...Object.keys(v.attributes).filter(k => !order.includes(k))].map(k => v.attributes[k]).join(' · ');
    const linked = seasons.filter(s => parseJson<number[]>(r.season_ids, []).includes(s.id));
    // Confirmed orders hold stock (reserved), so customers can only buy what is still available.
    const availability = productAvailability(r as { fulfilment_mode: string }, linked, v.available, today);
    const fulfilment = r.fulfilment_mode as PricedLine['fulfilmentMode'];
    const maxQty = fulfilment === 'made_to_order' ? 20 : Math.min(MAX_QTY, v.available);
    let problem: string | null = null;
    if (!availability.canBuy) problem = availability.label;
    else if (maxQty === 0) problem = 'Out of stock';
    else if (l.qty > maxQty) problem = `Only ${maxQty} left`;
    if (problem) problems.push(`${String(r.name)}${label ? ` (${label})` : ''}: ${problem}.`);
    const unit = tierPrice(v.pricePaisa, v.wholesaleTiers, l.qty);
    out.push({
      variantId: v.id, productId: Number(r.pid), slug: String(r.slug), name: String(r.name), variantLabel: label, sku: v.sku,
      image: String(r.image_url ?? '/img/placeholders/none.svg'), qty: l.qty, basePaisa: v.pricePaisa, unitPaisa: unit, lineTotalPaisa: unit * l.qty,
      packedWeightGrams: v.packedWeightGrams, freeDelivery: Boolean(r.free_delivery), shippingProfile: r.shipping_profile as PricedLine['shippingProfile'],
      bulkyDeliveryMode: r.bulky_delivery_mode as PricedLine['bulkyDeliveryMode'], fulfilmentMode: fulfilment,
      preorder: fulfilment === 'pre_order' ? { advanceType: (r.preorder_advance_type as string) ?? null, advancePaisa: Number(r.preorder_advance_paisa ?? 0), dispatchDate: (r.preorder_dispatch_date as string) ?? null } : null,
      availability, maxQty, problem,
    });
  }
  return { lines: out, subtotalPaisa: out.reduce((s, l) => s + l.lineTotalPaisa, 0), problems };
}
