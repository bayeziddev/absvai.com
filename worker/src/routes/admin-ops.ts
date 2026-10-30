/** Admin operations: dashboard, orders, customers, seasons, delivery zones & geo, couriers, settings, inventory, audit. */
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../env';
import { getSeasons } from '../data/catalog';
import { bumpCatalogVersion, bumpGeoVersion, loadSettings } from '../data/settings';
import { bdDate, daysBetween, isIsoDate } from '../lib/dates';
import { bad, HttpError, int, notFound, parseJson, posInt, readJson, slugify, str } from '../lib/http';
import { buildInvoicePdf } from '../lib/invoice';
import { formatTaka } from '../lib/money';
import { confirmBlockers, nextStatuses, STATUS_LABELS, type OrderStatus } from '../lib/order-status';
import { isSeasonActive, nextSeason, productAvailability } from '../lib/seasons';
import { sendSms, SMS } from '../lib/sms';
import { changeStatus } from '../services/orders';
import { audit, need } from './admin-helpers';

export const adminOps = new Hono<AppEnv>();

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/** UTC ISO range for a Bangladesh calendar day. */
function bdDayRange(day: string): [string, string] {
  const start = new Date(Date.parse(`${day}T00:00:00+06:00`)).toISOString();
  const end = new Date(Date.parse(`${day}T00:00:00+06:00`) + 86_400_000).toISOString();
  return [start, end];
}

