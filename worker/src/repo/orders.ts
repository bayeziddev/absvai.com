/** Orders, items, status history, OTP codes, payments and the stock movements that go with each pipeline stage. */
import type { OrderStatus, Actor } from '../lib/state-machine';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
export type Row = Record<string, unknown>;

// ───────────── Customers ─────────────

export interface CustomerRow { id: number; phone: string; name: string | null; is_trusted: number; order_count: number; delivered_count: number; returned_count: number; last_order_at: string | null }

export async function customerByPhone(db: D1Database, phone: string): Promise<CustomerRow | null> {
  return db.prepare('SELECT * FROM customers WHERE phone = ?').bind(phone).first<CustomerRow>();
}

export async function ensureCustomer(db: D1Database, phone: string, name: string): Promise<void> {
  await db.prepare('INSERT INTO customers (phone, name) VALUES (?, ?) ON CONFLICT(phone) DO NOTHING').bind(phone, name).run();
}

// ───────────── Placement ─────────────

export interface RecentActivity {
  ordersLast24h: number;
  /** Most recent open order from the same phone or device inside the interval window. */
  intervalHit: { id: number; orderNo: string; createdAt: string; by: 'phone' | 'device' } | null;
  /** Same phone and exactly the same items a few minutes ago (a double tap). */
  duplicateOf: number | null;
}

export async function recentActivity(db: D1Database, a: { phone: string; deviceHash: string | null; dayAgoIso: string; intervalStartIso: string; duplicateSinceIso: string; cartSignature: string }): Promise<RecentActivity> {
  const open = "('new','confirmed','packed','in_courier')";
  const [count, byPhone, byDevice, dup] = await db.batch([
    db.prepare('SELECT COUNT(*) AS n FROM orders WHERE phone = ? AND created_at >= ?').bind(a.phone, a.dayAgoIso),
    db.prepare(`SELECT id, order_no, created_at FROM orders WHERE phone = ? AND created_at >= ? AND status IN ${open} ORDER BY created_at DESC LIMIT 1`).bind(a.phone, a.intervalStartIso),
    db.prepare(`SELECT id, order_no, created_at FROM orders WHERE device_hash = ? AND created_at >= ? AND status IN ${open} ORDER BY created_at DESC LIMIT 1`).bind(a.deviceHash ?? '-', a.intervalStartIso),
    db.prepare(`SELECT o.id FROM orders o WHERE o.phone = ? AND o.created_at >= ? AND o.status != 'cancelled'
                 AND (SELECT group_concat(x, ',') FROM (SELECT variant_id || 'x' || qty AS x FROM order_items WHERE order_id = o.id ORDER BY variant_id)) = ?
                 ORDER BY o.id DESC LIMIT 1`).bind(a.phone, a.duplicateSinceIso, a.cartSignature),
  ]);
  const p = byPhone.results[0] as { id: number; order_no: string; created_at: string } | undefined;
  const d = byDevice.results[0] as { id: number; order_no: string; created_at: string } | undefined;
  const hit = p ? { id: p.id, orderNo: p.order_no, createdAt: p.created_at, by: 'phone' as const } : d ? { id: d.id, orderNo: d.order_no, createdAt: d.created_at, by: 'device' as const } : null;
  return { ordersLast24h: Number((count.results[0] as { n: number }).n), intervalHit: hit, duplicateOf: (dup.results[0] as { id: number } | undefined)?.id ?? null };
}

export interface NewOrder {
  orderNo: string; accessToken: string; fulfilmentType: string; paymentMethod: string;
  advanceRequired: boolean; advanceReason: string | null; advanceAmountPaisa: number | null; advanceStatus: string; advanceTrxId: string | null; advanceWallet: string | null;
  subtotalPaisa: number; deliveryChargePaisa: number | null; deliveryChargeStatus: string; codFeePaisa: number; discountPaisa: number; totalPaisa: number; zoneId: number | null; etaText: string | null;
  name: string; phone: string; divisionId: number; districtId: number; upazilaId: number; unionId: number | null; postcode: string | null; postOffice: string | null;
  names: { division: string; district: string; upazila: string; union: string | null }; addressLine: string; landmark: string | null; note: string | null;
  riskLevel: string; riskReasons: Array<{ code: string; detail: string }>; duplicateOf: number | null; holdReason: string | null;
  source: string; sourceDetail: string | null; utm: Record<string, string>; checkoutSessionId: string | null; deviceHash: string | null; ipHash: string | null;
  createdBy: string | null; assignedTo: string | null; courier: string | null;
  items: Array<{ productId: number; variantId: number; sku: string; name: string; variantLabel: string; unitPaisa: number; qty: number; lineTotalPaisa: number; packedWeightGrams: number; fulfilmentMode: string }>;
  /** Links incomplete checkouts from the same session, or the same phone within the window, as converted. */
  conversion: { sessionId: string | null; phone: string; sinceIso: string; incompleteId: number | null };
  placedNote: string;
  actor: Actor;
}

