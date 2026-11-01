/**
 * The shop's built-in photos (public/img/photos): every photo the database or the pages point to exists with all its
 * smaller copies at the right widths, and the pages offer those copies so phones never download more than they show.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PHOTO_SETS, smallOf, srcsetOf } from '../../worker/src/lib/images';
import { bannerProblem } from '../../worker/src/lib/settings-schema';
import { bannerLayout } from '../../worker/src/views/components';

/** Width and height of a WebP file, from its header (lossy, lossless and extended). */
function webpSize(file: string): [number, number] {
  const b = readFileSync(file);
  expect(b.toString('ascii', 0, 4) + b.toString('ascii', 8, 12)).toBe('RIFFWEBP');
  const kind = b.toString('ascii', 12, 16);
  if (kind === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  if (kind === 'VP8L') { const n = b.readUInt32LE(21); return [(n & 0x3fff) + 1, ((n >> 14) & 0x3fff) + 1]; }
  return [b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1];
}

const files = (dir: string, ext: RegExp): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(d => (d.isDirectory() ? files(join(dir, d.name), ext) : ext.test(d.name) ? [join(dir, d.name)] : []));
const referenced = [...new Set(
  [...files('worker/migrations', /\.sql$/), 'worker/seed/demo.sql', ...files('worker/src', /\.tsx?$/), 'scripts/gen-seed.ts']
    .flatMap(f => readFileSync(f, 'utf8').match(/\/img\/photos\/(?:wide|sq)\/[\w-]+\.webp/g) ?? []),
)];

describe('built-in photos', () => {
  it('are all there, sharp enough and with every smaller copy', () => {
    expect(referenced.length).toBeGreaterThan(20);
    for (const url of referenced) {
      const kind = url.split('/')[3] as keyof typeof PHOTO_SETS;
      const main = join('public', url);
      expect(existsSync(main), url).toBe(true);
      const [w, h] = webpSize(main);
      expect(w, url).toBe(PHOTO_SETS[kind].main);
      if (kind === 'sq') expect(h, url).toBe(w);
      for (const cw of PHOTO_SETS[kind].copies) expect(webpSize(main.replace('.webp', `-${cw}.webp`))[0], `${url} ${cw}`).toBe(cw);
    }
  });

  it('stay small enough for phones', () => {
    for (const f of files('public/img/photos', /\.webp$/)) {
      const kb = readFileSync(f).length / 1024;
      // The smallest copies load in rails and the category row; the biggest only on wide, sharp screens.
      expect(kb, f).toBeLessThan(/-(240|480|640)\.webp$/.test(f) ? 70 : /-(720|960|1280)\.webp$/.test(f) ? 140 : 320);
    }
  });

  it('offer every width to the browser', () => {
    expect(srcsetOf('/img/photos/wide/hero-winter-gur.webp')).toBe('/img/photos/wide/hero-winter-gur-640.webp 640w, /img/photos/wide/hero-winter-gur-960.webp 960w, /img/photos/wide/hero-winter-gur-1280.webp 1280w, /img/photos/wide/hero-winter-gur-1920.webp 1920w, /img/photos/wide/hero-winter-gur.webp 2560w');
    expect(srcsetOf('/img/photos/sq/p-honey.webp')).toBe('/img/photos/sq/p-honey-240.webp 240w, /img/photos/sq/p-honey-480.webp 480w, /img/photos/sq/p-honey-720.webp 720w, /img/photos/sq/p-honey.webp 1024w');
    expect(smallOf('/img/photos/sq/p-honey.webp')).toBe('/img/photos/sq/p-honey-240.webp');
    expect(srcsetOf('/img/photos/other/x.webp')).toBeUndefined();
    expect(srcsetOf('/img/photos/sq/x.png')).toBeUndefined();
  });

  it('the storefront script picks the same widths', () => {
    const js = readFileSync('public/js/app.js', 'utf8');
    for (const [kind, set] of Object.entries(PHOTO_SETS)) expect(js).toContain(`${kind}: [[${set.copies.join(', ')}], ${set.main}]`);
  });
});

describe('banner layouts', () => {
  it('fills the banner with a wide photo, puts a square one on the right half, and keeps drawings beside the text', () => {
    expect(bannerLayout({ headline: 'a', image: '/img/photos/wide/hero-winter-gur.webp', wide: true })).toBe('wide');
    expect(bannerLayout({ headline: 'a', image: '/media/b/x.webp' })).toBe('side');
    expect(bannerLayout({ headline: 'a', image: '/img/placeholders/gur.svg', wide: true })).toBe('art');
    expect(bannerLayout({ headline: 'a' })).toBe('none');
  });

  it('accepts the wide switch only as yes or no', () => {
    expect(bannerProblem({ headline: 'a', image: '/img/photos/wide/hero-winter-gur.webp', wide: true }, 'Banner 1')).toBeNull();
    expect(bannerProblem({ headline: 'a', wide: 'yes' }, 'Banner 1')).toBe('Banner 1 is not valid.');
  });
});
