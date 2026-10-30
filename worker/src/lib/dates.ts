/** Bangladesh is UTC+6 with no daylight saving. Season dates and invoice numbers use the Bangladesh calendar date. */
const BD_OFFSET_MS = 6 * 60 * 60 * 1000;

export function bdDate(now: Date = new Date()): string {
  return new Date(now.getTime() + BD_OFFSET_MS).toISOString().slice(0, 10);
}

export function bdDateCompact(now: Date = new Date()): string {
  return bdDate(now).replace(/-/g, '');
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

export function isIsoDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function monthName(iso: string): string {
  return MONTHS[Number(iso.slice(5, 7)) - 1] ?? '';
}

export function formatDate(iso: string): string {
  const d = iso.slice(0, 10);
  return `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]?.slice(0, 3)} ${d.slice(0, 4)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
