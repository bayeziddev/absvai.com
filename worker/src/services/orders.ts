/**
 * Orders: placement (checkout, landing pages and staff-entered manual/social orders all use the same path), OTP,
 * pipeline transitions and the warehouse return scan.
 */
import type { Env } from '../env';
import { randomToken, sha256Hex, type Role } from '../lib/auth';
import { bad, HttpError } from '../lib/http';
import { formatTaka } from '../lib/money';
import { maskPhone, normalizeBdPhone } from '../lib/phone';
import { assessRisk } from '../lib/risk';
import { SMS } from '../lib/sms';
import { COURIERS, courierLabel } from '../lib/tracking';
import { canTransition, confirmBlockers, RESERVED_STAGES, RETURN_REASONS, STATUS_LABELS, validatePartialReturn, type Actor, type OrderStatus } from '../lib/state-machine';
import { validateAddress } from '../repo/geo';
import { nextInvoiceNo, nextOrderNo } from '../repo/numbering';
import {
  commitTransition, countOtpAttempt, customerByPhone, ensureCustomer, hasConfirmedCall, insertOrder, logRejectedTransition, markOtpVerified,
  NOW_VALUE, orderByCode, orderById, orderItems, otpRow, receiveReturn, recentActivity, saveOtp, type Row, type TransitionWrite,
} from '../repo/orders';
import { variantAvailability } from '../repo/inventory';
import { settingInt } from '../repo/settings';
import type { CartLineIn } from './cart';
import { quote } from './checkout';
import { blockedError, findBlock, minutesBetween, otpAllowed, otpSent, recordAttempt, type Identity } from './fraud';
import { orderEmails, validEmail, type OrderEmailEvent } from './email';
import { otpActive, sendSms } from './sms';
import { saveCustomerEmail } from '../repo/email';

export const ORDER_SOURCES: Record<string, string> = {
  web: 'Website', landing: 'Landing page', facebook_comment: 'Facebook comment', messenger: 'Messenger', whatsapp: 'WhatsApp',
  phone_call: 'Phone call', instagram: 'Instagram', walk_in: 'Walk-in', other: 'Other',
};
export const MANUAL_SOURCES = ['facebook_comment', 'messenger', 'whatsapp', 'phone_call', 'instagram', 'walk_in', 'other'];

export interface PlaceOrderInput {
  phone: string;
  name: string;
  divisionId: number;
  districtId: number;
  upazilaId: number;
  unionId: number | null;
  postcode: string | null;
  addressLine: string;
  landmark: string | null;
  note: string | null;
  paymentMethod: 'cod' | 'manual_mobile';
  advanceTrxId: string | null;
  advanceWallet: string | null;
  lines: CartLineIn[];
  source: string;
  sourceDetail: string | null;
  utm: Record<string, string>;
  /** Optional: the customer gets the receipt, the invoice and delivery updates by email. */
  email?: string | null;
  /** Ticked "email me offers". */
  emailOffers?: boolean;
  /** A coupon typed at checkout (web orders). */
  couponCode?: string | null;
  /** The landing page the order form was on. */
  landingPageId?: number | null;
}

/** Who is placing the order and from where. Web orders come from the checkout; manual orders from a signed-in staff member. */
export interface PlaceContext {
  channel: 'web' | 'manual';
  identity: Identity;
  checkoutSessionId: string | null;
  route: string;
  staff?: { adminId: string; role: Role; canDiscount: boolean };
  discountPaisa?: number;
  fromIncompleteId?: number | null;
}

export interface PlacedOrder {
  orderId: number;
  orderNo: string;
  accessToken: string;
  totalPaisa: number | null;
  advance: { required: boolean; amountPaisa: number | null };
  riskLevel: string;
  held: boolean;
  otpSent: boolean;
}

const DUPLICATE_WINDOW_MINUTES = 10;

export function cartSignature(lines: CartLineIn[]): string {
  return [...lines].sort((a, b) => a.variantId - b.variantId).map(l => `${l.variantId}x${l.qty}`).join(',');
}

