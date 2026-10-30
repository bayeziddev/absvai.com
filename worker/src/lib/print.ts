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
