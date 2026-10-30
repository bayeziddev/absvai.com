/** Honest claims (build prompt Section 13): no health or medical claims anywhere on a product. */
const HEALTH_WORDS = /\b(cures?|cured|healing|heals?|immunity|immune|boosts? (your )?(health|energy|immunity)|medicines?|medicinal|treats?|treatment|prevents?|diabetes|cancer|blood pressure|cholesterol|weight loss|detox)\b/i;

export function healthClaimIn(text: string | null | undefined): string | null {
  const m = (text ?? '').match(HEALTH_WORDS);
  return m ? m[0] : null;
}

/** Claim badges that may be switched on once a supporting document is attached. */
export const CLAIM_BADGES = ['Organic', '100% Natural', 'Adulteration-free', 'No added sugar', 'Chemical-free', 'Halal', 'BSTI certified'];