export async function placeOrder(env: Env, settings: Record<string, string>, input: PlaceOrderInput, ctx: PlaceContext, now = new Date()): Promise<PlacedOrder> {
  const db = env.DB;
  const manual = ctx.channel === 'manual';
  const phone = normalizeBdPhone(input.phone);
  if (!phone) throw bad('Enter a Bangladeshi mobile number like 01712345678.');
  const name = input.name.trim();
  if (name.length < 2) throw bad('Enter your name.');
  if (input.addressLine.trim().length < 5) throw bad('Enter your house, road or village so the courier can find you.');
  if (!input.lines.length) throw bad('Your cart is empty.');
  const email = (input.email ?? '').trim().toLowerCase();
  if (email && !validEmail(email)) throw bad('Check your email address, or leave it empty.');
  if (manual && !MANUAL_SOURCES.includes(input.source)) throw bad('Choose where this order came from (Facebook comment, Messenger, WhatsApp, phone call…).');

  // Layer 2–4: phone, device and IP block list.
  const block = await findBlock(env, { phone, id: ctx.identity, route: ctx.route, now });
  if (block) {
    if (manual) throw new HttpError(409, `This ${block.type} is on the block list (${block.reason}). Unblock it in Security → Block list if this is a mistake.`);
    throw blockedError(block.type, settings.support_phone ?? '');
  }

  const addr = await validateAddress(db, {
    divisionId: input.divisionId, districtId: input.districtId, upazilaId: input.upazilaId, unionId: input.unionId, postcode: input.postcode,
  });
  if (!addr.ok) throw bad(addr.error);

  const customer = await customerByPhone(db, phone);
  const isNewOrRisky = !customer || customer.delivered_count === 0 || customer.returned_count > 0;

  let discount = 0;
  if (manual && ctx.discountPaisa) {
    if (!ctx.staff?.canDiscount) {
      const maxPct = settingInt(settings, 'manual_discount_max_percent', 10);
      const pre = await quote(db, settings, { lines: input.lines, districtId: input.districtId, upazilaId: input.upazilaId, paymentMethod: input.paymentMethod }, now);
      if (ctx.discountPaisa > Math.floor((pre.subtotalPaisa * maxPct) / 100)) throw bad(`Sales agents can give at most ${maxPct}% off. Ask a manager for a bigger discount.`);
    }
    discount = ctx.discountPaisa;
  }
  const couponCode = manual ? null : input.couponCode?.trim() || null;
  const q = await quote(db, settings, { lines: input.lines, districtId: input.districtId, upazilaId: input.upazilaId, paymentMethod: input.paymentMethod, customerIsNewOrRisky: isNewOrRisky, discountPaisa: discount, couponCode, phone }, now);
  if (q.problems.length) throw new HttpError(409, q.problems[0], { problems: q.problems });
  // A coupon that stopped working (used up, expired, already used by this number) is reported, never silently dropped.
  if (couponCode && q.couponError) throw new HttpError(409, `${q.couponError} Remove the coupon to order without it.`, { coupon: q.couponError });
  if (!q.delivery) throw bad('We could not work out delivery to this area. Please call us.');
  if (!manual) {
    if (q.advance.required && q.advance.amountPaisa && input.paymentMethod !== 'manual_mobile') {
      throw bad(`This order needs an advance of ${formatTaka(q.advance.amountPaisa)}. Choose bKash / Nagad / Rocket and enter the transaction ID.`);
    }
    if (input.paymentMethod === 'manual_mobile' && q.advance.required && q.advance.amountPaisa && !input.advanceTrxId) {
      throw bad('Enter the transaction ID from your bKash / Nagad / Rocket payment.');
    }
  }

  // Velocity, the time-interval rule and double taps (Section 11.1). These hold the order for review; they never cancel it.
  const intervalMinutes = settingInt(settings, 'order_interval_minutes', 10);
  const recent = await recentActivity(db, {
    phone, deviceHash: ctx.identity.deviceHash, dayAgoIso: new Date(now.getTime() - 86_400_000).toISOString(),
    intervalStartIso: new Date(now.getTime() - intervalMinutes * 60_000).toISOString(),
    duplicateSinceIso: new Date(now.getTime() - DUPLICATE_WINDOW_MINUTES * 60_000).toISOString(), cartSignature: cartSignature(input.lines),
  });
  const holds: Array<{ layer: 'interval' | 'velocity'; reason: string }> = [];
  if (recent.intervalHit) {
    holds.push({ layer: 'interval', reason: `Another order (${recent.intervalHit.orderNo}) came from the same ${recent.intervalHit.by} ${minutesBetween(recent.intervalHit.createdAt, now)} minute(s) ago. Possible duplicate: merge it or release the hold.` });
  }
  const velocityMax = settingInt(settings, 'velocity_max_orders_24h', 3);
  if (velocityMax > 0 && recent.ordersLast24h >= velocityMax) holds.push({ layer: 'velocity', reason: `${recent.ordersLast24h + 1} orders from this phone in 24 hours.` });
  const duplicateOf = recent.duplicateOf ?? recent.intervalHit?.id ?? null;

  const risk = assessRisk({
    postcodeMismatch: addr.postcodeMismatch,
    addressLine: input.addressLine,
    totalPaisa: q.totalPaisa ?? q.subtotalPaisa,
    highValueThresholdPaisa: settingInt(settings, 'advance_high_value_threshold_paisa'),
    customer: customer ? { orderCount: customer.order_count, deliveredCount: customer.delivered_count, returnedCount: customer.returned_count, isTrusted: Boolean(customer.is_trusted) } : null,
    recentOrdersSamePhone24h: recent.ordersLast24h,
    duplicateOfOrderId: recent.duplicateOf,
  });

  const orderNo = await nextOrderNo(db, q.hasPreOrder, now);
  const accessToken = randomToken(16);
  const fulfilment = q.hasPreOrder ? 'pre_order' : q.lines.some(l => l.fulfilmentMode === 'made_to_order') ? 'made_to_order' : 'standard';
  const advanceStatus = !q.advance.required ? 'not_required' : input.advanceTrxId ? 'submitted' : 'pending';
  if (!customer) await ensureCustomer(db, phone, name);

  const orderId = await insertOrder(db, {
    orderNo, accessToken, fulfilmentType: fulfilment, paymentMethod: input.paymentMethod,
    advanceRequired: q.advance.required, advanceReason: q.advance.reasons.join(' ') || null, advanceAmountPaisa: q.advance.amountPaisa, advanceStatus,
    advanceTrxId: input.advanceTrxId, advanceWallet: input.advanceWallet,
    subtotalPaisa: q.subtotalPaisa, deliveryChargePaisa: q.delivery.chargePaisa, deliveryChargeStatus: q.delivery.status, codFeePaisa: q.delivery.codFeePaisa,
    discountPaisa: q.discountPaisa, totalPaisa: q.totalPaisa ?? q.subtotalPaisa - q.discountPaisa, zoneId: q.delivery.zoneId, etaText: q.delivery.etaText,
    name, phone, divisionId: input.divisionId, districtId: input.districtId, upazilaId: input.upazilaId, unionId: input.unionId, postcode: input.postcode,
    postOffice: addr.postOffice, names: addr.names, addressLine: input.addressLine.trim(), landmark: input.landmark, note: input.note,
    riskLevel: risk.level, riskReasons: risk.reasons, duplicateOf, holdReason: holds.map(h => h.reason).join(' ') || null,
    source: input.source, sourceDetail: input.sourceDetail, utm: input.utm, checkoutSessionId: ctx.checkoutSessionId,
    deviceHash: ctx.identity.deviceHash, ipHash: ctx.identity.ipHash,
    createdBy: ctx.staff?.adminId ?? null, assignedTo: ctx.staff?.adminId ?? null, courier: q.defaultCourier,
    landingPageId: input.landingPageId ?? null, coupon: q.coupon ? { id: q.coupon.id, code: q.coupon.code, discountPaisa: q.coupon.discountPaisa } : null,
    items: q.lines.map(l => ({ productId: l.productId, variantId: l.variantId, sku: l.sku, name: l.name, variantLabel: l.variantLabel, unitPaisa: l.unitPaisa, qty: l.qty, lineTotalPaisa: l.lineTotalPaisa, packedWeightGrams: l.packedWeightGrams, fulfilmentMode: l.fulfilmentMode })),
    conversion: { sessionId: ctx.checkoutSessionId, phone, sinceIso: new Date(now.getTime() - settingInt(settings, 'incomplete_conversion_window_hours', 24) * 3_600_000).toISOString(), incompleteId: ctx.fromIncompleteId ?? null },
    placedNote: manual ? `Entered by staff from ${ORDER_SOURCES[input.source]}${input.sourceDetail ? ` (${input.sourceDetail})` : ''}` : `Placed on the ${input.source === 'landing' ? 'landing page' : 'website'}`,
    actor: manual ? 'staff' : 'customer',
  });
  for (const h of holds) {
    await recordAttempt(env, { layer: h.layer, action: 'held', route: ctx.route, reason: h.reason, phoneHint: maskPhone(phone), deviceHash: ctx.identity.deviceHash, ipHash: ctx.identity.ipHash, orderId });
  }

  if (email) await saveCustomerEmail(db, orderId, phone, email, Boolean(input.emailOffers));
  await orderEmails(env, orderId, 'placed');
  await sendSms(env, { to: phone, body: SMS.orderReceived(orderNo, q.totalPaisa === null ? 'charge to confirm' : formatTaka(q.totalPaisa)), kind: 'order_received', orderId });
  let otp = false;
  if (input.paymentMethod === 'cod' && otpActive(env, settings)) otp = (await issueOtp(env, settings, { orderId, orderNo, phone, identity: ctx.identity, route: ctx.route })).sent;

  return { orderId, orderNo, accessToken, totalPaisa: q.totalPaisa, advance: { required: q.advance.required, amountPaisa: q.advance.amountPaisa }, riskLevel: risk.level, held: holds.length > 0, otpSent: otp };
}

