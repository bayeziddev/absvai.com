/**
 * Landing page content: everything a sales page for one product shows, kept as JSON in landing_pages.blocks.
 * cleanLanding() is the only way content gets in: it trims, limits lengths, keeps only our own photo URLs and YouTube
 * links, so the public page can render it without surprises.
 */
export interface LandingContent {
  /** Top of the page */
  badge: string; headline: string; subheadline: string; heroImage: string | null;
  /** Price shown crossed out next to the real price (optional). */
  regularPricePaisa: number | null;
  /** Photos and words */
  gallery: string[]; description: string; points: string[]; details: Array<{ label: string; value: string }>;
  video: { title: string; url: string; description: string } | null;
  /** Social proof and questions */
  reviews: Array<{ name: string; place: string; rating: number; text: string; image: string | null }>;
  showProductReviews: boolean;
  faq: Array<{ q: string; a: string }>;
  /** The order part */
  ctaText: string; ctaNote: string; couponCode: string | null; variantIds: number[] | null;
  accent: (typeof ACCENTS)[number]; stickyBar: boolean; focusMode: boolean;
}

export const ACCENTS = ['chili', 'leaf', 'clove', 'blue', 'purple'] as const;
export const ACCENT_COLORS: Record<LandingContent['accent'], string> = { chili: '#B3261E', leaf: '#2E7D32', clove: '#2A1F1A', blue: '#1D4ED8', purple: '#7C3AED' };

export const DEFAULT_CTA = 'এখনই অর্ডার করুন';
export const DEFAULT_CTA_NOTE = 'ক্যাশ অন ডেলিভারি · পণ্য হাতে পেয়ে টাকা দিন';

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim().slice(0, max) : '');
const line = (v: unknown, max: number) => text(v, max).replace(/\s+/g, ' ');
/** Our own uploads (/media/…), the shop's static images, or https links. */
const imageUrl = (v: unknown): string | null => {
  const s = text(v, 500);
  return /^(\/media\/|\/img\/)[\w./-]+$/.test(s) || /^https:\/\/[^\s"'<>]+$/.test(s) ? s : null;
};
export const youtubeId = (url: string): string | null => url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/)?.[1] ?? null;
const list = <T>(v: unknown, max: number, map: (x: Record<string, unknown>) => T | null): T[] =>
  (Array.isArray(v) ? v : []).slice(0, max).map(x => (x && typeof x === 'object' ? map(x as Record<string, unknown>) : null)).filter((x): x is T => x !== null);

export function emptyLanding(): LandingContent {
  return {
    badge: '', headline: '', subheadline: '', heroImage: null, regularPricePaisa: null, gallery: [], description: '', points: [], details: [], video: null,
    reviews: [], showProductReviews: true, faq: [], ctaText: DEFAULT_CTA, ctaNote: DEFAULT_CTA_NOTE, couponCode: null, variantIds: null,
    accent: 'chili', stickyBar: true, focusMode: true,
  };
}

/** Content from the admin form (or the database), cleaned. Returns problems in plain words. */
export function cleanLanding(raw: unknown): { content: LandingContent; problems: string[] } {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const problems: string[] = [];
  const videoUrl = text((b.video as Record<string, unknown> | null)?.url, 300);
  let video: LandingContent['video'] = null;
  if (videoUrl) {
    if (!youtubeId(videoUrl)) problems.push('The video link must be a YouTube link (youtube.com/watch?v=… or youtu.be/…).');
    else video = { url: videoUrl, title: line((b.video as Record<string, unknown>).title, 120), description: text((b.video as Record<string, unknown>).description, 1000) };
  }
  const price = Number(b.regularPricePaisa);
  const accent = ACCENTS.includes(b.accent as LandingContent['accent']) ? (b.accent as LandingContent['accent']) : 'chili';
  const variantIds = Array.isArray(b.variantIds) ? [...new Set((b.variantIds as unknown[]).map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, 30) : [];
  const content: LandingContent = {
    badge: line(b.badge, 60), headline: line(b.headline, 140), subheadline: text(b.subheadline, 300), heroImage: imageUrl(b.heroImage),
    regularPricePaisa: Number.isInteger(price) && price > 0 ? price : null,
    gallery: (Array.isArray(b.gallery) ? b.gallery : []).map(imageUrl).filter((x): x is string => Boolean(x)).slice(0, 12),
    description: text(b.description, 4000),
    points: (Array.isArray(b.points) ? b.points : []).map(x => line(x, 160)).filter(Boolean).slice(0, 12),
    details: list(b.details, 20, x => { const label = line(x.label, 60); const value = line(x.value, 200); return label && value ? { label, value } : null; }),
    video,
    reviews: list(b.reviews, 20, x => {
      const name = line(x.name, 60); const t = text(x.text, 600); const r = Math.round(Number(x.rating));
      return name && t ? { name, place: line(x.place, 60), rating: r >= 1 && r <= 5 ? r : 5, text: t, image: imageUrl(x.image) } : null;
    }),
    showProductReviews: b.showProductReviews !== false,
    faq: list(b.faq, 20, x => { const q = line(x.q, 200); const a = text(x.a, 1000); return q && a ? { q, a } : null; }),
    ctaText: line(b.ctaText, 40) || DEFAULT_CTA, ctaNote: line(b.ctaNote, 120),
    couponCode: line(b.couponCode, 30).toUpperCase().replace(/\s+/g, '') || null,
    variantIds: variantIds.length ? variantIds : null,
    accent, stickyBar: b.stickyBar !== false, focusMode: b.focusMode !== false,
  };
  return { content, problems };
}

/** The page's address: lower-case letters, digits and dashes (Bangla titles get an English address from the owner). */
export const landingSlug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
