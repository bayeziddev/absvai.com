/**
 * Staff editing an order before it leaves the shop: the customer's name, mobile, address and note, the delivery area
 * and charge (free delivery is a charge of ৳0), the discount, and the items (quantity, price, add, remove).
 *
 * New, Confirmed and Packed orders can be edited. Once a parcel is with the courier its details live in the courier's
 * system too, so it is no longer changed here. Confirmed and Packed orders hold stock, and the edit moves that hold
 * with the items (more of an item holds more; fewer or removed lets go). The invoice total follows the order.
 */
import type { Env } from '../env';
import type { Role } from '../lib/auth';
import { guessArea } from '../lib/area-guess';
import { bad, HttpError } from '../lib/http';
import { formatTaka } from '../lib/money';
import { localPhone, normalizeBdPhone } from '../lib/phone';
import { RESERVED_STAGES, STATUS_LABELS, type OrderStatus } from '../lib/state-machine';
import { deliveryAreaById, deliveryAreaDistricts, geoNames } from '../repo/geo';
import { applyOrderEdit, ensureCustomer, orderById, orderItems, type NewOrderItem, type OrderEditWrite } from '../repo/orders';
import { settingInt } from '../repo/settings';
import { priceCart } from './cart';
import { quote } from './checkout';

export const EDITABLE_STAGES: OrderStatus[] = ['new', 'confirmed', 'packed'];
export const MAX_EDIT_QTY = 999;

export interface OrderEditInput {
  name?: string;
  phone?: string;
  addressLine?: string;
  note?: string | null;
  zoneId?: number | null;
  /** ৳0 makes delivery free. */
  deliveryChargePaisa?: number | null;
  discountPaisa?: number | null;
  /** The whole item list as it should be: existing items by itemId, new ones by variantId. Left out = items unchanged. */
  items?: Array<{ itemId?: number | null; variantId?: number | null; qty: number; unitPaisa?: number | null }>;
}

export interface EditStaff { adminId: string; role: Role; canDiscount: boolean }

interface Line extends NewOrderItem { id: number | null }

const itemName = (l: { name: string; variantLabel: string | null }) => `${l.name}${l.variantLabel ? ` (${l.variantLabel})` : ''}`;