// ───────────── OTP ─────────────

const OTP_TTL_MINUTES = 15;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_SENDS_PER_ORDER = 3;

async function otpHash(env: Env, orderId: number, code: string): Promise<string> {
  return sha256Hex(`${env.OTP_PEPPER ?? 'absvai-dev-pepper'}:${orderId}:${code}`);
}

export function generateOtp(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, '0');
}

/** Sends a code only within the per-order, per-phone, per-device and store-wide caps (counted in otp_log). */
export async function issueOtp(env: Env, settings: Record<string, string>, a: { orderId: number; orderNo: string; phone: string; identity: Identity; route: string }): Promise<{ sent: boolean; message: string }> {
  const existing = await otpRow(env.DB, a.orderId);
  if (existing && existing.sends >= OTP_MAX_SENDS_PER_ORDER) return { sent: false, message: 'You have asked for the code too many times. We will call you to confirm instead.' };
  const allowed = await otpAllowed(env, settings, { phone: a.phone, id: a.identity, orderId: a.orderId, route: a.route });
  if (!allowed.ok) return { sent: false, message: allowed.message };
  const code = generateOtp();
  await saveOtp(env.DB, a.orderId, await otpHash(env, a.orderId, code), new Date(Date.now() + OTP_TTL_MINUTES * 60_000).toISOString());
  await sendSms(env, { to: a.phone, body: SMS.otp(code, a.orderNo), kind: 'otp', orderId: a.orderId });
  await otpSent(env, { phone: a.phone, id: a.identity, orderId: a.orderId });
  return { sent: true, message: 'A new code is on its way.' };
}

