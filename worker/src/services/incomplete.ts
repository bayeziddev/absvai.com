/**
 * Incomplete-order engine (Section 8). The checkout gets a short-lived signed token after an invisible Turnstile check;
 * every capture must carry it and match the HttpOnly checkout-session cookie, so scripts can't flood the table.
 */
import type { Env } from '../env';
import { signingKey, signToken, verifyToken } from '../lib/crypto';
import { asciiDigits, normalizeBdPhone } from '../lib/phone';
import { upsertCapture } from '../repo/incomplete';
import { customerByPhone } from '../repo/orders';
import { priceCart, sanitizeLines } from './cart';
import { findBlock, type Identity } from './fraud';

export const SESSION_COOKIE = '__Host-absvai_cs';
export const DEVICE_COOKIE = '__Host-absvai_did';
export const TOKEN_TTL_SECONDS = 2 * 60 * 60;
/** A form submitted faster than a person could fill it in is rejected (Section 11.1, timing check). */
export const MIN_FILL_SECONDS = 3;

export interface CheckoutToken { sid: string; iat: number; exp: number; [k: string]: string | number | undefined }

export async function issueCheckoutToken(env: Env, sid: string, now = Date.now()): Promise<{ token: string; expiresAt: string }> {
  const iat = Math.floor(now / 1000);
  const exp = iat + TOKEN_TTL_SECONDS;
  return { token: await signToken(signingKey(env), { sid, iat, exp }), expiresAt: new Date(exp * 1000).toISOString() };
}

/** Valid, unexpired and issued to this browser's checkout session. */
export async function checkCheckoutToken(env: Env, token: string, sid: string | null, now = Date.now()): Promise<CheckoutToken | null> {
  if (!sid) return null;
  const t = await verifyToken<CheckoutToken>(signingKey(env), token, now);
  return t && t.sid === sid ? t : null;
}

export function newSessionId(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
}

export interface CaptureInput {
  phone: unknown; name: unknown; divisionId: unknown; districtId: unknown; upazilaId: unknown; postcode: unknown; addressLine: unknown; landmark: unknown;
  lines: unknown; utm: unknown; landingPageId: unknown;
}

const s = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const n = (v: unknown) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);

/**
 * One row per checkout session, upserted. Starts only when the phone number is valid; partial or invalid numbers
 * create nothing. Returns whether a row was written.
 */
export async function captureIncomplete(env: Env, sid: string, id: Identity, body: CaptureInput): Promise<{ saved: boolean }> {
  const phone = normalizeBdPhone(s(body.phone, 20));
  if (!phone) return { saved: false };
  const priced = await priceCart(env.DB, sanitizeLines(body.lines));
  const customer = await customerByPhone(env.DB, phone);
  const block = await findBlock(env, { phone, id, route: '/api/checkout/capture' });
  const reasons: string[] = [];
  let risk: 'low' | 'medium' | 'high' | 'blocked' = 'low';
  if (block) { risk = 'blocked'; reasons.push(`On the block list: ${block.reason}`); }
  else if (customer && customer.returned_count >= 2) { risk = 'high'; reasons.push(`${customer.returned_count} earlier orders refused or returned`); }
  else if (customer && customer.returned_count > 0) { risk = 'medium'; reasons.push('An earlier order was refused or returned'); }
  const utm: Record<string, string> = {};
  if (body.utm && typeof body.utm === 'object') {
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
      const v = s((body.utm as Record<string, unknown>)[k], 120);
      if (v) utm[k] = v;
    }
  }
  const saved = await upsertCapture(env.DB, {
    sessionId: sid, phone, name: s(body.name, 120) || null,
    address: { divisionId: n(body.divisionId), districtId: n(body.districtId), upazilaId: n(body.upazilaId), postcode: asciiDigits(s(body.postcode, 4)) || null, line: s(body.addressLine, 300) || null, landmark: s(body.landmark, 200) || null },
    cart: priced.lines.map(l => ({ variantId: l.variantId, qty: l.qty, pricePaisa: l.unitPaisa, name: l.name + (l.variantLabel ? ` (${l.variantLabel})` : ''), sku: l.sku })),
    subtotalPaisa: priced.subtotalPaisa, source: { landingPageId: n(body.landingPageId), utm }, deviceHash: id.deviceHash, ipHash: id.ipHash, riskLevel: risk, riskReasons: reasons,
  });
  return { saved };
}
