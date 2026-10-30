/** All money is integer paisa (৳1 = 100). Display uses ৳ with thousands separators. */

export function formatTaka(paisa: number): string {
  const negative = paisa < 0;
  const abs = Math.abs(Math.round(paisa));
  const taka = Math.floor(abs / 100);
  const rest = abs % 100;
  const body = taka.toLocaleString('en-US') + (rest ? `.${String(rest).padStart(2, '0')}` : '');
  return `${negative ? '−' : ''}৳${body}`;
}

/** Plain-ASCII form for PDFs and SMS (the ৳ glyph is not in standard PDF fonts or GSM-7). */
export function formatTakaAscii(paisa: number): string {
  return formatTaka(paisa).replace('৳', 'Tk ').replace('−', '-');
}

export function takaToPaisa(input: string | number): number | null {
  const s = String(input).replace(/[৳,\s]|tk/gi, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

export type NetUnit = 'g' | 'kg' | 'ml' | 'l' | 'm' | 'pcs';

/** "৳650 / kg" for weighed food, "৳320 / m" for fabric, "৳9 / pc" for packaging packs. */
export function unitPrice(pricePaisa: number, netValue: number | null | undefined, netUnit: NetUnit | null | undefined): { paisa: number; per: 'kg' | 'litre' | 'm' | 'pc' } | null {
  if (!netValue || !netUnit || netValue <= 0) return null;
  switch (netUnit) {
    case 'g': return { paisa: Math.round((pricePaisa * 1000) / netValue), per: 'kg' };
    case 'kg': return { paisa: Math.round(pricePaisa / netValue), per: 'kg' };
    case 'ml': return { paisa: Math.round((pricePaisa * 1000) / netValue), per: 'litre' };
    case 'l': return { paisa: Math.round(pricePaisa / netValue), per: 'litre' };
    case 'm': return { paisa: Math.round(pricePaisa / netValue), per: 'm' };
    case 'pcs': return { paisa: Math.round(pricePaisa / netValue), per: 'pc' };
  }
}

export function formatUnitPrice(u: { paisa: number; per: string } | null): string {
  return u ? `${formatTaka(u.paisa)} / ${u.per}` : '';
}

/** Price for a quantity after wholesale tiers (highest tier whose minQty is met). */
export function tierPrice(basePaisa: number, tiers: Array<{ minQty: number; pricePaisa: number }> | null | undefined, qty: number): number {
  let price = basePaisa;
  let best = 0;
  for (const t of tiers ?? []) {
    if (qty >= t.minQty && t.minQty > best && t.pricePaisa > 0) { price = t.pricePaisa; best = t.minQty; }
  }
  return price;
}
