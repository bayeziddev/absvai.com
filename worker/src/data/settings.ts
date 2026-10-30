import { parseJson } from '../lib/http';

export async function loadSettings(db: D1Database): Promise<Record<string, string>> {
  const rows = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  return Object.fromEntries(rows.results.map(r => [r.key, r.value]));
}

export function settingInt(s: Record<string, string>, key: string, fallback = 0): number {
  const n = Number(s[key]);
  return Number.isFinite(n) ? n : fallback;
}

export function settingJson<T>(s: Record<string, string>, key: string, fallback: T): T {
  return parseJson<T>(s[key], fallback);
}

/** Bumped on every catalog write so cached listings and the homepage refresh. */
export async function bumpCatalogVersion(db: D1Database): Promise<void> {
  await db.prepare("UPDATE settings SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key = 'catalog_version'").run();
}

export async function bumpGeoVersion(db: D1Database): Promise<void> {
  await db.prepare("UPDATE settings SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key = 'geo_postcode_version'").run();
}
