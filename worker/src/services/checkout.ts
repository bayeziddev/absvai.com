/** Checkout quote: repriced cart + live delivery charge + advance rules, shown before the customer places the order. */
import { deliveryCharge, type ChargeResult } from '../lib/delivery-charge';
import { resolveZone } from '../repo/geo';
import { settingInt } from '../repo/settings';
import { formatTaka } from '../lib/money';
import { priceCart, type CartLineIn, type PricedLine } from './cart';
import { checkCoupon } from './coupons';

export interface AdvanceRule { required: boolean; amountPaisa: number | null; reasons: string[] }

export interface Quote {
  lines: PricedLine[];
  problems: string[];
  subtotalPaisa: number;
  delivery: ChargeResult | null;
  needsArea: boolean;
  defaultCourier: string | null;
  discountPaisa: number;
  /** The coupon that applies (and what it takes off), or why the typed code can't be used. */
  coupon: { id: number; code: string; label: string; discountPaisa: number; kind: string; note: string | null } | null;
  couponError: string | null;
  advance: AdvanceRule;
  totalPaisa: number | null;
  hasPreOrder: boolean;
}

/**
 * Advance payment (build prompt Sections 5 and 12): pre-orders, heavy/bulky items, and high-value orders from new
 * or high-risk customers. Usually the delivery charge, paid by bKash/Nagad before confirmation.
 */
export function advanceFor(lines: PricedLine[], delivery: ChargeResult | null, opts: { totalPaisa: number; highValueThresholdPaisa: number; customerIsNewOrRisky: boolean }): AdvanceRule {
  const reasons: string[] = [];
  let fixed = 0;
  let needsDeliveryCharge = false;
  for (const l of lines) {
    if (l.fulfilmentMode === 'pre_order' && l.preorder) {
      if (l.preorder.advanceType === 'fixed' && l.preorder.advancePaisa > 0) {
        fixed += l.preorder.advancePaisa * l.qty;
        reasons.push(`Pre-order advance for ${l.name}: ${formatTaka(l.preorder.advancePaisa)}${l.qty > 1 ? ` × ${l.qty}` : ''}.`);
      } else {
        needsDeliveryCharge = true;
        reasons.push(`Pre-orders need the delivery charge paid in advance to book your slot (${l.name}).`);
      }
    }
  }
  if (lines.some(l => l.shippingProfile === 'heavy_bulky')) {
    needsDeliveryCharge = true;
    reasons.push('Large items need the delivery charge paid in advance.');
  }
  if (opts.customerIsNewOrRisky && opts.highValueThresholdPaisa > 0 && opts.totalPaisa >= opts.highValueThresholdPaisa) {
    needsDeliveryCharge = true;
    reasons.push(`Orders over ${formatTaka(opts.highValueThresholdPaisa)} from new customers need the delivery charge paid in advance.`);
  }
  if (!fixed && !needsDeliveryCharge) return { required: false, amountPaisa: 0, reasons: [] };
  if (needsDeliveryCharge && delivery?.status === 'to_confirm') {
    return { required: true, amountPaisa: null, reasons: [...reasons, 'We will tell you the exact advance when we call to confirm the delivery charge.'] };
  }
  const deliveryPart = needsDeliveryCharge ? delivery?.chargePaisa ?? 0 : 0;
  const amount = fixed + deliveryPart;
  if (amount <= 0) return { required: false, amountPaisa: 0, reasons: [] };
  return { required: true, amountPaisa: amount, reasons };
}

export async function quote(
  db: D1Database,
  settings: Record<string, string>,
  input: { lines: CartLineIn[]; districtId: number | null; upazilaId: number | null; paymentMethod: string; customerIsNewOrRisky?: boolean; discountPaisa?: number; couponCode?: string | null; phone?: string | null },
  now = new Date(),
): Promise<Quote> {
  const priced = await priceCart(db, input.lines, now);
  let delivery: ChargeResult | null = null;
  let needsArea = false;
  let defaultCourier: string | null = null;
  if (input.districtId) {
    const z = await resolveZone(db, input.districtId, input.upazilaId);
    if (z) {
      needsArea = z.needsArea;
      defaultCourier = z.defaultCourier;
      delivery = deliveryCharge(
        priced.lines.map(l => ({ qty: l.qty, packedWeightGrams: l.packedWeightGrams, freeDelivery: l.freeDelivery, shippingProfile: l.shippingProfile, bulkyDeliveryMode: l.bulkyDeliveryMode, lineTotalPaisa: l.lineTotalPaisa })),
        z.zone,
        {
          freeThresholdPaisa: settingInt(settings, 'free_delivery_threshold_paisa'),
          freeExcludesBulky: settings.free_delivery_excludes_bulky !== '0',
          codFeePaisa: settingInt(settings, 'cod_fee_paisa'),
        },
        input.paymentMethod,
      );
    }
  }
  // Manual orders: a staff discount (role limits are checked by the caller). Web orders: a coupon. Product discounts never
  // go below zero; a free-delivery coupon takes the delivery charge off.
  let couponOff = 0;
  let deliveryOff = 0;
  let coupon: Quote['coupon'] = null;
  let couponError: string | null = null;
  if (input.couponCode?.trim()) {
    const chargeKnown = delivery && delivery.chargePaisa !== null ? delivery.chargePaisa : null;
    const r = await checkCoupon(db, input.couponCode, { subtotalPaisa: priced.subtotalPaisa, deliveryChargePaisa: chargeKnown, phone: input.phone ?? null }, now);
    if (r.ok) {
      if (r.coupon.kind === 'free_delivery') deliveryOff = r.discountPaisa; else couponOff = r.discountPaisa;
      coupon = { id: r.coupon.id, code: r.coupon.code, label: r.label, discountPaisa: r.discountPaisa, kind: r.coupon.kind, note: r.coupon.kind === 'free_delivery' && chargeKnown === null ? 'Delivery becomes free once you choose your area.' : null };
    } else couponError = r.error;
  }
  const discountPaisa = Math.min(Math.max(0, input.discountPaisa ?? 0) + couponOff, priced.subtotalPaisa) + deliveryOff;
  const totalPaisa = delivery && delivery.chargePaisa !== null ? priced.subtotalPaisa - discountPaisa + delivery.chargePaisa + delivery.codFeePaisa : null;
  const advance = advanceFor(priced.lines, delivery, {
    totalPaisa: totalPaisa ?? priced.subtotalPaisa,
    highValueThresholdPaisa: settingInt(settings, 'advance_high_value_threshold_paisa'),
    customerIsNewOrRisky: input.customerIsNewOrRisky ?? true,
  });
  return {
    lines: priced.lines,
    problems: priced.problems,
    subtotalPaisa: priced.subtotalPaisa,
    delivery,
    needsArea,
    defaultCourier,
    discountPaisa,
    coupon,
    couponError,
    advance,
    totalPaisa,
    hasPreOrder: priced.lines.some(l => l.fulfilmentMode === 'pre_order'),
  };
}
