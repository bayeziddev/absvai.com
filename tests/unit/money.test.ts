import { describe, expect, it } from 'vitest';
import { formatTaka, formatTakaAscii, takaToPaisa, tierPrice, unitPrice, formatUnitPrice } from '../../worker/src/lib/money';

describe('money', () => {
  it('formats paisa as taka with thousands separators', () => {
    expect(formatTaka(120000)).toBe('৳1,200');
    expect(formatTaka(150050)).toBe('৳1,500.50');
    expect(formatTaka(0)).toBe('৳0');
    expect(formatTakaAscii(260000)).toBe('Tk 2,600');
  });

  it('parses taka input to integer paisa without float errors', () => {
    expect(takaToPaisa('1,200')).toBe(120000);
    expect(takaToPaisa('৳19.99')).toBe(1999);
    expect(takaToPaisa('0.1')).toBe(10);
    expect(takaToPaisa('abc')).toBeNull();
  });

  it('computes per-kg, per-litre and per-piece unit prices', () => {
    expect(formatUnitPrice(unitPrice(38000, 500, 'g'))).toBe('৳760 / kg');
    expect(formatUnitPrice(unitPrice(65000, 1, 'kg'))).toBe('৳650 / kg');
    expect(formatUnitPrice(unitPrice(9000, 250, 'ml'))).toBe('৳360 / litre');
    expect(formatUnitPrice(unitPrice(90000, 100, 'pcs'))).toBe('৳9 / pc');
    expect(unitPrice(1000, null, null)).toBeNull();
  });

  it('applies the highest wholesale tier that the quantity reaches', () => {
    const tiers = [{ minQty: 5, pricePaisa: 60000 }, { minQty: 20, pricePaisa: 56000 }];
    expect(tierPrice(65000, tiers, 1)).toBe(65000);
    expect(tierPrice(65000, tiers, 5)).toBe(60000);
    expect(tierPrice(65000, tiers, 25)).toBe(56000);
  });
});
