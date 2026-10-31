/**
 * A landing page (/lp/:slug): one product, built to sell. Order buttons sit at the top, after the photos, after the
 * video and in a bar that follows the customer down the page; they all lead to the order form at the bottom, which is
 * the real checkout form (address finder, coupon, fraud checks), so nothing is lost by ordering here.
 */
import { formatTaka } from '../lib/money';
import { ACCENT_COLORS, youtubeId, type LandingContent } from '../lib/landing';
import type { ProductDetail } from '../repo/catalog';
import { Icon } from './icons';
import { CheckoutForm } from './pages';
import { ReviewsSection, type ReviewSummary } from './reviews';

export interface LandingView {
  id: number; title: string; slug: string; draft: boolean;
  c: LandingContent; d: ProductDetail; reviews: ReviewSummary;
  wallets: Array<{ wallet: string; number: string; type?: string }>; turnstileSiteKey?: string;
  phone: string | null; whatsapp: string | null; etaText: string | null;
}

const optionLabel = (attrs: Record<string, string>) => Object.values(attrs).join(' · ');

/** The options this page sells: the ones the owner picked (or all), only those that can be bought now. */
export function landingVariants(v: Pick<LandingView, 'c' | 'd'>) {
  const all = v.d.variants.filter(x => v.d.availabilityByVariant[x.id]?.canBuy !== false);
  const picked = v.c.variantIds ? all.filter(x => v.c.variantIds!.includes(x.id)) : all;
  return picked.length ? picked : all;
}

function Cta({ c, big = false }: { c: LandingContent; big?: boolean }) {
  return (
    <div class={`lp-cta-wrap${big ? ' big' : ''}`}>
      <a class="btn lp-cta" href="#order" data-lp-cta><Icon name="bag" size={22} />{c.ctaText}</a>
      {c.ctaNote && <p class="lp-cta-note">{c.ctaNote}</p>}
    </div>
  );
}

