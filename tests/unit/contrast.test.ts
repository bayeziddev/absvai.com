import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// WCAG 2.x relative luminance and contrast ratio.
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

const css = readFileSync('public/css/app.css', 'utf8');
const token = (name: string) => css.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`))![1];

describe('brand palette contrast (WCAG AA, 4.5:1 for body text)', () => {
  const pairs: Array<[string, string, string]> = [
    ['clove text on cream', 'clove', 'cream'],
    ['chili text on cream', 'chili', 'cream'],
    ['white on chili (Order Now)', 'white', 'chili'],
    ['clove on turmeric (yellow only behind dark text)', 'clove', 'turmeric'],
    ['white on leaf (check chips)', 'white', 'leaf'],
    ['leaf text on cream (In stock)', 'leaf', 'cream'],
    ['muted text on cream', 'muted', 'cream'],
    ['cream on clove (footer)', 'cream', 'clove'],
  ];
  for (const [label, fg, bg] of pairs) {
    it(label, () => expect(ratio(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5));
  }

  it('documents that yellow on cream fails, so it is never used for text', () => {
    expect(ratio(token('turmeric'), token('cream'))).toBeLessThan(4.5);
  });
});
