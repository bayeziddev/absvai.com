/**
 * Coupon rules. A coupon takes a percentage or a taka amount off the products, or makes delivery free. It can need a
 * minimum order, cap a percentage discount, run between two dates, and be limited in total uses and per customer
 * (mobile number). The checkout quote and the order placement both run the same check, so what the customer sees is
 * what they pay.
 */
import { bdDate, formatDate } from '../lib/dates';
import { formatTaka } from '../lib/money';
import { couponByCode, phoneUses, type CouponRow } from '../repo/coupons';

export const COUPON_KINDS = ['percent', 'fixed', 'free_delivery'] as const;

export const normalizeCode = (code: unknown) => String(code ?? '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 30);

export type CouponCheck =
  | { ok: true; coupon: CouponRow; discountPaisa: number; label: string }
  | { ok: false; error: string };

/** What the coupon gives on this order, or why it can't be used. */
export async function checkCoupon(
  db: D1Database,
  rawCode: string,
  order: { subtotalPaisa: number; deliveryChargePaisa: number | null; phone: string | null },
  now = new Date(),
): Promise<CouponCheck> {
  const code = normalizeCode(rawCode);
  if (!code) return { ok: false, error: 'Type the coupon code.' };
  const c = await couponByCode(db, code);
  if (!c || !c.is_active) return { ok: false, error: `“${code}” is not a valid coupon.` };
  const t = now.toISOString();
  if (c.starts_at && t < c.starts_at) return { ok: false, error: `This coupon starts on ${formatDate(bdDate(new Date(c.starts_at)))}.` };
  if (c.ends_at && t > c.ends_at) return { ok: false, error: 'This coupon has expired.' };
  if (c.usage_limit !== null && c.used_count >= c.usage_limit) return { ok: false, error: 'This coupon has been used up.' };
  if (order.subtotalPaisa < c.min_subtotal_paisa) return { ok: false, error: `This coupon needs an order of at least ${formatTaka(c.min_subtotal_paisa)}.` };
  if (c.per_phone_limit && order.phone && (await phoneUses(db, c.id, order.phone)) >= c.per_phone_limit) {
    return { ok: false, error: c.per_phone_limit === 1 ? 'You have already used this coupon.' : `This coupon can be used ${c.per_phone_limit} times per customer.` };
  }
  let discount = 0;
  let label = '';
  if (c.kind === 'percent') {
    discount = Math.floor((order.subtotalPaisa * c.value) / 100);
    if (c.max_discount_paisa !== null) discount = Math.min(discount, c.max_discount_paisa);
    label = `${c.value}% off`;
  } else if (c.kind === 'fixed') {
    discount = Math.min(c.value, order.subtotalPaisa);
    label = `${formatTaka(c.value)} off`;
  } else {
    // Free delivery: the delivery charge comes off once it is known (the customer picks their area first).
    discount = Math.max(0, order.deliveryChargePaisa ?? 0);
    label = 'Free delivery';
  }
  return { ok: true, coupon: c, discountPaisa: Math.max(0, discount), label };
}