/** One atomic batch: the order, its items, history, risk flags, advance payment, customer counters and incomplete-order conversion. */
export async function insertOrder(db: D1Database, o: NewOrder): Promise<number> {
  const idSql = '(SELECT id FROM orders WHERE order_no = ?)';
  const stmts: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO orders (order_no, access_token, customer_id, status, fulfilment_type, payment_method, payment_status,
         advance_required, advance_reason, advance_amount_paisa, advance_status, advance_trx_id, advance_wallet,
         subtotal_paisa, delivery_charge_paisa, delivery_charge_status, cod_fee_paisa, discount_paisa, total_paisa, delivery_zone_id, eta_text,
         customer_name, phone, division_id, district_id, upazila_id, union_id, postcode, post_office,
         division_name, district_name, upazila_name, union_name, address_line, landmark, customer_note,
         risk_level, risk_reasons, duplicate_of_order_id, hold_reason, source, source_detail, utm, checkout_session_id, device_hash, ip_hash, created_by, assigned_to, courier)
       VALUES (?, ?, (SELECT id FROM customers WHERE phone = ?), 'new', ?, ?, 'unpaid', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      o.orderNo, o.accessToken, o.phone, o.fulfilmentType, o.paymentMethod,
      o.advanceRequired ? 1 : 0, o.advanceReason, o.advanceAmountPaisa, o.advanceStatus, o.advanceTrxId, o.advanceWallet,
      o.subtotalPaisa, o.deliveryChargePaisa, o.deliveryChargeStatus, o.codFeePaisa, o.discountPaisa, o.totalPaisa, o.zoneId, o.etaText,
      o.name, o.phone, o.divisionId, o.districtId, o.upazilaId, o.unionId, o.postcode, o.postOffice,
      o.names.division, o.names.district, o.names.upazila, o.names.union, o.addressLine, o.landmark, o.note,
      o.riskLevel, JSON.stringify(o.riskReasons), o.duplicateOf, o.holdReason, o.source, o.sourceDetail, JSON.stringify(o.utm), o.checkoutSessionId, o.deviceHash, o.ipHash,
      o.createdBy, o.assignedTo, o.courier,
    ),
  ];
  for (const l of o.items) {
    stmts.push(db.prepare(
      `INSERT INTO order_items (order_id, product_id, variant_id, sku, name, variant_label, unit_price_paisa, qty, line_total_paisa, packed_weight_grams, fulfilment_mode)
       VALUES (${idSql}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(o.orderNo, l.productId, l.variantId, l.sku, l.name, l.variantLabel || null, l.unitPaisa, l.qty, l.lineTotalPaisa, l.packedWeightGrams, l.fulfilmentMode));
    stmts.push(db.prepare('UPDATE products SET sold_count = sold_count + ? WHERE id = ?').bind(l.qty, l.productId));
  }
  stmts.push(db.prepare(`INSERT INTO order_events (order_id, kind, to_status, note, actor_type, admin_id) VALUES (${idSql}, 'status', 'new', ?, ?, ?)`).bind(o.orderNo, o.placedNote, o.actor, o.createdBy));
  if (o.holdReason) stmts.push(db.prepare(`INSERT INTO order_events (order_id, kind, note, actor_type) VALUES (${idSql}, 'hold', ?, 'system')`).bind(o.orderNo, o.holdReason));
  for (const r of o.riskReasons) stmts.push(db.prepare(`INSERT INTO risk_flags (order_id, customer_id, code, detail) VALUES (${idSql}, (SELECT id FROM customers WHERE phone = ?), ?, ?)`).bind(o.orderNo, o.phone, r.code, r.detail));
  if (o.advanceTrxId && o.advanceAmountPaisa) {
    stmts.push(db.prepare(`INSERT INTO payments (order_id, kind, method, amount_paisa, trx_id, status) VALUES (${idSql}, 'advance', ?, ?, ?, 'submitted')`).bind(o.orderNo, o.advanceWallet ?? 'mobile', o.advanceAmountPaisa, o.advanceTrxId));
  }
  stmts.push(db.prepare(`UPDATE customers SET order_count = order_count + 1, name = COALESCE(name, ?), last_order_at = ${NOW}, updated_at = ${NOW} WHERE phone = ?`).bind(o.name, o.phone));
  // Incomplete-order conversion (Section 8.2): marked converted and linked, never deleted, so recovery can be measured.
  const c = o.conversion;
  stmts.push(db.prepare(
    `UPDATE abandoned_checkouts SET status = 'converted', converted_order_id = ${idSql}, converted_at = ${NOW}, updated_at = ${NOW}
      WHERE status != 'converted' AND (id = ? OR checkout_session_id = ? OR (phone = ? AND updated_at >= ?))`,
  ).bind(o.orderNo, c.incompleteId ?? -1, c.sessionId ?? '-', c.phone, c.sinceIso));
  await db.batch(stmts);
  const row = await db.prepare('SELECT id FROM orders WHERE order_no = ?').bind(o.orderNo).first<{ id: number }>();
  return row!.id;
}

// ───────────── Reads ─────────────

export async function orderById(db: D1Database, id: number): Promise<Row | null> {
  return db.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first<Row>();
}

export async function orderByNo(db: D1Database, orderNo: string): Promise<Row | null> {
  return db.prepare('SELECT * FROM orders WHERE order_no = ?').bind(orderNo).first<Row>();
}

export async function orderByNoAndPhone(db: D1Database, orderNo: string, phone: string): Promise<Row | null> {
  return db.prepare('SELECT * FROM orders WHERE order_no = ? AND phone = ?').bind(orderNo, phone).first<Row>();
}

export async function orderItems(db: D1Database, orderId: number): Promise<Row[]> {
  return (await db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').bind(orderId).all<Row>()).results;
}

export async function statusTimeline(db: D1Database, orderId: number): Promise<Array<{ to_status: OrderStatus; created_at: string }>> {
  return (await db.prepare("SELECT to_status, created_at FROM order_events WHERE order_id = ? AND kind = 'status' ORDER BY id").bind(orderId).all<{ to_status: OrderStatus; created_at: string }>()).results;
}

export async function hasConfirmedCall(db: D1Database, orderId: number): Promise<boolean> {
  return Boolean(await db.prepare("SELECT 1 FROM order_events WHERE order_id = ? AND kind = 'call' AND outcome = 'confirmed' LIMIT 1").bind(orderId).first());
}

export async function orderDetail(db: D1Database, id: number) {
  const o = await orderById(db, id);
  if (!o) return null;
  const [items, events, payments, flags, sms, customer, assignee, creator] = await db.batch([
    db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').bind(id),
    db.prepare('SELECT e.*, a.name AS admin_name FROM order_events e LEFT JOIN admins a ON a.id = e.admin_id WHERE e.order_id = ? ORDER BY e.id').bind(id),
    db.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY id').bind(id),
    db.prepare('SELECT * FROM risk_flags WHERE order_id = ?').bind(id),
    db.prepare('SELECT id, kind, body, status, created_at FROM sms_outbox WHERE order_id = ? ORDER BY id').bind(id),
    db.prepare('SELECT * FROM customers WHERE id = ?').bind(o.customer_id ?? -1),
    db.prepare('SELECT id, name FROM admins WHERE id = ?').bind(o.assigned_to ?? '-'),
    db.prepare('SELECT id, name FROM admins WHERE id = ?').bind(o.created_by ?? '-'),
  ]);
  return {
    order: o, items: items.results as Row[], events: events.results as Row[], payments: payments.results as Row[], riskFlags: flags.results as Row[],
    sms: sms.results as Row[], customer: (customer.results[0] as Row) ?? null, assignee: (assignee.results[0] as Row) ?? null, creator: (creator.results[0] as Row) ?? null,
  };
}

export interface OrderFilters {
  status?: OrderStatus | 'held';
  risk?: string;
  advance?: string;
  preOrder?: boolean;
  source?: string;
  assignedTo?: string | null; // admin id, or '' for unassigned
  /** One of: phone prefix range, order/invoice number prefix, or customer name prefix. */
  phoneRange?: [string, string];
  numberPrefix?: [string, string, 'order_no' | 'invoice_no'];
  namePrefix?: string;
  sinceIso?: string;
  untilIso?: string;
}

function orderWhere(f: OrderFilters): { sql: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.status === 'held') where.push("o.hold_reason IS NOT NULL AND o.status = 'new'");
  else if (f.status) { where.push('o.status = ?'); params.push(f.status); }
  if (f.risk) { where.push('o.risk_level = ?'); params.push(f.risk); }
  if (f.advance) { where.push('o.advance_status = ?'); params.push(f.advance); }
  if (f.preOrder) where.push("o.fulfilment_type = 'pre_order'");
  if (f.source) { where.push('o.source = ?'); params.push(f.source); }
  if (f.assignedTo === '') where.push('o.assigned_to IS NULL');
  else if (f.assignedTo) { where.push('o.assigned_to = ?'); params.push(f.assignedTo); }
  if (f.phoneRange) { where.push('o.phone >= ? AND o.phone < ?'); params.push(...f.phoneRange); }
  if (f.numberPrefix) { where.push(`o.${f.numberPrefix[2]} >= ? AND o.${f.numberPrefix[2]} < ?`); params.push(f.numberPrefix[0], f.numberPrefix[1]); }
  if (f.namePrefix) { where.push("o.customer_name LIKE ? ESCAPE '\\'"); params.push(`${f.namePrefix.replace(/[\\%_]/g, m => `\\${m}`)}%`); }
  if (f.sinceIso) { where.push('o.created_at >= ?'); params.push(f.sinceIso); }
  if (f.untilIso) { where.push('o.created_at < ?'); params.push(f.untilIso); }
  return { sql: where.length ? where.join(' AND ') : '1 = 1', params };
}

export const ORDER_LIST_SQL = `SELECT o.id, o.order_no, o.invoice_no, o.customer_name, o.phone, o.district_name, o.upazila_name, o.total_paisa, o.status, o.sub_status,
            o.payment_method, o.advance_status, o.risk_level, o.risk_reasons, o.hold_reason, o.fulfilment_type, o.source, o.is_test, o.created_at, o.duplicate_of_order_id,
            o.assigned_to, o.courier, o.tracking_id, (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id) AS item_count
       FROM orders o`;

/** Keyset pagination on (created_at, id): deep pages cost the same as the first (Section 21.2). */
export function listOrdersQuery(f: OrderFilters, cursor: { createdAt: string; id: number } | null, limit: number): { sql: string; params: unknown[] } {
  const w = orderWhere(f);
  const params = [...w.params];
  let sql = `${ORDER_LIST_SQL} WHERE ${w.sql}`;
  if (cursor) { sql += ' AND (o.created_at, o.id) < (?, ?)'; params.push(cursor.createdAt, cursor.id); }
  sql += ` ORDER BY o.created_at DESC, o.id DESC LIMIT ${Math.min(Math.max(limit, 1), 200)}`;
  return { sql, params };
}

export async function listOrders(db: D1Database, f: OrderFilters, cursor: { createdAt: string; id: number } | null, limit = 50): Promise<Row[]> {
  const q = listOrdersQuery(f, cursor, limit);
  return (await db.prepare(q.sql).bind(...q.params).all<Row>()).results;
}

export async function exportOrders(db: D1Database, f: OrderFilters): Promise<Row[]> {
  const w = orderWhere(f);
  return (await db.prepare(
    `SELECT o.order_no, o.invoice_no, o.created_at, o.status, o.sub_status, o.source, o.customer_name, o.phone, o.division_name, o.district_name, o.upazila_name, o.postcode,
            o.address_line, o.landmark, o.payment_method, o.advance_status, o.subtotal_paisa, o.delivery_charge_paisa, o.cod_fee_paisa, o.discount_paisa, o.total_paisa,
            o.risk_level, o.courier, o.tracking_id, o.is_test FROM orders o WHERE ${w.sql} ORDER BY o.created_at DESC LIMIT 5000`,
  ).bind(...w.params).all<Row>()).results;
}

/** Barcode scan or typed code: invoice number, order number, tracking code or consignment ID. */
export async function orderByCode(db: D1Database, code: string): Promise<Row | null> {
  return db.prepare(
    `SELECT * FROM orders WHERE invoice_no = ?1 UNION ALL SELECT * FROM orders WHERE order_no = ?1
     UNION ALL SELECT * FROM orders WHERE tracking_id = ?1 UNION ALL SELECT * FROM orders WHERE consignment_id = ?1 LIMIT 1`,
  ).bind(code).first<Row>();
}

export async function ordersWithItems(db: D1Database, ids: number[]): Promise<Array<{ order: Row; items: Row[] }>> {
  if (!ids.length) return [];
  const list = ids.map(() => '?').join(',');
  const [orders, items, invoices] = await db.batch([
    db.prepare(`SELECT * FROM orders WHERE id IN (${list})`).bind(...ids),
    db.prepare(`SELECT * FROM order_items WHERE order_id IN (${list}) ORDER BY order_id, id`).bind(...ids),
    db.prepare(`SELECT order_id, issued_at FROM invoices WHERE order_id IN (${list})`).bind(...ids),
  ]);
  const byOrder = new Map<number, Row[]>();
  for (const it of items.results as Row[]) byOrder.set(Number(it.order_id), [...(byOrder.get(Number(it.order_id)) ?? []), it]);
  const issued = new Map((invoices.results as Array<{ order_id: number; issued_at: string }>).map(r => [r.order_id, r.issued_at]));
  const byId = new Map((orders.results as Row[]).map(o => [Number(o.id), { ...o, issued_at: issued.get(Number(o.id)) ?? null }]));
  return ids.filter(id => byId.has(id)).map(id => ({ order: byId.get(id)!, items: byOrder.get(id) ?? [] }));
}

/** Picking list: total quantity per SKU across the selected orders, sorted by shelf location (Section 9.3). */
export async function pickingList(db: D1Database, ids: number[]): Promise<Row[]> {
  if (!ids.length) return [];
  return (await db.prepare(
    `SELECT i.sku, i.name, i.variant_label, v.shelf_location, SUM(i.qty) AS qty, COUNT(DISTINCT i.order_id) AS orders,
            group_concat(DISTINCT o.order_no) AS order_nos
       FROM order_items i JOIN orders o ON o.id = i.order_id JOIN product_variants v ON v.id = i.variant_id
      WHERE i.order_id IN (${ids.map(() => '?').join(',')})
      GROUP BY i.variant_id ORDER BY COALESCE(v.shelf_location, 'zzz'), i.sku`,
  ).bind(...ids).all<Row>()).results;
}

// ───────────── Pipeline writes ─────────────

const SETTABLE = new Set(['invoice_no', 'confirmation_method', 'confirmed_at', 'packed_at', 'in_courier_at', 'delivered_at', 'returned_at', 'cancel_reason', 'return_reason',
  'courier', 'tracking_id', 'consignment_id', 'sub_status', 'payment_status', 'last_courier_update_at']);

export interface TransitionWrite {
  orderId: number;
  from: OrderStatus;
  to: OrderStatus;
  actor: Actor;
  adminId: string | null;
  note: string | null;
  /** Columns to set. The value NOW means the current timestamp. */
  fields: Record<string, string | number | null>;
  invoice?: { invoiceNo: string; totalPaisa: number };
  stock?: { op: 'reserve' | 'release' | 'ship'; items: Array<{ variantId: number; qty: number }> };
  returnedQty?: Array<{ itemId: number; qty: number }>;
  customer?: { id: number; delivered?: boolean; returned?: boolean };
}

export const NOW_VALUE = '__now__';

/**
 * Applies a validated transition in one batch. The status update is guarded by the expected current status, so two
 * staff moving the same order at once cannot both succeed. Stock CHECK constraints (stock ≥ reserved ≥ 0) roll back
 * the whole batch when there isn't enough on hand.
 */
export async function commitTransition(db: D1Database, t: TransitionWrite): Promise<boolean> {
  const token = crypto.randomUUID();
  const sets = ['status = ?', 'last_transition_id = ?', `updated_at = ${NOW}`];
  const vals: unknown[] = [t.to, token];
  for (const [k, v] of Object.entries(t.fields)) {
    if (!SETTABLE.has(k)) throw new Error(`Column ${k} cannot be set by a transition`);
    if (v === NOW_VALUE) sets.push(`${k} = ${NOW}`);
    else { sets.push(`${k} = ?`); vals.push(v); }
  }
  const stmts: D1PreparedStatement[] = [
    db.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = ? AND status = ?`).bind(...vals, t.orderId, t.from),
  ];
  // Every other statement runs only if the first one wrote this transition's token (the order had not moved meanwhile).
  const guard = `(SELECT last_transition_id FROM orders WHERE id = ${Number(t.orderId)}) = '${token}'`;
  if (t.invoice) stmts.push(db.prepare('INSERT INTO invoices (order_id, invoice_no, total_paisa) VALUES (?, ?, ?) ON CONFLICT(order_id) DO NOTHING').bind(t.orderId, t.invoice.invoiceNo, t.invoice.totalPaisa));
  if (t.stock) {
    for (const it of t.stock.items) {
      if (t.stock.op === 'reserve') {
        stmts.push(db.prepare(`UPDATE product_variants SET reserved = reserved + ?, updated_at = ${NOW} WHERE id = ? AND ${guard}`).bind(it.qty, it.variantId));
        stmts.push(db.prepare(`INSERT INTO stock_movements (variant_id, change, reserved_change, kind, order_id, admin_id) SELECT ?, 0, ?, 'reserve', ?, ? WHERE ${guard}`).bind(it.variantId, it.qty, t.orderId, t.adminId));
      } else if (t.stock.op === 'release') {
        stmts.push(db.prepare(`UPDATE product_variants SET reserved = reserved - ?, updated_at = ${NOW} WHERE id = ? AND ${guard}`).bind(it.qty, it.variantId));
        stmts.push(db.prepare(`INSERT INTO stock_movements (variant_id, change, reserved_change, kind, order_id, admin_id) SELECT ?, 0, ?, 'release', ?, ? WHERE ${guard}`).bind(it.variantId, -it.qty, t.orderId, t.adminId));
      } else {
        stmts.push(db.prepare(`UPDATE product_variants SET stock = stock - ?, reserved = reserved - ?, updated_at = ${NOW} WHERE id = ? AND ${guard}`).bind(it.qty, it.qty, it.variantId));
        stmts.push(db.prepare(`INSERT INTO stock_movements (variant_id, change, reserved_change, kind, order_id, admin_id) SELECT ?, ?, ?, 'sale', ?, ? WHERE ${guard}`).bind(it.variantId, -it.qty, -it.qty, t.orderId, t.adminId));
      }
    }
  }
  for (const r of t.returnedQty ?? []) stmts.push(db.prepare(`UPDATE order_items SET returned_qty = ? WHERE id = ? AND order_id = ? AND ${guard}`).bind(r.qty, r.itemId, t.orderId));
  if (t.customer?.delivered) stmts.push(db.prepare(`UPDATE customers SET delivered_count = delivered_count + 1 WHERE id = ? AND ${guard}`).bind(t.customer.id));
  if (t.customer?.returned) stmts.push(db.prepare(`UPDATE customers SET returned_count = returned_count + 1 WHERE id = ? AND ${guard}`).bind(t.customer.id));
  stmts.push(db.prepare(`INSERT INTO order_events (order_id, kind, from_status, to_status, note, actor_type, admin_id) SELECT ?, 'status', ?, ?, ?, ?, ? WHERE ${guard}`)
    .bind(t.orderId, t.from, t.to, t.note, t.actor, t.adminId));
  const results = await db.batch(stmts);
  return (results[0].meta.changes ?? 0) > 0;
}

