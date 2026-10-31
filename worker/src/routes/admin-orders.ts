/**
 * Admin orders: the eight-stage pipeline, bulk actions, manual/social orders, incomplete-order recovery, returns
 * scanning and warehouse printing (bulk invoices, packing slips, picking list, barcode labels).
 */
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../env';
import { can } from '../lib/auth';
import { bdDate } from '../lib/dates';
import { bad, HttpError, int, notFound, parseJson, posInt, readJson, str } from '../lib/http';
import { buildInvoicePdf } from '../lib/invoice';
import { formatTaka } from '../lib/money';
import { extractPhones, localPhone, maskPhone, normalizeBdPhone, phonePrefixRange } from '../lib/phone';
import { labelsHtml, pickingListHtml, PRINT_CSP } from '../lib/print';
import { buildSlipsPdf, type SlipData } from '../lib/slips';
import { confirmBlockers, isOrderStatus, nextStatuses, RETURN_REASONS, STAGE_MEANING, STATUS_LABELS, SUB_STATUSES, type OrderStatus } from '../lib/state-machine';
import { adminExists } from '../repo/admins';
import { incompleteCountForPhone } from '../repo/customers';
import { assignIncomplete, incompleteById, listIncomplete, recoveryReport, setIncompleteStatus } from '../repo/incomplete';
import { searchVariants, variantsForLabels } from '../repo/inventory';
import {
  addOrderEvent, assignOrders, customerByPhone, exportOrders, listOrders, logCall, orderById, orderDetail, ordersWithItems, pickingList, preorderExport, preorderSummary,
  previousAddresses, recentOrdersForPhone, rejectAdvance, releaseHold, setCourierInfo, setDeliveryCharge, setSubStatus, setTestFlag, verifyAdvance, type OrderFilters, type Row,
} from '../repo/orders';
import { quote } from '../services/checkout';
import { sanitizeLines } from '../services/cart';
import { blockValue } from '../services/fraud';
import { changeStatus, COURIERS, courierLabel, MANUAL_SOURCES, ORDER_SOURCES, placeOrder, receiveReturnScan } from '../services/orders';
import { allowed, audit, need, needAny } from './admin-helpers';
import { settingsOf } from './context';

export const adminOrders = new Hono<AppEnv>();

