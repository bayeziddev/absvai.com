import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { transformSync } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { copyOf, originalOf, smallOf, srcsetOf } from '../../worker/src/lib/images';

describe('photo sizes', () => {
  it('offers 480, 960 and the original for uploaded photos', () => {
    expect(srcsetOf('/media/p/12/ab-cd.webp')).toBe('/media/p/12/ab-cd-480.webp 480w, /media/p/12/ab-cd-960.webp 960w, /media/p/12/ab-cd.webp 1600w');
    expect(srcsetOf('/media/c/x.jpg')).toContain('/media/c/x-960.jpg 960w');
    expect(smallOf('/media/b/x.webp')).toBe('/media/b/x-480.webp');
  });

  it('leaves built-in pictures, logos, PDFs and outside links alone', () => {
    for (const u of ['/img/placeholders/gur.svg', '/media/brand/logo.png', '/media/p/3/manual.pdf', 'https://example.com/a.webp', '/media/p/3/a.png', null]) {
      expect(srcsetOf(u)).toBeUndefined();
    }
    expect(smallOf('/img/placeholders/gur.svg')).toBe('/img/placeholders/gur.svg');
  });

  it('finds the original of a missing copy', () => {
    expect(originalOf(copyOf('p/4/8cf59f3e-1620-4b6e-ae28-8caf4559d335.webp', 480))).toBe('p/4/8cf59f3e-1620-4b6e-ae28-8caf4559d335.webp');
    expect(originalOf('p/4/8cf59f3e-1620-4b6e-ae28-8caf4559d335.webp')).toBeNull();
  });
});

describe('first-load budget', () => {
  it('keeps the stylesheet put inside every page under 12 KB gzipped', () => {
    const css = transformSync(readFileSync('public/css/app.css', 'utf8'), { loader: 'css', minify: true }).code;
    expect(gzipSync(css).length).toBeLessThan(12 * 1024);
  });
});

describe('courier statuses', async () => {
  const { courierOutcome } = await import('../../worker/src/services/couriers');
  it('maps Steadfast and Pathao statuses to our stages', () => {
    expect(courierOutcome('delivered')).toEqual({ to: 'delivered' });
    expect(courierOutcome('order.delivered')).toEqual({ to: 'delivered' });
    expect(courierOutcome('delivered_approval_pending')).toEqual({ sub: 'awaiting_approval' });
    expect(courierOutcome('partial_delivered')).toEqual({ sub: 'awaiting_approval' });
    expect(courierOutcome('cancelled')).toEqual({ to: 'returned' });
    expect(courierOutcome('order.returned')).toEqual({ to: 'returned' });
    expect(courierOutcome('order.delivery-failed')).toEqual({ sub: 'on_hold' });
    expect(courierOutcome('order.pickup-cancelled')).toEqual({ sub: 'on_hold' });
    expect(courierOutcome('hold')).toEqual({ sub: 'on_hold' });
    expect(courierOutcome('order.picked')).toEqual({ sub: 'picked_up' });
    expect(courierOutcome('order.in-transit')).toEqual({ sub: 'in_transit' });
    expect(courierOutcome('order.assigned-for-delivery')).toEqual({ sub: 'out_for_delivery' });
    expect(courierOutcome('in_review')).toEqual({ sub: null });
  });
});
