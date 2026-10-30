/** Order placement, OTP and status changes. Shared by the checkout page and landing-page order forms. */
import type { Env } from '../env';
import { settingInt } from '../data/settings';
import { randomToken, sha256Hex } from '../lib/auth';
import { validateAddress } from '../lib/geo';
import { bad, HttpError } from '../lib/http';
import { formatTaka } from '../lib/money';
import { nextInvoiceNo, nextOrderNo } from '../lib/numbering';
import { canTransition, confirmBlockers, type OrderStatus } from '../lib/order-status';
import { normalizeBdPhone } from '../lib/phone';
import { assessRisk } from '../lib/risk';
import { sendSms, SMS } from '../lib/sms';
import type { CartLineIn } from './cart';
import { quote } from './checkout';

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
  utm: Record<string, string>;
  abandonedToken: string | null;
}

export interface PlacedOrder {
  orderId: number;
  orderNo: string;
  accessToken: string;
  totalPaisa: number | null;
  advance: { required: boolean; amountPaisa: number | null };
  riskLevel: string;
  otpSent: boolean;
}

const DUPLICATE_WINDOW_MINUTES = 10;

export function cartSignature(lines: CartLineIn[]): string {
  return [...lines].sort((a, b) => a.variantId - b.variantId).map(l => `${l.variantId}x${l.qty}`).join(',');
}