function csv(rows: unknown[][]): string {
  return rows.map(r => r.map(v => { const s = v === null || v === undefined ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\r\n') + '\r\n';
}

const encodeCursor = (createdAt: string, id: number) => btoa(`${createdAt}|${id}`).replace(/=+$/, '');
function decodeCursor(raw: string | undefined): { createdAt: string; id: number } | null {
  if (!raw) return null;
  try {
    const [createdAt, id] = atob(raw).split('|');
    return /^\d{4}-\d\d-\d\dT/.test(createdAt) && Number.isInteger(Number(id)) ? { createdAt, id: Number(id) } : null;
  } catch { return null; }
}

/** Sales agents see full phone numbers only on orders assigned to them (Section 14). */
function phoneFor(c: Context<AppEnv>, o: Row): string {
  const phone = String(o.phone);
  if (c.var.session.role !== 'order_processor' || o.assigned_to === c.var.session.adminId) return localPhone(phone);
  return maskPhone(phone);
}

function filtersFrom(c: Context<AppEnv>): OrderFilters {
  const f: OrderFilters = {};
  const status = c.req.query('status');
  if (status === 'held') f.status = 'held';
  else if (isOrderStatus(status)) f.status = status;
  const risk = c.req.query('risk');
  if (risk && ['low', 'medium', 'high'].includes(risk)) f.risk = risk;
  const adv = c.req.query('advance');
  if (adv && ['pending', 'submitted', 'paid'].includes(adv)) f.advance = adv;
  if (c.req.query('fulfilment') === 'pre_order') f.preOrder = true;
  const source = c.req.query('source');
  if (source && source in ORDER_SOURCES) f.source = source;
  const assigned = c.req.query('assigned');
  if (assigned === 'me') f.assignedTo = c.var.session.adminId;
  else if (assigned === 'unassigned') f.assignedTo = '';
  else if (assigned && /^[\w-]{8,64}$/.test(assigned)) f.assignedTo = assigned;
  const q = str(c.req.query('q'), 60);
  if (q) {
    const range = phonePrefixRange(q);
    const upper = q.toUpperCase();
    if (range) f.phoneRange = range;
    else if (/^(AV|PRE)-/.test(upper)) f.numberPrefix = [upper, `${upper}￿`, 'order_no'];
    else if (/^INV-/.test(upper)) f.numberPrefix = [upper, `${upper}￿`, 'invoice_no'];
    else f.namePrefix = q;
  }
  return f;
}

// ───────────── Pipeline ─────────────

adminOrders.get('/orders', need('orders:read'), async c => {
  const limit = Math.min(Number(c.req.query('limit')) || 50, 200);
  const rows = await listOrders(c.env.DB, filtersFrom(c), decodeCursor(c.req.query('cursor')), limit);
  const items = rows.map(o => ({ ...o, phone: phoneFor(c, o), risk_reasons: parseJson(o.risk_reasons, []) }));
  const last = rows[rows.length - 1];
  return c.json({ items, nextCursor: rows.length === limit && last ? encodeCursor(String(last.created_at), Number(last.id)) : null });
});

adminOrders.get('/orders/export.csv', need('orders:export'), async c => {
  const rows = await exportOrders(c.env.DB, filtersFrom(c));
  const head = Object.keys(rows[0] ?? { order_no: '' });
  await audit(c, 'orders.export', 'order', null, { rows: rows.length });
  return c.body(csv([head, ...rows.map(o => head.map(h => (h === 'phone' ? localPhone(String(o.phone)) : /_paisa$/.test(h) && o[h] != null ? Number(o[h]) / 100 : o[h])))]), 200, {
    'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="absvai-orders-${bdDate()}.csv"`,
  });
});

adminOrders.get('/orders/meta', need('orders:read'), c => c.json({
  stages: Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label, meaning: STAGE_MEANING[value as OrderStatus] })),
  subStatuses: SUB_STATUSES, returnReasons: RETURN_REASONS, sources: ORDER_SOURCES, manualSources: MANUAL_SOURCES, couriers: COURIERS,
}));

adminOrders.get('/orders/:id', need('orders:read'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const d = await orderDetail(c.env.DB, id);
  if (!d) throw notFound();
  const o = d.order;
  const hasCall = d.events.some(e => e.kind === 'call' && e.outcome === 'confirmed');
  return c.json({
    order: { ...o, phone: phoneFor(c, o), utm: parseJson(o.utm, {}), risk_reasons: parseJson(o.risk_reasons, []) },
    items: d.items, events: d.events, payments: d.payments, riskFlags: d.riskFlags, sms: d.sms, customer: d.customer ? { ...d.customer, phone: phoneFor(c, o) } : null,
    assignee: d.assignee, creator: d.creator,
    nextStatuses: nextStatuses(o.status as OrderStatus).map(s => ({ value: s, label: STATUS_LABELS[s] })),
    subStatuses: SUB_STATUSES[o.status as OrderStatus] ?? null,
    confirmBlockers: confirmBlockers({
      paymentMethod: String(o.payment_method), otpVerifiedAt: (o.otp_verified_at as string) ?? null, hasConfirmedCall: hasCall,
      advanceRequired: Boolean(o.advance_required), advanceStatus: String(o.advance_status), deliveryChargeStatus: o.delivery_charge_status as 'final', holdReason: (o.hold_reason as string) ?? null,
    }),
  });
});

/** Packing and handing over are warehouse work; everything else needs order rights. */
function mayMove(c: Context<AppEnv>, to: OrderStatus): boolean {
  return allowed(c, 'orders:write') || (allowed(c, 'orders:pack') && (to === 'packed' || to === 'in_courier'));
}

function transitionBody(b: Record<string, unknown>) {
  const returned: Record<string, number> = {};
  if (b.returned && typeof b.returned === 'object') for (const [k, v] of Object.entries(b.returned as Record<string, unknown>)) returned[k] = Number(v) || 0;
  return {
    note: str(b.note, 500) || null, courier: str(b.courier, 30) || null, trackingId: str(b.trackingId, 60) || null,
    cancelReason: str(b.cancelReason, 300) || null, returnReason: str(b.returnReason, 30) || null, returned,
  };
}

