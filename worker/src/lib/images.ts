/**
 * Uploaded photos come in three widths so phones never download a 1600 px photo for a 180 px card: the original
 * (at most 1600 px) and 480 / 960 px wide copies the admin makes in the browser at upload, stored next to it as
 * `<name>-480.webp` and `<name>-960.webp`. Photos uploaded before the copies existed still work: /media serves the
 * original when a copy is missing.
 */
export const COPY_WIDTHS = [480, 960] as const;
export type CopyWidth = (typeof COPY_WIDTHS)[number];

const RESIZABLE = /^\/media\/(p\/\d+|c|b)\/[\w-]+\.(webp|jpg)$/;
const COPY_KEY = /-(480|960)\.(webp|jpg)$/;

/** The R2 key (or URL) of one copy. */
export const copyOf = (keyOrUrl: string, w: CopyWidth) => keyOrUrl.replace(/\.(webp|jpg)$/, `-${w}.$1`);

/** For a copy that is missing in R2: the original's key, or null when the key is not a copy. */
export const originalOf = (key: string) => (COPY_KEY.test(key) ? key.replace(COPY_KEY, '.$2') : null);

/** `srcset` for an uploaded photo; undefined for built-in pictures (SVG placeholders, external links). */
export function srcsetOf(url: string | null | undefined): string | undefined {
  if (!url || !RESIZABLE.test(url)) return undefined;
  return `${copyOf(url, 480)} 480w, ${copyOf(url, 960)} 960w, ${url} 1600w`;
}

/** The small copy, for thumbnails drawn at a fixed small size (cart lines, gallery thumbnails). */
export const smallOf = (url: string | null | undefined) => (url && RESIZABLE.test(url) ? copyOf(url, 480) : url ?? undefined);

/** `sizes` for the places photos appear, matching the CSS widths at each breakpoint. */
export const SIZES = {
  card: '(max-width: 719px) 46vw, (max-width: 1023px) 31vw, 300px',
  rail: '(max-width: 456px) 46vw, 210px',
  hero: '(max-width: 640px) 42vw, 260px',
  promo: '180px',
  pdp: '(max-width: 899px) 100vw, 600px',
  catCircle: '92px',
  catTile: '160px',
  menuIcon: '36px',
} as const;