export async function placeOrder(env: Env, settings: Record<string, string>, input: PlaceOrderInput, now = new Date()): Promise<PlacedOrder> {
  const db = env.DB;
  const phone = normalizeBdPhone(input.phone);
  if (!phone) throw bad('Enter a Bangladeshi mobile number like 01712345678.');
  const name = input.name.trim();
  if (name.length < 2) throw bad('Enter your name.');
  if (input.addressLine.trim().length < 5) throw bad('Enter your house, road or village so the courier can find you.');
  if (!input.lines.length) throw bad('Your cart is empty.');

  const addr = await validateAddress(db, {
    divisionId: input.divisionId, districtId: input.districtId, upazilaId: input.upazilaId, unionId: input.unionId, postcode: input.postcode,
  });
  if (!addr.ok) throw bad(addr.error);

  const customer = await db.prepare('SELECT * FROM customers WHERE phone = ?').bind(phone).first<Record<string, number>>();
  const isNewOrRisky = !customer || customer.delivered_count === 0 || customer.returned_count > 0;
  const q = await quote(db, settings, { lines: input.lines, districtId: input.districtId, upazilaId: input.upazilaId, paymentMethod: input.paymentMethod, customerIsNewOrRisky: isNewOrRisky }, now);
  if (q.problems.length) throw new HttpError(409, q.problems[0], { problems: q.problems });
  if (!q.delivery) throw bad('We could not work out delivery to this area. Please call us.');
  if (q.advance.required && q.advance.amountPaisa && input.paymentMethod !== 'manual_mobile') {
    throw bad(`This order needs an advance of ${formatTaka(q.advance.amountPaisa)}. Choose bKash / Nagad / Rocket and enter the transaction ID.`);
  }
  if (input.paymentMethod === 'manual_mobile' && q.advance.required && q.advance.amountPaisa && !input.advanceTrxId) {
    throw bad('Enter the transaction ID from your bKash / Nagad / Rocket payment.');
  }

  const signature = cartSignature(input.lines);
  const since = new Date(now.getTime() - DUPLICATE_WINDOW_MINUTES * 60_000).toISOString();
  const day = new Date(now.getTime() - 86_400_000).toISOString();
  const [recent, dup] = await db.batch([
    db.prepare('SELECT COUNT(*) AS n FROM orders WHERE phone = ? AND created_at >= ?').bind(phone, day),
    db.prepare(`SELECT o.id FROM orders o WHERE o.phone = ? AND o.created_at >= ? AND o.status NOT IN ('cancelled')
                 AND (SELECT group_concat(x, ',') FROM (SELECT variant_id || 'x' || qty AS x FROM order_items WHERE order_id = o.id ORDER BY variant_id)) = ?
                 ORDER BY o.id DESC LIMIT 1`).bind(phone, since, signature),
  ]);
  const duplicateOf = (dup.results[0] as { id: number } | undefined)?.id ?? null;

  const risk = assessRisk({
    postcodeMismatch: addr.postcodeMismatch,
    addressLine: input.addressLine,
    totalPaisa: q.totalPaisa ?? q.subtotalPaisa,
    highValueThresholdPaisa: settingInt(settings, 'advance_high_value_threshold_paisa'),
    customer: customer ? { orderCount: customer.order_count, deliveredCount: customer.delivered_count, returnedCount: customer.returned_count, isTrusted: Boolean(customer.is_trusted) } : null,
    recentOrdersSamePhone24h: Number((recent.results[0] as { n: number }).n),
    duplicateOfOrderId: duplicateOf,
  });

  const orderNo = await nextOrderNo(db, q.hasPreOrder, now);
  const accessToken = randomToken(16);
  const fulfilment = q.hasPreOrder ? 'pre_order' : q.lines.some(l => l.fulfilmentMode === 'made_to_order') ? 'made_to_order' : 'standard';
  const advanceStatus = !q.advance.required ? 'not_required' : input.advanceTrxId ? 'submitted' : 'pending';

  if (!customer) await db.prepare('INSERT INTO customers (phone, name) VALUES (?, ?) ON CONFLICT(phone) DO NOTHING').bind(phone, name).run();

  const insertOrder = db.prepare(
    `INSERT INTO orders (order_no, access_token, customer_id, status, fulfilment_type, payment_method, payment_status,
       advance_required, advance_reason, advance_amount_paisa, advance_status, advance_trx_id, advance_wallet,
       subtotal_paisa, delivery_charge_paisa, delivery_charge_status, cod_fee_paisa, total_paisa, delivery_zone_id, eta_text,
       customer_name, phone, division_id, district_id, upazila_id, union_id, postcode, post_office,
       division_name, district_name, upazila_name, union_name, address_line, landmark, customer_note,
       risk_level, risk_reasons, duplicate_of_order_id, source, utm)
     VALUES (?, ?, (SELECT id FROM customers WHERE phone = ?), 'pending', ?, ?, 'unpaid', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    orderNo, accessToken, phone, fulfilment, input.paymentMethod,
    q.advance.required ? 1 : 0, q.advance.reasons.join(' ') || null, q.advance.amountPaisa, advanceStatus, input.advanceTrxId, input.advanceWallet,
    q.subtotalPaisa, q.delivery.chargePaisa, q.delivery.status, q.delivery.codFeePaisa, q.totalPaisa ?? q.subtotalPaisa, q.delivery.zoneId, q.delivery.etaText,
    name, phone, input.divisionId, input.districtId, input.upazilaId, input.unionId, input.postcode, addr.postOffice,
    addr.names.division, addr.names.district, addr.names.upazila, addr.names.union, input.addressLine.trim(), input.landmark, input.note,
    risk.level, JSON.stringify(risk.reasons), duplicateOf, input.source, JSON.stringify(input.utm),
  );

  const orderIdSql = '(SELECT id FROM orders WHERE order_no = ?)';
  const stmts: D1PreparedStatement[] = [insertOrder];
  for (const l of q.lines) {
    stmts.push(db.prepare(
      `INSERT INTO order_items (order_id, product_id, variant_id, sku, name, variant_label, unit_price_paisa, qty, line_total_paisa, packed_weight_grams, fulfilment_mode)
       VALUES (${orderIdSql}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(orderNo, l.productId, l.variantId, l.sku, l.name, l.variantLabel || null, l.unitPaisa, l.qty, l.lineTotalPaisa, l.packedWeightGrams, l.fulfilmentMode));
    if (l.fulfilmentMode !== 'made_to_order') {
      // CHECK (stock >= 0) makes this fail, and the whole batch roll back, if two people buy the last unit at once.
      stmts.push(db.prepare('UPDATE product_variants SET stock = stock - ? WHERE id = ?').bind(l.qty, l.variantId));
      stmts.push(db.prepare(`INSERT INTO inventory_log (variant_id, change, reason, order_id) VALUES (?, ?, 'sale', ${orderIdSql})`).bind(l.variantId, -l.qty, orderNo));
    }
    stmts.push(db.prepare('UPDATE products SET sold_count = sold_count + ? WHERE id = ?').bind(l.qty, l.productId));
  }
  stmts.push(db.prepare(`INSERT INTO order_events (order_id, kind, to_status, note) VALUES (${orderIdSql}, 'status', 'pending', ?)`).bind(orderNo, `Placed on ${input.source}`));
  for (const r of risk.reasons) stmts.push(db.prepare(`INSERT INTO risk_flags (order_id, customer_id, code, detail) VALUES (${orderIdSql}, (SELECT id FROM customers WHERE phone = ?), ?, ?)`).bind(orderNo, phone, r.code, r.detail));
  if (input.advanceTrxId && q.advance.amountPaisa) {
    stmts.push(db.prepare(`INSERT INTO payments (order_id, kind, method, amount_paisa, trx_id, status) VALUES (${orderIdSql}, 'advance', ?, ?, ?, 'submitted')`).bind(orderNo, input.advanceWallet ?? 'mobile', q.advance.amountPaisa, input.advanceTrxId));
  }
  stmts.push(db.prepare("UPDATE customers SET order_count = order_count + 1, name = COALESCE(name, ?), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE phone = ?").bind(name, phone));
  if (input.abandonedToken) {
    stmts.push(db.prepare(`UPDATE abandoned_checkouts SET status = 'converted', order_id = ${orderIdSql}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE token = ?`).bind(orderNo, input.abandonedToken));
  }

  try {
    await db.batch(stmts);
  } catch (e) {
    if (/CHECK constraint failed/i.test(String(e))) throw new HttpError(409, 'Sorry, one of the items just sold out. Please check your cart.');
    throw e;
  }
  const order = await db.prepare('SELECT id FROM orders WHERE order_no = ?').bind(orderNo).first<{ id: number }>();
  const orderId = order!.id;

  await sendSms(env, { to: phone, body: SMS.orderReceived(orderNo, q.totalPaisa === null ? 'charge to confirm' : formatTaka(q.totalPaisa)), kind: 'order_received', orderId });
  let otpSent = false;
  if (input.paymentMethod === 'cod') otpSent = await issueOtp(env, orderId, orderNo, phone);

  return { orderId, orderNo, accessToken, totalPaisa: q.totalPaisa, advance: { required: q.advance.required, amountPaisa: q.advance.amountPaisa }, riskLevel: risk.level, otpSent };
}

