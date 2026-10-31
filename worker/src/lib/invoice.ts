import { formatDate } from './dates';
import { formatTakaAscii } from './money';
import { PdfDoc } from './pdf';
import { PAYMENT_LABELS } from './tracking';

export interface InvoiceData {
  invoiceNo: string;
  issuedAt: string;
  orderNo: string;
  company: { name: string; legalName: string; address: string; phone: string; site: string };
  customer: { name: string; phone: string; address: string[] };
  paymentMethod: string;
  paymentStatus: string;
  advancePaidPaisa: number;
  items: Array<{ sku: string; name: string; variant: string | null; qty: number; unitPaisa: number; totalPaisa: number }>;
  subtotalPaisa: number;
  deliveryPaisa: number | null;
  codFeePaisa: number;
  discountPaisa: number;
  totalPaisa: number;
}


export function buildInvoicePdf(d: InvoiceData): Uint8Array<ArrayBuffer> {
  const pdf = new PdfDoc();
  const L = 40;
  const R = pdf.width - 40;
  let y = pdf.height - 56;

  pdf.rect(0, pdf.height - 8, pdf.width, 8, '#B3261E');
  pdf.text(L, y, d.company.name, { size: 24, bold: true, color: '#B3261E' });
  pdf.text(R, y + 4, 'INVOICE', { size: 18, bold: true, align: 'right' });
  y -= 16;
  pdf.text(L, y, `${d.company.legalName} · ${d.company.site}`, { size: 9, color: '#5A4A40' });
  pdf.text(R, y, d.invoiceNo, { size: 10, bold: true, align: 'right' });
  y -= 12;
  if (d.company.address) pdf.text(L, y, d.company.address, { size: 9, color: '#5A4A40' });
  pdf.text(R, y, `Date: ${formatDate(d.issuedAt)}`, { size: 9, align: 'right' });
  y -= 12;
  if (d.company.phone) pdf.text(L, y, `Support: ${d.company.phone}`, { size: 9, color: '#5A4A40' });
  pdf.text(R, y, `Order: ${d.orderNo}`, { size: 9, align: 'right' });

  y -= 30;
  pdf.text(L, y, 'BILL TO', { size: 8, bold: true, color: '#5A4A40' });
  pdf.text(330, y, 'PAYMENT', { size: 8, bold: true, color: '#5A4A40' });
  y -= 14;
  pdf.text(L, y, d.customer.name, { size: 11, bold: true });
  pdf.text(330, y, PAYMENT_LABELS[d.paymentMethod] ?? d.paymentMethod, { size: 10 });
  y -= 13;
  pdf.text(L, y, d.customer.phone, { size: 10 });
  pdf.text(330, y, `Status: ${d.paymentStatus.replace(/_/g, ' ')}`, { size: 10 });
  let ay = y - 13;
  for (const line of d.customer.address) ay = pdf.paragraph(L, ay, line, 260, { size: 9, color: '#3A2E28', leading: 12 });
  y = Math.min(ay, y - 13) - 18;

  // Table
  const cols = { sku: L, item: L + 120, qty: 380, unit: 460, total: R };
  pdf.rect(L - 6, y - 6, R - L + 12, 20, '#FFF8EC');
  pdf.text(cols.sku, y, 'SKU', { size: 8, bold: true });
  pdf.text(cols.item, y, 'ITEM', { size: 8, bold: true });
  pdf.text(cols.qty, y, 'QTY', { size: 8, bold: true, align: 'right' });
  pdf.text(cols.unit, y, 'UNIT PRICE', { size: 8, bold: true, align: 'right' });
  pdf.text(cols.total, y, 'AMOUNT', { size: 8, bold: true, align: 'right' });
  y -= 22;
  for (const it of d.items) {
    if (y < 160) { pdf.addPage(); y = pdf.height - 60; }
    pdf.text(cols.sku, y, it.sku, { size: 8, color: '#5A4A40' });
    const label = it.variant ? `${it.name} (${it.variant})` : it.name;
    const after = pdf.paragraph(cols.item, y, label, 200, { size: 9, leading: 11 });
    pdf.text(cols.qty, y, String(it.qty), { size: 9, align: 'right' });
    pdf.text(cols.unit, y, formatTakaAscii(it.unitPaisa), { size: 9, align: 'right' });
    pdf.text(cols.total, y, formatTakaAscii(it.totalPaisa), { size: 9, align: 'right' });
    y = Math.min(after, y - 11) - 6;
    pdf.line(L - 6, y + 8, R + 6, y + 8);
  }

  y -= 8;
  const row = (label: string, value: string, bold = false) => {
    pdf.text(460, y, label, { size: bold ? 11 : 9, bold, align: 'right' });
    pdf.text(R, y, value, { size: bold ? 11 : 9, bold, align: 'right' });
    y -= bold ? 18 : 14;
  };
  row('Subtotal', formatTakaAscii(d.subtotalPaisa));
  row('Delivery', d.deliveryPaisa === null ? 'To be confirmed' : d.deliveryPaisa === 0 ? 'Free' : formatTakaAscii(d.deliveryPaisa));
  if (d.codFeePaisa) row('COD fee', formatTakaAscii(d.codFeePaisa));
  if (d.discountPaisa) row('Discount', `-${formatTakaAscii(d.discountPaisa)}`);
  pdf.line(330, y + 10, R, y + 10, '#2A1F1A', 1);
  y -= 4;
  row('Total', formatTakaAscii(d.totalPaisa), true);
  if (d.advancePaidPaisa) row('Advance paid', `-${formatTakaAscii(d.advancePaidPaisa)}`);
  const due = d.paymentStatus === 'paid' ? 0 : Math.max(0, d.totalPaisa - d.advancePaidPaisa);
  row(d.paymentMethod === 'cod' ? 'Due on delivery' : 'Balance due', formatTakaAscii(due), true);

  pdf.line(L, 70, R, 70);
  pdf.text(L, 54, 'Thank you for shopping with Abs Vai.', { size: 9, bold: true });
  pdf.text(L, 41, 'Please check the parcel in front of the delivery person. Keep this invoice for returns and warranty.', { size: 8, color: '#5A4A40' });
  return pdf.toBytes();
}