export async function logRejectedTransition(db: D1Database, orderId: number, from: string, to: string, actor: Actor, adminId: string | null, reason: string): Promise<void> {
  await db.prepare("INSERT INTO order_events (order_id, kind, from_status, to_status, note, actor_type, admin_id) VALUES (?, 'rejected_transition', ?, ?, ?, ?, ?)")
    .bind(orderId, from, to, reason.slice(0, 500), actor, adminId).run();
}

/** Warehouse scan: the parcel is back, so its stock is too (Section 9.1, stage 8). */
export async function receiveReturn(db: D1Database, orderId: number, items: Array<{ variantId: number; qty: number }>, adminId: string, note: string): Promise<boolean> {
  const token = crypto.randomUUID();
  const stmts: D1PreparedStatement[] = [
    db.prepare(`UPDATE orders SET return_received_at = ${NOW}, return_received_by = ?, sub_status = 'received', last_transition_id = ?, updated_at = ${NOW}
                 WHERE id = ? AND status IN ('returned','partial_delivered') AND return_received_at IS NULL`).bind(adminId, token, orderId),
  ];
  const guard = `(SELECT last_transition_id FROM orders WHERE id = ${Number(orderId)}) = '${token}'`;
  for (const it of items) {
    stmts.push(db.prepare(`UPDATE product_variants SET stock = stock + ?, updated_at = ${NOW} WHERE id = ? AND ${guard}`).bind(it.qty, it.variantId));
    stmts.push(db.prepare(`INSERT INTO stock_movements (variant_id, change, kind, reason, order_id, admin_id) SELECT ?, ?, 'return_received', 'received', ?, ? WHERE ${guard}`).bind(it.variantId, it.qty, orderId, adminId));
  }
  stmts.push(db.prepare(`INSERT INTO order_events (order_id, kind, note, actor_type, admin_id) SELECT ?, 'return_scan', ?, 'staff', ? WHERE ${guard}`).bind(orderId, note, adminId));
  const r = await db.batch(stmts);
  return (r[0].meta.changes ?? 0) > 0;
}

