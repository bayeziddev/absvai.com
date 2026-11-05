/** Printable HTML (no scripts) for barcode labels and the picking list. Opened in a new tab from admin and printed. */
import { code128Svg } from './barcode';
import { escapeHtml as e } from './http';
import { formatTaka } from './money';

export type LabelLayout = 'a4' | 'thermal';

const shell = (title: string, css: string, body: string) => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${e(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><style>
*{box-sizing:border-box}body{margin:0;font:12px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#2A1F1A}
.bar{display:flex;gap:12px;align-items:center;padding:10px 16px;background:#FFF8EC;border-bottom:1px solid #E9DCC6}
.bar b{font-size:14px}@media print{.bar{display:none}}${css}</style></head><body>${body}</body></html>`;

/**
 * Labels with name, variant, price, SKU and its Code 128 barcode (Section 13.2).
 * A4 sticker sheets: 3 × 8 labels of 70 × 37 mm. Thermal: one 38 × 25 mm label per page.
 */
export function labelsHtml(labels: Array<{ name: string; variant: string; pricePaisa: number; sku: string }>, layout: LabelLayout): string {
  const css = layout === 'thermal'
    ? '@page{size:38mm 25mm;margin:0}.sheet{display:block}.label{width:38mm;height:25mm;padding:1.2mm 1.6mm;page-break-after:always;overflow:hidden}.label .n{font-size:7px}.label .p{font-size:9px}.label svg{height:11mm}'
    : '@page{size:A4;margin:10mm 0 0 0}.sheet{display:grid;grid-template-columns:repeat(3,70mm);grid-auto-rows:37mm}.label{width:70mm;height:37mm;padding:3mm 4mm;overflow:hidden;border:1px dashed #ddd}@media print{.label{border:0}}.label .n{font-size:10px}.label .p{font-size:13px}.label svg{height:15mm}';
  const body = labels.map(l => `<div class="label"><div class="n"><b>${e(l.name)}</b>${l.variant ? ` · ${e(l.variant)}` : ''}</div>
<div class="p"><b>${e(formatTaka(l.pricePaisa))}</b></div>${code128Svg(l.sku, { height: 40, module: 1 })}</div>`).join('');
  return shell('Barcode labels', `.label svg{width:100%;display:block}.label{display:flex;flex-direction:column;justify-content:space-between}${css}`,
    `<div class="bar"><b>${labels.length} label(s)</b><span>${layout === 'thermal' ? '38 × 25 mm thermal labels' : 'A4 sheet, 3 × 8 stickers (70 × 37 mm)'}. Press Ctrl+P / ⌘P to print.</span></div><div class="sheet">${body}</div>`);
}

/** Total quantity per SKU across the selected orders, sorted by shelf location: pick once, pack many. */
export function pickingListHtml(rows: Array<{ sku: string; name: string; variant_label: string | null; shelf_location: string | null; qty: number; orders: number; order_nos: string }>, orderCount: number, printedAt: string): string {
  const total = rows.reduce((s, r) => s + Number(r.qty), 0);
  const body = rows.map(r => `<tr><td class="shelf">${e(r.shelf_location ?? '—')}</td><td>${e(r.sku)}</td><td><b>${e(r.name)}</b>${r.variant_label ? `<br><small>${e(r.variant_label)}</small>` : ''}</td>
<td class="q">${Number(r.qty)}</td><td><small>${Number(r.orders)} order(s): ${e(String(r.order_nos ?? '').split(',').join(', '))}</small></td><td class="tick">☐</td></tr>`).join('');
  return shell('Picking list', `@page{size:A4;margin:12mm}main{padding:16px}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #E9DCC6;padding:6px 8px;text-align:left;vertical-align:top}
th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;background:#FFF8EC}.q{font-size:16px;font-weight:700;text-align:right}.shelf{font-weight:700;white-space:nowrap}.tick{font-size:18px}h1{margin:0 0 4px;font-size:20px}`,
    `<div class="bar"><b>Picking list</b><span>Press Ctrl+P / ⌘P to print.</span></div><main><h1>Picking list</h1><p>${orderCount} order(s) · ${rows.length} SKU(s) · ${total} item(s) · printed ${e(printedAt)}</p>
<table><thead><tr><th>Shelf</th><th>SKU</th><th>Item</th><th style="text-align:right">Qty</th><th>Orders</th><th>Picked</th></tr></thead><tbody>${body}</tbody></table></main>`);
}

/** Print pages have no scripts and only inline styles. */
export const PRINT_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'";

/** The delivery address as the customer typed it, then the thana and district it was read as (for the courier), e.g.
 * "বাসা ১২, পাংশা, রাজবাড়ী (Pangsa, Rajbari)". Places already in the typed text are not repeated. */
export function orderAddress(o: Record<string, unknown>): string {
  const typed = String(o.address_line ?? '').trim();
  const places = [o.upazila_name, o.district_name].map(x => String(x ?? '').trim()).filter(x => x && !typed.toLowerCase().includes(x.toLowerCase()));
  return places.length ? `${typed}${typed ? ' ' : ''}(${[...new Set(places)].join(', ')})` : typed;
}

export interface CustomerInvoice {
  store: string; legalName: string; companyAddress: string; phone: string; site: string;
  invoiceNo: string | null; orderNo: string; date: string; status: string;
  customer: { name: string; phone: string; address: string };
  payment: string; paid: boolean; advancePaidPaisa: number;
  items: Array<{ name: string; variant: string | null; qty: number; unitPaisa: number; totalPaisa: number }>;
  subtotalPaisa: number; discountPaisa: number; deliveryPaisa: number | null; codFeePaisa: number; totalPaisa: number;
  backUrl: string;
}

/** Content-Security-Policy for the customer's invoice: its own styles and the one print button script. */
export const INVOICE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/**
 * The customer's invoice (or receipt, before the order is confirmed) as a print-ready A4 page in Bangla and English.
 * "Download" opens the browser's print dialog, where "Save as PDF" keeps a copy: every script prints, Bangla included,
 * which the built-in PDF fonts cannot do.
 */
export function customerInvoiceHtml(d: CustomerInvoice): string {
  const t = formatTaka;
  const title = d.invoiceNo ? 'ইনভয়েস · Invoice' : 'অর্ডার রসিদ · Order receipt';
  const rows = d.items.map(i => `<tr><td>${e(i.name)}${i.variant ? `<br><small>${e(i.variant)}</small>` : ''}</td><td class="n">${i.qty}</td><td class="n">${t(i.unitPaisa)}</td><td class="n">${t(i.totalPaisa)}</td></tr>`).join('');
  const line = (label: string, value: string, cls = '') => `<tr class="${cls}"><td>${label}</td><td class="n">${value}</td></tr>`;
  const due = Math.max(0, d.totalPaisa - d.advancePaidPaisa);
  const css = `@page{size:A4;margin:14mm}body{font:13px/1.45 "Noto Sans Bengali","Hind Siliguri","Nirmala UI",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#F6F1E8}
.bar{position:sticky;top:0;z-index:1;flex-wrap:wrap}.bar button,.bar a{font:inherit;font-weight:700;border-radius:999px;padding:9px 16px;border:1px solid #B3261E;cursor:pointer;text-decoration:none}
.bar button{background:#B3261E;color:#fff}.bar a{color:#B3261E;background:#fff}.bar small{color:#6B5A4E}
.sheet{max-width:760px;margin:16px auto;background:#fff;padding:28px;border-radius:12px;box-shadow:0 1px 6px rgba(0,0,0,.08)}
.top{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;border-bottom:2px solid #B3261E;padding-bottom:14px}
.brand{font:800 26px/1.1 system-ui,sans-serif;color:#2A1F1A}.brand+div{color:#6B5A4E;font-size:12px;margin-top:4px}
h1{margin:0;font-size:18px;text-align:right}.meta{text-align:right;font-size:12px;color:#6B5A4E}.meta b{color:#2A1F1A}
.two{display:flex;gap:16px;margin:16px 0}.two>div{flex:1;background:#FFF8EC;border-radius:10px;padding:10px 12px}.two h3{margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#6B5A4E}
table{width:100%;border-collapse:collapse}.items th{background:#2A1F1A;color:#fff;text-align:left;padding:7px 8px;font-size:12px}.items td{padding:8px;border-bottom:1px solid #EDE3D3;vertical-align:top}
.items small{color:#6B5A4E}.n{text-align:right;white-space:nowrap}.sum{width:300px;margin:12px 0 0 auto}.sum td{padding:5px 8px}.sum .total td{font-weight:800;font-size:16px;border-top:2px solid #2A1F1A}
.paid{display:inline-block;margin-top:6px;padding:2px 10px;border-radius:999px;background:#E6F4EA;color:#1E6B34;font-weight:700;font-size:12px}
.foot{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:12px;margin-top:22px;color:#6B5A4E;font-size:12px}.foot svg{display:block;width:210px;height:auto}
@media (max-width:600px){.sheet{margin:0;border-radius:0;padding:16px}.top,.two{flex-direction:column}h1,.meta{text-align:left}.sum{width:100%}}
@media print{body{background:#fff}.sheet{box-shadow:none;margin:0;max-width:none;padding:0}}`;
  const body = `<div class="bar"><button type="button" data-print>⬇ ডাউনলোড / প্রিন্ট (PDF)</button><a href="${e(d.backUrl)}">← অর্ডারে ফিরে যান</a>
<small>ফোনে: ডাউনলোড চাপুন, তারপর “Save as PDF” বেছে নিন।</small></div>
<div class="sheet"><div class="top"><div><div class="brand">${e(d.store)}</div><div>${d.legalName && d.legalName !== d.store ? `${e(d.legalName)}<br>` : ''}${d.companyAddress ? `${e(d.companyAddress)}<br>` : ''}${[d.phone, d.site].filter(Boolean).map(e).join(' · ')}</div></div>
<div><h1>${title}</h1><div class="meta">${d.invoiceNo ? `ইনভয়েস নং <b>${e(d.invoiceNo)}</b><br>` : ''}অর্ডার নং <b>${e(d.orderNo)}</b><br>তারিখ <b>${e(d.date)}</b><br>অবস্থা <b>${e(d.status)}</b></div></div></div>
<div class="two"><div><h3>ক্রেতা · Bill to</h3><b>${e(d.customer.name)}</b><br>${e(d.customer.phone)}<br>${e(d.customer.address)}</div>
<div><h3>পেমেন্ট · Payment</h3>${e(d.payment)}${d.paid ? '<br><span class="paid">পরিশোধিত · Paid</span>' : ''}${d.advancePaidPaisa ? `<br>অগ্রিম দেওয়া: ${t(d.advancePaidPaisa)}` : ''}</div></div>
<table class="items"><thead><tr><th>পণ্য · Item</th><th class="n">পরিমাণ</th><th class="n">দাম</th><th class="n">মোট</th></tr></thead><tbody>${rows}</tbody></table>
<table class="sum"><tbody>${line('পণ্যের মূল্য', t(d.subtotalPaisa))}${d.discountPaisa ? line('ছাড়', `−${t(d.discountPaisa)}`) : ''}
${line('ডেলিভারি চার্জ', d.deliveryPaisa === null ? 'ফোনে জানানো হবে' : d.deliveryPaisa === 0 ? 'ফ্রি' : t(d.deliveryPaisa))}${d.codFeePaisa ? line('COD চার্জ', t(d.codFeePaisa)) : ''}
${line('সর্বমোট · Total', t(d.totalPaisa), 'total')}${d.advancePaidPaisa ? line('অগ্রিম বাদে বাকি · Due', t(due)) : ''}</tbody></table>
<div class="foot"><div>ধন্যবাদ! কোনো প্রশ্ন থাকলে ${e(d.phone || d.site)}-এ যোগাযোগ করুন।<br>Computer-generated ${d.invoiceNo ? 'invoice' : 'receipt'}; no signature needed.</div><div>${code128Svg(d.orderNo, { height: 36, label: true })}</div></div></div>
<script src="/js/invoice.js"></script>`;
  return shell(`${d.invoiceNo ?? d.orderNo} · ${d.store}`, css, body).replace('<html lang="en">', '<html lang="bn">');
}