// ───────────── OTP ─────────────

const OTP_TTL_MINUTES = 15;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_SENDS = 3;

async function otpHash(env: Env, orderId: number, code: string): Promise<string> {
  return sha256Hex(`${env.OTP_PEPPER ?? 'absvai-dev-pepper'}:${orderId}:${code}`);
}

export function generateOtp(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, '0');
}

export async function issueOtp(env: Env, orderId: number, orderNo: string, phone: string): Promise<boolean> {
  const existing = await env.DB.prepare('SELECT sends FROM order_otps WHERE order_id = ?').bind(orderId).first<{ sends: number }>();
  if (existing && existing.sends >= OTP_MAX_SENDS) return false;
  const code = generateOtp();
  const expires = new Date(Date.now() + OTP_TTL_MINUTES * 60_000).toISOString();
  await env.DB.prepare(
    `INSERT INTO order_otps (order_id, code_hash, expires_at, attempts, sends) VALUES (?, ?, ?, 0, 1)
     ON CONFLICT(order_id) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, sends = sends + 1`,
  ).bind(orderId, await otpHash(env, orderId, code), expires).run();
  await sendSms(env, { to: phone, body: SMS.otp(code, orderNo), kind: 'otp', orderId });
  return true;
}

export async function verifyOtp(env: Env, orderId: number, code: string): Promise<{ ok: boolean; message: string }> {
  const row = await env.DB.prepare('SELECT * FROM order_otps WHERE order_id = ?').bind(orderId).first<{ code_hash: string; expires_at: string; attempts: number }>();
  if (!row) return { ok: false, message: 'Ask for a new code.' };
  if (row.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, message: 'Too many tries. We will call you to confirm instead.' };
  if (row.expires_at < new Date().toISOString()) return { ok: false, message: 'That code has expired. Ask for a new one.' };
  await env.DB.prepare('UPDATE order_otps SET attempts = attempts + 1 WHERE order_id = ?').bind(orderId).run();
  if (row.code_hash !== (await otpHash(env, orderId, code.trim()))) return { ok: false, message: 'That code is not right. Check the SMS and try again.' };
  await env.DB.batch([
    env.DB.prepare("UPDATE orders SET otp_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").bind(orderId),
    env.DB.prepare("INSERT INTO order_events (order_id, kind, note) VALUES (?, 'otp', 'Customer verified the SMS code')").bind(orderId),
    env.DB.prepare('DELETE FROM order_otps WHERE order_id = ?').bind(orderId),
  ]);
  return { ok: true, message: 'Thank you! Your phone number is verified.' };
}

// ───────────── Status changes ─────────────