adminOrders.post('/orders/:id/status', needAny('orders:write', 'orders:pack'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const b = await readJson(c);
  const to = str(b.to);
  if (!isOrderStatus(to)) throw bad('Unknown stage.');
  if (!mayMove(c, to)) throw new HttpError(403, 'Your role can pack orders and hand them to the courier, but not make this change.');
  const opts = transitionBody(b);
  if (opts.courier && !(opts.courier in COURIERS)) throw bad('Unknown courier.');
  const r = await changeStatus(c.env, id, to, { actor: 'staff', adminId: c.var.session.adminId, ...opts });
  await audit(c, 'order.status', 'order', id, { to });
  return c.json({ ok: true, ...r });
});

adminOrders.post('/orders/bulk', needAny('orders:write', 'orders:pack'), async c => {
  const b = await readJson(c);
  const ids = Array.isArray(b.ids) ? (b.ids as unknown[]).map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 500) : [];
  const to = str(b.to);
  if (!ids.length || !isOrderStatus(to)) throw bad('Choose orders and a stage.');
  if (!mayMove(c, to)) throw new HttpError(403, 'Your role can pack orders and hand them to the courier, but not make this change.');
  const courier = str(b.courier, 30) || null;
  if (courier && !(courier in COURIERS)) throw bad('Unknown courier.');
  const tracking = (b.trackingIds ?? {}) as Record<string, string>;
  const results: Array<{ id: number; ok: boolean; message?: string }> = [];
  for (const id of ids) {
    try {
      await changeStatus(c.env, id, to, { actor: 'staff', adminId: c.var.session.adminId, courier, trackingId: str(tracking[String(id)], 60) || null, cancelReason: str(b.cancelReason, 300) || null, returnReason: str(b.returnReason, 30) || null });
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, message: (e as Error).message });
    }
  }
  await audit(c, 'order.bulk_status', 'order', null, { to, ids, ok: results.filter(r => r.ok).length });
  return c.json({ results, summary: `${results.filter(r => r.ok).length} updated · ${results.filter(r => !r.ok).length} failed` });
});

adminOrders.post('/orders/:id/call', need('orders:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const b = await readJson(c);
  const outcome = str(b.outcome);
  if (!['confirmed', 'no_answer', 'wrong_number', 'cancel_requested', 'call_back'].includes(outcome)) throw bad('Choose how the call went.');
  if (!(await orderById(c.env.DB, id))) throw notFound();
  await logCall(c.env.DB, id, outcome, str(b.note, 500) || null, c.var.session.adminId);
  await audit(c, 'order.call', 'order', id, { outcome });
  return c.json({ ok: true });
});

adminOrders.post('/orders/:id/advance', need('orders:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const b = await readJson(c);
  const o = await orderById(c.env.DB, id);
  if (!o) throw notFound();
  if (!o.advance_required) throw bad('This order has no advance.');
  if (b.action === 'reject') await rejectAdvance(c.env.DB, id, c.var.session.adminId, str(b.note, 200) || 'transaction not found');
  else {
    const amount = posInt(b.amountPaisa) ?? Number(o.advance_amount_paisa);
    if (!amount) throw bad('Enter the amount received.');
    await verifyAdvance(c.env.DB, o, amount, amount >= Number(o.total_paisa) ? 'paid' : 'partially_paid', c.var.session.adminId, `Advance of ${formatTaka(amount)} verified`);
  }
  await audit(c, 'order.advance', 'order', id, { action: b.action ?? 'verify' });
  return c.json({ ok: true });
});

/** For heavy/bulky items marked "confirm by phone": set the charge, then the order can be confirmed. */
adminOrders.post('/orders/:id/delivery-charge', need('orders:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const b = await readJson(c);
  const charge = int(b.chargePaisa);
  if (charge === null || charge < 0) throw bad('Enter the delivery charge.');
  const o = await orderById(c.env.DB, id);
  if (!o) throw notFound();
  if (o.status !== 'new') throw bad('The delivery charge can only change before the order is confirmed.');
  const total = Number(o.subtotal_paisa) + charge + Number(o.cod_fee_paisa) - Number(o.discount_paisa);
  const advance = o.advance_required && o.advance_amount_paisa === null ? charge : (o.advance_amount_paisa as number | null);
  await setDeliveryCharge(c.env.DB, id, charge, total, advance, c.var.session.adminId, `Delivery charge set to ${formatTaka(charge)}`);
  await audit(c, 'order.delivery_charge', 'order', id, { charge });
  return c.json({ ok: true });
});