export async function verifyOtp(env: Env, orderId: number, code: string): Promise<{ ok: boolean; message: string }> {
  const row = await otpRow(env.DB, orderId);
  if (!row) return { ok: false, message: 'Ask for a new code.' };
  if (row.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, message: 'Too many tries. We will call you to confirm instead.' };
  if (row.expires_at < new Date().toISOString()) return { ok: false, message: 'That code has expired. Ask for a new one.' };
  await countOtpAttempt(env.DB, orderId);
  if (row.code_hash !== (await otpHash(env, orderId, code.trim()))) return { ok: false, message: 'That code is not right. Check the SMS and try again.' };
  await markOtpVerified(env.DB, orderId);
  return { ok: true, message: 'Thank you! Your phone number is verified.' };
}

// ───────────── Pipeline transitions ─────────────

export interface TransitionOptions {
  actor: Actor;
  adminId: string | null;
  note?: string | null;
  courier?: string | null;
  trackingId?: string | null;
  cancelReason?: string | null;
  returnReason?: string | null;
  /** Partial delivery: order_item id → quantity coming back. */
  returned?: Record<string, number>;
}

const stockItems = (items: Row[]) => items.filter(i => i.fulfilment_mode !== 'made_to_order').map(i => ({ variantId: Number(i.variant_id), qty: Number(i.qty) }));