export async function changeStatus(env: Env, orderId: number, to: OrderStatus, opts: { adminId: string; note?: string | null; courier?: string | null; trackingId?: string | null; cancelReason?: string | null }): Promise<{ invoiceNo?: string }> {
  const db = env.DB;
  const o = await db.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first<Record<string, unknown>>();
  if (!o) throw new HttpError(404, 'Order not found.');
  const from = o.status as OrderStatus;
  if (!canTransition(from, to)) throw bad(`An order that is "${from.replace(/_/g, ' ')}" cannot be moved to "${to.replace(/_/g, ' ')}".`);

  const stmts: D1PreparedStatement[] = [];
  const result: { invoiceNo?: string } = {};
  const now = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

  if (to === 'confirmed') {
    const call = await db.prepare("SELECT 1 FROM order_events WHERE order_id = ? AND kind = 'call' AND outcome = 'confirmed' LIMIT 1").bind(orderId).first();
    const blockers = confirmBlockers({
      paymentMethod: String(o.payment_method), otpVerifiedAt: (o.otp_verified_at as string) ?? null, hasConfirmedCall: Boolean(call),
      advanceRequired: Boolean(o.advance_required), advanceStatus: String(o.advance_status), deliveryChargeStatus: o.delivery_charge_status as 'final' | 'to_confirm',
    });
    if (blockers.length) throw new HttpError(409, blockers[0], { blockers });
    const invoiceNo = (o.invoice_no as string) ?? (await nextInvoiceNo(db));
    result.invoiceNo = invoiceNo;
    const method = o.otp_verified_at ? 'otp' : o.payment_method === 'cod' ? 'call' : 'prepaid';
    stmts.push(db.prepare(`UPDATE orders SET status = 'confirmed', invoice_no = ?, confirmation_method = ?, confirmed_at = ${now}, updated_at = ${now} WHERE id = ?`).bind(invoiceNo, method, orderId));
    stmts.push(db.prepare('INSERT INTO invoices (order_id, invoice_no, total_paisa) VALUES (?, ?, ?) ON CONFLICT(order_id) DO NOTHING').bind(orderId, invoiceNo, o.total_paisa));
  } else if (to === 'shipped') {
    if (!opts.courier || !opts.trackingId) throw bad('Add the courier and tracking ID (or "Own delivery" and a note) before marking it shipped.');
    stmts.push(db.prepare(`UPDATE orders SET status = 'shipped', courier = ?, tracking_id = ?, shipped_at = ${now}, updated_at = ${now} WHERE id = ?`).bind(opts.courier, opts.trackingId, orderId));
  } else if (to === 'delivered') {
    stmts.push(db.prepare(`UPDATE orders SET status = 'delivered', payment_status = 'paid', delivered_at = ${now}, updated_at = ${now} WHERE id = ?`).bind(orderId));
    stmts.push(db.prepare('UPDATE customers SET delivered_count = delivered_count + 1 WHERE id = ?').bind(o.customer_id));
  } else if (to === 'cancelled' || to === 'returned' || to === 'refused_at_delivery') {
    stmts.push(db.prepare(`UPDATE orders SET status = ?, cancel_reason = COALESCE(?, cancel_reason), updated_at = ${now} WHERE id = ?`).bind(to, opts.cancelReason ?? null, orderId));
    // Put stock back (made-to-order items never took stock).
    if (to === 'cancelled' || to === 'returned') {
      const items = await db.prepare("SELECT variant_id, qty FROM order_items WHERE order_id = ? AND fulfilment_mode != 'made_to_order'").bind(orderId).all<{ variant_id: number; qty: number }>();
      const reason = to === 'cancelled' ? 'cancel' : 'return';
      for (const it of items.results) {
        stmts.push(db.prepare('UPDATE product_variants SET stock = stock + ? WHERE id = ?').bind(it.qty, it.variant_id));
        stmts.push(db.prepare('INSERT INTO inventory_log (variant_id, change, reason, order_id, admin_id) VALUES (?, ?, ?, ?, ?)').bind(it.variant_id, it.qty, reason, orderId, opts.adminId));
      }
    }
    if ((to === 'returned' || to === 'refused_at_delivery') && from !== 'refused_at_delivery') stmts.push(db.prepare('UPDATE customers SET returned_count = returned_count + 1 WHERE id = ?').bind(o.customer_id));
  } else {
    stmts.push(db.prepare(`UPDATE orders SET status = ?, updated_at = ${now} WHERE id = ?`).bind(to, orderId));
  }
  stmts.push(db.prepare("INSERT INTO order_events (order_id, kind, from_status, to_status, note, admin_id) VALUES (?, 'status', ?, ?, ?, ?)").bind(orderId, from, to, opts.note ?? opts.cancelReason ?? null, opts.adminId));
  await db.batch(stmts);

  const phone = String(o.phone);
  if (to === 'confirmed' && result.invoiceNo) await sendSms(env, { to: phone, body: SMS.confirmed(String(o.order_no), result.invoiceNo), kind: 'confirmed', orderId });
  if (to === 'shipped') await sendSms(env, { to: phone, body: SMS.shipped(String(o.order_no), opts.courier!, opts.trackingId!), kind: 'shipped', orderId });
  if (to === 'delivered') await sendSms(env, { to: phone, body: SMS.delivered(String(o.order_no)), kind: 'delivered', orderId });
  return result;
}