adminOrders.post('/orders/:id/note', need('orders:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const note = str((await readJson(c)).note, 1000);
  if (!note) throw bad('Write a note.');
  await addOrderEvent(c.env.DB, { orderId: id, kind: 'note', note, adminId: c.var.session.adminId });
  return c.json({ ok: true });
});

/** Test orders never count in reports and must never fire a Purchase event. */
adminOrders.post('/orders/:id/test', need('orders:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const isTest = Boolean((await readJson(c)).isTest);
  await setTestFlag(c.env.DB, id, isTest);
  await audit(c, 'order.test_flag', 'order', id, { isTest });
  return c.json({ ok: true });
});

adminOrders.post('/orders/:id/merge', need('orders:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const o = await orderById(c.env.DB, id);
  if (!o?.duplicate_of_order_id) throw bad('This order is not marked as a possible duplicate.');
  const target = await orderById(c.env.DB, Number(o.duplicate_of_order_id));
  await changeStatus(c.env, id, 'cancelled', { actor: 'staff', adminId: c.var.session.adminId, cancelReason: `Duplicate of ${target?.order_no}` });
  await audit(c, 'order.merge', 'order', id, { into: o.duplicate_of_order_id });
  return c.json({ ok: true });
});

adminOrders.post('/orders/:id/release-hold', need('orders:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const note = str((await readJson(c)).note, 300);
  if (!note) throw bad('Write why the hold can be released, e.g. "Called the customer, both orders are wanted".');
  const o = await orderById(c.env.DB, id);
  if (!o?.hold_reason) throw bad('This order is not on hold.');
  await releaseHold(c.env.DB, id, c.var.session.adminId, note);
  await audit(c, 'order.release_hold', 'order', id, { note });
  return c.json({ ok: true });
});

/** Block the order's phone, device or connection from the order screen (Security → Block list to undo). */
adminOrders.post('/orders/:id/block', need('security:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const b = await readJson(c);
  const o = await orderById(c.env.DB, id);
  if (!o) throw notFound();
  const type = str(b.type);
  const reason = str(b.reason, 200);
  if (!reason) throw bad('Write the reason for the block.');
  const days = posInt(b.days);
  let value: string | null = null;
  let hint: string | null = null;
  if (type === 'phone') { value = String(o.phone); hint = maskPhone(String(o.phone)); }
  else if (type === 'device') { value = (o.device_hash as string) ?? null; hint = value ? `device ${value.slice(0, 6)}…` : null; }
  else if (type === 'ip') { value = (o.ip_hash as string) ?? null; hint = value ? `connection ${value.slice(0, 6)}…` : null; }
  else throw bad('Choose phone, device or connection.');
  if (!value) throw bad('This order has no device or connection recorded.');
  // IP blocks expire by default: many customers share one mobile-network IP.
  const expiresAt = type === 'ip' ? new Date(Date.now() + (days ?? 1) * 86_400_000).toISOString() : days ? new Date(Date.now() + days * 86_400_000).toISOString() : null;
  const blockId = await blockValue(c.env, { type, value, hint, reason, expiresAt, adminId: c.var.session.adminId, alreadyHashed: type !== 'phone' });
  await audit(c, 'security.block', 'block_list', blockId, { type, hint, reason, expiresAt, fromOrder: o.order_no });
  return c.json({ ok: true, id: blockId });
});

adminOrders.post('/orders/assign', need('orders:write'), async c => {
  const b = await readJson(c);
  const ids = Array.isArray(b.ids) ? (b.ids as unknown[]).map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 500) : [];
  const adminId = str(b.adminId, 64) || null;
  if (!ids.length) throw bad('Choose orders.');
  if (adminId && !(await adminExists(c.env.DB, adminId))) throw bad('Choose an active staff member.');
  // Agents can only claim orders for themselves.
  if (c.var.session.role === 'order_processor' && adminId !== c.var.session.adminId) throw new HttpError(403, 'You can claim orders for yourself only.');
  const n = await assignOrders(c.env.DB, ids, adminId);
  await audit(c, 'order.assign', 'order', null, { ids, adminId });
  return c.json({ ok: true, updated: n });
});