function csv(rows: unknown[][]): string {
  return rows.map(r => r.map(v => { const s = v === null || v === undefined ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\r\n') + '\r\n';
}

// ───────────── Dashboard ─────────────

adminOps.get('/dashboard', need('dashboard'), async c => {
  const db = c.env.DB;
  const today = bdDate();
  const [start, end] = bdDayRange(today);
  const fourteen = bdDayRange(new Date(Date.now() - 13 * 86_400_000 + 6 * 3_600_000).toISOString().slice(0, 10))[0];
  const live = "status NOT IN ('cancelled','refused_at_delivery','returned') AND is_test = 0";
  const [kpi, awaiting, low, recent, chart, abandoned, advances, preorders, unmatched, fuzzy] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS orders, COALESCE(SUM(total_paisa),0) AS revenue FROM orders WHERE created_at >= ? AND created_at < ? AND ${live}`).bind(start, end),
    db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status IN ('pending','confirmation_attempted') AND is_test = 0"),
    db.prepare(`SELECT v.id, v.sku, v.stock, p.name, p.id AS product_id FROM product_variants v JOIN products p ON p.id = v.product_id
                 WHERE v.is_active = 1 AND p.status = 'published' AND p.deleted_at IS NULL AND p.fulfilment_mode = 'in_stock' AND v.stock <= 5 ORDER BY v.stock LIMIT 20`),
    db.prepare('SELECT id, order_no, customer_name, district_name, total_paisa, status, risk_level, payment_method, created_at FROM orders ORDER BY id DESC LIMIT 8'),
    db.prepare(`SELECT substr(datetime(created_at, '+6 hours'), 1, 10) AS day, COUNT(*) AS orders, SUM(total_paisa) AS revenue FROM orders WHERE created_at >= ? AND ${live} GROUP BY day ORDER BY day`).bind(fourteen),
    db.prepare("SELECT COUNT(*) AS n FROM abandoned_checkouts WHERE status = 'open' AND updated_at >= datetime('now', '-7 days')"),
    db.prepare("SELECT COUNT(*) AS n FROM orders WHERE advance_status = 'submitted'"),
    db.prepare("SELECT COUNT(*) AS n FROM orders WHERE fulfilment_type = 'pre_order' AND status = 'confirmed'"),
    db.prepare("SELECT COUNT(*) AS n FROM geo_postcodes WHERE match_status = 'unmatched'"),
    db.prepare("SELECT COUNT(*) AS n FROM geo_postcodes WHERE match_status = 'fuzzy'"),
  ]);
  const codPending = await db.prepare(`SELECT COALESCE(SUM(total_paisa),0) AS v FROM orders WHERE payment_method = 'cod' AND status IN ('confirmed','packed','shipped') AND is_test = 0`).first<{ v: number }>();

  const seasons = await getSeasons(db);
  const active = seasons.filter(s => isSeasonActive(s, today)).map(s => ({ id: s.id, name: s.name, endsOn: s.ends_on, daysLeft: daysBetween(today, s.ends_on!) }));
  const next = nextSeason(seasons, today);
  const undated = seasons.filter(s => s.is_enabled && (!s.starts_on || !s.ends_on)).map(s => s.name);

  const attention: Array<{ level: 'info' | 'warn' | 'alert'; text: string; href: string }> = [];
  const n = (r: D1Result) => Number((r.results[0] as { n: number })?.n ?? 0);
  if (n(awaiting)) attention.push({ level: 'alert', text: `${n(awaiting)} order(s) waiting for confirmation`, href: '#/orders?status=pending' });
  if (n(advances)) attention.push({ level: 'warn', text: `${n(advances)} advance payment(s) to verify`, href: '#/orders?advance=submitted' });
  if (n(abandoned)) attention.push({ level: 'info', text: `${n(abandoned)} abandoned checkout(s) in the last 7 days`, href: '#/abandoned' });
  if (low.results.length) attention.push({ level: 'warn', text: `${low.results.length} option(s) with 5 or fewer in stock`, href: '#/inventory' });
  if (n(preorders)) attention.push({ level: 'info', text: `${n(preorders)} confirmed pre-order(s) to dispatch`, href: '#/preorders' });
  if (n(unmatched)) attention.push({ level: 'info', text: `${n(unmatched)} postcode(s) not linked to an area yet`, href: '#/geo?status=unmatched' });
  if (undated.length) attention.push({ level: 'warn', text: `Set this year's dates for: ${undated.join(', ')}`, href: '#/seasons' });
  if (next && next.daysUntil <= 30) {
    const linked = await db.prepare(
      `SELECT SUM(CASE WHEN p.status != 'published' THEN 1 ELSE 0 END) AS hidden,
              SUM(CASE WHEN (SELECT COALESCE(SUM(stock),0) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1) = 0 AND p.fulfilment_mode = 'in_stock' THEN 1 ELSE 0 END) AS empty
         FROM products p JOIN product_seasons ps ON ps.product_id = p.id WHERE ps.season_id = ? AND p.deleted_at IS NULL`,
    ).bind(next.season.id).first<{ hidden: number; empty: number }>();
    attention.push({ level: 'warn', text: `${next.season.name} starts in ${next.daysUntil} day(s). ${linked?.hidden ?? 0} product(s) still hidden and ${linked?.empty ?? 0} with no stock.`, href: '#/seasons' });
  }
  const expired = await db.prepare(`SELECT COUNT(*) AS n FROM product_spec_values s JOIN products p ON p.id = s.product_id WHERE s.field_key = 'best_before' AND s.value < ? AND p.status = 'published' AND p.deleted_at IS NULL`).bind(today).first<{ n: number }>();
  if (expired?.n) attention.push({ level: 'alert', text: `${expired.n} live food product(s) are past their best-before date`, href: '#/products?status=published' });

  const s = await loadSettings(db);
  const wallets = parseJson<unknown[]>(s.manual_wallets, []);
  const health = [
    { label: 'Cash on Delivery', ok: true, text: 'Cash on Delivery working' },
    { label: 'Mobile wallets', ok: wallets.length > 0, text: wallets.length ? `${wallets.length} wallet number(s) for advances` : 'Add bKash/Nagad numbers for advances' },
    { label: 'SMS', ok: Boolean(c.env.SMS_PROVIDER && c.env.SMS_API_KEY), text: c.env.SMS_PROVIDER ? 'SMS provider connected' : 'SMS provider not connected (messages are logged only)' },
    { label: 'Bot check', ok: Boolean(c.env.TURNSTILE_SECRET), text: c.env.TURNSTILE_SECRET ? 'Turnstile on checkout' : 'Turnstile not configured' },
    { label: 'Courier', ok: false, text: 'Courier API not connected yet (Phase 2)' },
  ];

  return c.json({
    kpis: {
      todayOrders: Number((kpi.results[0] as { orders: number }).orders), todayRevenuePaisa: Number((kpi.results[0] as { revenue: number }).revenue),
      codPendingPaisa: codPending?.v ?? 0, awaitingConfirmation: n(awaiting), lowStock: low.results.length,
    },
    seasons: { active, next: next ? { name: next.season.name, startsOn: next.season.starts_on, daysUntil: next.daysUntil } : null, undated },
    chart: chart.results, recentOrders: recent.results, lowStock: low.results, attention, health, fuzzyPostcodes: n(fuzzy),
  });
});

// ───────────── Orders ─────────────

adminOps.get('/orders', need('orders:read'), async c => {
  const where: string[] = ['1 = 1'];
  const params: unknown[] = [];
  const status = c.req.query('status');
  if (status === 'pending') where.push("o.status IN ('pending','confirmation_attempted')");
  else if (status && status in STATUS_LABELS) { where.push('o.status = ?'); params.push(status); }
  const risk = c.req.query('risk');
  if (risk && ['low', 'medium', 'high'].includes(risk)) { where.push('o.risk_level = ?'); params.push(risk); }
  const adv = c.req.query('advance');
  if (adv && ['pending', 'submitted', 'paid'].includes(adv)) { where.push('o.advance_status = ?'); params.push(adv); }
  if (c.req.query('fulfilment') === 'pre_order') where.push("o.fulfilment_type = 'pre_order'");
  const q = str(c.req.query('q'), 60);
  if (q) { where.push('(o.order_no LIKE ? OR o.phone LIKE ? OR o.customer_name LIKE ? OR o.invoice_no LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  const page = Math.max(1, Number(c.req.query('page')) || 1);
  const r = await c.env.DB.prepare(
    `SELECT o.id, o.order_no, o.invoice_no, o.customer_name, o.phone, o.district_name, o.upazila_name, o.total_paisa, o.status, o.payment_method, o.advance_status,
            o.risk_level, o.fulfilment_type, o.is_test, o.created_at, o.duplicate_of_order_id, (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id) AS item_count
       FROM orders o WHERE ${where.join(' AND ')} ORDER BY o.id DESC LIMIT 50 OFFSET ${(page - 1) * 50}`,
  ).bind(...params).all();
  return c.json(r.results);
});

adminOps.get('/orders/export.csv', need('orders:read'), async c => {
  const r = await c.env.DB.prepare('SELECT order_no, invoice_no, created_at, status, customer_name, phone, division_name, district_name, upazila_name, postcode, address_line, landmark, payment_method, advance_status, subtotal_paisa, delivery_charge_paisa, cod_fee_paisa, total_paisa, risk_level, courier, tracking_id, is_test FROM orders ORDER BY id DESC LIMIT 5000').all<Record<string, unknown>>();
  const head = Object.keys(r.results[0] ?? { order_no: '' });
  return c.body(csv([head, ...r.results.map(o => head.map(h => (/_paisa$/.test(h) && o[h] != null ? Number(o[h]) / 100 : o[h])))]), 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="absvai-orders.csv"' });
});

adminOps.get('/orders/:id', need('orders:read'), async c => {
  const id = posInt(c.req.param('id'));
  const db = c.env.DB;
  const o = await db.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first<Record<string, unknown>>();
  if (!o) throw notFound();
  const [items, events, payments, flags, sms, customer] = await db.batch([
    db.prepare('SELECT * FROM order_items WHERE order_id = ?').bind(id),
    db.prepare('SELECT e.*, a.name AS admin_name FROM order_events e LEFT JOIN admins a ON a.id = e.admin_id WHERE e.order_id = ? ORDER BY e.id').bind(id),
    db.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY id').bind(id),
    db.prepare('SELECT * FROM risk_flags WHERE order_id = ?').bind(id),
    db.prepare('SELECT id, kind, body, status, created_at FROM sms_outbox WHERE order_id = ? ORDER BY id').bind(id),
    db.prepare('SELECT * FROM customers WHERE id = ?').bind(o.customer_id),
  ]);
  const hasCall = (events.results as Array<{ kind: string; outcome: string }>).some(e => e.kind === 'call' && e.outcome === 'confirmed');
  return c.json({
    order: { ...o, utm: parseJson(o.utm, {}), risk_reasons: parseJson(o.risk_reasons, []) },
    items: items.results, events: events.results, payments: payments.results, riskFlags: flags.results, sms: sms.results, customer: customer.results[0] ?? null,
    nextStatuses: nextStatuses(o.status as OrderStatus).map(s => ({ value: s, label: STATUS_LABELS[s] })),
    confirmBlockers: confirmBlockers({
      paymentMethod: String(o.payment_method), otpVerifiedAt: (o.otp_verified_at as string) ?? null, hasConfirmedCall: hasCall,
      advanceRequired: Boolean(o.advance_required), advanceStatus: String(o.advance_status), deliveryChargeStatus: o.delivery_charge_status as 'final',
    }),
  });
});

adminOps.post('/orders/:id/status', need('orders:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const b = await readJson(c);
  const to = str(b.to) as OrderStatus;
  if (!(to in STATUS_LABELS)) throw bad('Unknown status.');
  const r = await changeStatus(c.env, id, to, { adminId: c.var.session.adminId, note: str(b.note, 500) || null, courier: str(b.courier, 40) || null, trackingId: str(b.trackingId, 60) || null, cancelReason: str(b.cancelReason, 300) || null });
  await audit(c, 'order.status', 'order', id, { to });
  return c.json({ ok: true, ...r });
});

adminOps.post('/orders/bulk', need('orders:write'), async c => {
  const b = await readJson(c);
  const ids = Array.isArray(b.ids) ? (b.ids as unknown[]).map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 100) : [];
  const to = str(b.to) as OrderStatus;
  if (!ids.length || !(to in STATUS_LABELS)) throw bad('Choose orders and a status.');
  const tracking = (b.trackingIds ?? {}) as Record<string, string>;
  const results: Array<{ id: number; ok: boolean; message?: string }> = [];
  for (const id of ids) {
    try {
      await changeStatus(c.env, id, to, { adminId: c.var.session.adminId, courier: str(b.courier, 40) || null, trackingId: str(tracking[String(id)], 60) || null, cancelReason: str(b.cancelReason, 300) || null });
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, message: (e as Error).message });
    }
  }
  await audit(c, 'order.bulk_status', 'order', null, { to, ids });
  return c.json({ results });
});

adminOps.post('/orders/:id/call', need('orders:write'), async c => {
  const id = posInt(c.req.param('id'));
  const b = await readJson(c);
  const outcome = str(b.outcome);
  if (!['confirmed', 'no_answer', 'wrong_number', 'cancel_requested', 'call_back'].includes(outcome)) throw bad('Choose how the call went.');
  const o = await c.env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(id).first<{ status: string }>();
  if (!o) throw notFound();
  const stmts = [c.env.DB.prepare("INSERT INTO order_events (order_id, kind, outcome, note, admin_id) VALUES (?, 'call', ?, ?, ?)").bind(id, outcome, str(b.note, 500) || null, c.var.session.adminId)];
  if (o.status === 'pending') {
    stmts.push(c.env.DB.prepare(`UPDATE orders SET status = 'confirmation_attempted', updated_at = ${NOW} WHERE id = ?`).bind(id));
    stmts.push(c.env.DB.prepare("INSERT INTO order_events (order_id, kind, from_status, to_status, admin_id) VALUES (?, 'status', 'pending', 'confirmation_attempted', ?)").bind(id, c.var.session.adminId));
  }
  await c.env.DB.batch(stmts);
  await audit(c, 'order.call', 'order', id, { outcome });
  return c.json({ ok: true });
});

adminOps.post('/orders/:id/advance', need('orders:write'), async c => {
  const id = posInt(c.req.param('id'));
  const b = await readJson(c);
  const o = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first<Record<string, number | string>>();
  if (!o) throw notFound();
  if (!o.advance_required) throw bad('This order has no advance.');
  if (b.action === 'reject') {
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE orders SET advance_status = 'pending', updated_at = ${NOW} WHERE id = ?`).bind(id),
      c.env.DB.prepare("UPDATE payments SET status = 'rejected', verified_by = ? WHERE order_id = ? AND kind = 'advance' AND status = 'submitted'").bind(c.var.session.adminId, id),
      c.env.DB.prepare("INSERT INTO order_events (order_id, kind, note, admin_id) VALUES (?, 'payment', ?, ?)").bind(id, `Advance rejected: ${str(b.note, 200) || 'transaction not found'}`, c.var.session.adminId),
    ]);
  } else {
    const amount = posInt(b.amountPaisa) ?? Number(o.advance_amount_paisa);
    if (!amount) throw bad('Enter the amount received.');
    const status = amount >= Number(o.total_paisa) ? 'paid' : 'partially_paid';
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE orders SET advance_status = 'paid', advance_amount_paisa = ?, payment_status = ?, updated_at = ${NOW} WHERE id = ?`).bind(amount, status, id),
      c.env.DB.prepare("UPDATE payments SET status = 'verified', verified_by = ?, amount_paisa = ? WHERE order_id = ? AND kind = 'advance' AND status = 'submitted'").bind(c.var.session.adminId, amount, id),
      c.env.DB.prepare("INSERT INTO payments (order_id, kind, method, amount_paisa, trx_id, status, verified_by) SELECT ?, 'advance', COALESCE(?, 'mobile'), ?, ?, 'verified', ? WHERE NOT EXISTS (SELECT 1 FROM payments WHERE order_id = ? AND kind = 'advance' AND status = 'verified')")
        .bind(id, o.advance_wallet ?? null, amount, o.advance_trx_id ?? null, c.var.session.adminId, id),
      c.env.DB.prepare("INSERT INTO order_events (order_id, kind, note, admin_id) VALUES (?, 'payment', ?, ?)").bind(id, `Advance of ${formatTaka(amount)} verified`, c.var.session.adminId),
    ]);
  }
  await audit(c, 'order.advance', 'order', id, { action: b.action ?? 'verify' });
  return c.json({ ok: true });
});