export async function editOrder(env: Env, settings: Record<string, string>, orderId: number, input: OrderEditInput, staff: EditStaff): Promise<{ changed: string[]; totalPaisa: number }> {
  const db = env.DB;
  const o = await orderById(db, orderId);
  if (!o) throw new HttpError(404, 'Order not found.');
  const status = o.status as OrderStatus;
  if (!EDITABLE_STAGES.includes(status)) {
    throw new HttpError(409, `This order is ${STATUS_LABELS[status]}, so it can no longer be changed here. Add a note to its history instead.`);
  }
  const changes: string[] = [];
  const fields: Record<string, string | number | null> = {};

  // ── The customer ──
  const name = input.name === undefined ? String(o.customer_name) : input.name.trim();
  if (name.length < 2) throw bad('Enter the customer’s name.');
  if (name !== o.customer_name) { fields.customer_name = name; changes.push(`Name: ${String(o.customer_name)} → ${name}`); }

  let newPhone: string | null = null;
  if (input.phone !== undefined && input.phone.trim() !== '') {
    const p = normalizeBdPhone(input.phone);
    if (!p) throw bad('Enter a Bangladeshi mobile number like 01712345678.');
    if (p !== o.phone) {
      // Sales agents see (and so change) the full number only on orders assigned to them.
      if (staff.role === 'order_processor' && o.assigned_to !== staff.adminId) throw new HttpError(403, 'Assign this order to yourself to change the mobile number.');
      fields.phone = p;
      newPhone = p;
      changes.push(`Mobile: ${localPhone(String(o.phone))} → ${localPhone(p)}`);
    }
  }

  const addressLine = input.addressLine === undefined ? String(o.address_line) : input.addressLine.trim();
  if (addressLine.length < 5) throw bad('Enter the house, road or village so the courier can find it.');
  const addressChanged = addressLine !== o.address_line;
  if (addressChanged) { fields.address_line = addressLine; changes.push(`Address: ${addressLine}`); }

  if (input.note !== undefined) {
    const note = input.note?.trim() || null;
    if (note !== ((o.customer_note as string | null) || null)) { fields.customer_note = note; changes.push(note ? `Note: ${note}` : 'Note removed'); }
  }

  // ── Delivery area ──
  let zone = o.delivery_zone_id ? await deliveryAreaById(db, Number(o.delivery_zone_id)) : null;
  let zoneChanged = false;
  if (input.zoneId && input.zoneId !== Number(o.delivery_zone_id ?? 0)) {
    const z = await deliveryAreaById(db, input.zoneId);
    if (!z) throw bad('Choose a delivery area.');
    zone = z;
    zoneChanged = true;
    fields.delivery_zone_id = z.id;
    fields.eta_text = z.etaText ?? null;
    changes.push(`Delivery area: ${z.name}`);
  }
  // The district and thana are read from the address again (they are used for courier booking and the dashboard map).
  // A guess that finds nothing keeps what the order had.
  if (addressChanged || zoneChanged) {
    const guess = guessArea(addressLine, await geoNames(db), { districtIds: zone ? await deliveryAreaDistricts(db, zone.id) : [] });
    if (guess) {
      Object.assign(fields, {
        division_id: guess.divisionId, district_id: guess.districtId, upazila_id: guess.upazilaId ?? 0, union_id: null,
        division_name: guess.division, district_name: guess.district, upazila_name: guess.upazila ?? '', union_name: null,
      });
    }
  }

  // ── Items ──
  const old = await orderItems(db, orderId);
  const current: Line[] = old.map(i => ({
    id: Number(i.id), productId: Number(i.product_id), variantId: Number(i.variant_id), sku: String(i.sku), name: String(i.name), variantLabel: (i.variant_label as string) || null,
    unitPaisa: Number(i.unit_price_paisa), qty: Number(i.qty), packedWeightGrams: Number(i.packed_weight_grams), fulfilmentMode: String(i.fulfilment_mode),
  }));
  let next = current;
  let itemsChanged = false;
  if (input.items) {
    if (!input.items.length) throw bad('An order needs at least one item. To drop the whole order, cancel it instead.');
    const byId = new Map(current.map(l => [l.id, l]));
    next = [];
    const added: Array<{ variantId: number; qty: number; unitPaisa: number | null }> = [];
    for (const it of input.items) {
      const qty = Number(it.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > MAX_EDIT_QTY) throw bad(`Quantity must be between 1 and ${MAX_EDIT_QTY}.`);
      const unit = it.unitPaisa === undefined || it.unitPaisa === null ? null : Number(it.unitPaisa);
      if (unit !== null && (!Number.isInteger(unit) || unit < 0)) throw bad('Enter a price of ৳0 or more.');
      if (it.itemId) {
        const cur = byId.get(it.itemId);
        if (!cur) throw new HttpError(409, 'An item is no longer on this order. Reload the order and try again.');
        if (next.some(n => n.id === cur.id)) continue;
        next.push({ ...cur, qty, unitPaisa: unit ?? cur.unitPaisa });
      } else if (it.variantId) {
        added.push({ variantId: it.variantId, qty, unitPaisa: unit });
      }
    }
    if (added.length) {
      const priced = await priceCart(db, added.map(a => ({ variantId: a.variantId, qty: a.qty })));
      for (const a of added) {
        const p = priced.lines.find(l => l.variantId === a.variantId);
        if (!p) throw bad('That product is not available any more.');
        const same = next.find(n => n.variantId === a.variantId);
        if (same) { same.qty = Math.min(MAX_EDIT_QTY, same.qty + a.qty); continue; }
        if (p.problem && p.fulfilmentMode !== 'made_to_order') throw new HttpError(409, `${itemName({ name: p.name, variantLabel: p.variantLabel || null })}: ${p.problem}.`);
        next.push({
          id: null, productId: p.productId, variantId: p.variantId, sku: p.sku, name: p.name, variantLabel: p.variantLabel || null, unitPaisa: a.unitPaisa ?? p.unitPaisa,
          qty: a.qty, packedWeightGrams: p.packedWeightGrams, fulfilmentMode: p.fulfilmentMode,
        });
      }
    }
    if (!next.length) throw bad('An order needs at least one item. To drop the whole order, cancel it instead.');
    // A different price is a discount by another name: only managers (who may give discounts) can change one.
    for (const l of next) {
      const before = l.id ? byId.get(l.id) : null;
      if (before && l.unitPaisa !== before.unitPaisa && !staff.canDiscount) throw new HttpError(403, 'Only a manager can change a price. Give a discount instead, or ask a manager.');
    }
    for (const l of next) {
      const before = l.id ? byId.get(l.id) : null;
      if (!before) { changes.push(`Added ${itemName(l)} × ${l.qty}`); itemsChanged = true; continue; }
      if (before.qty !== l.qty) { changes.push(`${itemName(l)}: ${before.qty} → ${l.qty}`); itemsChanged = true; }
      if (before.unitPaisa !== l.unitPaisa) { changes.push(`${itemName(l)} price: ${formatTaka(before.unitPaisa)} → ${formatTaka(l.unitPaisa)}`); itemsChanged = true; }
    }
    for (const l of current) if (!next.some(n => n.id === l.id)) { changes.push(`Removed ${itemName(l)}`); itemsChanged = true; }
  }
  const subtotal = next.reduce((s, l) => s + l.unitPaisa * l.qty, 0);

  // ── Money ──
  let charge = o.delivery_charge_paisa === null ? null : Number(o.delivery_charge_paisa);
  let chargeStatus = String(o.delivery_charge_status);
  if (input.deliveryChargePaisa !== undefined && input.deliveryChargePaisa !== null) {
    const c = Number(input.deliveryChargePaisa);
    if (!Number.isInteger(c) || c < 0 || c > 10_000_000) throw bad('Enter a delivery charge of ৳0 or more (৳0 = free delivery).');
    if (c !== charge || chargeStatus !== 'final') {
      changes.push(`Delivery charge: ${charge === null ? 'to confirm' : formatTaka(charge)} → ${c === 0 ? 'free' : formatTaka(c)}`);
      charge = c;
      chargeStatus = 'final';
    }
  } else if (zoneChanged && zone) {
    // A new area without a charge typed in: the area's own charge for these items.
    const q = await quote(db, settings, { lines: next.map(l => ({ variantId: l.variantId, qty: l.qty })), districtId: null, upazilaId: null, zoneId: zone.id, paymentMethod: String(o.payment_method) });
    if (q.delivery) {
      charge = q.delivery.chargePaisa;
      chargeStatus = q.delivery.status;
      changes.push(`Delivery charge: ${charge === null ? 'to confirm' : formatTaka(charge)}`);
    }
  }

  let discount = Number(o.discount_paisa);
  if (input.discountPaisa !== undefined && input.discountPaisa !== null && input.discountPaisa !== discount) {
    const d = Number(input.discountPaisa);
    if (!Number.isInteger(d) || d < 0) throw bad('Enter a discount of ৳0 or more.');
    if (d > discount && !staff.canDiscount) {
      const maxPct = settingInt(settings, 'manual_discount_max_percent', 10);
      if (d > Math.floor((subtotal * maxPct) / 100)) throw bad(`Sales agents can give at most ${maxPct}% off. Ask a manager for a bigger discount.`);
    }
    changes.push(`Discount: ${formatTaka(discount)} → ${formatTaka(d)}`);
    discount = d;
  }
  discount = Math.min(discount, subtotal + (charge ?? 0));
  const codFee = Number(o.cod_fee_paisa ?? 0);
  const total = charge === null ? subtotal - discount : subtotal + charge + codFee - discount;

  if (subtotal !== Number(o.subtotal_paisa)) fields.subtotal_paisa = subtotal;
  if (charge !== (o.delivery_charge_paisa === null ? null : Number(o.delivery_charge_paisa))) fields.delivery_charge_paisa = charge;
  if (chargeStatus !== o.delivery_charge_status) fields.delivery_charge_status = chargeStatus;
  if (discount !== Number(o.discount_paisa)) fields.discount_paisa = discount;
  if (total !== Number(o.total_paisa)) { fields.total_paisa = total; changes.push(`Total: ${formatTaka(Number(o.total_paisa))} → ${formatTaka(total)}`); }

  if (!changes.length) return { changed: [], totalPaisa: Number(o.total_paisa) };

  // ── Stock held by the order, sold counts ──
  const held = RESERVED_STAGES.includes(status);
  const qtyBy = (ls: Line[], key: 'variantId' | 'productId', stockOnly: boolean) => {
    const m = new Map<number, number>();
    for (const l of ls) if (!stockOnly || l.fulfilmentMode !== 'made_to_order') m.set(l[key], (m.get(l[key]) ?? 0) + l.qty);
    return m;
  };
  const diff = (a: Map<number, number>, b: Map<number, number>) => [...new Set([...a.keys(), ...b.keys()])].map(k => ({ k, change: (b.get(k) ?? 0) - (a.get(k) ?? 0) })).filter(x => x.change !== 0);
  const reserve = held && itemsChanged ? diff(qtyBy(current, 'variantId', true), qtyBy(next, 'variantId', true)).map(x => ({ variantId: x.k, qty: x.change })) : [];
  const soldCount = itemsChanged ? diff(qtyBy(current, 'productId', false), qtyBy(next, 'productId', false)).map(x => ({ productId: x.k, change: x.change })) : [];

  if (newPhone) await ensureCustomer(db, newPhone, name);
  const write: OrderEditWrite = {
    orderId, status, adminId: staff.adminId, fields,
    updateItems: itemsChanged ? next.filter((l): l is Line & { id: number } => l.id !== null).map(l => ({ id: l.id, qty: l.qty, unitPaisa: l.unitPaisa })) : [],
    insertItems: itemsChanged ? next.filter(l => l.id === null) : [],
    deleteItemIds: itemsChanged ? current.filter(l => !next.some(n => n.id === l.id)).map(l => l.id as number) : [],
    reserve, soldCount,
    invoiceTotalPaisa: o.invoice_no && fields.total_paisa !== undefined ? total : null,
    customer: newPhone ? { fromId: o.customer_id ? Number(o.customer_id) : null, toPhone: newPhone } : null,
    note: `Edited: ${changes.join('; ')}`,
  };
  let applied: boolean;
  try {
    applied = await applyOrderEdit(db, write);
  } catch (e) {
    if (/CHECK constraint failed/i.test(String(e))) {
      throw new HttpError(409, 'Not enough stock for the new quantities. Lower them, or add stock in Products first.');
    }
    throw e;
  }
  if (!applied) throw new HttpError(409, 'Someone else just updated this order. Reload it and try again.');
  return { changed: changes, totalPaisa: total };
}
