/**
 * Tiny dependency-free PDF writer (A4 or label sizes, Helvetica / Helvetica-Bold, WinAnsi, Code 128 bars). Enough for
 * invoices, packing slips and thermal labels.
 * Text outside WinAnsi (e.g. Bangla) cannot be drawn with the standard fonts and becomes "?";
 * the admin also has a printable HTML invoice that renders any script.
 */

// Helvetica glyph widths for ASCII 32..126 (units per 1000 em).
const W = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];

const WINANSI_EXTRA: Record<string, number> = { '€': 0x80, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99 };

function toWinAnsi(s: string): number[] {
  const out: number[] = [];
  for (const ch of s.replace(/৳/g, 'Tk ')) {
    const c = ch.codePointAt(0)!;
    if (c >= 32 && c < 127) out.push(c);
    else if (c >= 0xa0 && c <= 0xff) out.push(c);
    else if (WINANSI_EXTRA[ch]) out.push(WINANSI_EXTRA[ch]);
    else if (c === 0x2212) out.push(45);
    else out.push(63); // ?
  }
  return out;
}

export function textWidth(s: string, size: number, bold = false): number {
  let units = 0;
  for (const c of toWinAnsi(s)) units += c >= 32 && c < 127 ? W[c - 32] : 556;
  return (units * size * (bold ? 1.06 : 1)) / 1000;
}

function pdfString(s: string): string {
  return toWinAnsi(s)
    .map(c => (c === 40 || c === 41 || c === 92 ? `\\${String.fromCharCode(c)}` : c < 32 || c > 126 ? `\\${c.toString(8).padStart(3, '0')}` : String.fromCharCode(c)))
    .join('');
}

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const rgb = (c: RGB) => c.map(v => v.toFixed(3)).join(' ');

import { code128Bars } from './barcode';

/** Page sizes in points: A4, and the 4×6 inch thermal label most Bangladeshi couriers print. */
export const PAGE = { a4: [595, 842] as const, thermal4x6: [288, 432] as const };

export class PdfDoc {
  readonly width: number;
  readonly height: number;
  private pages: string[][] = [[]];

  constructor(size: readonly [number, number] = PAGE.a4) {
    this.width = size[0];
    this.height = size[1];
  }
  private get ops() { return this.pages[this.pages.length - 1]; }

  addPage() { this.pages.push([]); }

  text(x: number, y: number, s: string, opts: { size?: number; bold?: boolean; color?: string; align?: 'left' | 'right' | 'center' } = {}) {
    const size = opts.size ?? 10;
    const w = textWidth(s, size, opts.bold);
    const tx = opts.align === 'right' ? x - w : opts.align === 'center' ? x - w / 2 : x;
    this.ops.push(`BT /${opts.bold ? 'F2' : 'F1'} ${size} Tf ${rgb(hex(opts.color ?? '#2A1F1A'))} rg ${tx.toFixed(2)} ${y.toFixed(2)} Td (${pdfString(s)}) Tj ET`);
  }

  /** Wraps text to maxWidth and returns the y below the last line. */
  paragraph(x: number, y: number, s: string, maxWidth: number, opts: { size?: number; bold?: boolean; color?: string; leading?: number } = {}): number {
    const size = opts.size ?? 10;
    const leading = opts.leading ?? size * 1.35;
    let line = '';
    for (const word of s.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, size, opts.bold) > maxWidth && line) { this.text(x, y, line, opts); y -= leading; line = word; }
      else line = next;
    }
    if (line) { this.text(x, y, line, opts); y -= leading; }
    return y;
  }

  rect(x: number, y: number, w: number, h: number, fill: string) {
    this.ops.push(`${rgb(hex(fill))} rg ${x} ${y} ${w} ${h} re f`);
  }

  line(x1: number, y1: number, x2: number, y2: number, color = '#E9DCC6', width = 0.8) {
    this.ops.push(`${rgb(hex(color))} RG ${width} w ${x1} ${y1} m ${x2} ${y2} l S`);
  }

  /** Code 128 barcode with its text underneath. x/y is the bottom-left of the bars; returns the width drawn. */
  barcode(x: number, y: number, text: string, opts: { height?: number; module?: number; label?: boolean } = {}): number {
    const m = opts.module ?? 0.9;
    const h = opts.height ?? 32;
    const { bars, totalModules } = code128Bars(text);
    const bars0 = bars.map(([bx, bw]) => `${(x + bx * m).toFixed(2)} ${y.toFixed(2)} ${(bw * m).toFixed(2)} ${h} re`).join(' ');
    this.ops.push(`0 0 0 rg ${bars0} f`);
    if (opts.label !== false) this.text(x + (totalModules * m) / 2, y - 9, text, { size: 7, align: 'center' });
    return totalModules * m;
  }

  toBytes(): Uint8Array<ArrayBuffer> {
    const enc = (s: string) => { const b = new Uint8Array(new ArrayBuffer(s.length)); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff; return b; };
    const objects: string[] = [];
    const pageCount = this.pages.length;
    const firstPageObj = 5;
    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[2] = `<< /Type /Pages /Kids [${this.pages.map((_, i) => `${firstPageObj + i * 2} 0 R`).join(' ')}] /Count ${pageCount} >>`;
    objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    this.pages.forEach((ops, i) => {
      const pageObj = firstPageObj + i * 2;
      const stream = ops.join('\n');
      objects[pageObj] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.width} ${this.height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageObj + 1} 0 R >>`;
      objects[pageObj + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    });
    let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets: number[] = [];
    for (let i = 1; i < objects.length; i++) {
      offsets[i] = out.length;
      out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xref = out.length;
    out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < objects.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return enc(out);
  }
}
