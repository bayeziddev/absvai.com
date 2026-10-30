import { describe, expect, it } from 'vitest';
import { deliveryCharge, standardCharge, type ChargeLine, type Zone } from '../../worker/src/lib/delivery-charge';

const dhakaCity: Zone = { id: 1, name: 'Inside Dhaka City', baseChargePaisa: 7000, baseWeightGrams: 1000, extraPerKgPaisa: 1500, bulkyChargePaisa: 40000, etaText: '1–2 days' };
const outside: Zone = { id: 3, name: 'Outside Dhaka', baseChargePaisa: 13000, baseWeightGrams: 1000, extraPerKgPaisa: 2500, bulkyChargePaisa: 80000, etaText: '3–5 days' };
const settings = { freeThresholdPaisa: 150000, freeExcludesBulky: true, codFeePaisa: 0 };
const line = (over: Partial<ChargeLine> = {}): ChargeLine => ({ qty: 1, packedWeightGrams: 600, freeDelivery: false, shippingProfile: 'standard', bulkyDeliveryMode: 'zone_fixed', lineTotalPaisa: 38000, ...over });

describe('delivery charge', () => {
  it('charges each zone its base rate up to the base weight', () => {
    expect(deliveryCharge([line()], dhakaCity, settings, 'cod').chargePaisa).toBe(7000);
    expect(deliveryCharge([line()], outside, settings, 'cod').chargePaisa).toBe(13000);
  });

  it('adds the per-kg extra above the threshold, rounding partial kilos up', () => {
    expect(standardCharge(outside, 1000)).toBe(13000);
    expect(standardCharge(outside, 1001)).toBe(15500);
    expect(standardCharge(outside, 2300)).toBe(18000);
    // packed weight × quantity drives the charge
    expect(deliveryCharge([line({ qty: 3, packedWeightGrams: 650 })], outside, settings, 'cod').chargePaisa).toBe(15500);
  });

  it('makes delivery free exactly at the threshold, not one paisa below', () => {
    expect(deliveryCharge([line({ lineTotalPaisa: 149999 })], outside, settings, 'cod').chargePaisa).toBe(13000);
    const atThreshold = deliveryCharge([line({ lineTotalPaisa: 150000 })], outside, settings, 'cod');
    expect(atThreshold.chargePaisa).toBe(0);
    expect(atThreshold.freeDelivery).toBe(true);
  });

  it('only gives free delivery to a mixed cart when every item qualifies', () => {
    // 2 × 600g = 1.2kg packed, so the whole order pays base + one extra kg.
    const mixed = deliveryCharge([line({ freeDelivery: true }), line()], outside, settings, 'cod');
    expect(mixed.chargePaisa).toBe(15500);
    const allFree = deliveryCharge([line({ freeDelivery: true }), line({ freeDelivery: true })], outside, settings, 'cod');
    expect(allFree.chargePaisa).toBe(0);
  });

  it('uses the bulky charge per unit for heavy items, and the threshold does not cover them', () => {
    const r = deliveryCharge([line({ shippingProfile: 'heavy_bulky', packedWeightGrams: 9000, lineTotalPaisa: 450000 })], dhakaCity, settings, 'cod');
    expect(r.chargePaisa).toBe(40000);
    expect(r.explanation.join(' ')).toMatch(/does not cover large items/);
    const two = deliveryCharge([line({ shippingProfile: 'heavy_bulky', qty: 2, lineTotalPaisa: 900000 })], dhakaCity, settings, 'cod');
    expect(two.chargePaisa).toBe(80000);
  });

  it('adds the standard charge for regular items next to a bulky one', () => {
    const r = deliveryCharge([line({ shippingProfile: 'heavy_bulky', lineTotalPaisa: 100000 }), line({ lineTotalPaisa: 18000 })], outside, settings, 'cod');
    expect(r.chargePaisa).toBe(80000 + 13000);
  });

  it('holds bulky items set to "confirm by phone"', () => {
    const r = deliveryCharge([line({ shippingProfile: 'heavy_bulky', bulkyDeliveryMode: 'confirm_by_phone' })], outside, settings, 'cod');
    expect(r.status).toBe('to_confirm');
    expect(r.chargePaisa).toBeNull();
  });

  it('respects product-level free delivery on a bulky item', () => {
    expect(deliveryCharge([line({ shippingProfile: 'heavy_bulky', freeDelivery: true, lineTotalPaisa: 260000 })], outside, settings, 'cod').chargePaisa).toBe(0);
  });

  it('shows the COD fee as its own line, only for COD', () => {
    const s = { ...settings, codFeePaisa: 1000 };
    expect(deliveryCharge([line()], outside, s, 'cod').codFeePaisa).toBe(1000);
    expect(deliveryCharge([line()], outside, s, 'manual_mobile').codFeePaisa).toBe(0);
  });

  it('tells the customer how far they are from free delivery', () => {
    expect(deliveryCharge([line({ lineTotalPaisa: 100000 })], outside, settings, 'cod').explanation.join(' ')).toMatch(/Add ৳500 more for free delivery/);
  });
});