/** For heavy/bulky items marked "confirm by phone": set the charge, then the order can be confirmed. */
adminOps.post('/orders/:id/delivery-charge', need('orders:write'), async c => {
  const id = posInt(c.req.param('id'));
  const b = await readJson(c);
  const charge = int(b.chargePaisa);
  if (charge === null || charge < 0) throw bad('Enter the delivery charge.');
  const o = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first<Record<string, number | string | null>>();
  if (!o) throw notFound();
  if (!['pending', 'confirmation_attempted'].includes(String(o.status))) throw bad('The delivery charge can only change before the order is confirmed.');
  const total = Number(o.subtotal_paisa) + charge + Number(o.cod_fee_paisa) - Number(o.discount_paisa);
  const advance = o.advance_required && o.advance_amount_paisa === null ? charge : o.advance_amount_paisa;
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE orders SET delivery_charge_paisa = ?, delivery_charge_status = 'final', total_paisa = ?, advance_amount_paisa = ?, updated_at = ${NOW} WHERE id = ?`).bind(charge, total, advance, id),
    c.env.DB.prepare("INSERT INTO order_events (order_id, kind, note, admin_id) VALUES (?, 'note', ?, ?)").bind(id, `Delivery charge set to ${formatTaka(charge)}`, c.var.session.adminId),
  ]);
  await audit(c, 'order.delivery_charge', 'order', id, { charge });
  return c.json({ ok: true });
});

adminOps.post('/orders/:id/note', need('orders:write'), async c => {
  const id = posInt(c.req.param('id'));
  const note = str((await readJson(c)).note, 1000);
  if (!note) throw bad('Write a note.');
  await c.env.DB.prepare("INSERT INTO order_events (order_id, kind, note, admin_id) VALUES (?, 'note', ?, ?)").bind(id, note, c.var.session.adminId).run();
  return c.json({ ok: true });
});

/** Test orders never count in reports and must never fire a Purchase event. */
adminOps.post('/orders/:id/test', need('orders:write'), async c => {
  const id = posInt(c.req.param('id'));
  const isTest = Boolean((await readJson(c)).isTest);
  await c.env.DB.prepare(`UPDATE orders SET is_test = ?, updated_at = ${NOW} WHERE id = ?`).bind(isTest ? 1 : 0, id).run();
  await audit(c, 'order.test_flag', 'order', id, { isTest });
  return c.json({ ok: true });
});

adminOps.post('/orders/:id/merge', need('orders:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const o = await c.env.DB.prepare('SELECT duplicate_of_order_id FROM orders WHERE id = ?').bind(id).first<{ duplicate_of_order_id: number | null }>();
  if (!o?.duplicate_of_order_id) throw bad('This order is not marked as a possible duplicate.');
  const target = await c.env.DB.prepare('SELECT order_no FROM orders WHERE id = ?').bind(o.duplicate_of_order_id).first<{ order_no: string }>();
  await changeStatus(c.env, id, 'cancelled', { adminId: c.var.session.adminId, cancelReason: `Duplicate of ${target?.order_no}` });
  await audit(c, 'order.merge', 'order', id, { into: o.duplicate_of_order_id });
  return c.json({ ok: true });
});

adminOps.get('/orders/:id/invoice.pdf', need('orders:read'), async c => {
  const id = posInt(c.req.param('id'));
  const o = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first<Record<string, unknown>>();
  if (!o) throw notFound();
  if (!o.invoice_no) throw bad('The invoice is created when the order is confirmed.');
  const items = await c.env.DB.prepare('SELECT * FROM order_items WHERE order_id = ?').bind(id).all<Record<string, unknown>>();
  const inv = await c.env.DB.prepare('SELECT issued_at FROM invoices WHERE order_id = ?').bind(id).first<{ issued_at: string }>();
  const s = await loadSettings(c.env.DB);
  const pdf = buildInvoicePdf({
    invoiceNo: String(o.invoice_no), issuedAt: inv?.issued_at ?? String(o.confirmed_at), orderNo: String(o.order_no),
    company: { name: s.store_name ?? 'Abs Vai', legalName: s.company_name ?? 'ABS VAI LTD', address: s.company_address ?? '', phone: s.support_phone ?? '', site: 'absvai.com' },
    customer: {
      name: String(o.customer_name), phone: String(o.phone),
      address: [String(o.address_line), [o.landmark ? `Near ${o.landmark}` : '', o.union_name].filter(Boolean).join(', '), `${o.upazila_name}, ${o.district_name}, ${o.division_name} Division${o.postcode ? ` ${o.postcode}` : ''}`].filter(Boolean),
    },
    paymentMethod: String(o.payment_method), paymentStatus: String(o.payment_status), advancePaidPaisa: o.advance_status === 'paid' ? Number(o.advance_amount_paisa ?? 0) : 0,
    items: items.results.map(i => ({ sku: String(i.sku), name: String(i.name), variant: (i.variant_label as string) ?? null, qty: Number(i.qty), unitPaisa: Number(i.unit_price_paisa), totalPaisa: Number(i.line_total_paisa) })),
    subtotalPaisa: Number(o.subtotal_paisa), deliveryPaisa: o.delivery_charge_paisa === null ? null : Number(o.delivery_charge_paisa), codFeePaisa: Number(o.cod_fee_paisa),
    discountPaisa: Number(o.discount_paisa), totalPaisa: Number(o.total_paisa),
  });
  return c.body(pdf, 200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${o.invoice_no}.pdf"`, 'Cache-Control': 'private, no-store' });
});

