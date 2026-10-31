/**
 * Bangladesh mobile numbers. Stored normalized as 8801XXXXXXXXX (Section 21.1); shown to people as 01XXXXXXXXX.
 * Accepts +880 / 880 / 0 prefixes, spaces, dashes and Bangla digits. Valid operators: 01[3-9] + 8 digits.
 */
const BANGLA_DIGITS = '০১২৩৪৫৬৭৮৯';

/** Bangla digits (০-৯) as ASCII digits; everything else unchanged. */
export const asciiDigits = (s: string) => String(s).replace(/[০-৯]/g, d => String(BANGLA_DIGITS.indexOf(d)));

function clean(input: string): string {
  return asciiDigits(String(input).replace(/[\s\-().]/g, ''));
}

export function normalizeBdPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = clean(input);
  if (s.startsWith('+880')) s = s.slice(4);
  else if (s.startsWith('880')) s = s.slice(3);
  else if (s.startsWith('0')) s = s.slice(1);
  return /^1[3-9]\d{8}$/.test(s) ? `880${s}` : null;
}

/** 8801712345678 → 01712345678 (for display, tel: links and SMS text). */
export function localPhone(phone: string): string {
  return /^8801\d{9}$/.test(phone) ? `0${phone.slice(3)}` : phone;
}

/** 8801712345678 → 017XXXXX678. */
export function maskPhone(phone: string): string {
  const p = localPhone(phone);
  return p.length >= 11 ? `${p.slice(0, 3)}XXXXX${p.slice(-3)}` : p;
}

/**
 * Prefix search as an index range ("017" → ['88017', '88018')), never a leading-wildcard LIKE (Section 21.2).
 * Returns null when the input is not a phone prefix.
 */
export function phonePrefixRange(input: string): [string, string] | null {
  let s = clean(input);
  if (!/^\+?\d{3,13}$/.test(s)) return null;
  s = s.replace(/^\+/, '');
  if (s.startsWith('880')) s = s.slice(3);
  else if (s.startsWith('0')) s = s.slice(1);
  else if (!s.startsWith('1')) return null;
  const lo = `880${s}`;
  if (lo.length > 13) return null;
  const last = lo.charCodeAt(lo.length - 1);
  return [lo, lo.slice(0, -1) + String.fromCharCode(last + 1)];
}

/** "Paste chat" helper: every Bangladeshi mobile number in a block of Messenger/WhatsApp text, normalized and de-duplicated. */
export function extractPhones(text: string): string[] {
  const src = String(text).replace(/[০-৯]/g, d => String(BANGLA_DIGITS.indexOf(d)));
  const found = new Set<string>();
  for (const m of src.matchAll(/(?:\+?88)?[\s-]?0?1[\s-]?[3-9](?:[\s-]?\d){8}/g)) {
    const p = normalizeBdPhone(m[0]);
    if (p) found.add(p);
  }
  return [...found];
}