adminOrders.post('/orders/:id/courier', needAny('orders:write', 'orders:pack'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const b = await readJson(c);
  const o = await orderById(c.env.DB, id);
  if (!o) throw notFound();
  const courier = str(b.courier, 30) || null;
  if (courier && !(courier in COURIERS)) throw bad('Unknown courier.');
  const sub = str(b.subStatus, 30);
  if (sub) {
    if (!(SUB_STATUSES[o.status as OrderStatus] ?? {})[sub]) throw bad('That courier status does not apply to this stage.');
    await setSubStatus(c.env.DB, id, sub, c.var.session.adminId);
  }
  if (courier || b.trackingId) await setCourierInfo(c.env.DB, id, courier, str(b.trackingId, 60) || null);
  await audit(c, 'order.courier', 'order', id, { courier, sub });
  return c.json({ ok: true });
});

// ───────────── Warehouse: returns scan ─────────────

adminOrders.post('/returns/scan', needAny('orders:write', 'orders:pack', 'inventory:write'), async c => {
  const code = str((await readJson(c)).code, 80);
  const r = await receiveReturnScan(c.env, code, c.var.session.adminId);
  await audit(c, 'return.received', 'order', r.orderId, { restocked: r.restocked });
  return c.json({ ok: true, ...r, message: `${r.orderNo} received.${r.restocked.length ? ` Back in stock: ${r.restocked.map(x => `${x.sku} × ${x.qty}`).join(', ')}.` : ''}` });
});

// ───────────── Printing ─────────────

async function slipData(c: Context<AppEnv>, ids: number[]): Promise<SlipData[]> {
  const s = await settingsOf(c);
  const list = await ordersWithItems(c.env.DB, ids);
  return list.filter(x => x.order.invoice_no).map(({ order: o, items }) => {
    const advance = o.advance_status === 'paid' ? Number(o.advance_amount_paisa ?? 0) : 0;
    return {
      invoiceNo: String(o.invoice_no), orderNo: String(o.order_no), issuedAt: String(o.issued_at ?? o.confirmed_at ?? o.created_at),
      company: { name: s.store_name || 'Abs Vai', phone: s.support_phone ?? '' },
      customer: {
        name: String(o.customer_name), phone: localPhone(String(o.phone)),
        address: [String(o.address_line), [o.landmark ? `Near ${o.landmark}` : '', o.union_name].filter(Boolean).join(', '), `${o.upazila_name}, ${o.district_name}${o.postcode ? ` ${o.postcode}` : ''}`].filter(Boolean),
      },
      items: items.map(i => ({ sku: String(i.sku), name: String(i.name), variant: (i.variant_label as string) ?? null, qty: Number(i.qty), totalPaisa: Number(i.line_total_paisa) })),
      totalPaisa: Number(o.total_paisa), duePaisa: o.payment_status === 'paid' ? 0 : Math.max(0, Number(o.total_paisa) - advance),
      paymentMethod: String(o.payment_method), courier: o.courier ? courierLabel(String(o.courier)) : null, trackingId: (o.tracking_id as string) ?? null, note: (o.customer_note as string) ?? null,
    };
  });
}

