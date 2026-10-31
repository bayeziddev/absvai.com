import { describe, expect, it } from 'vitest';
import { CODE128_PATTERNS, code128Widths, validGtin } from '../../worker/src/lib/barcode';
import { cacheKey, isCacheablePath, isEdgeServed, tagHeader } from '../../worker/src/lib/cache-tags';
import { decryptSecret, encryptSecret, maskSecret, saltedHash, signToken, verifyToken } from '../../worker/src/lib/crypto';
import { buildCsp } from '../../worker/src/lib/csp';
import { extractPhones, localPhone, maskPhone, normalizeBdPhone, phonePrefixRange } from '../../worker/src/lib/phone';
import { contrastWarnings, DEFAULT_COLORS, SETTING_BY_KEY, validateSetting } from '../../worker/src/lib/settings-schema';
import { canTransition, confirmBlockers, nextStatuses, STAGES, validatePartialReturn } from '../../worker/src/lib/state-machine';

describe('8-stage order state machine (Section 9.1)', () => {
  it('has exactly the eight stages', () => {
    expect(STAGES).toEqual(['new', 'confirmed', 'packed', 'in_courier', 'delivered', 'partial_delivered', 'cancelled', 'returned']);
  });
  it('allows the forward path and refuses skips and reopening', () => {
    for (const [a, b] of [['new', 'confirmed'], ['confirmed', 'packed'], ['packed', 'in_courier'], ['in_courier', 'delivered'], ['in_courier', 'partial_delivered'], ['delivered', 'returned']] as const) expect(canTransition(a, b)).toBe(true);
    for (const [a, b] of [['new', 'packed'], ['confirmed', 'in_courier'], ['delivered', 'cancelled'], ['cancelled', 'new'], ['returned', 'in_courier'], ['in_courier', 'cancelled']] as const) expect(canTransition(a, b)).toBe(false);
    expect(nextStatuses('partial_delivered')).toEqual([]);
  });
  it('blocks confirmation while an order is on hold', () => {
    const base = { paymentMethod: 'cod', otpVerifiedAt: '2026-10-30T10:00:00Z', hasConfirmedCall: false, advanceRequired: false, advanceStatus: 'not_required', deliveryChargeStatus: 'final' as const, verificationRequired: true };
    expect(confirmBlockers(base)).toEqual([]);
    expect(confirmBlockers({ ...base, holdReason: 'Second order from this phone within 10 minutes.' })[0]).toMatch(/on hold/);
  });
  it('validates partial returns: something kept and something back', () => {
    const items = [{ id: 1, qty: 2 }, { id: 2, qty: 1 }];
    expect(validatePartialReturn(items, { 1: 1 })).toBeNull();
    expect(validatePartialReturn(items, {})).toMatch(/Choose/);
    expect(validatePartialReturn(items, { 1: 2, 2: 1 })).toMatch(/Returned instead/);
    expect(validatePartialReturn(items, { 1: 3 })).toMatch(/between 0/);
  });
});

describe('phones stored as 8801XXXXXXXXX (Section 21.1)', () => {
  it('normalises, displays and masks', () => {
    expect(normalizeBdPhone('017-1234 5678')).toBe('8801712345678');
    expect(normalizeBdPhone('01212345678')).toBeNull();
    expect(localPhone('8801712345678')).toBe('01712345678');
    expect(maskPhone('8801712345678')).toBe('017XXXXX678');
  });
  it('turns a prefix into an index range instead of a leading-wildcard LIKE', () => {
    expect(phonePrefixRange('017')).toEqual(['88017', '88018']);
    expect(phonePrefixRange('+8801712')).toEqual(['8801712', '8801713']);
    expect(phonePrefixRange('Karim')).toBeNull();
  });
  it('finds every number in a pasted chat, once', () => {
    const chat = 'ভাই আমার নাম্বার 01712-345678\nবা ০১৮১২৩৪৫৬৭৮ e call din. again 01712345678. Order no AV-261030-0001';
    expect(extractPhones(chat)).toEqual(['8801712345678', '8801812345678']);
  });
});

/** Independent decoder: modules → symbols → text, with checksum verification. */
function decode128(widths: number[]): string {
  const bin = (w: number[]) => w.map((n, i) => (i % 2 === 0 ? '1' : '0').repeat(n)).join('');
  const byPattern = new Map(CODE128_PATTERNS.map((p, v) => [bin(p.split('').map(Number)), v]));
  const bits = bin(widths);
  const syms: number[] = [];
  for (let i = 0; i < bits.length;) {
    const len = bits.length - i === 13 ? 13 : 11;
    const v = byPattern.get(bits.slice(i, i + len));
    if (v === undefined) throw new Error(`Unknown symbol at module ${i}`);
    syms.push(v);
    i += len;
  }
  expect(syms.pop()).toBe(106);
  const check = syms.pop()!;
  expect(syms.reduce((s, v, k) => s + v * (k === 0 ? 1 : k), 0) % 103).toBe(check);
  let set = syms[0] === 105 ? 'C' : 'B';
  let out = '';
  for (const v of syms.slice(1)) {
    if (v === 99) set = 'C';
    else if (v === 100) set = 'B';
    else out += set === 'C' ? String(v).padStart(2, '0') : String.fromCharCode(v + 32);
  }
  return out;
}

