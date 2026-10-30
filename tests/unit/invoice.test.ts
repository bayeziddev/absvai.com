import { describe, expect, it } from 'vitest';
import { buildInvoicePdf } from '../../worker/src/lib/invoice';

describe('invoice PDF', () => {
  it('writes a valid single-page PDF with the invoice number and ASCII taka amounts', () => {
    const bytes = buildInvoicePdf({
      invoiceNo: 'INV-20261030-0001', issuedAt: '2026-10-30T10:00:00Z', orderNo: 'AV-261030-0001',
      company: { name: 'Abs Vai', legalName: 'ABS VAI LTD', address: 'Dhaka', phone: '+880 1700-000000', site: 'absvai.com' },
      customer: { name: 'Rahim (রহিম)', phone: '01712345678', address: ['House 12, Road 5', 'Kalihati, Tangail, Dhaka Division'] },
      paymentMethod: 'cod', paymentStatus: 'unpaid', advancePaidPaisa: 0,
      items: [{ sku: 'MCH-SEAL-300MM-0002', name: 'Electronic Impulse Sealer', variant: '300mm', qty: 1, unitPaisa: 185000, totalPaisa: 185000 }],
      subtotalPaisa: 185000, deliveryPaisa: 13000, codFeePaisa: 0, discountPaisa: 0, totalPaisa: 198000,
    });
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('(INV-20261030-0001)');
    expect(text).toContain('(Tk 1,980)');
    expect(text).toContain('(MCH-SEAL-300MM-0002)');
    // xref offsets point at real objects
    const xref = Number(text.match(/startxref\n(\d+)/)![1]);
    expect(text.slice(xref, xref + 4)).toBe('xref');
    const firstOffset = Number(text.slice(xref).split('\n')[3].slice(0, 10));
    expect(text.slice(firstOffset, firstOffset + 7)).toBe('1 0 obj');
  });
});
