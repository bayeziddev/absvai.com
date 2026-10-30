/** Seasonal engine helpers (build prompt Section 5). Dates are Bangladesh calendar dates (YYYY-MM-DD). */
import { daysBetween, monthName } from './dates';

export interface SeasonRow {
  id: number;
  slug: string;
  name: string;
  starts_on: string | null;
  ends_on: string | null;
  is_enabled: number;
  back_in_season_text?: string | null;
  accent_label?: string | null;
  accent_color?: string | null;
  banners?: string;
}

export function isSeasonActive(s: SeasonRow, today: string): boolean {
  return Boolean(s.is_enabled && s.starts_on && s.ends_on && s.starts_on <= today && today <= s.ends_on);
}

export function nextSeason(seasons: SeasonRow[], today: string): { season: SeasonRow; daysUntil: number } | null {
  const upcoming = seasons
    .filter(s => s.is_enabled && s.starts_on && s.starts_on > today)
    .sort((a, b) => (a.starts_on! < b.starts_on! ? -1 : 1));
  return upcoming[0] ? { season: upcoming[0], daysUntil: daysBetween(today, upcoming[0].starts_on!) } : null;
}

export type Availability =
  | { state: 'available'; canBuy: true; label: string }
  | { state: 'pre_order'; canBuy: true; label: string; dispatchDate: string | null }
  | { state: 'made_to_order'; canBuy: true; label: string; leadDays: number }
  | { state: 'out_of_season'; canBuy: false; label: string; backText: string }
  | { state: 'out_of_stock'; canBuy: false; label: string };

/**
 * A product tied to seasons can only be bought while one of them is active, unless pre-order is on.
 * Out-of-season pages stay live (for Google) and show "Back in season from …" with Notify me.
 */
export function productAvailability(
  p: { fulfilment_mode: string; preorder_dispatch_date?: string | null; made_to_order_lead_days?: number | null },
  linkedSeasons: SeasonRow[],
  stock: number,
  today: string,
): Availability {
  if (p.fulfilment_mode === 'pre_order') {
    return { state: 'pre_order', canBuy: true, label: p.preorder_dispatch_date ? `Pre-order · ships from ${p.preorder_dispatch_date}` : 'Pre-order', dispatchDate: p.preorder_dispatch_date ?? null };
  }
  if (linkedSeasons.length && !linkedSeasons.some(s => isSeasonActive(s, today))) {
    const next = nextSeason(linkedSeasons, today);
    const backText = next?.season.starts_on ? monthName(next.season.starts_on) : linkedSeasons.find(s => s.back_in_season_text)?.back_in_season_text ?? 'next season';
    return { state: 'out_of_season', canBuy: false, label: `Back in season from ${backText}`, backText };
  }
  if (p.fulfilment_mode === 'made_to_order') {
    const days = p.made_to_order_lead_days ?? 3;
    return { state: 'made_to_order', canBuy: true, label: `Made to order · ready in ${days} days`, leadDays: days };
  }
  if (stock <= 0) return { state: 'out_of_stock', canBuy: false, label: 'Out of stock' };
  return { state: 'available', canBuy: true, label: 'In stock' };
}

/** Category visibility: always, or only while one of its seasons is active. */
export function categoryVisible(c: { season_visibility: string }, linkedSeasons: SeasonRow[], today: string): boolean {
  return c.season_visibility !== 'seasons' || linkedSeasons.some(s => isSeasonActive(s, today));
}
