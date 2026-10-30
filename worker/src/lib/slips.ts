/**
 * Bulk invoices and packing slips (Section 9.3): two per A4 page or one per 4×6 inch thermal label, each with the
 * invoice barcode and, once handed over, the courier tracking barcode. Packing slips leave out prices.
 */
import { formatDate } from './dates';
import { formatTakaAscii } from './money';
import { PAGE, PdfDoc, textWidth } from './pdf';

export interface SlipData {
  invoiceNo: string;
  orderNo: string;
  issuedAt: string;
  company: { name: string; phone: string };
  customer: { name: string; phone: string; address: string[] };
  items: Array<{ sku: string; name: string; variant: string | null; qty: number; totalPaisa: number }>;
  totalPaisa: number;
  duePaisa: number;
  paymentMethod: string;
  courier: string | null;
  trackingId: string | null;
  note: string | null;
}

export type SlipLayout = 'a4' | 'thermal';
export type SlipKind = 'invoice' | 'packing_slip';

function fit(s: string, size: number, max: number, bold = false): string {
  if (textWidth(s, size, bold) <= max) return s;
  let out = s;
  while (out.length > 1 && textWidth(`${out}…`, size, bold) > max) out = out.slice(0, -1);
  return `${out}…`;
}

function drawSlip(pdf: PdfDoc, d: SlipData, box: { x: number; y: number; w: number; h: number }, kind: SlipKind) {
  const L = box.x + 18;
  const R = box.x + box.w - 18;
  const W = R - L;
  let y = box.y + box.h - 30;
  const small = box.w < 320;
  pdf.text(L, y, d.company.name, { size: small ? 14 : 16, bold: true, color: '#B3261E' });
  pdf.text(R, y, kind === 'invoice' ? 'INVOICE' : 'PACKING SLIP', { size: small ? 9 : 11, bold: true, align: 'right' });
  y -= 14;
  pdf.text(L, y, `${d.orderNo} · ${formatDate(d.issuedAt)}`, { size: 8, color: '#5A4A40' });
  if (d.company.phone) pdf.text(R, y, d.company.phone, { size: 8, color: '#5A4A40', align: 'right' });
  y -= 44;
  pdf.barcode(L, y, d.invoiceNo, { height: 30, module: small ? 0.8 : 0.9 });
  if (d.trackingId && d.courier !== 'own_delivery') {
    const label = `${d.courier ?? 'Courier'} ${d.trackingId}`;
    pdf.text(R, y + 34, fit(label, 7, W / 2, true), { size: 7, bold: true, align: 'right' });
    // Right-align the tracking barcode by measuring it first.
    const probe = new PdfDoc([10, 10]);
    const bw = probe.barcode(0, 0, d.trackingId, { height: 30, module: small ? 0.7 : 0.8, label: false });
    pdf.barcode(R - bw, y, d.trackingId, { height: 30, module: small ? 0.7 : 0.8 });
  }
  y -= 26;
  pdf.text(L, y, 'DELIVER TO', { size: 7, bold: true, color: '#5A4A40' });
  y -= 13;
  pdf.text(L, y, fit(`${d.customer.name} · ${d.customer.phone}`, 11, W, true), { size: 11, bold: true });
  y -= 13;
  for (const line of d.customer.address) y = pdf.paragraph(L, y, line, W, { size: 9, leading: 11 });
  y -= 6;
  pdf.line(L, y + 4, R, y + 4);
  y -= 10;
  const maxItems = Math.max(1, Math.floor((y - box.y - 70) / 12));
  const shown = d.items.slice(0, maxItems);
  for (const it of shown) {
    const label = `${it.qty} × ${it.name}${it.variant ? ` (${it.variant})` : ''}`;
    pdf.text(L, y, fit(label, 9, kind === 'invoice' ? W - 120 : W - 80), { size: 9 });
    pdf.text(kind === 'invoice' ? R - 70 : R, y, it.sku, { size: 7, color: '#5A4A40', align: 'right' });
    if (kind === 'invoice') pdf.text(R, y, formatTakaAscii(it.totalPaisa), { size: 9, align: 'right' });
    y -= 12;
  }
  if (d.items.length > shown.length) { pdf.text(L, y, `+ ${d.items.length - shown.length} more item(s): see the full invoice`, { size: 8, color: '#5A4A40' }); y -= 12; }
  pdf.line(L, y + 6, R, y + 6);
  y -= 8;
  if (kind === 'invoice') {
    pdf.text(L, y, 'Total', { size: 10 });
    pdf.text(R, y, formatTakaAscii(d.totalPaisa), { size: 10, align: 'right' });
    y -= 16;
  }
  // The courier collects this: always printed, also on packing slips.
  pdf.rect(L - 4, y - 6, W + 8, 20, '#FFF8EC');
  pdf.text(L, y, d.paymentMethod === 'cod' ? 'COLLECT ON DELIVERY' : 'BALANCE DUE', { size: 10, bold: true });
  pdf.text(R, y, d.duePaisa > 0 ? formatTakaAscii(d.duePaisa) : 'PAID', { size: 12, bold: true, align: 'right' });
  if (d.note) pdf.paragraph(L, y - 20, `Note: ${d.note}`, W, { size: 8, color: '#5A4A40', leading: 10 });
}

export function buildSlipsPdf(slips: SlipData[], layout: SlipLayout, kind: SlipKind): Uint8Array<ArrayBuffer> {
  const pdf = new PdfDoc(layout === 'thermal' ? PAGE.thermal4x6 : PAGE.a4);
  slips.forEach((d, i) => {
    if (layout === 'thermal') {
      if (i > 0) pdf.addPage();
      drawSlip(pdf, d, { x: 0, y: 0, w: pdf.width, h: pdf.height }, kind);
      return;
    }
    // Two per A4 page with a dashed cut line between them.
    if (i > 0 && i % 2 === 0) pdf.addPage();
    const top = i % 2 === 0;
    const h = pdf.height / 2;
    drawSlip(pdf, d, { x: 0, y: top ? h : 0, w: pdf.width, h }, kind);
    if (top) for (let x = 20; x < pdf.width - 20; x += 12) pdf.line(x, h, x + 6, h, '#9A8A80', 0.6);
  });
  return pdf.toBytes();
}