const idsParam = (raw: string | undefined, max = 500) => (raw ?? '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, max);

adminOrders.get('/orders/:id/invoice.pdf', need('orders:read'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const [x] = await ordersWithItems(c.env.DB, [id]);
  if (!x) throw notFound();
  const o = x.order;
  if (!o.invoice_no) throw bad('The invoice is created when the order is confirmed.');
  const s = await settingsOf(c);
  const pdf = buildInvoicePdf({
    invoiceNo: String(o.invoice_no), issuedAt: String(o.issued_at ?? o.confirmed_at), orderNo: String(o.order_no),
    company: { name: s.store_name ?? 'Abs Vai', legalName: s.company_name ?? 'ABS VAI LTD', address: s.company_address ?? '', phone: s.support_phone ?? '', site: 'absvai.com' },
    customer: {
      name: String(o.customer_name), phone: localPhone(String(o.phone)),
      address: [String(o.address_line), [o.landmark ? `Near ${o.landmark}` : '', o.union_name].filter(Boolean).join(', '), `${o.upazila_name}, ${o.district_name}, ${o.division_name} Division${o.postcode ? ` ${o.postcode}` : ''}`].filter(Boolean),
    },
    paymentMethod: String(o.payment_method), paymentStatus: String(o.payment_status), advancePaidPaisa: o.advance_status === 'paid' ? Number(o.advance_amount_paisa ?? 0) : 0,
    items: x.items.map(i => ({ sku: String(i.sku), name: String(i.name), variant: (i.variant_label as string) ?? null, qty: Number(i.qty), unitPaisa: Number(i.unit_price_paisa), totalPaisa: Number(i.line_total_paisa) })),
    subtotalPaisa: Number(o.subtotal_paisa), deliveryPaisa: o.delivery_charge_paisa === null ? null : Number(o.delivery_charge_paisa), codFeePaisa: Number(o.cod_fee_paisa),
    discountPaisa: Number(o.discount_paisa), totalPaisa: Number(o.total_paisa),
  });
  return c.body(pdf, 200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${o.invoice_no}.pdf"`, 'Cache-Control': 'private, no-store' });
});

/** Bulk invoices or packing slips: A4 (two per page) or 4×6 thermal, with invoice and tracking barcodes. */
adminOrders.get('/print/slips.pdf', need('orders:read'), async c => {
  const ids = idsParam(c.req.query('ids'));
  if (!ids.length) throw bad('Choose the orders to print.');
  const slips = await slipData(c, ids);
  if (!slips.length) throw bad('Only confirmed orders have invoices. Confirm the orders first.');
  const layout = c.req.query('layout') === 'thermal' ? 'thermal' : 'a4';
  const kind = c.req.query('kind') === 'packing_slip' ? 'packing_slip' : 'invoice';
  await audit(c, 'print.slips', 'order', null, { count: slips.length, layout, kind });
  return c.body(buildSlipsPdf(slips, layout, kind), 200, {
    'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="absvai-${kind === 'invoice' ? 'invoices' : 'packing-slips'}-${bdDate()}.pdf"`, 'Cache-Control': 'private, no-store',
  });
});

adminOrders.get('/print/picking-list', need('orders:read'), async c => {
  const ids = idsParam(c.req.query('ids'));
  if (!ids.length) throw bad('Choose the orders to pick.');
  const rows = await pickingList(c.env.DB, ids);
  const html = pickingListHtml(rows as never, ids.length, new Date(Date.now() + 6 * 3_600_000).toISOString().replace('T', ' ').slice(0, 16));
  return c.html(html, 200, { 'Content-Security-Policy': PRINT_CSP, 'Cache-Control': 'private, no-store' });
});

adminOrders.get('/print/labels', need('catalog:read'), async c => {
  const ids = idsParam(c.req.query('variants'), 200);
  if (!ids.length) throw bad('Choose the options to print labels for.');
  const copies = Math.min(Math.max(Number(c.req.query('copies')) || 1, 1), 100);
  const rows = await variantsForLabels(c.env.DB, ids);
  const labels = rows.flatMap(r => Array.from({ length: copies }, () => ({ name: String(r.name), variant: Object.values(parseJson<Record<string, string>>(r.attributes, {})).join(' · '), pricePaisa: Number(r.price_paisa), sku: String(r.sku) })));
  return c.html(labelsHtml(labels, c.req.query('layout') === 'thermal' ? 'thermal' : 'a4'), 200, { 'Content-Security-Policy': PRINT_CSP, 'Cache-Control': 'private, no-store' });
});

// ───────────── Manual / social orders ─────────────

/** Phone first: history, risk, previous addresses and open incomplete checkouts for that number. */
adminOrders.get('/customers/lookup', need('orders:read'), async c => {
  const phone = normalizeBdPhone(c.req.query('phone'));
  if (!phone) throw bad('Enter a Bangladeshi mobile number like 01712345678.');
  const [customer, orders, addresses, incomplete] = await Promise.all([
    customerByPhone(c.env.DB, phone), recentOrdersForPhone(c.env.DB, phone), previousAddresses(c.env.DB, phone), incompleteCountForPhone(c.env.DB, phone),
  ]);
  let risk: { level: string; reasons: string[] } = { level: 'low', reasons: ['New customer'] };
  if (customer) {
    const done = customer.delivered_count + customer.returned_count;
    const rate = done ? Math.round((customer.delivered_count / done) * 100) : null;
    const reasons = [`${customer.order_count} order(s), ${customer.delivered_count} delivered, ${customer.returned_count} refused or returned${rate !== null ? ` (${rate}% delivered)` : ''}`];
    risk = { level: customer.returned_count >= 2 || (rate !== null && rate < 50) ? 'high' : customer.returned_count > 0 || (rate !== null && rate < 80) ? 'medium' : 'low', reasons };
    if (customer.is_trusted) risk.reasons.push('Marked trusted');
  }
  return c.json({ phone: localPhone(phone), customer, risk, orders, addresses, incompleteCount: incomplete });
});

adminOrders.get('/variants/search', need('orders:read'), async c => {
  const q = str(c.req.query('q'), 60);
  if (q.length < 2) return c.json([]);
  const rows = await searchVariants(c.env.DB, q, new Date().toISOString());
  return c.json(rows.map(r => ({ ...r, attributes: parseJson(r.attributes, {}), label: Object.values(parseJson<Record<string, string>>(r.attributes, {})).join(' · ') })));
});

/** "Paste chat" helper: finds phone numbers in a pasted Messenger/WhatsApp conversation for staff to confirm. */
adminOrders.post('/tools/extract-phones', need('orders:write'), async c => {
  const text = str((await readJson(c)).text, 20_000);
  return c.json({ phones: extractPhones(text).map(localPhone) });
});

function manualInput(b: Record<string, unknown>) {
  return {
    phone: str(b.phone, 20), name: str(b.name, 120),
    divisionId: int(b.divisionId) ?? 0, districtId: int(b.districtId) ?? 0, upazilaId: int(b.upazilaId) ?? 0, unionId: posInt(b.unionId),
    postcode: str(b.postcode, 4) || null, addressLine: str(b.addressLine, 300), landmark: str(b.landmark, 200) || null, note: str(b.note, 500) || null,
    paymentMethod: (b.paymentMethod === 'manual_mobile' ? 'manual_mobile' : 'cod') as 'cod' | 'manual_mobile',
    advanceTrxId: str(b.advanceTrxId, 40) || null, advanceWallet: str(b.advanceWallet, 20) || null,
    lines: sanitizeLines(b.lines), source: str(b.source, 30), sourceDetail: str(b.sourceDetail, 200) || null, utm: {},
    email: str(b.email, 120) || null,
  };
}

adminOrders.post('/orders/quote', need('orders:write'), async c => {
  const b = await readJson(c);
  const phone = normalizeBdPhone(str(b.phone));
  const cust = phone ? await customerByPhone(c.env.DB, phone) : null;
  return c.json(await quote(c.env.DB, await settingsOf(c), {
    lines: sanitizeLines(b.lines), districtId: posInt(b.districtId), upazilaId: posInt(b.upazilaId), paymentMethod: b.paymentMethod === 'manual_mobile' ? 'manual_mobile' : 'cod',
    customerIsNewOrRisky: !cust || cust.delivered_count === 0 || cust.returned_count > 0, discountPaisa: Math.max(0, int(b.discountPaisa) ?? 0),
  }));
});

/**
 * A Facebook/Messenger/WhatsApp/phone order entered by staff. Same pipeline, numbering and fraud checks as the
 * website; the source is required and the order is credited to (and assigned to) the staff member who entered it.
 */
adminOrders.post('/orders/manual', need('orders:write'), async c => {
  const b = await readJson(c);
  const fromIncompleteId = posInt(b.fromIncompleteId);
  const placed = await placeOrder(c.env, await settingsOf(c), manualInput(b), {
    channel: 'manual', identity: { deviceHash: null, ipHash: null }, checkoutSessionId: null, route: '/api/admin/orders/manual',
    staff: { adminId: c.var.session.adminId, role: c.var.session.role, canDiscount: can(c.var.session.role, 'orders:discount') },
    discountPaisa: Math.max(0, int(b.discountPaisa) ?? 0), fromIncompleteId,
  });
  await audit(c, 'order.manual', 'order', placed.orderId, { source: b.source, fromIncompleteId });
  return c.json(placed, 201);
});

// ───────────── Incomplete orders ─────────────

const INCOMPLETE_STATUSES = ['new', 'contacted', 'converted', 'not_interested', 'unreachable', 'spam'];

adminOrders.get('/incomplete', need('orders:read'), async c => {
  const status = c.req.query('status');
  const assigned = c.req.query('assigned');
  const cur = c.req.query('cursor');
  let cursor: { updatedAt: string; id: number } | null = null;
  const dc = decodeCursor(cur);
  if (dc) cursor = { updatedAt: dc.createdAt, id: dc.id };
  const rows = await listIncomplete(c.env.DB, {
    status: status && INCOMPLETE_STATUSES.includes(status) ? status : undefined,
    assignedTo: assigned === 'me' ? c.var.session.adminId : assigned === 'unassigned' ? '' : undefined,
  }, cursor, 50);
  const last = rows[rows.length - 1];
  return c.json({
    items: rows.map(r => ({ ...r, phone: c.var.session.role === 'order_processor' && r.assigned_to !== c.var.session.adminId ? maskPhone(String(r.phone)) : localPhone(String(r.phone)), address: parseJson(r.address, {}), cart: parseJson(r.cart, []), source: parseJson(r.source, {}), risk_reasons: parseJson(r.risk_reasons, []) })),
    nextCursor: rows.length === 50 && last ? encodeCursor(String(last.updated_at), Number(last.id)) : null,
  });
});

adminOrders.get('/incomplete/report', need('orders:read'), async c => {
  const days = Math.min(Math.max(Number(c.req.query('days')) || 30, 1), 365);
  const r = await recoveryReport(c.env.DB, new Date(Date.now() - days * 86_400_000).toISOString());
  const captured = Number(r.totals.captured ?? 0);
  return c.json({ days, ...r, recoveryRate: captured ? Math.round((Number(r.totals.recovered ?? 0) / captured) * 1000) / 10 : 0 });
});

/** Prefill for "Convert to order": the manual order form opens with the snapshot. */
adminOrders.get('/incomplete/:id', need('orders:read'), async c => {
  const r = await incompleteById(c.env.DB, posInt(c.req.param('id')) ?? 0);
  if (!r) throw notFound();
  return c.json({ ...r, phone: localPhone(String(r.phone)), address: parseJson(r.address, {}), cart: parseJson(r.cart, []), source: parseJson(r.source, {}) });
});

adminOrders.post('/incomplete/:id/status', need('orders:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const b = await readJson(c);
  const status = str(b.status);
  if (!['new', 'contacted', 'not_interested', 'unreachable', 'spam'].includes(status)) throw bad('Unknown status. Converted is set automatically when an order is placed.');
  if (!(await setIncompleteStatus(c.env.DB, id, status, str(b.note, 500) || null))) throw bad('This checkout was already converted to an order.');
  await audit(c, 'incomplete.status', 'abandoned_checkout', id, { status });
  return c.json({ ok: true });
});

adminOrders.post('/incomplete/:id/assign', need('orders:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const adminId = str((await readJson(c)).adminId, 64) || null;
  if (adminId && !(await adminExists(c.env.DB, adminId))) throw bad('Choose an active staff member.');
  if (c.var.session.role === 'order_processor' && adminId !== c.var.session.adminId) throw new HttpError(403, 'You can claim checkouts for yourself only.');
  await assignIncomplete(c.env.DB, id, adminId);
  await audit(c, 'incomplete.assign', 'abandoned_checkout', id, { adminId });
  return c.json({ ok: true });
});

// ───────────── Pre-orders ─────────────

adminOrders.get('/preorders', need('orders:read'), async c => c.json(await preorderSummary(c.env.DB)));

adminOrders.get('/preorders/:productId/export.csv', need('orders:export'), async c => {
  const rows = await preorderExport(c.env.DB, posInt(c.req.param('productId')) ?? 0);
  const head = ['order_no', 'created_at', 'customer_name', 'phone', 'district_name', 'variant_label', 'qty', 'advance_status', 'advance_taka', 'status'];
  return c.body(csv([head, ...rows.map(o => [o.order_no, o.created_at, o.customer_name, localPhone(String(o.phone)), o.district_name, o.variant_label, o.qty, o.advance_status, o.advance_amount_paisa == null ? '' : Number(o.advance_amount_paisa) / 100, o.status])]), 200, {
    'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="absvai-preorders.csv"',
  });
});
