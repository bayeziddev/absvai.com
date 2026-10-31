/**
 * Order tracking for customers: one box that takes the mobile number OR the order number (or the invoice number, or
 * the courier's tracking code). A mobile number shows that number's latest orders; a code shows that one order. Each
 * order comes with its items, money, delivery area, courier and the full timeline from order_tracking.
 *
 * Privacy: anyone can type a number, so the page never shows the full name, the full mobile number or the house
 * address: only the first name and initials, a masked number and the area (upazila, district). Lookups are rate
 * limited per IP in the route.
 */
import type { Env } from '../env';
import { bad, notFound } from '../lib/http';
import { asciiDigits, maskPhone, normalizeBdPhone } from '../lib/phone';
import { STATUS_LABELS, type OrderStatus } from '../lib/state-machine';
import { courierLabel, maskName, orderCodeCandidates, PAYMENT_LABELS, stageIndex } from '../lib/tracking';
import { trackItems, trackLines, trackOrderByCode, trackOrdersByPhone, type TrackOrder } from '../repo/tracking';

export interface TrackedOrder {
  orderNo: string; placedAt: string; status: OrderStatus; statusLabel: string;
  /** 0–4 along Placed → Confirmed → Packed → With courier → Delivered; -1 when cancelled or returned. */
  stage: number;
  name: string; phone: string; area: string; preOrder: boolean; invoiceNo: string | null;
  payment: string; paymentState: string;
  items: Array<{ name: string; variant: string | null; qty: number; unitPaisa: number; linePaisa: number; returned: number }>;
  subtotalPaisa: number; deliveryPaisa: number; codFeePaisa: number; discountPaisa: number; totalPaisa: number; paidPaisa: number; duePaisa: number;
  courier: string | null; trackingCode: string | null; eta: string | null;
  steps: Array<{ title: string; titleBn: string | null; detail: string | null; at: string; source: string }>;
}

export interface TrackResult { by: 'phone' | 'code'; orders: TrackedOrder[] }

const n = (v: unknown) => Number(v ?? 0) || 0;
const HANDED_OVER = new Set(['in_courier', 'delivered', 'partial_delivered', 'returned']);

function paidOf(o: TrackOrder): number {
  if (o.payment_status === 'paid') return n(o.total_paisa);
  if (o.advance_status === 'paid') return Math.min(n(o.advance_amount_paisa), n(o.total_paisa));
  return 0;
}

function paymentState(o: TrackOrder, paid: number): string {
  if (o.payment_status === 'refunded') return 'Refunded';
  if (o.payment_status === 'paid') return 'Paid';
  if (paid > 0) return 'Advance paid';
  if (o.advance_required && o.advance_status === 'submitted') return 'Advance sent: the shop is checking it';
  if (o.advance_required && o.advance_status === 'pending') return 'Advance needed before we ship';
  return o.payment_method === 'cod' ? 'Pay the courier when the parcel arrives' : 'Not paid yet';
}

async function present(env: Env, rows: TrackOrder[]): Promise<TrackedOrder[]> {
  const ids = rows.map(r => r.id);
  const [items, lines] = await Promise.all([trackItems(env.DB, ids), trackLines(env.DB, ids)]);
  return rows.map(o => {
    const status = o.status as OrderStatus;
    const paid = paidOf(o);
    const total = n(o.total_paisa);
    const closed = status === 'cancelled' || status === 'returned';
    return {
      orderNo: String(o.order_no), placedAt: String(o.created_at), status, statusLabel: STATUS_LABELS[status] ?? status, stage: closed ? -1 : stageIndex(status),
      name: maskName(o.customer_name as string), phone: maskPhone(String(o.phone ?? '')),
      area: [o.upazila_name, o.district_name].filter(Boolean).join(', ') || String(o.division_name ?? ''),
      preOrder: o.fulfilment_type === 'pre_order', invoiceNo: (o.invoice_no as string) ?? null,
      payment: PAYMENT_LABELS[String(o.payment_method)] ?? String(o.payment_method), paymentState: closed && !paid ? '—' : paymentState(o, paid),
      items: items.filter(i => i.order_id === o.id).map(i => ({ name: i.name, variant: i.variant_label, qty: i.qty, unitPaisa: i.unit_price_paisa, linePaisa: i.line_total_paisa, returned: i.returned_qty ?? 0 })),
      subtotalPaisa: n(o.subtotal_paisa), deliveryPaisa: n(o.delivery_charge_paisa), codFeePaisa: n(o.cod_fee_paisa), discountPaisa: n(o.discount_paisa),
      totalPaisa: total, paidPaisa: paid, duePaisa: closed ? 0 : Math.max(0, total - paid),
      // The courier planned for the zone is shown only once the parcel is really with them.
      courier: o.courier && (o.tracking_id || HANDED_OVER.has(status)) ? courierLabel(String(o.courier)) : null, trackingCode: (o.tracking_id as string) ?? null, eta: (o.eta_text as string) ?? null,
      steps: lines.filter(l => l.order_id === o.id).map(l => ({ title: l.title, titleBn: l.title_bn, detail: l.detail, at: l.created_at, source: l.source })),
    };
  });
}

/**
 * `q` is the one tracking box. The older two-box form (phone + orderNo, both given) still works and must match both.
 * Throws 400 for something that is neither a number nor a code, and 404 when nothing matches.
 */
export async function trackOrders(env: Env, input: { q?: string; phone?: string; orderNo?: string }): Promise<TrackResult> {
  const q = asciiDigits(String(input.q ?? '')).trim();
  const phoneIn = String(input.phone ?? '').trim();
  const codeIn = String(input.orderNo ?? '').trim();
  if (!q && phoneIn && codeIn) {
    const phone = normalizeBdPhone(phoneIn);
    const o = phone ? await trackOrderByCode(env.DB, orderCodeCandidates(codeIn)) : null;
    if (!o || o.phone !== phone) throw notFound('We could not find an order with that mobile number and order number.');
    return { by: 'code', orders: await present(env, [o]) };
  }
  const value = q || phoneIn || codeIn;
  if (!value) throw bad('Type your mobile number or your order number.');
  const phone = normalizeBdPhone(value);
  if (phone) {
    const rows = await trackOrdersByPhone(env.DB, phone);
    if (!rows.length) throw notFound('We could not find any order on this mobile number. Check the number you ordered with.');
    return { by: 'phone', orders: await present(env, rows) };
  }
  const codes = orderCodeCandidates(value);
  if (!codes.length) throw bad('Type your mobile number (01XXXXXXXXX) or your order number (like AV-261030-0001).');
  const o = await trackOrderByCode(env.DB, codes);
  if (!o) throw notFound('We could not find an order with that number. Check the order number in your SMS or email.');
  return { by: 'code', orders: await present(env, [o]) };
}