/**
 * Moves an order to the next stage. Invalid transitions are rejected and logged; valid ones are applied in one batch
 * with their stock movements (reserve on confirm, take on courier handover, release on cancel).
 */
export async function changeStatus(env: Env, orderId: number, to: OrderStatus, opts: TransitionOptions): Promise<{ invoiceNo?: string }> {
  const db = env.DB;
  const o = await orderById(db, orderId);
  if (!o) throw new HttpError(404, 'Order not found.');
  const from = o.status as OrderStatus;
  if (!canTransition(from, to)) {
    const reason = `An order that is ${STATUS_LABELS[from]} cannot be moved to ${STATUS_LABELS[to] ?? to}.`;
    await logRejectedTransition(db, orderId, from, to, opts.actor, opts.adminId, reason);
    throw new HttpError(409, reason);
  }
  const items = await orderItems(db, orderId);
  const t: TransitionWrite = { orderId, from, to, actor: opts.actor, adminId: opts.adminId, note: opts.note ?? null, fields: { sub_status: null } };
  const result: { invoiceNo?: string } = {};

  if (to === 'confirmed') {
    const blockers = confirmBlockers({
      paymentMethod: String(o.payment_method), otpVerifiedAt: (o.otp_verified_at as string) ?? null, hasConfirmedCall: await hasConfirmedCall(db, orderId),
      advanceRequired: Boolean(o.advance_required), advanceStatus: String(o.advance_status), deliveryChargeStatus: o.delivery_charge_status as 'final' | 'to_confirm',
      holdReason: (o.hold_reason as string) ?? null,
    });
    if (blockers.length) throw new HttpError(409, blockers[0], { blockers });
    const invoiceNo = (o.invoice_no as string) ?? (await nextInvoiceNo(db));
    result.invoiceNo = invoiceNo;
    t.fields = { ...t.fields, invoice_no: invoiceNo, confirmation_method: o.otp_verified_at ? 'otp' : o.payment_method === 'cod' ? 'call' : 'prepaid', confirmed_at: NOW_VALUE };
    t.invoice = { invoiceNo, totalPaisa: Number(o.total_paisa) };
    t.stock = { op: 'reserve', items: stockItems(items) };
  } else if (to === 'packed') {
    t.fields.packed_at = NOW_VALUE;
  } else if (to === 'in_courier') {
    const courier = opts.courier ?? (o.courier as string | null);
    const tracking = opts.trackingId ?? (o.tracking_id as string | null);
    if (!courier) throw bad('Choose the courier (or "Own delivery") before handing the parcel over.');
    if (courier !== 'own_delivery' && !tracking) throw bad('Add the courier tracking ID before handing the parcel over.');
    t.fields = { ...t.fields, courier, tracking_id: tracking, in_courier_at: NOW_VALUE, sub_status: 'picked_up' };
    t.stock = { op: 'ship', items: stockItems(items) };
  } else if (to === 'delivered') {
    t.fields = { ...t.fields, delivered_at: NOW_VALUE, payment_status: 'paid' };
    if (o.customer_id) t.customer = { id: Number(o.customer_id), delivered: true };
  } else if (to === 'partial_delivered') {
    const err = validatePartialReturn(items.map(i => ({ id: Number(i.id), qty: Number(i.qty) })), opts.returned ?? {});
    if (err) throw bad(err);
    t.returnedQty = items.map(i => ({ itemId: Number(i.id), qty: Number(opts.returned?.[String(i.id)] ?? 0) }));
    t.fields = { ...t.fields, delivered_at: NOW_VALUE, payment_status: 'paid', sub_status: 'in_transit_back', return_reason: opts.returnReason && opts.returnReason in RETURN_REASONS ? opts.returnReason : 'refused' };
    if (o.customer_id) t.customer = { id: Number(o.customer_id), delivered: true };
  } else if (to === 'returned') {
    if (!opts.returnReason || !(opts.returnReason in RETURN_REASONS)) throw bad('Choose why the parcel came back (refused, unreachable, wrong address, damaged or other).');
    t.fields = { ...t.fields, return_reason: opts.returnReason, returned_at: NOW_VALUE, sub_status: 'in_transit_back' };
    t.returnedQty = items.map(i => ({ itemId: Number(i.id), qty: Number(i.qty) }));
    if (o.customer_id) t.customer = { id: Number(o.customer_id), returned: true };
  } else if (to === 'cancelled') {
    t.fields.cancel_reason = opts.cancelReason ?? opts.note ?? null;
    if (RESERVED_STAGES.includes(from)) t.stock = { op: 'release', items: stockItems(items) };
  }

  let applied: boolean;
  try {
    applied = await commitTransition(db, t);
  } catch (e) {
    if (to === 'confirmed' && /CHECK constraint failed/i.test(String(e))) {
      const avail = await variantAvailability(db, items.map(i => Number(i.variant_id)));
      const short = items.find(i => i.fulfilment_mode !== 'made_to_order' && (avail.get(Number(i.variant_id)) ?? 0) < Number(i.qty));
      throw new HttpError(409, short ? `Not enough stock to confirm: ${String(short.name)}${short.variant_label ? ` (${String(short.variant_label)})` : ''} has ${avail.get(Number(short.variant_id)) ?? 0} available.` : 'Not enough stock to confirm this order.');
    }
    throw e;
  }
  if (!applied) throw new HttpError(409, 'Someone else just updated this order. Reload it and try again.');

  const phone = String(o.phone);
  if (to === 'confirmed' && result.invoiceNo) await sendSms(env, { to: phone, body: SMS.confirmed(String(o.order_no), result.invoiceNo), kind: 'confirmed', orderId });
  if (to === 'in_courier') {
    const courier = String(t.fields.courier);
    await sendSms(env, { to: phone, body: courier === 'own_delivery' ? SMS.ownDelivery(String(o.order_no)) : SMS.shipped(String(o.order_no), courierLabel(courier), String(t.fields.tracking_id)), kind: 'shipped', orderId });
  }
  if (to === 'delivered') await sendSms(env, { to: phone, body: SMS.delivered(String(o.order_no)), kind: 'delivered', orderId });
  // Emails (invoice, on the way, delivered, and the owner's cancelled/returned alerts) are queued here and sent after the response.
  if (['confirmed', 'in_courier', 'delivered', 'partial_delivered', 'cancelled', 'returned'].includes(to)) {
    await orderEmails(env, orderId, to as OrderEmailEvent, opts.cancelReason ?? opts.returnReason ?? null);
  }
  return result;
}