describe('Code 128 and GTIN (Section 13.2)', () => {
  it('round-trips SKUs, invoice numbers and tracking codes', () => {
    for (const t of ['ORG-GUR-500G', 'AV-261030-0001', 'INV-20261030-0001', 'SF123456789', '12345', '00', 'a b-c/d']) expect(decode128(code128Widths(t))).toBe(t);
  });
  it('matches the reference encoding for a known Code B value', () => {
    // "ORG-GUR-500G" in set B, checked against JsBarcode 3.11.6 (CODE128B) while building.
    expect(code128Widths('ORG-GUR-500G').slice(0, 6).join('')).toBe('211214');
    expect(code128Widths('ORG-GUR-500G').reduce((a, b) => a + b, 0)).toBe(167);
  });
  it('uses set C to keep digit-heavy codes short', () => {
    expect(code128Widths('2610300001').reduce((a, b) => a + b, 0)).toBeLessThan(code128Widths('ABCDEFGHIJ').reduce((a, b) => a + b, 0));
  });
  it('refuses non-ASCII text', () => expect(() => code128Widths('গুড়')).toThrow());
  it('checks GS1 check digits', () => {
    expect(validGtin('4006381333931')).toBe(true);
    expect(validGtin('4006381333932')).toBe(false);
    expect(validGtin('96385074')).toBe(true);
    expect(validGtin('12345')).toBe(false);
  });
});

describe('edge cache keys and tags (Section 2.1)', () => {
  it('drops ad-click parameters from the key and keeps the meaningful ones in a fixed order', () => {
    const a = cacheKey(new URL('https://absvai.com/c/gur?fbclid=IwAR123&utm_source=fb&sort=price&page=2'));
    const b = cacheKey(new URL('https://absvai.com/c/gur?page=2&sort=price&gclid=xyz'));
    expect(a).toBe('/c/gur?page=2&sort=price');
    expect(b).toBe(a);
    expect(cacheKey(new URL('https://absvai.com/?fbclid=1'))).toBe('/');
  });
  it('never caches private paths', () => {
    for (const p of ['/', '/c/gur', '/p/patali-gur', '/season/winter', '/policies/returns']) expect(isCacheablePath(p)).toBe(true);
    for (const p of ['/cart', '/checkout', '/account', '/order/AV-1', '/admin/', '/api/checkout/place', '/api/geo/version']) expect(isEdgeServed(p)).toBe(false);
    expect(isEdgeServed('/api/live')).toBe(true);
  });
  it('builds a de-duplicated Cache-Tag header', () => expect(tagHeader(['site', 'home', 'site', 'prod-1', 'bad tag!'])).toBe('site,home,prod-1'));
});

describe('signed tokens, salted hashes and encrypted settings', () => {
  const env = { ENVIRONMENT: 'test', SIGNING_KEY: 'k'.repeat(32), SETTINGS_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))) } as never;
  it('verifies tokens and rejects tampering and expiry', async () => {
    const t = await signToken('secret', { sid: 'abc', exp: Math.floor(Date.now() / 1000) + 60 });
    expect(await verifyToken('secret', t)).toMatchObject({ sid: 'abc' });
    expect(await verifyToken('other', t)).toBeNull();
    expect(await verifyToken('secret', `${t.split('.')[0]}x.${t.split('.')[1]}`)).toBeNull();
    expect(await verifyToken('secret', t, Date.now() + 120_000)).toBeNull();
  });
  it('hashes identities per kind so a phone hash never equals an IP hash of the same text', async () => {
    expect(await saltedHash(env, 'phone', '1.2.3.4')).not.toBe(await saltedHash(env, 'ip', '1.2.3.4'));
    expect(await saltedHash(env, 'ip', '1.2.3.4')).toBe(await saltedHash(env, 'ip', '1.2.3.4'));
  });
  it('encrypts credentials with AES-GCM and masks them for display', async () => {
    const stored = await encryptSecret(env, 'sk_live_abcdef1234');
    expect(stored).toMatch(/^v1:/);
    expect(stored).not.toContain('abcdef');
    expect(await decryptSecret(env, stored)).toBe('sk_live_abcdef1234');
    // Flip a character in the middle of the ciphertext (the last base64 character can carry only padding bits).
    const [ver, iv, ct] = stored.split(':');
    const mid = Math.floor(ct.length / 2);
    expect(await decryptSecret(env, `${ver}:${iv}:${ct.slice(0, mid)}${ct[mid] === 'A' ? 'B' : 'A'}${ct.slice(mid + 1)}`)).toBeNull();
    expect(maskSecret('sk_live_abcdef1234')).toBe('••••1234');
  });
});

describe('settings validation and CSP (Section 19)', () => {
  const v = (k: string, x: string) => validateSetting(SETTING_BY_KEY.get(k)!, x);
  it('accepts only well-formed tracking IDs, never script', () => {
    expect(v('gtm_id', 'GTM-ABC1234')).toBeNull();
    expect(v('gtm_id', '<script>alert(1)</script>')).toMatch(/GTM/);
    expect(v('pixel_id', '123456789012345')).toBeNull();
    expect(v('ga4_id', 'UA-1234')).toMatch(/GA4/);
    expect(v('order_interval_minutes', 'ten')).toMatch(/whole number/);
  });
  it('opens third-party hosts only for enabled integrations', () => {
    const none = buildCsp({});
    expect(none).not.toContain('facebook');
    expect(none).not.toContain('googletagmanager');
    expect(none).toContain("'inline-speculation-rules'");
    const fb = buildCsp({ pixel_id: '123456789012345', gtm_id: 'bad' });
    expect(fb).toContain('https://connect.facebook.net');
    expect(fb).not.toContain('googletagmanager');
  });
  it('warns about unreadable brand colours', () => {
    expect(contrastWarnings(DEFAULT_COLORS)).toEqual([]);
    expect(contrastWarnings({ ...DEFAULT_COLORS, chili: '#FFD0D0' }).join(' ')).toMatch(/White text on chili/);
  });
});
