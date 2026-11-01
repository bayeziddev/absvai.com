/**
 * Real photos: migration 0010 swaps the drawn pictures for photos on a shop that still has them (the live shop got its
 * demo catalog before 0010), leaves pictures the owner uploaded alone, and the homepage loads the right sizes.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from './env';

let t: TestEnv;
beforeAll(async () => { t = await createTestEnv(); });
afterAll(async () => { await t?.dispose(); });

const migration = readFileSync('worker/migrations/0010_real_photos.sql', 'utf8')
  .split('\n').filter(l => !l.startsWith('--') && l.trim()).join('\n').split(/;\n/).map(s => s.trim().replace(/;$/, '')).filter(Boolean);

describe('migration 0010', () => {
  it('replaces drawings that were never changed, and only those', async () => {
    // As the live shop has it: the old drawings everywhere, except one category picture the owner uploaded.
    await t.sql("UPDATE categories SET icon_url = '/img/placeholders/gur.svg' WHERE slug = 'khejur-gur'");
    await t.sql("UPDATE categories SET icon_url = '/media/c/own-photo.webp' WHERE slug = 'shoes'");
    await t.sql("UPDATE product_media SET url = '/img/placeholders/masala.svg' WHERE product_id = (SELECT id FROM products WHERE slug = '42-item-master-masala')");
    await t.sql(`UPDATE seasons SET banners = '[{"headline":"Fresh khejur gur is here","theme":"chili","image":"/img/placeholders/gur.svg"},{"headline":"Warm up","theme":"clove","image":"/img/placeholders/shawl.svg"}]' WHERE slug = 'winter'`);
    await t.sql(`UPDATE settings SET value = '[{"headline":"A","image":"/img/placeholders/masala.svg"},{"headline":"B","image":"/img/placeholders/press.svg"}]' WHERE key = 'default_banners'`);
    await t.sql('DELETE FROM cache_purges');
    for (const s of migration) await t.sql(s);

    const cats = Object.fromEntries((await t.sql<{ slug: string; icon_url: string }>('SELECT slug, icon_url FROM categories')).map(r => [r.slug, r.icon_url]));
    expect(cats['khejur-gur']).toBe('/img/photos/sq/cat-khejur-gur.webp');
    expect(cats.shoes).toBe('/media/c/own-photo.webp');
    expect(Object.values(cats).some(u => u.startsWith('/img/placeholders/'))).toBe(false);
    expect(await t.sql("SELECT url FROM product_media WHERE url LIKE '/img/placeholders/%'")).toEqual([]);
    const [{ url }] = await t.sql<{ url: string }>("SELECT url FROM product_media WHERE product_id = (SELECT id FROM products WHERE slug = '42-item-master-masala')");
    expect(url).toBe('/img/photos/sq/p-masala.webp');
    const [{ banners }] = await t.sql<{ banners: string }>("SELECT banners FROM seasons WHERE slug = 'winter'");
    expect(JSON.parse(banners)).toMatchObject([{ image: '/img/photos/wide/hero-winter-gur.webp', wide: true }, { image: '/img/photos/sq/banner-winter-wear.webp' }]);
    expect(JSON.parse(banners)[1].wide).toBeUndefined();
    const [{ value }] = await t.sql<{ value: string }>("SELECT value FROM settings WHERE key = 'default_banners'");
    expect(JSON.parse(value)).toMatchObject([{ image: '/img/photos/sq/banner-pantry.webp' }, { image: '/img/photos/wide/hero-food-business.webp', wide: true }]);
    // Every cached page is refreshed so the photos show.
    expect(await t.sql('SELECT tag FROM cache_purges')).toEqual([{ tag: 'site' }]);
  });
});

describe('homepage photos', () => {
  it('loads the first banner photo first, in every width, and the other banners later', async () => {
    // Winter is on (its banners show), whatever today's date is.
    await t.sql("UPDATE seasons SET starts_on = date('now', '-10 days'), ends_on = date('now', '+60 days'), is_enabled = 1 WHERE slug = 'winter'");
    const html = await (await t.fetch('/')).text();
    const bg = html.match(/<img class="hero-bg"[^>]*>/)![0];
    expect(bg).toContain('src="/img/photos/wide/hero-winter-gur.webp"');
    expect(bg).toContain('hero-winter-gur-1280.webp 1280w');
    expect(bg).toContain('sizes="(max-width: 719px) 104vw');
    expect(bg).toContain('fetchpriority="high"');
    expect(bg).toContain('loading="eager"');
    const side = html.match(/<img class="hero-photo"[^>]*>/)![0];
    expect(side).toContain('banner-winter-wear-720.webp 720w');
    expect(side).toContain('loading="lazy"');
    expect(html).toContain('class="hero-slide hero-wide theme-chili"');
    expect(html).toContain('class="hero-slide hero-side theme-clove"');
    // Category circles and product cards offer the small copies; no drawings are left on the page.
    expect(html).toMatch(/<img src="\/img\/photos\/sq\/cat-[\w-]+\.webp" srcset="[^"]*-240\.webp 240w/);
    expect(html).not.toContain('/img/placeholders/');
  });
});
