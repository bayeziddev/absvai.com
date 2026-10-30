/**
 * Small WebCrypto helpers: salted hashes for device IDs/IPs/phones on the block list, HMAC-signed short-lived tokens
 * (checkout token), constant-time comparison, and AES-GCM for settings secrets (Section 19: encrypted at rest).
 */
import type { Env } from '../env';

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Constant-time comparison. Uses crypto.subtle.timingSafeEqual on Workers, a branch-free loop elsewhere (tests). */
export function timingSafeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean };
  if (x.length !== y.length) {
    // Compare against itself so the time spent does not depend on where the inputs differ.
    if (subtle.timingSafeEqual) subtle.timingSafeEqual(x, x);
    return false;
  }
  if (subtle.timingSafeEqual) return subtle.timingSafeEqual(x, y);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function devFallback(env: Pick<Env, 'ENVIRONMENT'>, name: string): string {
  if (env.ENVIRONMENT === 'production') throw new Error(`${name} is not set. Add it with: wrangler secret put ${name}`);
  return `absvai-dev-${name.toLowerCase()}`;
}

export function signingKey(env: Pick<Env, 'SIGNING_KEY' | 'ENVIRONMENT'>): string {
  return env.SIGNING_KEY || devFallback(env, 'SIGNING_KEY');
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

export async function hmac(secret: string, data: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(data))));
}

/** Salted hash used for device IDs, IPs and block-list values. Never stores the raw value. */
export async function saltedHash(env: Pick<Env, 'SIGNING_KEY' | 'ENVIRONMENT'>, kind: 'device' | 'ip' | 'phone', value: string): Promise<string> {
  return (await hmac(signingKey(env), `${kind}:${value}`)).slice(0, 32);
}

export interface TokenPayload { [k: string]: string | number | undefined; exp: number }

/** payload.signature, both base64url. Expiry is checked on verify. */
export async function signToken(secret: string, payload: TokenPayload): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  return `${body}.${await hmac(secret, body)}`;
}

export async function verifyToken<T extends TokenPayload>(secret: string, token: string, now = Date.now()): Promise<T | null> {
  if (typeof token !== 'string' || token.length > 1024) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  if (!timingSafeEqual(sig, await hmac(secret, body))) return null;
  try {
    const payload = JSON.parse(dec.decode(unb64url(body))) as T;
    return typeof payload.exp === 'number' && payload.exp * 1000 > now ? payload : null;
  } catch {
    return null;
  }
}

// ───────────── AES-GCM for settings secrets ─────────────

async function aesKey(env: Pick<Env, 'SETTINGS_KEY' | 'ENVIRONMENT'>): Promise<CryptoKey> {
  let raw: Uint8Array<ArrayBuffer>;
  if (env.SETTINGS_KEY) {
    raw = unb64url(env.SETTINGS_KEY.trim());
    if (raw.length !== 32) throw new Error('SETTINGS_KEY must be 32 random bytes, base64 encoded (openssl rand -base64 32).');
  } else {
    raw = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(devFallback(env, 'SETTINGS_KEY'))));
  }
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(env: Pick<Env, 'SETTINGS_KEY' | 'ENVIRONMENT'>, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), enc.encode(plain)));
  return `v1:${b64url(iv)}:${b64url(ct)}`;
}

export async function decryptSecret(env: Pick<Env, 'SETTINGS_KEY' | 'ENVIRONMENT'>, stored: string): Promise<string | null> {
  const [v, iv, ct] = stored.split(':');
  if (v !== 'v1' || !iv || !ct) return null;
  try {
    return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64url(iv) }, await aesKey(env), unb64url(ct)));
  } catch {
    return null;
  }
}

/** What the admin sees after saving: never the secret itself. */
export function maskSecret(plain: string): string {
  return plain.length <= 4 ? '••••' : `••••${plain.slice(-4)}`;
}