// ───────────── Customers, abandoned, pre-orders, notify-me ─────────────

adminOps.get('/customers', need('customers:read'), async c => {
  const q = str(c.req.query('q'), 60);
  const r = await c.env.DB.prepare(`SELECT * FROM customers ${q ? 'WHERE phone LIKE ? OR name LIKE ?' : ''} ORDER BY updated_at DESC LIMIT 100`).bind(...(q ? [`%${q}%`, `%${q}%`] : [])).all();
  return c.json(r.results);
});

adminOps.post('/customers/:id/trusted', need('orders:write'), async c => {
  const trusted = Boolean((await readJson(c)).trusted);
  await c.env.DB.prepare(`UPDATE customers SET is_trusted = ?, updated_at = ${NOW} WHERE id = ?`).bind(trusted ? 1 : 0, posInt(c.req.param('id'))).run();
  await audit(c, 'customer.trusted', 'customer', c.req.param('id'), { trusted });
  return c.json({ ok: true });
});

adminOps.get('/abandoned', need('orders:read'), async c => {
  const status = ['open', 'contacted', 'converted', 'dismissed'].includes(c.req.query('status') ?? '') ? c.req.query('status') : 'open';
  const r = await c.env.DB.prepare('SELECT * FROM abandoned_checkouts WHERE status = ? ORDER BY updated_at DESC LIMIT 100').bind(status).all<Record<string, unknown>>();
  return c.json(r.results.map(a => ({ ...a, address: parseJson(a.address, {}), cart: parseJson(a.cart, []) })));
});

adminOps.post('/abandoned/:id', need('orders:write'), async c => {
  const status = str((await readJson(c)).status);
  if (!['open', 'contacted', 'dismissed'].includes(status)) throw bad('Unknown status.');
  await c.env.DB.prepare(`UPDATE abandoned_checkouts SET status = ?, updated_at = ${NOW} WHERE id = ?`).bind(status, posInt(c.req.param('id'))).run();
  return c.json({ ok: true });
});

adminOps.get('/preorders', need('orders:read'), async c => {
  const r = await c.env.DB.prepare(
    `SELECT i.product_id, i.name, p.preorder_dispatch_date, COUNT(DISTINCT o.id) AS orders, SUM(i.qty) AS qty,
            SUM(CASE WHEN o.advance_status = 'paid' THEN 1 ELSE 0 END) AS advance_paid, SUM(CASE WHEN o.advance_status IN ('pending','submitted') THEN 1 ELSE 0 END) AS advance_due
       FROM order_items i JOIN orders o ON o.id = i.order_id JOIN products p ON p.id = i.product_id
      WHERE i.fulfilment_mode = 'pre_order' AND o.status NOT IN ('cancelled','returned') AND o.is_test = 0
      GROUP BY i.product_id ORDER BY p.preorder_dispatch_date`,
  ).all();
  return c.json(r.results);
});

