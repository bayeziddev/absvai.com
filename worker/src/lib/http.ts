import type { Context } from 'hono';

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}

export const bad = (message: string, details?: unknown) => new HttpError(400, message, details);
export const notFound = (message = 'Not found') => new HttpError(404, message);
export const forbidden = (message = 'You do not have permission to do that.') => new HttpError(403, message);

export async function readJson<T = Record<string, unknown>>(c: Context): Promise<T> {
  try {
    const body = await c.req.json();
    if (!body || typeof body !== 'object') throw new Error();
    return body as T;
  } catch {
    throw bad('Send the request body as JSON.');
  }
}

export function str(v: unknown, max = 500): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '';
}

export function int(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) ? n : null;
}

export function posInt(v: unknown): number | null {
  const n = int(v);
  return n !== null && n > 0 ? n : null;
}

export function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

export function parseJson<T>(s: unknown, fallback: T): T {
  if (typeof s !== 'string' || !s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

export function clientIp(c: Context): string {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0';
}

/** Fixed-window counter in KV. Coarse (KV is eventually consistent) but enough to slow down abuse. */
export async function rateLimit(kv: KVNamespace, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const bucket = Math.floor(Date.now() / 1000 / windowSeconds);
  const k = `rl:${key}:${bucket}`;
  const n = Number((await kv.get(k)) ?? 0);
  if (n >= limit) return false;
  await kv.put(k, String(n + 1), { expirationTtl: Math.max(60, windowSeconds * 2) });
  return true;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}
