import { describe, expect, it } from 'vitest';
import { canTransition, confirmBlockers } from '../../worker/src/lib/order-status';
import { normalizeBdPhone } from '../../worker/src/lib/phone';
import { assessRisk } from '../../worker/src/lib/risk';
import { expandQuery } from '../../worker/src/lib/search';
import { categoryVisible, nextSeason, productAvailability, type SeasonRow } from '../../worker/src/lib/seasons';
import { segments, SMS, toGsm7 } from '../../worker/src/lib/sms';
import { bdDate, bdDateCompact } from '../../worker/src/lib/dates';
import { SYNONYM_GROUPS } from '../../scripts/seed-defs';

const winter: SeasonRow = { id: 1, slug: 'winter', name: 'Winter', starts_on: '2026-11-01', ends_on: '2027-02-28', is_enabled: 1, back_in_season_text: 'November' };

describe('seasons', () => {
  it('blocks the cart for out-of-season products but keeps a friendly "back from" label', () => {
    const a = productAvailability({ fulfilment_mode: 'in_stock' }, [winter], 10, '2026-07-01');
    expect(a).toMatchObject({ state: 'out_of_season', canBuy: false, label: 'Back in season from November' });
  });

  it('switches on and off exactly at the boundaries (inclusive)', () => {
    expect(productAvailability({ fulfilment_mode: 'in_stock' }, [winter], 10, '2026-10-31').canBuy).toBe(false);
    expect(productAvailability({ fulfilment_mode: 'in_stock' }, [winter], 10, '2026-11-01').canBuy).toBe(true);
    expect(productAvailability({ fulfilment_mode: 'in_stock' }, [winter], 10, '2027-02-28').canBuy).toBe(true);
    expect(productAvailability({ fulfilment_mode: 'in_stock' }, [winter], 10, '2027-03-01').canBuy).toBe(false);
  });

  it('lets pre-orders through out of season', () => {
    expect(productAvailability({ fulfilment_mode: 'pre_order', preorder_dispatch_date: '2026-11-20' }, [winter], 50, '2026-07-01').canBuy).toBe(true);
  });

  it('seasons without dates never activate (Ramadan/Eid must be set each year)', () => {
    const undated: SeasonRow = { ...winter, starts_on: null, ends_on: null };
    expect(categoryVisible({ season_visibility: 'seasons' }, [undated], '2026-12-01')).toBe(false);
    expect(categoryVisible({ season_visibility: 'always' }, [undated], '2026-12-01')).toBe(true);
    expect(nextSeason([undated, winter], '2026-10-18')).toMatchObject({ daysUntil: 14 });
  });
});

describe('order pipeline', () => {
  it('follows the defined transitions only', () => {
    expect(canTransition('pending', 'confirmed')).toBe(true);
    expect(canTransition('pending', 'shipped')).toBe(false);
    expect(canTransition('shipped', 'refused_at_delivery')).toBe(true);
    expect(canTransition('cancelled', 'confirmed')).toBe(false);
  });

  it('blocks COD confirmation without OTP or a logged confirmation call', () => {
    const base = { paymentMethod: 'cod', otpVerifiedAt: null, hasConfirmedCall: false, advanceRequired: false, advanceStatus: 'not_required', deliveryChargeStatus: 'final' as const };
    expect(confirmBlockers(base)).toHaveLength(1);
    expect(confirmBlockers({ ...base, hasConfirmedCall: true })).toEqual([]);
    expect(confirmBlockers({ ...base, otpVerifiedAt: '2026-10-30T10:00:00Z' })).toEqual([]);
    expect(confirmBlockers({ ...base, hasConfirmedCall: true, advanceRequired: true, advanceStatus: 'submitted' })[0]).toMatch(/advance/);
  });
});

describe('risk', () => {
  const base = { postcodeMismatch: false, addressLine: 'House 12, Road 5, Dhanmondi', totalPaisa: 50000, highValueThresholdPaisa: 500000, customer: null, recentOrdersSamePhone24h: 0, duplicateOfOrderId: null };
  it('is low for a normal order', () => expect(assessRisk(base).level).toBe('low'));
  it('raises a postcode/district mismatch to medium, never cancels', () => expect(assessRisk({ ...base, postcodeMismatch: true }).level).toBe('medium'));
  it('flags short addresses', () => expect(assessRisk({ ...base, addressLine: 'Dhaka' }).reasons[0].code).toBe('short_address'));
  it('is high for a likely double tap plus mismatch', () => expect(assessRisk({ ...base, postcodeMismatch: true, duplicateOfOrderId: 9 }).level).toBe('high'));
  it('lets trusted customers through the fast lane', () => {
    expect(assessRisk({ ...base, addressLine: 'x', customer: { orderCount: 9, deliveredCount: 9, returnedCount: 0, isTrusted: true } }).level).toBe('low');
  });
});

describe('search synonyms', () => {
  const groups = new Map(Object.entries(SYNONYM_GROUPS));
  it('maps transliterations to each other', () => {
    expect(expandQuery('phuchka', groups)).toContain('fuchka');
    expect(expandQuery('golgappa maker', groups)).toContain('panipuri');
    expect(expandQuery('nolen gur', groups)).toEqual(expect.arrayContaining(['patali gur', 'khejur gur', 'date palm jaggery']));
  });
  it('does not match partial words', () => {
    expect(expandQuery('guru', groups)).not.toContain('patali gur');
  });
});

describe('phones, SMS and dates', () => {
  it('normalises Bangladeshi mobile numbers', () => {
    expect(normalizeBdPhone('+880 1712-345678')).toBe('01712345678');
    expect(normalizeBdPhone('8801712345678')).toBe('01712345678');
    expect(normalizeBdPhone('০১৭১২৩৪৫৬৭৮')).toBe('01712345678');
    expect(normalizeBdPhone('01212345678')).toBeNull();
  });

  it('keeps every SMS template in one GSM-7 segment', () => {
    const msgs = [
      SMS.orderReceived('AV-261030-0001', '৳1,850'), SMS.otp('123456', 'AV-261030-0001'), SMS.confirmed('AV-261030-0001', 'INV-20261030-0001'),
      SMS.shipped('AV-261030-0001', 'Steadfast', 'SF123456789'), SMS.delivered('AV-261030-0001'),
    ].map(toGsm7);
    for (const m of msgs) {
      expect(/^[\x20-\x7E\n]*$/.test(m)).toBe(true);
      expect(segments(m)).toBe(1);
    }
  });

  it('uses the Bangladesh calendar date (UTC+6)', () => {
    expect(bdDate(new Date('2026-10-30T18:30:00Z'))).toBe('2026-10-31');
    expect(bdDateCompact(new Date('2026-10-30T17:59:00Z'))).toBe('20261030');
  });
});
