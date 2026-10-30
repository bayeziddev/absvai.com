/**
 * Delivery charge rules (build prompt Section 6.3).
 *   - Packed weight drives the charge: Σ variant packed weight × qty.
 *   - Heavy/bulky items use a fixed bulky charge per unit for the zone, or "confirmed by phone" (order held).
 *   - Free delivery: sitewide threshold, or every item is marked free delivery. Bulky items can be excluded.
 *   - Optional COD fee is always a separate, visible line.
 */
import { formatTaka } from './money';

export interface Zone {
  id: number;
  name: string;
  baseChargePaisa: number;
  baseWeightGrams: number;
  extraPerKgPaisa: number;
  bulkyChargePaisa: number;
  etaText: string;
}

export interface ChargeLine {
  qty: number;
  packedWeightGrams: number;
  freeDelivery: boolean;
  shippingProfile: 'standard' | 'fragile' | 'heavy_bulky' | 'perishable';
  bulkyDeliveryMode: 'zone_fixed' | 'confirm_by_phone';
  lineTotalPaisa: number;
}

export interface ChargeSettings {
  freeThresholdPaisa: number; // 0 = no threshold
  freeExcludesBulky: boolean;
  codFeePaisa: number;
}

export interface ChargeResult {
  status: 'final' | 'to_confirm';
  chargePaisa: number | null;
  codFeePaisa: number;
  zoneId: number;
  zoneName: string;
  etaText: string;
  totalWeightGrams: number;
  freeDelivery: boolean;
  explanation: string[];
}

export function standardCharge(zone: Zone, weightGrams: number): number {
  if (weightGrams <= 0) return 0;
  const extraKg = Math.ceil(Math.max(0, weightGrams - zone.baseWeightGrams) / 1000);
  return zone.baseChargePaisa + extraKg * zone.extraPerKgPaisa;
}

export function deliveryCharge(lines: ChargeLine[], zone: Zone, settings: ChargeSettings, paymentMethod: string): ChargeResult {
  const explanation: string[] = [];
  const subtotal = lines.reduce((s, l) => s + l.lineTotalPaisa, 0);
  const totalWeight = lines.reduce((s, l) => s + l.packedWeightGrams * l.qty, 0);
  const bulky = lines.filter(l => l.shippingProfile === 'heavy_bulky');
  const regular = lines.filter(l => l.shippingProfile !== 'heavy_bulky');

  const thresholdMet = settings.freeThresholdPaisa > 0 && subtotal >= settings.freeThresholdPaisa;
  const everyItemFree = lines.length > 0 && lines.every(l => l.freeDelivery);

  const regularWeight = regular.reduce((s, l) => s + l.packedWeightGrams * l.qty, 0);
  let regularCharge = standardCharge(zone, regularWeight);
  // Free delivery covers the whole order only if every item qualifies or the threshold is met.
  const regularFree = everyItemFree || thresholdMet;
  if (regular.length && regularFree) regularCharge = 0;

  let bulkyCharge = 0;
  let status: ChargeResult['status'] = 'final';
  for (const l of bulky) {
    const free = l.freeDelivery || everyItemFree || (thresholdMet && !settings.freeExcludesBulky);
    if (free) continue;
    if (l.bulkyDeliveryMode === 'confirm_by_phone') { status = 'to_confirm'; continue; }
    bulkyCharge += zone.bulkyChargePaisa * l.qty;
  }

  if (regular.length) {
    explanation.push(regularCharge === 0
      ? (thresholdMet ? `Free delivery: your order is over ${formatTaka(settings.freeThresholdPaisa)}.` : 'Free delivery on these items.')
      : `${zone.name}: ${formatTaka(zone.baseChargePaisa)} up to ${zone.baseWeightGrams / 1000}kg` +
        (regularWeight > zone.baseWeightGrams ? `, +${formatTaka(zone.extraPerKgPaisa)} per extra kg (${(regularWeight / 1000).toFixed(1)}kg packed).` : '.'));
  }
  if (bulky.length) {
    if (status === 'to_confirm') explanation.push('Large item: we will call you to confirm the delivery charge before dispatch.');
    else if (bulkyCharge > 0) explanation.push(`Large item delivery: ${formatTaka(zone.bulkyChargePaisa)} each.`);
    else explanation.push('Free delivery on the large item.');
    if (thresholdMet && settings.freeExcludesBulky && bulkyCharge > 0) explanation.push('The free-delivery threshold does not cover large items.');
  }
  if (settings.freeThresholdPaisa > 0 && !thresholdMet && regularCharge > 0) {
    explanation.push(`Add ${formatTaka(settings.freeThresholdPaisa - subtotal)} more for free delivery.`);
  }

  const codFee = paymentMethod === 'cod' ? settings.codFeePaisa : 0;
  if (codFee > 0) explanation.push(`Cash on Delivery fee: ${formatTaka(codFee)} (charged by the courier).`);

  return {
    status,
    chargePaisa: status === 'to_confirm' ? null : regularCharge + bulkyCharge,
    codFeePaisa: codFee,
    zoneId: zone.id,
    zoneName: zone.name,
    etaText: zone.etaText,
    totalWeightGrams: totalWeight,
    freeDelivery: regularCharge + bulkyCharge === 0 && status === 'final',
    explanation,
  };
}

export function rowToZone(r: Record<string, unknown>): Zone {
  return {
    id: Number(r.id),
    name: String(r.name),
    baseChargePaisa: Number(r.base_charge_paisa),
    baseWeightGrams: Number(r.base_weight_grams),
    extraPerKgPaisa: Number(r.extra_per_kg_paisa),
    bulkyChargePaisa: Number(r.bulky_charge_paisa),
    etaText: String(r.eta_text),
  };
}