adminOps.get('/preorders/:productId/export.csv', need('orders:read'), async c => {
  const r = await c.env.DB.prepare(
    `SELECT o.order_no, o.created_at, o.customer_name, o.phone, o.district_name, i.variant_label, i.qty, o.advance_status, o.advance_amount_paisa, o.status
       FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.product_id = ? AND i.fulfilment_mode = 'pre_order' AND o.status NOT IN ('cancelled','returned') ORDER BY o.id`,
  ).bind(posInt(c.req.param('productId'))).all<Record<string, unknown>>();
  const head = ['order_no', 'created_at', 'customer_name', 'phone', 'district_name', 'variant_label', 'qty', 'advance_status', 'advance_taka', 'status'];
  return c.body(csv([head, ...r.results.map(o => [o.order_no, o.created_at, o.customer_name, o.phone, o.district_name, o.variant_label, o.qty, o.advance_status, o.advance_amount_paisa == null ? '' : Number(o.advance_amount_paisa) / 100, o.status])]), 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="absvai-preorders.csv"' });
});

adminOps.get('/notify-requests', need('orders:read'), async c => {
  const r = await c.env.DB.prepare(
    `SELECT n.product_id, p.name, p.slug, SUM(CASE WHEN n.status = 'waiting' THEN 1 ELSE 0 END) AS waiting, SUM(CASE WHEN n.status = 'sent' THEN 1 ELSE 0 END) AS sent, MAX(n.created_at) AS last_at
       FROM notify_requests n JOIN products p ON p.id = n.product_id GROUP BY n.product_id ORDER BY waiting DESC`,
  ).all();
  return c.json(r.results);
});

export async function sendBackInSeason(env: AppEnv['Bindings'], productId: number): Promise<number> {
  const p = await env.DB.prepare('SELECT id, name, slug, fulfilment_mode FROM products WHERE id = ?').bind(productId).first<{ id: number; name: string; slug: string; fulfilment_mode: string }>();
  if (!p) return 0;
  const seasonRows = await env.DB.prepare('SELECT s.* FROM seasons s JOIN product_seasons ps ON ps.season_id = s.id WHERE ps.product_id = ?').bind(productId).all();
  const stock = await env.DB.prepare('SELECT COALESCE(SUM(stock),0) AS s FROM product_variants WHERE product_id = ? AND is_active = 1').bind(productId).first<{ s: number }>();
  const avail = productAvailability(p, seasonRows.results as never, stock?.s ?? 0, bdDate());
  if (!avail.canBuy) throw new HttpError(409, `${p.name} is not available yet (${avail.label}).`);
  const waiting = await env.DB.prepare("SELECT id, phone FROM notify_requests WHERE product_id = ? AND status = 'waiting' LIMIT 500").bind(productId).all<{ id: number; phone: string }>();
  for (const w of waiting.results) {
    await sendSms(env, { to: w.phone, body: SMS.backInSeason(p.name, `${env.SITE_URL}/p/${p.slug}`), kind: 'back_in_season' });
    await env.DB.prepare(`UPDATE notify_requests SET status = 'sent', notified_at = ${NOW} WHERE id = ?`).bind(w.id).run();
  }
  return waiting.results.length;
}

adminOps.post('/notify-requests/send', need('orders:write'), async c => {
  const productId = posInt((await readJson(c)).productId) ?? 0;
  const sent = await sendBackInSeason(c.env, productId);
  await audit(c, 'notify.send', 'product', productId, { sent });
  return c.json({ ok: true, sent });
});

adminOps.get('/wholesale', need('customers:read'), async c => c.json((await c.env.DB.prepare('SELECT * FROM wholesale_inquiries ORDER BY id DESC LIMIT 200').all()).results));
adminOps.put('/wholesale/:id', need('orders:write'), async c => {
  const status = str((await readJson(c)).status);
  if (!['new', 'contacted', 'won', 'lost'].includes(status)) throw bad('Unknown status.');
  await c.env.DB.prepare('UPDATE wholesale_inquiries SET status = ? WHERE id = ?').bind(status, posInt(c.req.param('id'))).run();
  return c.json({ ok: true });
});

// ───────────── Seasons ─────────────

adminOps.get('/seasons', need('catalog:read'), async c => {
  const today = bdDate();
  const r = await c.env.DB.prepare(
    `SELECT s.*, (SELECT COUNT(*) FROM product_seasons ps WHERE ps.season_id = s.id) AS product_count,
            (SELECT COUNT(*) FROM category_seasons cs WHERE cs.season_id = s.id) AS category_count FROM seasons s ORDER BY COALESCE(s.starts_on, '9999'), s.sort_order`,
  ).all<Record<string, unknown>>();
  return c.json(r.results.map(s => {
    const state = !s.starts_on || !s.ends_on ? 'needs_dates' : !s.is_enabled ? 'off' : String(s.ends_on) < today ? 'past' : String(s.starts_on) > today ? 'upcoming' : 'active';
    return { ...s, banners: parseJson(s.banners, []), state, daysUntil: s.starts_on && state === 'upcoming' ? daysBetween(today, String(s.starts_on)) : null, daysLeft: state === 'active' ? daysBetween(today, String(s.ends_on)) : null };
  }));
});

async function saveSeason(c: Context<AppEnv>, id: number | null) {
  const b = await readJson(c);
  const name = str(b.name, 60);
  if (!name) throw bad('Name the season.');
  const starts = str(b.startsOn, 10) || null;
  const ends = str(b.endsOn, 10) || null;
  if ((starts && !isIsoDate(starts)) || (ends && !isIsoDate(ends))) throw bad('Use real dates.');
  if (starts && ends && ends < starts) throw bad('The season must end after it starts.');
  const banners = Array.isArray(b.banners) ? (b.banners as Array<Record<string, unknown>>).slice(0, 5).map(x => ({
    headline: str(x.headline, 80), subline: str(x.subline, 160), cta_text: str(x.cta_text, 30) || 'Shop now', cta_href: str(x.cta_href, 200) || '/',
    theme: ['chili', 'turmeric', 'clove', 'leaf'].includes(String(x.theme)) ? String(x.theme) : 'chili', image: str(x.image, 300),
  })).filter(x => x.headline) : [];
  const vals = [name, starts, ends, str(b.accentLabel, 40) || null, /^#[0-9a-fA-F]{6}$/.test(str(b.accentColor)) ? str(b.accentColor) : null, JSON.stringify(banners), str(b.landingIntro, 300) || null, str(b.backInSeasonText, 40) || null, b.isEnabled === false ? 0 : 1];
  let sid = id;
  if (id) {
    await c.env.DB.prepare(`UPDATE seasons SET name = ?, starts_on = ?, ends_on = ?, accent_label = ?, accent_color = ?, banners = ?, landing_intro = ?, back_in_season_text = ?, is_enabled = ?, updated_at = ${NOW} WHERE id = ?`).bind(...vals, id).run();
  } else {
    const slug = slugify(str(b.slug, 60) || name);
    try {
      sid = (await c.env.DB.prepare('INSERT INTO seasons (name, starts_on, ends_on, accent_label, accent_color, banners, landing_intro, back_in_season_text, is_enabled, slug) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id').bind(...vals, slug).first<{ id: number }>())!.id;
    } catch { throw bad('A season with that web address already exists.'); }
  }
  await audit(c, id ? 'season.update' : 'season.create', 'season', sid, { name, starts, ends });
  await bumpCatalogVersion(c.env.DB);
  return c.json({ id: sid }, id ? 200 : 201);
}

adminOps.post('/seasons', need('seasons:write'), c => saveSeason(c, null));
adminOps.put('/seasons/:id', need('seasons:write'), c => saveSeason(c, posInt(c.req.param('id'))));
adminOps.delete('/seasons/:id', need('seasons:write'), async c => {
  const id = posInt(c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM seasons WHERE id = ?').bind(id).run();
  await audit(c, 'season.delete', 'season', id);
  await bumpCatalogVersion(c.env.DB);
  return c.json({ ok: true });
});

/** "Copy last year's seasons": seasons that have ended keep their products and banners, with dates cleared for the owner to confirm. */
adminOps.post('/seasons/copy-last-year', need('seasons:write'), async c => {
  const r = await c.env.DB.prepare(`UPDATE seasons SET starts_on = NULL, ends_on = NULL, started_notified_on = NULL, updated_at = ${NOW} WHERE ends_on IS NOT NULL AND ends_on < ?`).bind(bdDate()).run();
  await audit(c, 'season.copy_last_year', 'season', null, { reset: r.meta.changes });
  return c.json({ ok: true, reset: r.meta.changes });
});

// ───────────── Delivery zones & geo ─────────────

adminOps.get('/zones', need('settings:read'), async c => {
  const [zones, districts, overrides] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT z.*, (SELECT COUNT(*) FROM zone_districts d WHERE d.zone_id = z.id) AS district_count FROM delivery_zones z ORDER BY z.sort_order'),
    c.env.DB.prepare('SELECT d.id, d.name, dv.name AS division, zd.zone_id FROM geo_districts d JOIN geo_divisions dv ON dv.id = d.division_id LEFT JOIN zone_districts zd ON zd.district_id = d.id ORDER BY dv.name, d.name'),
    c.env.DB.prepare('SELECT o.upazila_id, o.zone_id, u.name, d.name AS district FROM zone_upazila_overrides o JOIN geo_upazilas u ON u.id = o.upazila_id JOIN geo_districts d ON d.id = u.district_id ORDER BY d.name, u.name'),
  ]);
  return c.json({ zones: zones.results, districts: districts.results, overrides: overrides.results });
});

async function saveZone(c: Context<AppEnv>, id: number | null) {
  const b = await readJson(c);
  const name = str(b.name, 60);
  if (!name) throw bad('Name the zone.');
  const money = (k: string) => { const n = int(b[k]); if (n === null || n < 0) throw bad('Charges must be 0 or more.'); return n; };
  const vals = [name, money('baseChargePaisa'), posInt(b.baseWeightGrams) ?? 1000, money('extraPerKgPaisa'), money('bulkyChargePaisa'), str(b.etaText, 40) || '3–5 days', b.isDefault ? 1 : 0, int(b.sortOrder) ?? 0];
  const stmts = b.isDefault ? [c.env.DB.prepare('UPDATE delivery_zones SET is_default = 0')] : [];
  if (id) stmts.push(c.env.DB.prepare('UPDATE delivery_zones SET name = ?, base_charge_paisa = ?, base_weight_grams = ?, extra_per_kg_paisa = ?, bulky_charge_paisa = ?, eta_text = ?, is_default = ?, sort_order = ? WHERE id = ?').bind(...vals, id));
  else stmts.push(c.env.DB.prepare('INSERT INTO delivery_zones (name, base_charge_paisa, base_weight_grams, extra_per_kg_paisa, bulky_charge_paisa, eta_text, is_default, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(...vals));
  try { await c.env.DB.batch(stmts); } catch { throw bad('A zone with that name already exists.'); }
  await audit(c, id ? 'zone.update' : 'zone.create', 'zone', id, { name });
  return c.json({ ok: true }, id ? 200 : 201);
}

adminOps.post('/zones', need('geo:write'), c => saveZone(c, null));
adminOps.put('/zones/:id', need('geo:write'), c => saveZone(c, posInt(c.req.param('id'))));
adminOps.delete('/zones/:id', need('geo:write'), async c => {
  const id = posInt(c.req.param('id'));
  const z = await c.env.DB.prepare('SELECT is_default FROM delivery_zones WHERE id = ?').bind(id).first<{ is_default: number }>();
  if (z?.is_default) throw bad('Choose another default zone first.');
  if (await c.env.DB.prepare('SELECT 1 FROM orders WHERE delivery_zone_id = ? LIMIT 1').bind(id).first()) throw bad('Orders use this zone. Move its districts instead of deleting it.');
  await c.env.DB.prepare('DELETE FROM delivery_zones WHERE id = ?').bind(id).run();
  await audit(c, 'zone.delete', 'zone', id);
  return c.json({ ok: true });
});

adminOps.put('/zones/assign-district', need('geo:write'), async c => {
  const b = await readJson(c);
  const d = posInt(b.districtId);
  const z = posInt(b.zoneId);
  if (!d) throw bad('Choose a district.');
  await c.env.DB.prepare(z ? 'INSERT INTO zone_districts (district_id, zone_id) VALUES (?, ?) ON CONFLICT(district_id) DO UPDATE SET zone_id = excluded.zone_id' : 'DELETE FROM zone_districts WHERE district_id = ?').bind(...(z ? [d, z] : [d])).run();
  await audit(c, 'zone.assign_district', 'district', d, { zone: z });
  return c.json({ ok: true });
});

adminOps.put('/zones/assign-upazila', need('geo:write'), async c => {
  const b = await readJson(c);
  const u = posInt(b.upazilaId);
  const z = posInt(b.zoneId);
  if (!u) throw bad('Choose an area.');
  await c.env.DB.prepare(z ? 'INSERT INTO zone_upazila_overrides (upazila_id, zone_id) VALUES (?, ?) ON CONFLICT(upazila_id) DO UPDATE SET zone_id = excluded.zone_id' : 'DELETE FROM zone_upazila_overrides WHERE upazila_id = ?').bind(...(z ? [u, z] : [u])).run();
  await audit(c, 'zone.assign_upazila', 'upazila', u, { zone: z });
  return c.json({ ok: true });
});

adminOps.get('/geo/summary', need('settings:read'), async c => {
  const r = await c.env.DB.prepare('SELECT match_status, COUNT(*) AS n FROM geo_postcodes GROUP BY match_status').all();
  return c.json(r.results);
});

adminOps.get('/geo/postcodes', need('settings:read'), async c => {
  const where = ['1 = 1'];
  const params: unknown[] = [];
  const status = c.req.query('status');
  if (status && ['exact', 'alias', 'fuzzy', 'unmatched', 'manual'].includes(status)) { where.push('p.match_status = ?'); params.push(status); }
  const district = posInt(c.req.query('district'));
  if (district) { where.push('p.district_id = ?'); params.push(district); }
  const q = str(c.req.query('q'), 40);
  if (q) { where.push('(p.postcode LIKE ? OR p.post_office LIKE ? OR p.source_upazila_name LIKE ?)'); params.push(`${q}%`, `%${q}%`, `%${q}%`); }
  const page = Math.max(1, Number(c.req.query('page')) || 1);
  const r = await c.env.DB.prepare(
    `SELECT p.*, d.name AS district_name, u.name AS upazila_name FROM geo_postcodes p JOIN geo_districts d ON d.id = p.district_id LEFT JOIN geo_upazilas u ON u.id = p.upazila_id
      WHERE ${where.join(' AND ')} ORDER BY d.name, p.postcode LIMIT 100 OFFSET ${(page - 1) * 100}`,
  ).bind(...params).all();
  return c.json(r.results);
});

adminOps.get('/geo/districts/:id/upazilas', need('settings:read'), async c => {
  const r = await c.env.DB.prepare('SELECT id, name, kind FROM geo_upazilas WHERE district_id = ? ORDER BY kind ASC, name').bind(posInt(c.req.param('id'))).all();
  return c.json(r.results);
});

async function checkUpazila(db: D1Database, districtId: number, upazilaId: number | null) {
  if (!upazilaId) return;
  const u = await db.prepare('SELECT district_id FROM geo_upazilas WHERE id = ?').bind(upazilaId).first<{ district_id: number }>();
  if (!u || u.district_id !== districtId) throw bad('That area is not in the postcode’s district.');
}

adminOps.put('/geo/postcodes/:id', need('geo:write'), async c => {
  const id = posInt(c.req.param('id'));
  const b = await readJson(c);
  const p = await c.env.DB.prepare('SELECT district_id FROM geo_postcodes WHERE id = ?').bind(id).first<{ district_id: number }>();
  if (!p) throw notFound();
  const upazilaId = posInt(b.upazilaId);
  await checkUpazila(c.env.DB, p.district_id, upazilaId);
  await c.env.DB.prepare(`UPDATE geo_postcodes SET upazila_id = ?, post_office = COALESCE(?, post_office), match_status = ?, match_note = 'Fixed in admin', updated_at = ${NOW} WHERE id = ?`)
    .bind(upazilaId, str(b.postOffice, 80) || null, upazilaId ? 'manual' : 'unmatched', id).run();
  await bumpGeoVersion(c.env.DB);
  await audit(c, 'geo.postcode_fix', 'postcode', id, { upazilaId });
  return c.json({ ok: true });
});

adminOps.post('/geo/postcodes/bulk-assign', need('geo:write'), async c => {
  const b = await readJson(c);
  const ids = Array.isArray(b.ids) ? (b.ids as unknown[]).map(Number).filter(Number.isInteger).slice(0, 200) : [];
  const upazilaId = posInt(b.upazilaId);
  if (!ids.length || !upazilaId) throw bad('Choose postcodes and an area.');
  const u = await c.env.DB.prepare('SELECT district_id FROM geo_upazilas WHERE id = ?').bind(upazilaId).first<{ district_id: number }>();
  if (!u) throw bad('Unknown area.');
  const r = await c.env.DB.prepare(`UPDATE geo_postcodes SET upazila_id = ?, match_status = 'manual', match_note = 'Bulk-assigned in admin', updated_at = ${NOW} WHERE id IN (${ids.map(() => '?').join(',')}) AND district_id = ?`).bind(upazilaId, ...ids, u.district_id).run();
  await bumpGeoVersion(c.env.DB);
  await audit(c, 'geo.postcode_bulk', 'upazila', upazilaId, { ids });
  return c.json({ ok: true, updated: r.meta.changes });
});

adminOps.post('/geo/postcodes', need('geo:write'), async c => {
  const b = await readJson(c);
  const postcode = str(b.postcode, 4);
  if (!/^\d{4}$/.test(postcode)) throw bad('Postcodes have 4 digits.');
  const office = str(b.postOffice, 80);
  if (!office) throw bad('Add the post office name.');
  const d = await c.env.DB.prepare('SELECT id, division_id FROM geo_districts WHERE id = ?').bind(posInt(b.districtId)).first<{ id: number; division_id: number }>();
  if (!d) throw bad('Choose the district.');
  const upazilaId = posInt(b.upazilaId);
  await checkUpazila(c.env.DB, d.id, upazilaId);
  await c.env.DB.prepare("INSERT INTO geo_postcodes (postcode, post_office, division_id, district_id, upazila_id, match_status, match_note) VALUES (?, ?, ?, ?, ?, ?, 'Added in admin')")
    .bind(postcode, office, d.division_id, d.id, upazilaId, upazilaId ? 'manual' : 'unmatched').run();
  await bumpGeoVersion(c.env.DB);
  await audit(c, 'geo.postcode_add', 'postcode', postcode);
  return c.json({ ok: true }, 201);
});

adminOps.get('/courier-areas', need('settings:read'), async c => {
  const courier = str(c.req.query('courier'), 30) || 'steadfast';
  const district = posInt(c.req.query('district'));
  if (!district) return c.json([]);
  const r = await c.env.DB.prepare(
    `SELECT u.id AS upazila_id, u.name, m.courier_city_id, m.courier_zone_id, m.courier_area_id, m.label FROM geo_upazilas u
       LEFT JOIN courier_area_map m ON m.upazila_id = u.id AND m.courier = ? WHERE u.district_id = ? ORDER BY u.kind ASC, u.name`,
  ).bind(courier, district).all();
  return c.json(r.results);
});

adminOps.put('/courier-areas', need('geo:write'), async c => {
  const b = await readJson(c);
  const courier = str(b.courier, 30);
  const upazilaId = posInt(b.upazilaId);
  if (!courier || !upazilaId) throw bad('Choose the courier and area.');
  await c.env.DB.prepare(
    `INSERT INTO courier_area_map (courier, upazila_id, courier_city_id, courier_zone_id, courier_area_id, label) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(courier, upazila_id) DO UPDATE SET courier_city_id = excluded.courier_city_id, courier_zone_id = excluded.courier_zone_id, courier_area_id = excluded.courier_area_id, label = excluded.label, updated_at = ${NOW}`,
  ).bind(courier, upazilaId, str(b.cityId, 20) || null, str(b.zoneId, 20) || null, str(b.areaId, 20) || null, str(b.label, 80) || null).run();
  await audit(c, 'courier.map', 'upazila', upazilaId, { courier });
  return c.json({ ok: true });
});

// ───────────── Synonyms, settings, inventory, outbox, audit ─────────────

adminOps.get('/synonyms', need('catalog:read'), async c => c.json((await c.env.DB.prepare('SELECT * FROM search_synonyms ORDER BY group_key, term').all()).results));
adminOps.post('/synonyms', need('catalog:write'), async c => {
  const b = await readJson(c);
  const group = slugify(str(b.groupKey, 40)).replace(/-/g, '_');
  const term = str(b.term, 60).toLowerCase();
  if (!group || !term) throw bad('Enter the group and the search word.');
  try { await c.env.DB.prepare('INSERT INTO search_synonyms (group_key, term) VALUES (?, ?)').bind(group, term).run(); } catch { throw bad('That word is already in a group.'); }
  await audit(c, 'synonym.add', 'synonym', term, { group });
  return c.json({ ok: true }, 201);
});
adminOps.delete('/synonyms/:id', need('catalog:write'), async c => {
  await c.env.DB.prepare('DELETE FROM search_synonyms WHERE id = ?').bind(posInt(c.req.param('id'))).run();
  return c.json({ ok: true });
});

const EDITABLE_SETTINGS = ['store_name', 'tagline', 'announcement', 'free_delivery_threshold_paisa', 'free_delivery_excludes_bulky', 'cod_fee_paisa', 'advance_high_value_threshold_paisa',
  'support_phone', 'whatsapp_number', 'messenger_page', 'manual_wallets', 'map_tile_url', 'map_tile_attribution', 'company_name', 'company_address', 'default_banners', 'promo_banner', 'pixel_id', 'ga4_id'];

adminOps.get('/settings', need('settings:read'), async c => {
  const s = await loadSettings(c.env.DB);
  return c.json(Object.fromEntries(EDITABLE_SETTINGS.map(k => [k, s[k] ?? ''])));
});

adminOps.put('/settings', need('settings:write'), async c => {
  const b = await readJson(c);
  const stmts: D1PreparedStatement[] = [];
  for (const [k, v] of Object.entries(b)) {
    if (!EDITABLE_SETTINGS.includes(k)) continue;
    const value = str(v, 4000);
    if (/_paisa$/.test(k) && !/^\d+$/.test(value)) throw bad(`${k.replace(/_/g, ' ')} must be a whole number.`);
    if (['manual_wallets', 'default_banners', 'promo_banner'].includes(k)) { try { JSON.parse(value || 'null'); } catch { throw bad(`${k} is not valid.`); } }
    if (k === 'map_tile_url' && value && !/^https:\/\/[^\s]+\{z\}[^\s]*\{x\}[^\s]*\{y\}/.test(value)) throw bad('Map tile URL must be https and contain {z}, {x} and {y}.');
    stmts.push(c.env.DB.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ${NOW}) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(k, value));
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  await bumpCatalogVersion(c.env.DB);
  await audit(c, 'settings.update', 'settings', null, Object.keys(b));
  return c.json({ ok: true });
});

adminOps.post('/inventory/adjust', need('catalog:write'), async c => {
  const b = await readJson(c);
  const variantId = posInt(b.variantId);
  const change = int(b.change);
  const reason = ['receive', 'adjust', 'return'].includes(str(b.reason)) ? str(b.reason) : 'adjust';
  if (!variantId || !change) throw bad('Enter the option and how many to add or remove.');
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE product_variants SET stock = stock + ?, updated_at = ${NOW} WHERE id = ?`).bind(change, variantId),
      c.env.DB.prepare('INSERT INTO inventory_log (variant_id, change, reason, batch_no, note, admin_id) VALUES (?, ?, ?, ?, ?, ?)').bind(variantId, change, reason, str(b.batchNo, 60) || null, str(b.note, 300) || null, c.var.session.adminId),
    ]);
  } catch (e) {
    if (/CHECK/.test(String(e))) throw bad('Stock cannot go below zero.');
    throw e;
  }
  await audit(c, 'inventory.adjust', 'variant', variantId, { change, reason });
  await bumpCatalogVersion(c.env.DB);
  return c.json({ ok: true });
});

adminOps.get('/inventory', need('catalog:read'), async c => {
  const r = await c.env.DB.prepare(
    `SELECT v.id, v.sku, v.stock, v.attributes, p.name, p.id AS product_id, p.status, p.fulfilment_mode FROM product_variants v JOIN products p ON p.id = v.product_id
      WHERE v.is_active = 1 AND p.deleted_at IS NULL ORDER BY v.stock ASC, p.name LIMIT 300`,
  ).all<Record<string, unknown>>();
  return c.json(r.results.map(v => ({ ...v, attributes: parseJson(v.attributes, {}) })));
});

adminOps.get('/inventory/log', need('catalog:read'), async c => {
  const v = posInt(c.req.query('variantId'));
  const batch = str(c.req.query('batch'), 60);
  const r = await c.env.DB.prepare(
    `SELECT l.*, v.sku, a.name AS admin_name FROM inventory_log l JOIN product_variants v ON v.id = l.variant_id LEFT JOIN admins a ON a.id = l.admin_id
      WHERE ${v ? 'l.variant_id = ?' : batch ? 'l.batch_no = ?' : '1 = 1'} ORDER BY l.id DESC LIMIT 200`,
  ).bind(...(v ? [v] : batch ? [batch] : [])).all();
  return c.json(r.results);
});

adminOps.get('/sms-outbox', need('orders:read'), async c => c.json((await c.env.DB.prepare('SELECT * FROM sms_outbox ORDER BY id DESC LIMIT 100').all()).results));

adminOps.get('/audit', need('audit:read'), async c => {
  const page = Math.max(1, Number(c.req.query('page')) || 1);
  const r = await c.env.DB.prepare(`SELECT l.*, a.name AS admin_name FROM audit_log l LEFT JOIN admins a ON a.id = l.admin_id ORDER BY l.id DESC LIMIT 100 OFFSET ${(page - 1) * 100}`).all();
  return c.json(r.results);
});