export async function addOrderEvent(db: D1Database, e: { orderId: number; kind: string; note: string | null; outcome?: string | null; actor?: Actor; adminId?: string | null }): Promise<void> {
  await db.prepare('INSERT INTO order_events (order_id, kind, outcome, note, actor_type, admin_id) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(e.orderId, e.kind, e.outcome ?? null, e.note, e.actor ?? 'staff', e.adminId ?? null).run();
}

export async function logCall(db: D1Database, orderId: number, outcome: string, note: string | null, adminId: string): Promise<void> {
  await db.batch([
    db.prepare("INSERT INTO order_events (order_id, kind, outcome, note, actor_type, admin_id) VALUES (?, 'call', ?, ?, 'staff', ?)").bind(orderId, outcome, note, adminId),
    db.prepare(`UPDATE orders SET call_attempts = call_attempts + 1, sub_status = CASE WHEN status = 'new' THEN ? ELSE sub_status END, updated_at = ${NOW} WHERE id = ?`)
      .bind(outcome === 'call_back' ? 'call_back' : 'call_attempted', orderId),
  ]);
}

export async function releaseHold(db: D1Database, orderId: number, adminId: string, note: string): Promise<void> {
  await db.batch([
    db.prepare(`UPDATE orders SET hold_reason = NULL, updated_at = ${NOW} WHERE id = ?`).bind(orderId),
    db.prepare("INSERT INTO order_events (order_id, kind, note, actor_type, admin_id) VALUES (?, 'hold', ?, 'staff', ?)").bind(orderId, `Hold released: ${note}`, adminId),
  ]);
}

export async function assignOrders(db: D1Database, ids: number[], adminId: string | null): Promise<number> {
  if (!ids.length) return 0;
  const r = await db.prepare(`UPDATE orders SET assigned_to = ?, updated_at = ${NOW} WHERE id IN (${ids.map(() => '?').join(',')})`).bind(adminId, ...ids).run();
  return r.meta.changes ?? 0;
}

export async function setCourierInfo(db: D1Database, orderId: number, courier: string | null, trackingId: string | null): Promise<void> {
  await db.prepare(`UPDATE orders SET courier = COALESCE(?, courier), tracking_id = COALESCE(?, tracking_id), updated_at = ${NOW} WHERE id = ?`).bind(courier, trackingId, orderId).run();
}

export async function setSubStatus(db: D1Database, orderId: number, subStatus: string, adminId: string): Promise<void> {
  await db.batch([
    db.prepare(`UPDATE orders SET sub_status = ?, updated_at = ${NOW} WHERE id = ?`).bind(subStatus, orderId),
    db.prepare("INSERT INTO order_events (order_id, kind, note, actor_type, admin_id) VALUES (?, 'note', ?, 'staff', ?)").bind(orderId, `Courier status: ${subStatus.replace(/_/g, ' ')}`, adminId),
  ]);
}

export async function setTestFlag(db: D1Database, orderId: number, isTest: boolean): Promise<void> {
  await db.prepare(`UPDATE orders SET is_test = ?, updated_at = ${NOW} WHERE id = ?`).bind(isTest ? 1 : 0, orderId).run();
}

export async function setDeliveryCharge(db: D1Database, orderId: number, chargePaisa: number, totalPaisa: number, advancePaisa: number | null, adminId: string, note: string): Promise<void> {
  await db.batch([
    db.prepare(`UPDATE orders SET delivery_charge_paisa = ?, delivery_charge_status = 'final', total_paisa = ?, advance_amount_paisa = ?, updated_at = ${NOW} WHERE id = ?`).bind(chargePaisa, totalPaisa, advancePaisa, orderId),
    db.prepare("INSERT INTO order_events (order_id, kind, note, actor_type, admin_id) VALUES (?, 'note', ?, 'staff', ?)").bind(orderId, note, adminId),
  ]);
}

// ───────────── Advance payments ─────────────

export async function submitAdvance(db: D1Database, orderId: number, trxId: string, wallet: string, amountPaisa: number): Promise<void> {
  await db.batch([
    db.prepare(`UPDATE orders SET advance_trx_id = ?, advance_wallet = ?, advance_status = 'submitted', updated_at = ${NOW} WHERE id = ?`).bind(trxId, wallet, orderId),
    db.prepare("INSERT INTO payments (order_id, kind, method, amount_paisa, trx_id, status) VALUES (?, 'advance', ?, ?, ?, 'submitted')").bind(orderId, wallet, amountPaisa, trxId),
    db.prepare("INSERT INTO order_events (order_id, kind, note, actor_type) VALUES (?, 'payment', ?, 'customer')").bind(orderId, `Customer submitted advance TrxID ${trxId} (${wallet})`),
  ]);
}

export async function rejectAdvance(db: D1Database, orderId: number, adminId: string, note: string): Promise<void> {
  await db.batch([
    db.prepare(`UPDATE orders SET advance_status = 'pending', updated_at = ${NOW} WHERE id = ?`).bind(orderId),
    db.prepare("UPDATE payments SET status = 'rejected', verified_by = ? WHERE order_id = ? AND kind = 'advance' AND status = 'submitted'").bind(adminId, orderId),
    db.prepare("INSERT INTO order_events (order_id, kind, note, actor_type, admin_id) VALUES (?, 'payment', ?, 'staff', ?)").bind(orderId, `Advance rejected: ${note}`, adminId),
  ]);
}

export async function verifyAdvance(db: D1Database, o: Row, amountPaisa: number, paymentStatus: string, adminId: string, note: string): Promise<void> {
  const id = Number(o.id);
  await db.batch([
    db.prepare(`UPDATE orders SET advance_status = 'paid', advance_amount_paisa = ?, payment_status = ?, updated_at = ${NOW} WHERE id = ?`).bind(amountPaisa, paymentStatus, id),
    db.prepare("UPDATE payments SET status = 'verified', verified_by = ?, amount_paisa = ? WHERE order_id = ? AND kind = 'advance' AND status = 'submitted'").bind(adminId, amountPaisa, id),
    db.prepare("INSERT INTO payments (order_id, kind, method, amount_paisa, trx_id, status, verified_by) SELECT ?, 'advance', COALESCE(?, 'mobile'), ?, ?, 'verified', ? WHERE NOT EXISTS (SELECT 1 FROM payments WHERE order_id = ? AND kind = 'advance' AND status = 'verified')")
      .bind(id, o.advance_wallet ?? null, amountPaisa, o.advance_trx_id ?? null, adminId, id),
    db.prepare("INSERT INTO order_events (order_id, kind, note, actor_type, admin_id) VALUES (?, 'payment', ?, 'staff', ?)").bind(id, note, adminId),
  ]);
}

// ───────────── OTP codes ─────────────

export async function otpRow(db: D1Database, orderId: number): Promise<{ code_hash: string; expires_at: string; attempts: number; sends: number } | null> {
  return db.prepare('SELECT * FROM order_otps WHERE order_id = ?').bind(orderId).first();
}

export async function saveOtp(db: D1Database, orderId: number, codeHash: string, expiresIso: string): Promise<void> {
  await db.prepare(
    `INSERT INTO order_otps (order_id, code_hash, expires_at, attempts, sends) VALUES (?, ?, ?, 0, 1)
     ON CONFLICT(order_id) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, sends = sends + 1`,
  ).bind(orderId, codeHash, expiresIso).run();
}

export async function countOtpAttempt(db: D1Database, orderId: number): Promise<void> {
  await db.prepare('UPDATE order_otps SET attempts = attempts + 1 WHERE order_id = ?').bind(orderId).run();
}

export async function markOtpVerified(db: D1Database, orderId: number): Promise<void> {
  await db.batch([
    db.prepare(`UPDATE orders SET otp_verified_at = ${NOW}, updated_at = ${NOW} WHERE id = ?`).bind(orderId),
    db.prepare("INSERT INTO order_events (order_id, kind, note, actor_type) VALUES (?, 'otp', 'Customer verified the SMS code', 'customer')").bind(orderId),
    db.prepare('DELETE FROM order_otps WHERE order_id = ?').bind(orderId),
  ]);
}

// ───────────── Pre-orders ─────────────

export async function preorderSummary(db: D1Database): Promise<Row[]> {
  return (await db.prepare(
    `SELECT i.product_id, i.name, p.preorder_dispatch_date, COUNT(DISTINCT o.id) AS orders, SUM(i.qty) AS qty,
            SUM(CASE WHEN o.advance_status = 'paid' THEN 1 ELSE 0 END) AS advance_paid, SUM(CASE WHEN o.advance_status IN ('pending','submitted') THEN 1 ELSE 0 END) AS advance_due
       FROM order_items i JOIN orders o ON o.id = i.order_id JOIN products p ON p.id = i.product_id
      WHERE i.fulfilment_mode = 'pre_order' AND o.status NOT IN ('cancelled','returned') AND o.is_test = 0
      GROUP BY i.product_id ORDER BY p.preorder_dispatch_date`,
  ).all<Row>()).results;
}

export async function preorderExport(db: D1Database, productId: number): Promise<Row[]> {
  return (await db.prepare(
    `SELECT o.order_no, o.created_at, o.customer_name, o.phone, o.district_name, i.variant_label, i.qty, o.advance_status, o.advance_amount_paisa, o.status
       FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.product_id = ? AND i.fulfilment_mode = 'pre_order' AND o.status NOT IN ('cancelled','returned') ORDER BY o.id`,
  ).bind(productId).all<Row>()).results;
}

// ───────────── Manual-order helpers ─────────────

/** Previous delivery addresses for the phone-first manual order form. */
export async function previousAddresses(db: D1Database, phone: string): Promise<Row[]> {
  return (await db.prepare(
    `SELECT division_id, district_id, upazila_id, union_id, postcode, address_line, landmark, district_name, upazila_name, MAX(created_at) AS last_used
       FROM orders WHERE phone = ? GROUP BY upazila_id, address_line ORDER BY last_used DESC LIMIT 3`,
  ).bind(phone).all<Row>()).results;
}

export async function recentOrdersForPhone(db: D1Database, phone: string, limit = 5): Promise<Row[]> {
  return (await db.prepare('SELECT id, order_no, status, total_paisa, created_at, source FROM orders WHERE phone = ? ORDER BY created_at DESC LIMIT ?').bind(phone, limit).all<Row>()).results;
}