export { COURIERS, courierLabel };

/** Warehouse scan of a returned parcel: the only way stock comes back (Section 9.1, stage 8). */
export async function receiveReturnScan(env: Env, code: string, adminId: string): Promise<{ orderId: number; orderNo: string; restocked: Array<{ sku: string; qty: number }> }> {
  const clean = code.trim().toUpperCase();
  if (!clean) throw bad('Scan the invoice or tracking barcode, or type the order number.');
  const o = await orderByCode(env.DB, clean) ?? (clean !== code.trim() ? await orderByCode(env.DB, code.trim()) : null);
  if (!o) throw new HttpError(404, `No order matches ${code.trim()}.`);
  const status = o.status as OrderStatus;
  if (status !== 'returned' && status !== 'partial_delivered') throw new HttpError(409, `Order ${String(o.order_no)} is ${STATUS_LABELS[status]}: there is nothing to receive. Mark it Returned first if the parcel came back.`);
  if (o.return_received_at) throw new HttpError(409, `Order ${String(o.order_no)} was already received on ${String(o.return_received_at).slice(0, 10)}.`);
  const items = await orderItems(env.DB, Number(o.id));
  const back = items.filter(i => i.fulfilment_mode !== 'made_to_order' && Number(i.returned_qty) > 0).map(i => ({ variantId: Number(i.variant_id), qty: Number(i.returned_qty), sku: String(i.sku) }));
  const note = back.length ? `Received at warehouse: ${back.map(b => `${b.sku} × ${b.qty}`).join(', ')}` : 'Received at warehouse (made-to-order items, no stock change)';
  const ok = await receiveReturn(env.DB, Number(o.id), back, adminId, note);
  if (!ok) throw new HttpError(409, `Order ${String(o.order_no)} was just received by someone else.`);
  return { orderId: Number(o.id), orderNo: String(o.order_no), restocked: back.map(b => ({ sku: b.sku, qty: b.qty })) };
}
