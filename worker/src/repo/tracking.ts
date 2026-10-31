/** The customer's tracking timeline (order_tracking, migration 0006) and the order lookups behind /track. */
import type { TrackLine } from '../lib/tracking';

const COLS = 'order_id, step, title, title_bn, detail, courier, tracking_code, source';
const vals = (l: TrackLine) => [l.step, l.title, l.titleBn, l.detail, l.courier ?? null, l.trackingCode ?? null, l.source];

/** One tracking line, for a batch. `onlyIf` is an SQL condition (the transition guard) the line is written under. */
export function trackStmt(db: D1Database, orderId: number, line: TrackLine, onlyIf?: string): D1PreparedStatement {
  return db.prepare(`INSERT INTO order_tracking (${COLS}) SELECT ?, ?, ?, ?, ?, ?, ?, ?${onlyIf ? ` WHERE ${onlyIf}` : ''}`).bind(orderId, ...vals(line));
}

/** The first line of a new order, whose id is not known yet inside the placing batch. */
export function trackNewOrderStmt(db: D1Database, orderNo: string, line: TrackLine): D1PreparedStatement {
  return db.prepare(`INSERT INTO order_tracking (${COLS}) SELECT id, ?, ?, ?, ?, ?, ?, ? FROM orders WHERE order_no = ?`).bind(...vals(line), orderNo);
}

/** A message the shop writes for the customer: on their tracking page and in the staff history. */
export async function addTrackNote(db: D1Database, orderId: number, line: TrackLine, adminId: string): Promise<void> {
  await db.batch([
    trackStmt(db, orderId, line),
    db.prepare("INSERT INTO order_events (order_id, kind, note, actor_type, admin_id) VALUES (?, 'note', ?, 'staff', ?)").bind(orderId, `Message for the customer: ${line.detail}`, adminId),
  ]);
}

export interface TrackRow { order_id: number; step: string; title: string; title_bn: string | null; detail: string | null; courier: string | null; tracking_code: string | null; source: string; created_at: string }

export async function trackLines(db: D1Database, orderIds: number[]): Promise<TrackRow[]> {
  if (!orderIds.length) return [];
  return (await db.prepare(`SELECT order_id, step, title, title_bn, detail, courier, tracking_code, source, created_at FROM order_tracking
    WHERE order_id IN (${orderIds.map(() => '?').join(',')}) ORDER BY order_id, id`).bind(...orderIds).all<TrackRow>()).results;
}

export type TrackOrder = Record<string, unknown> & { id: number };
const ORDER_COLS = `o.id, o.order_no, o.status, o.sub_status, o.created_at, o.customer_name, o.phone, o.payment_method, o.payment_status,
  o.advance_required, o.advance_status, o.advance_amount_paisa, o.subtotal_paisa, o.delivery_charge_paisa, o.cod_fee_paisa, o.discount_paisa,
  o.total_paisa, o.eta_text, o.courier, o.tracking_id, o.upazila_name, o.district_name, o.division_name, o.fulfilment_type, o.invoice_no`;

/** The latest orders on a mobile number (newest first). */
export async function trackOrdersByPhone(db: D1Database, phone: string, limit = 10): Promise<TrackOrder[]> {
  return (await db.prepare(`SELECT ${ORDER_COLS} FROM orders o WHERE o.phone = ? ORDER BY o.created_at DESC LIMIT ?`).bind(phone, limit).all<TrackOrder>()).results;
}

/** One order by any code the customer may have: order number, invoice number, courier tracking code or consignment id. */
export async function trackOrderByCode(db: D1Database, codes: string[]): Promise<TrackOrder | null> {
  for (const code of codes) {
    const o = await db.prepare(
      `SELECT ${ORDER_COLS} FROM orders o WHERE o.order_no = ?1
       UNION ALL SELECT ${ORDER_COLS} FROM orders o WHERE o.invoice_no = ?1
       UNION ALL SELECT ${ORDER_COLS} FROM orders o WHERE o.tracking_id = ?1
       UNION ALL SELECT ${ORDER_COLS} FROM orders o WHERE o.consignment_id = ?1 LIMIT 1`,
    ).bind(code).first<TrackOrder>();
    if (o) return o;
  }
  return null;
}

export async function trackItems(db: D1Database, orderIds: number[]): Promise<Array<{ order_id: number; name: string; variant_label: string | null; qty: number; unit_price_paisa: number; line_total_paisa: number; returned_qty: number | null }>> {
  if (!orderIds.length) return [];
  return (await db.prepare(`SELECT order_id, name, variant_label, qty, unit_price_paisa, line_total_paisa, returned_qty FROM order_items
    WHERE order_id IN (${orderIds.map(() => '?').join(',')}) ORDER BY order_id, id`).bind(...orderIds)
    .all<{ order_id: number; name: string; variant_label: string | null; qty: number; unit_price_paisa: number; line_total_paisa: number; returned_qty: number | null }>()).results;
}
