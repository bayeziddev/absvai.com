/**
 * COD risk signals (build prompt Section 12). Signals only raise the level for a manual check; nothing auto-cancels.
 */
export interface RiskInput {
  postcodeMismatch: boolean;
  addressLine: string;
  totalPaisa: number;
  highValueThresholdPaisa: number;
  customer: { orderCount: number; deliveredCount: number; returnedCount: number; isTrusted: boolean } | null;
  recentOrdersSamePhone24h: number;
  duplicateOfOrderId: number | null;
}

export interface RiskResult { level: 'low' | 'medium' | 'high'; score: number; reasons: Array<{ code: string; detail: string }> }

export function assessRisk(i: RiskInput): RiskResult {
  const reasons: RiskResult['reasons'] = [];
  let score = 0;
  const flag = (code: string, points: number, detail: string) => { score += points; reasons.push({ code, detail }); };

  if (i.postcodeMismatch) flag('postcode_mismatch', 2, 'Postcode does not belong to the chosen district.');
  const words = i.addressLine.trim().split(/\s+/).filter(Boolean);
  if (i.addressLine.trim().length < 12 || words.length < 3) flag('short_address', 1, 'Address line is too short to deliver to.');
  if (i.duplicateOfOrderId) flag('possible_duplicate', 2, `Same phone and items as order #${i.duplicateOfOrderId} a few minutes ago.`);
  if (i.recentOrdersSamePhone24h >= 3) flag('velocity', 2, `${i.recentOrdersSamePhone24h} orders from this phone in 24 hours.`);
  const c = i.customer;
  if (c && c.returnedCount > 0) flag('previous_returns', c.returnedCount >= 2 ? 3 : 2, `${c.returnedCount} earlier order(s) refused or returned.`);
  const isNew = !c || c.deliveredCount === 0;
  if (isNew && i.highValueThresholdPaisa > 0 && i.totalPaisa >= i.highValueThresholdPaisa) flag('high_value_new_customer', 1, 'High-value order from a new customer.');

  // Trusted customers with a clean record take the fast lane.
  if (c?.isTrusted && c.returnedCount === 0 && !i.duplicateOfOrderId) return { level: 'low', score: 0, reasons: [] };
  const level = score >= 3 ? 'high' : score >= 1 ? 'medium' : 'low';
  return { level, score, reasons };
}
