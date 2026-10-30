/** Per-request helpers shared by the public API, pages and admin: settings, cookies, device identity. */
import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from '../env';
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
