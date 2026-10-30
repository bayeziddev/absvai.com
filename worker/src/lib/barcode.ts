/**
 * Code 128 barcodes (Section 13.2): every variant's internal barcode encodes its SKU; invoices and courier slips
 * carry the invoice number and tracking code. Code set B, switching to set C for long digit runs to keep labels short.
 * Retail GTIN/EAN-13 codes need GS1 Bangladesh membership and are entered by hand (product_variants.gtin).
 */

// Bar/space widths for symbol values 0–106 (106 = stop).
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
export const CODE128_PATTERNS = PATTERNS;

const START_B = 104;
const START_C = 105;
const TO_C = 99;
const TO_B = 100;
const STOP = 106;

/** Symbol values for a text (without checksum and stop). Throws for characters outside printable ASCII. */
export function code128Values(text: string): number[] {
  if (!text.length) throw new Error('Nothing to encode.');
  if (!/^[\x20-\x7E]+$/.test(text)) throw new Error('Code 128 labels can only contain plain letters, numbers and symbols.');
  const values: number[] = [];
  let i = 0;
  const digitRun = (from: number) => { let n = 0; while (from + n < text.length && /\d/.test(text[from + n])) n++; return n; };
  const allDigits = /^\d+$/.test(text) && text.length >= 4 && text.length % 2 === 0;
  let set: 'B' | 'C' = allDigits ? 'C' : 'B';
  values.push(allDigits ? START_C : START_B);
  while (i < text.length) {
    if (set === 'C') {
      if (digitRun(i) >= 2) { values.push(Number(text.slice(i, i + 2))); i += 2; continue; }
      values.push(TO_B);
      set = 'B';
      continue;
    }
    const run = digitRun(i);
    // Switching costs one symbol, so only worth it for 6+ digits mid-text (4+ at the end).
    if (run >= 6 || (run >= 4 && i + run === text.length)) {
      if (run % 2 === 1) { values.push(text.charCodeAt(i) - 32); i += 1; }
      values.push(TO_C);
      set = 'C';
      continue;
    }
    values.push(text.charCodeAt(i) - 32);
    i += 1;
  }
  return values;
}

export function code128Checksum(values: number[]): number {
  return values.reduce((sum, v, i) => sum + v * (i === 0 ? 1 : i), 0) % 103;
}

/** Module widths, alternating bar/space, starting with a bar. Includes checksum and stop. */
export function code128Widths(text: string): number[] {
  const values = code128Values(text);
  const all = [...values, code128Checksum(values), STOP];
  return all.flatMap(v => PATTERNS[v].split('').map(Number));
}

/** Bars as [x, width] in modules, after a 10-module quiet zone. */
export function code128Bars(text: string): { bars: Array<[number, number]>; totalModules: number } {
  const widths = code128Widths(text);
  const bars: Array<[number, number]> = [];
  let x = 10;
  widths.forEach((w, i) => { if (i % 2 === 0) bars.push([x, w]); x += w; });
  return { bars, totalModules: x + 10 };
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Crisp SVG for labels and printouts. Height and module width in user units (mm when printed via viewBox). */
export function code128Svg(text: string, opts: { height?: number; module?: number; label?: boolean } = {}): string {
  const { bars, totalModules } = code128Bars(text);
  const m = opts.module ?? 1;
  const h = opts.height ?? 40;
  const labelH = opts.label === false ? 0 : 12;
  const w = totalModules * m;
  const rects = bars.map(([x, bw]) => `<rect x="${x * m}" y="0" width="${bw * m}" height="${h}"/>`).join('');
  const label = labelH ? `<text x="${w / 2}" y="${h + 10}" text-anchor="middle" font-family="monospace" font-size="10">${esc(text)}</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h + labelH}" role="img" aria-label="Barcode ${esc(text)}"><rect width="${w}" height="${h + labelH}" fill="#fff"/><g fill="#000">${rects}</g>${label}</svg>`;
}

/** GS1 check digit (EAN-13 / GTIN-8/12/13/14). */
export function validGtin(code: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}
