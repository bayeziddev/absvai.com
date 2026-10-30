/**
 * SKU format: [CategoryCode]-[ProductCode]-[VariantCode]-[Sequence]
 *   ORG-PTGR-500G-0001 · MCH-SEAL-300MM-0003 · MCH-CHNC-4IN-0001 · TLS-VLPR-8X6-COL-0002 · HOM-CRCK-STD-0001
 */

const UNIT_CODES: Record<string, string> = {
  g: 'G', gm: 'G', gram: 'G', grams: 'G', kg: 'KG', ml: 'ML', l: 'L', ltr: 'L', litre: 'L', liter: 'L',
  mm: 'MM', cm: 'CM', m: 'M', in: 'IN', inch: 'IN', inches: 'IN', pcs: 'PCS', pc: 'PCS', pieces: 'PCS', w: 'W',
};

export function valueCode(value: string): string {
  const v = value.trim().toLowerCase().replace(/[×✕]/g, 'x');
  // Dimensions: "8×6 inch" → 8X6 (unit dropped, the numbers already say it)
  const dim = v.match(/^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)(?:\s*x\s*(\d+(?:\.\d+)?))?/);
  if (dim) return [dim[1], dim[2], dim[3]].filter(Boolean).join('X').replace(/\./g, '');
  // Number + unit: "500g" → 500G, "4-inch" → 4IN, "300 mm" → 300MM, "100 pcs" → 100PCS
  const num = v.match(/^(\d+(?:\.\d+)?)\s*-?\s*([a-z]+)?/);
  if (num) {
    const unit = num[2] ? UNIT_CODES[num[2]] ?? num[2].slice(0, 3).toUpperCase() : '';
    return (num[1].replace('.', 'P') + unit).slice(0, 10);
  }
  // Words: "Colored" → COL, "Navy" → NAVY; several words use initials: "Foil tray" → FT, "Grade A" → GA
  const words = v.replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'X';
  if (words.length > 1) return words.slice(0, 4).map(w => w[0]).join('').toUpperCase();
  const word = words[0];
  return (word.length <= 4 ? word : word.slice(0, 3)).toUpperCase();
}

/** Canonical attribute order: by key, so the same combination always produces the same code. */
export function variantCode(attributes: Record<string, string>): string {
  const keys = Object.keys(attributes).filter(k => attributes[k]?.trim()).sort(attributeOrder);
  if (!keys.length) return 'STD';
  return keys.map(k => valueCode(attributes[k])).join('-');
}

// Keep size-like attributes before finish/color so codes read naturally (8X6-COL, L-RED).
const ORDER = ['weight', 'pack_size', 'model_size', 'tool_size', 'home_size', 'supply_size', 'apparel_size', 'shoe_size', 'storage_model', 'pack_qty'];
function attributeOrder(a: string, b: string): number {
  const ia = ORDER.indexOf(a);
  const ib = ORDER.indexOf(b);
  if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  return a.localeCompare(b);
}

export function attributesKey(attributes: Record<string, string>): string {
  return Object.keys(attributes)
    .filter(k => attributes[k]?.trim())
    .sort()
    .map(k => `${k}=${attributes[k].trim().toLowerCase()}`)
    .join('|');
}

export function productCodeFromName(name: string): string {
  const words = name.toUpperCase().replace(/\(.*?\)/g, ' ').replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(w => w.length > 1);
  const stop = new Set(['THE', 'AND', 'FOR', 'WITH', 'OF', 'MENS', 'WOMENS']);
  const useful = words.filter(w => !stop.has(w));
  const pick = useful.length ? useful : words;
  if (!pick.length) return 'PROD';
  if (pick.length === 1) return (pick[0][0] + pick[0].slice(1).replace(/[AEIOU]/g, '')).padEnd(4, 'X').slice(0, 4);
  // Initial of each word, then fill from the last word's consonants: "Khejur Patali Gur" → KPGR
  let code = pick.slice(0, 4).map(w => w[0]).join('');
  const filler = pick[pick.length - 1].slice(1).replace(/[AEIOU]/g, '');
  for (const ch of filler) { if (code.length >= 4) break; code += ch; }
  return code.padEnd(4, 'X').slice(0, 4);
}

export function formatSku(categoryCode: string, productCode: string, vCode: string, sequence: number): string {
  return `${categoryCode}-${productCode}-${vCode}-${String(sequence).padStart(4, '0')}`.toUpperCase();
}

export const SKU_PATTERN = /^[A-Z]{2,5}-[A-Z0-9]{2,8}-[A-Z0-9-]{1,40}-\d{4,}$/;
