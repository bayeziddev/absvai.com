/** Search with transliteration synonyms: "phuchka" finds fuchka products, "nolen gur" finds patali gur. */

export function normalizeQuery(q: string): string {
  return q.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/**
 * Returns the search terms: the query itself, its words, and every term of any synonym group
 * whose term appears in the query (whole-word match, longest terms first).
 */
export function expandQuery(query: string, groups: Map<string, string[]>): string[] {
  const q = normalizeQuery(query);
  if (!q) return [];
  const terms = new Set<string>([q]);
  for (const w of q.split(' ')) if (w.length >= 2) terms.add(w);
  const padded = ` ${q} `;
  for (const members of groups.values()) {
    if (members.some(m => padded.includes(` ${normalizeQuery(m)} `))) {
      for (const m of members) terms.add(normalizeQuery(m));
    }
  }
  return [...terms].slice(0, 24);
}

export function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, c => `\\${c}`);
}
