/**
 * The "For small food businesses" band on the homepage is editable from Website & banners (settings key biz_band),
 * manually, with no schedule or season. Until the owner touches it, the homepage shows the original wording and photo.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from './env';

let t: TestEnv;
beforeAll(async () => { t = await createTestEnv(); });
afterAll(async () => { await t?.dispose(); });

const home = () => t.fetch('/').then(r => r.text());
const setBand = (band: unknown) => t.adminJson('/settings', 'PUT', { biz_band: JSON.stringify(band) });

describe('the editable "food businesses" band', () => {
  it('shows the built-in wording and photo by default', async () => {
    const html = await home();
    expect(html).toContain('Make fuchka, chotpoti and chanachur to sell');
    expect(html).toContain('For small food businesses');
    expect(html).toContain('/img/photos/sq/cat-press');
  });

  it('shows the owner’s photo, words and buttons after a manual change', async () => {
    expect((await setBand({
      enabled: true, kicker: 'নতুন অফার', title: 'Custom band heading', chips: ['One tick', 'Two tick'],
      cta1Text: 'Buy now', cta1Href: '/shop', cta2Text: '', cta2Href: '', image: '/media/b/custom-photo.webp',
    })).status).toBe(200);
    const html = await home();
    expect(html).toContain('Custom band heading');
    expect(html).toContain('নতুন অফার');
    expect(html).toContain('/media/b/custom-photo.webp');
    expect(html).toContain('One tick');
    expect(html).toContain('Buy now');
    expect(html).not.toContain('Make fuchka, chotpoti and chanachur to sell');
    // An empty second button is dropped (that text is the default second button only).
    expect(html).not.toContain('Bulk &amp; dealer inquiry');
  });

  it('hides the whole band when the owner turns it off', async () => {
    expect((await setBand({ enabled: false })).status).toBe(200);
    const html = await home();
    // The band's own text is gone (the .biz-band CSS rule stays in the stylesheet, so test the content, not the class).
    expect(html).not.toContain('Custom band heading');
    expect(html).not.toContain('নতুন অফার');
    expect(html).not.toContain('Make fuchka, chotpoti and chanachur to sell');
  });

  it('rejects text that is too long, and an unsafe button link falls back', async () => {
    expect((await setBand({ enabled: true, title: 'x'.repeat(130) })).status).toBe(400);
    expect((await setBand({ enabled: true, title: 'Safe title', cta1Text: 'Go', cta1Href: 'javascript:alert(1)' })).status).toBe(200);
    const html = await home();
    expect(html).not.toContain('javascript:alert');
  });
});
