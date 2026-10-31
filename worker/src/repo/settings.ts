/** Settings rows. Secret rows hold AES-GCM ciphertext and are never returned by loadSettings(). */
import type { Env } from '../env';
import { decryptSecret, encryptSecret } from '../lib/crypto';
import { parseJson } from '../lib/http';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/** Public (non-secret) settings as key → value. */
export async function loadSettings(db: D1Database): Promise<Record<string, string>> {
  const rows = await db.prepare('SELECT key, value FROM settings WHERE is_secret = 0').all<{ key: string; value: string }>();
  return Object.fromEntries(rows.results.map(r => [r.key, r.value]));
}

export function settingInt(s: Record<string, string>, key: string, fallback = 0): number {
  const n = Number(s[key]);
  return s[key] !== undefined && s[key] !== '' && Number.isFinite(n) ? n : fallback;
}

export function settingJson<T>(s: Record<string, string>, key: string, fallback: T): T {
  return parseJson<T>(s[key], fallback);
}

export async function saveSettings(db: D1Database, values: Record<string, string>): Promise<void> {
  const entries = Object.entries(values);
  if (!entries.length) return;
  await db.batch(entries.map(([k, v]) => db.prepare(
    `INSERT INTO settings (key, value, is_secret, updated_at) VALUES (?, ?, 0, ${NOW}) ON CONFLICT(key) DO UPDATE SET value = excluded.value, is_secret = 0, updated_at = excluded.updated_at`,
  ).bind(k, v)));
}

/** Which secrets are set (never their values). */
export async function secretStatus(db: D1Database): Promise<Record<string, { set: boolean; updatedAt: string }>> {
  const rows = await db.prepare('SELECT key, updated_at FROM settings WHERE is_secret = 1').all<{ key: string; updated_at: string }>();
  return Object.fromEntries(rows.results.map(r => [r.key, { set: true, updatedAt: r.updated_at }]));
}

export async function saveSecret(env: Pick<Env, 'DB' | 'SETTINGS_KEY' | 'ENVIRONMENT'>, key: string, plain: string | null): Promise<void> {
  if (plain === null) {
    await env.DB.prepare('DELETE FROM settings WHERE key = ? AND is_secret = 1').bind(key).run();
    return;
  }
  await env.DB.prepare(
    `INSERT INTO settings (key, value, is_secret, updated_at) VALUES (?, ?, 1, ${NOW}) ON CONFLICT(key) DO UPDATE SET value = excluded.value, is_secret = 1, updated_at = excluded.updated_at`,
  ).bind(key, await encryptSecret(env, plain)).run();
}

/** Decrypted secret for server-side use only (courier, SMS, CAPI calls). */
export async function getSecret(env: Pick<Env, 'DB' | 'SETTINGS_KEY' | 'ENVIRONMENT'>, key: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ? AND is_secret = 1').bind(key).first<{ value: string }>();
  return row ? decryptSecret(env, row.value) : null;
}

export async function rawSecretValue(db: D1Database, key: string): Promise<string | null> {
  return (await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>())?.value ?? null;
}

