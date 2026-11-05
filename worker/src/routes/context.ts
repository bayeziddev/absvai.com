/** Per-request helpers shared by the public API, pages and admin: settings, cookies, device identity. */
import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from '../env';
import { signingKey, signToken, verifyToken } from '../lib/crypto';
import { clientIp } from '../lib/http';
import { loadSettings } from '../repo/settings';
import { identity, type Identity } from '../services/fraud';
import { DEVICE_COOKIE, newSessionId, SESSION_COOKIE } from '../services/incomplete';

export async function settingsOf(c: Context<AppEnv>): Promise<Record<string, string>> {
  if (!c.var.settings) c.set('settings', await loadSettings(c.env.DB));
  return c.var.settings;
}

export function deviceId(c: Context<AppEnv>): string | null {
  const v = getCookie(c, DEVICE_COOKIE);
  return v && /^[a-f0-9]{32}$/.test(v) ? v : null;
}

/** First-party device ID (HttpOnly, one year). One signal for fraud checks, never proof; stored only as a hash. */
export function ensureDeviceId(c: Context<AppEnv>): string {
  const existing = deviceId(c);
  if (existing) return existing;
  const id = newSessionId();
  setCookie(c, DEVICE_COOKIE, id, { path: '/', httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 60 * 60 * 24 * 365 });
  return id;
}

export function checkoutSessionId(c: Context<AppEnv>): string | null {
  const v = getCookie(c, SESSION_COOKIE);
  return v && /^[a-f0-9]{32}$/.test(v) ? v : null;
}

export function setCheckoutSession(c: Context<AppEnv>, sid: string): void {
  setCookie(c, SESSION_COOKIE, sid, { path: '/', httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 60 * 60 * 24 * 7 });
}

export async function requestIdentity(c: Context<AppEnv>): Promise<Identity> {
  return identity(c.env, deviceId(c), clientIp(c));
}

/** Per-device first, per-IP second and looser: many Bangladeshi mobile customers share one IP (Section 11.2). */
export function limiterKeys(c: Context<AppEnv>, route: string): { device: string; ip: string } {
  return { device: `${route}:d:${deviceId(c) ?? 'none'}`, ip: `${route}:ip:${clientIp(c)}` };
}

// ── Customer accounts: a signed cookie with the account id (60 days), plus a plain flag cookie so page scripts know to
// fill in the checkout. The flag is not trusted by the server. ──
export const ACCOUNT_COOKIE = '__Host-vm_acct';
export const ACCOUNT_FLAG = 'vm_in';
const ACCOUNT_DAYS = 60;

export async function signedInAccountId(c: Context<AppEnv>): Promise<number | null> {
  const v = getCookie(c, ACCOUNT_COOKIE);
  if (!v) return null;
  const p = await verifyToken<{ a: number; exp: number }>(signingKey(c.env), v);
  return p && Number.isInteger(p.a) && p.a > 0 ? p.a : null;
}

export async function setAccountCookie(c: Context<AppEnv>, accountId: number): Promise<void> {
  const token = await signToken(signingKey(c.env), { a: accountId, exp: Math.floor(Date.now() / 1000) + ACCOUNT_DAYS * 86_400 });
  setCookie(c, ACCOUNT_COOKIE, token, { path: '/', httpOnly: true, secure: true, sameSite: 'Lax', maxAge: ACCOUNT_DAYS * 86_400 });
  setCookie(c, ACCOUNT_FLAG, '1', { path: '/', secure: true, sameSite: 'Lax', maxAge: ACCOUNT_DAYS * 86_400 });
}

export function clearAccountCookie(c: Context<AppEnv>): void {
  setCookie(c, ACCOUNT_COOKIE, '', { path: '/', httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 0 });
  setCookie(c, ACCOUNT_FLAG, '', { path: '/', secure: true, sameSite: 'Lax', maxAge: 0 });
}

/** The invisible "I am human" check (always passes where Turnstile is not set up, e.g. local development and tests). */
export async function verifyTurnstile(c: Context<AppEnv>, token: string): Promise<boolean> {
  if (!c.env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  const form = new FormData();
  form.append('secret', c.env.TURNSTILE_SECRET);
  form.append('response', token);
  form.append('remoteip', clientIp(c));
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  return Boolean(((await r.json()) as { success?: boolean }).success);
}