export function LandingPage(v: LandingView) {
  const { c, d } = v;
  const prod = d.product as Record<string, string | number | null>;
  const options = landingVariants(v);
  const first = options[0];
  const price = first?.pricePaisa ?? 0;
  const many = new Set(options.map(o => o.pricePaisa)).size > 1;
  const was = c.regularPricePaisa ?? first?.compareAtPricePaisa ?? null;
  const save = was && was > price ? was - price : 0;
  const photos = d.media.filter(m => m.kind === 'image').map(m => m.url);
  const hero = c.heroImage ?? photos[0] ?? null;
  const gallery = c.gallery.length ? c.gallery : photos.filter(u => u !== hero).slice(0, 8);
  const vid = c.video ? youtubeId(c.video.url) : null;
  const paragraphs = c.description.split(/\n{2,}/).map(t => t.trim()).filter(Boolean);
  const reviews: ReviewSummary = c.showProductReviews ? v.reviews : { items: [], count: 0, average: 0, stars: [0, 0, 0, 0, 0] };
  const hasReviews = c.reviews.length > 0 || reviews.count > 0;
  const canBuy = options.length > 0;
  return (
    <div class={`lp accent-${c.accent}`} style={`--lp:${ACCENT_COLORS[c.accent]}`} data-lp={String(v.id)}>
      {v.draft && <p class="lp-draft">Preview: this page is a draft. Only signed-in staff can see it.</p>}

      <section class="lp-hero">
        <div class="lp-hero-text">
          {c.badge && <span class="lp-badge">{c.badge}</span>}
          <h1>{c.headline || String(prod.name)}</h1>
          {c.subheadline && <p class="lp-sub">{c.subheadline}</p>}
          {canBuy && (
            <div class="lp-price">
              <strong>{many ? 'From ' : ''}{formatTaka(price)}</strong>
              {save > 0 && <><s>{formatTaka(was!)}</s><span class="lp-save">{formatTaka(save)} ছাড়</span></>}
            </div>
          )}
          {canBuy ? <Cta c={c} big /> : <p class="notice">This product is out of stock right now. Please check back soon.</p>}
          <ul class="lp-trust">
            <li><Icon name="cash" size={18} />ক্যাশ অন ডেলিভারি</li>
            <li><Icon name="truck" size={18} />{v.etaText ? `ডেলিভারি ${v.etaText}` : 'সারা দেশে হোম ডেলিভারি'}</li>
            <li><Icon name="return" size={18} />পণ্য দেখে টাকা দিন</li>
          </ul>
        </div>
        {hero && <div class="lp-hero-img"><img src={hero} alt={String(prod.name)} width="720" height="720" fetchpriority="high" decoding="async" /></div>}
      </section>

      {gallery.length > 0 && (
        <section class="lp-section">
          <div class="lp-gallery">{gallery.map((u, i) => <button type="button" class="lp-photo" data-lp-photo={u} aria-label={`Photo ${i + 1}`}><img src={u} alt="" loading="lazy" decoding="async" width="400" height="400" /></button>)}</div>
        </section>
      )}

      {(paragraphs.length > 0 || c.points.length > 0) && (
        <section class="lp-section lp-about">
          {paragraphs.length > 0 && <><h2>পণ্যের বিবরণ</h2>{paragraphs.map(t => <p>{t}</p>)}</>}
          {c.points.length > 0 && <ul class="lp-points">{c.points.map(t => <li><Icon name="check" size={20} /><span>{t}</span></li>)}</ul>}
          {canBuy && <Cta c={c} />}
        </section>
      )}

      {c.details.length > 0 && (
        <section class="lp-section">
          <h2>বিস্তারিত তথ্য</h2>
          <div class="table-wrap"><table class="lp-details"><tbody>{c.details.map(x => <tr><th>{x.label}</th><td>{x.value}</td></tr>)}</tbody></table></div>
        </section>
      )}

      {vid && c.video && (
        <section class="lp-section lp-video">
          {c.video.title && <h2>{c.video.title}</h2>}
          <div class="video-lite" data-youtube={vid}>
            <img src={`https://i.ytimg.com/vi/${vid}/hqdefault.jpg`} alt="" loading="lazy" width="480" height="360" />
            <button class="video-play" type="button" aria-label="Play the video"><Icon name="play" size={28} /></button>
          </div>
          {c.video.description && <p>{c.video.description}</p>}
          {canBuy && <Cta c={c} />}
        </section>
      )}

      {hasReviews && <div class="lp-section"><ReviewsSection productId={Number(prod.id)} s={reviews} canWrite={false} extra={c.reviews} title="গ্রাহকদের মতামত" /></div>}

      {c.faq.length > 0 && (
        <section class="lp-section lp-faq">
          <h2>সাধারণ জিজ্ঞাসা</h2>
          {c.faq.map((f, i) => <details open={i === 0}><summary>{f.q}</summary><p>{f.a}</p></details>)}
        </section>
      )}

      {canBuy && (
        <section class="lp-section lp-order" id="order">
          <h2>অর্ডার করতে নিচের ফর্মটি পূরণ করুন</h2>
          <p class="lp-order-sub">{c.ctaNote || 'ক্যাশ অন ডেলিভারি'} · {String(prod.name)}</p>
          {options.length > 1 && (
            <fieldset class="lp-options" data-lp-options>
              <legend>কোনটি নেবেন?</legend>
              {options.map((o, i) => (
                <label class="lp-option"><input type="radio" name="lpVariant" value={String(o.id)} checked={i === 0} data-price={String(o.pricePaisa)} />
                  <span><b>{optionLabel(o.attributes) || String(prod.name)}</b><span>{formatTaka(o.pricePaisa)}</span></span></label>
              ))}
            </fieldset>
          )}
          <div class="lp-qty"><span>পরিমাণ</span>
            <div class="qty-stepper"><button type="button" data-lp-qty="-1" aria-label="One less">−</button><input type="number" min="1" max="20" value="1" data-lp-qty-input aria-label="Quantity" inputmode="numeric" /><button type="button" data-lp-qty="1" aria-label="One more">+</button></div>
          </div>
          <CheckoutForm wallets={v.wallets} turnstileSiteKey={v.turnstileSiteKey} couponCode={c.couponCode} placeLabel={c.ctaText} compact />
          {(v.phone || v.whatsapp) && (
            <p class="lp-help">অর্ডার করতে সমস্যা? {v.phone && <a href={`tel:${v.phone}`}><Icon name="phone" size={16} /> কল করুন {v.phone}</a>}{v.whatsapp && <a href={`https://wa.me/${v.whatsapp}`} target="_blank" rel="noopener"><Icon name="whatsapp" size={16} /> WhatsApp</a>}</p>
          )}
        </section>
      )}

      {canBuy && c.stickyBar && (
        <div class="lp-sticky" data-lp-sticky>
          <div><strong data-lp-sticky-price>{formatTaka(price)}</strong>{save > 0 && <s>{formatTaka(was!)}</s>}</div>
          <a class="btn lp-cta" href="#order" data-lp-cta>{c.ctaText}</a>
        </div>
      )}

      <dialog class="lp-viewer" data-lp-viewer><button type="button" class="icon-btn" data-lp-close aria-label="Close"><Icon name="close" /></button><img alt="" /></dialog>
    </div>
  );
}
