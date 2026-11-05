import type { CategoryNode, ProductCard, ProductDetail } from '../repo/catalog';
import { formatDate, formatDateTime } from '../lib/dates';
import { TRACK_STAGES } from '../lib/tracking';
import type { TrackedOrder, TrackResult } from '../services/tracking';
import { SIZES, smallOf, srcsetOf } from '../lib/images';
import { companyName, storeName } from '../lib/brand';
import { formatTaka, formatUnitPrice, unitPrice } from '../lib/money';
import { localPhone, maskPhone } from '../lib/phone';
import { STATUS_LABELS, type OrderStatus } from '../lib/state-machine';
import { effectiveVariantAttributes, formatNetQuantity, infoPanels } from '../lib/templates';
import { Banner, Breadcrumbs, Burst, CategoryCarousel, CheckChip, Empty, Grid, HeroCarousel, OriginalsSeal, Pagination, PromoBanner, Rail, SectionTitle, TrustStrip } from './components';
import { Icon } from './icons';
import { RatingLine, ReviewsSection, type ReviewSummary } from './reviews';
import { orderAddress } from '../lib/print';

// ───────────── Home ─────────────

/** The business band's photo: a press making chanachur. */
const BIZ_PHOTO = '/img/photos/sq/cat-press.webp';

export function HomePage(p: {
  banners: Banner[]; categories: CategoryNode[]; seasonal: Set<number>; activeSeason: { slug: string; name: string } | null;
  inSeason: ProductCard[]; featured: ProductCard[]; originals: ProductCard[]; deals: ProductCard[]; newArrivals: ProductCard[]; promo: Banner | null; settings: Record<string, string>;
}) {
  // The first row of products is on screen on a phone, so its photos load with the page. Sections further down are
  // drawn only as they scroll near (class "cv"), which keeps the first paint light.
  const seasonFirst = Boolean(p.activeSeason && p.inSeason.length > 0);
  return (
    <>
      <HeroCarousel banners={p.banners} />
      <CategoryCarousel categories={p.categories} seasonal={p.seasonal} />
      {seasonFirst && (
        <section class="section">
          <SectionTitle title={`In Season Now · ${p.activeSeason!.name}`} href={`/season/${p.activeSeason!.slug}`} />
          <Rail items={p.inSeason} label="In season now" eagerCount={2} />
        </section>
      )}
      {p.featured.length > 0 && (
        <section class={seasonFirst ? 'section cv' : 'section'}>
          <SectionTitle title="Picked for you" href="/shop" />
          <Rail items={p.featured} label="Picked for you" eagerCount={seasonFirst ? 0 : 2} />
        </section>
      )}
      {p.originals.length > 0 && (
        <section class="section section-originals cv">
          <SectionTitle title={`${storeName(p.settings)} Originals`} href="/originals" />
          <p class="section-lead">Made and packed by {companyName(p.settings)}.</p>
          <Rail items={p.originals} label={`${storeName(p.settings)} Originals`} />
        </section>
      )}
      {p.deals.length > 0 && (
        <section class="section cv">
          <SectionTitle title="Hot Deals" href="/deals" />
          <Grid items={p.deals} />
        </section>
      )}
      <section class="section cv">
        <div class="biz-band">
          <div>
            <p class="biz-kicker">For small food businesses</p>
            <h2 class="biz-title">Make fuchka, chotpoti and chanachur to sell</h2>
            <ul class="chips">
              <CheckChip>Presses and sealers</CheckChip>
              <CheckChip>42 Item Master Masala in 1kg packs</CheckChip>
              <CheckChip>Wholesale prices on 5+ packs</CheckChip>
            </ul>
            <div class="biz-actions">
              <a class="btn btn-cta" href="/c/food-business-machines">See machines</a>
              <a class="btn btn-outline-light" href="/contact#wholesale">Bulk & dealer inquiry</a>
            </div>
          </div>
          <img src={BIZ_PHOTO} srcset={srcsetOf(BIZ_PHOTO)} sizes={SIZES.bizBand} alt="" width="600" height="600" loading="lazy" decoding="async" />
        </div>
      </section>
      <PromoBanner b={p.promo} />
      {p.newArrivals.length > 0 && (
        <section class="section cv">
          <SectionTitle title="New Arrivals" href="/new" />
          <Rail items={p.newArrivals} label="New arrivals" />
        </section>
      )}
      <TrustStrip whatsapp={p.settings.whatsapp_number?.replace(/\D/g, '')} phone={p.settings.support_phone} />
    </>
  );
}

// ───────────── Listing ─────────────

export interface Facet { key: string; label: string; kind: 'f' | 'a'; values: Array<{ value: string; count: number; label?: string }> }

export function ListingPage(p: {
  title: string; description?: string; crumbs: Array<{ name: string; href?: string }>; items: ProductCard[]; total: number; page: number; perPage: number;
  url: URL; facets: Facet[]; subcategories?: CategoryNode[]; banner?: { text: string; tone: 'season' | 'off' } | null; countdownTo?: string | null; emptyText?: string;
}) {
  const sp = p.url.searchParams;
  const activeFilters = [...sp.entries()].filter(([k]) => k.startsWith('f.') || k.startsWith('a.')).length + (sp.get('min') || sp.get('max') ? 1 : 0);
  const showLink = (n: number) => { const u = new URL(p.url); u.searchParams.set('show', String(n)); u.searchParams.delete('page'); return `${u.pathname}${u.search}`; };
  return (
    <div class="container">
      <Breadcrumbs items={p.crumbs} />
      <header class="listing-head">
        <h1>{p.title}</h1>
        {p.description && <p class="lead">{p.description}</p>}
        {p.banner && <p class={`season-note ${p.banner.tone === 'off' ? 'season-off' : ''}`}><Icon name="sun" size={18} />{p.banner.text}</p>}
        {p.countdownTo && <p class="countdown" data-countdown={p.countdownTo}>Season ends {formatDate(p.countdownTo)}</p>}
      </header>
      {p.subcategories && p.subcategories.length > 0 && (
        <nav class="subcats" aria-label="Subcategories">{p.subcategories.map(c => <a class="pill-link" href={`/c/${c.slug}`}>{c.name}</a>)}</nav>
      )}
      <form class="toolbar" method="get" data-toolbar>
        {sp.get('q') && <input type="hidden" name="q" value={sp.get('q')!} />}
        <button class="btn btn-outline btn-sm" type="button" data-filter-open aria-controls="filters"><Icon name="filter" size={18} />Filter{activeFilters ? ` (${activeFilters})` : ''}</button>
        <div class="show-n" aria-label="Products per page">
          <span>Show</span>
          {[10, 20, 30, 40].map(n => <a href={showLink(n)} aria-current={p.perPage === n ? 'true' : undefined}>{n}</a>)}
        </div>
        <label class="sort">
          <span class="sr-only">Sort by</span>
          <select name="sort" data-autosubmit>
            {[['default', 'Sort by: Popular'], ['newest', 'Newest'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low'], ['best_selling', 'Best selling'], ['discount', 'Biggest saving']].map(([v, l]) => <option value={v} selected={(sp.get('sort') ?? 'default') === v}>{l}</option>)}
          </select>
        </label>
        <input type="hidden" name="show" value={String(p.perPage)} />
        <noscript><button class="btn btn-sm btn-outline" type="submit">Apply</button></noscript>
        <dialog class="filters" id="filters" data-filters>
          <div class="sheet-head"><h2>Filter</h2><button class="icon-btn" type="button" data-filter-close aria-label="Close filters"><Icon name="close" /></button></div>
          <div class="filters-body">
            {p.facets.map(f => (
              <fieldset>
                <legend>{f.label}</legend>
                {f.values.map(v => (
                  <label class="check-row"><input type="checkbox" name={`${f.kind}.${f.key}`} value={v.value} checked={sp.getAll(`${f.kind}.${f.key}`).includes(v.value)} /><span>{v.label ?? v.value}</span><small>{v.count}</small></label>
                ))}
              </fieldset>
            ))}
            <fieldset>
              <legend>Price (৳)</legend>
              <div class="price-range">
                <label>Min<input type="number" name="min" inputmode="numeric" min="0" value={sp.get('min') ?? ''} /></label>
                <label>Max<input type="number" name="max" inputmode="numeric" min="0" value={sp.get('max') ?? ''} /></label>
              </div>
            </fieldset>
          </div>
          <div class="filters-foot">
            <a class="btn btn-ghost" href={`${p.url.pathname}${sp.get('q') ? `?q=${encodeURIComponent(sp.get('q')!)}` : ''}`}>Clear</a>
            <button class="btn btn-primary" type="submit">Show results</button>
          </div>
        </dialog>
      </form>
      <p class="result-count">{p.total} product{p.total === 1 ? '' : 's'}</p>
      {p.items.length ? <Grid items={p.items} eagerCount={4} /> : <Empty title="Nothing here yet">{p.emptyText && <p>{p.emptyText}</p>}<a class="btn btn-primary" href="/shop">Browse all products</a></Empty>}
      <Pagination page={p.page} total={p.total} perPage={p.perPage} baseUrl={p.url} />
    </div>
  );
}

// ───────────── Product ─────────────

const youtubeId = (url: string) => url.match(/(?:v=|youtu\.be\/)([\w-]{6,})/)?.[1] ?? null;

export function ProductPage(p: { d: ProductDetail; related: ProductCard[]; zones: Array<{ name: string; eta_text: string; base_charge_paisa: number }>; freeThresholdPaisa: number; settings: Record<string, string>; soldBy?: { shop_name: string; slug: string } | null; reviews?: ReviewSummary }) {
  const wa = p.settings.whatsapp_number?.replace(/\D/g, '') || null;
  const { d } = p;
  const prod = d.product as Record<string, string | number | null>;
  const attrs = effectiveVariantAttributes(d.template, d.promotedSpecKeys).filter(a => d.variants.some(v => v.attributes[a.attributeTypeId]));
  const first = [...d.variants].sort((a, b) => a.pricePaisa - b.pricePaisa).find(v => d.availabilityByVariant[v.id]?.canBuy) ?? d.variants[0];
  const images = d.media.filter(m => m.kind === 'image');
  const save = first?.compareAtPricePaisa && first.compareAtPricePaisa > first.pricePaisa ? first.compareAtPricePaisa - first.pricePaisa : 0;
  const unit = first ? formatUnitPrice(unitPrice(first.pricePaisa, first.netValue, first.netUnit)) : '';
  const panels = infoPanels(d.template, d.specs, d.promotedSpecKeys);
  const manual = d.media.find(m => m.kind === 'manual');
  const vid = prod.video_url ? youtubeId(String(prod.video_url)) : null;
  const a = first ? d.availabilityByVariant[first.id] : d.availability;
  const chips = [...d.benefitChips];
  if (d.specs.bonus_item && !chips.some(c => /bonus|free/i.test(c))) chips.push(`Free bonus: ${d.specs.bonus_item}`);
  if (prod.free_delivery) chips.push('Free delivery');
  const sizeAttr = attrs.find(x => /size/.test(x.attributeTypeId));

  return (
    <div class="container">
      <Breadcrumbs items={[{ name: 'Home', href: '/' }, ...(d.category.parent ? [{ name: d.category.parent.name, href: `/c/${d.category.parent.slug}` }] : []), { name: d.category.name, href: `/c/${d.category.slug}` }, { name: String(prod.name) }]} />
      <div class="pdp" data-pdp>
        <div class="pdp-gallery">
          <div class="gallery-main">
            <img id="pdp-main" src={images[0]?.url ?? '/img/placeholders/none.svg'} srcset={srcsetOf(images[0]?.url)} sizes={SIZES.pdp} alt={images[0]?.alt ?? String(prod.name)} width="600" height="600" fetchpriority="high" />
            <Burst savePaisa={save} />
          </div>
          {images.length > 1 && (
            <div class="gallery-thumbs" role="list">
              {images.map((m, i) => <button type="button" role="listitem" data-thumb={m.url} data-media-id={String(m.id)} aria-label={`Photo ${i + 1}`} aria-current={i === 0 ? 'true' : undefined}><img src={smallOf(m.url)} alt="" width="80" height="80" loading="lazy" decoding="async" /></button>)}
            </div>
          )}
        </div>

        <div class="pdp-info">
          {prod.is_original ? <OriginalsSeal store={storeName(p.settings)} /> : null}
          <h1 class="pdp-title">{prod.name}</h1>
          {p.reviews && <RatingLine s={p.reviews} />}
          {p.soldBy && <p class="sold-by"><Icon name="shield" size={14} />Sold by <a href={`/store/${p.soldBy.slug}`}>{p.soldBy.shop_name}</a> · delivered by {storeName(p.settings)}</p>}
          {prod.short_description && <p class="pdp-short">{prod.short_description}</p>}
          {d.claims.length > 0 && <ul class="claims">{d.claims.map(c => <li><Icon name="shield" size={14} />{c.claim}</li>)}</ul>}

          <div class="pdp-price">
            <strong data-price>{first ? formatTaka(first.pricePaisa) : ''}</strong>
            <s data-compare hidden={!save}>{first?.compareAtPricePaisa ? formatTaka(first.compareAtPricePaisa) : ''}</s>
            <span class="save-pill" data-save hidden={!save}>{save ? `Save ${formatTaka(save)}` : ''}</span>
          </div>
          <p class="unit-price" data-unit>{unit}</p>
          <p class={`avail avail-${a.state}`} data-avail>{a.label}{a.state === 'available' && first && first.available <= 5 ? ` · only ${first.available} left` : ''}</p>
          {first && first.wholesaleTiers.length > 0 && (
            <div class="tiers" data-tiers>
              <p><Icon name="tag" size={16} />Wholesale prices</p>
              <ul>{first.wholesaleTiers.map(t => <li>Buy {t.minQty}+ : <strong>{formatTaka(t.pricePaisa)}</strong> each</li>)}</ul>
            </div>
          )}

          <form class="pdp-form" data-pdp-form>
            {attrs.map(at => {
              const values = [...new Set(d.variants.map(v => v.attributes[at.attributeTypeId]).filter(Boolean))];
              return (
                <fieldset class="opt" data-attr={at.attributeTypeId}>
                  <legend>{at.label}: <span data-selected-label={at.attributeTypeId}>{first?.attributes[at.attributeTypeId] ?? ''}</span></legend>
                  <div class={`opt-values ${at.input === 'swatch' ? 'opt-swatches' : ''}`}>
                    {values.map(v => (
                      <label class="opt-chip">
                        <input type="radio" name={`opt-${at.attributeTypeId}`} value={v} checked={first?.attributes[at.attributeTypeId] === v} />
                        <span style={at.input === 'swatch' && at.swatches?.[v] ? `--sw:${at.swatches[v]}` : undefined} class={at.input === 'swatch' ? 'swatch' : undefined}>{v}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
            {d.sizeChart && d.sizeChart.rows.length > 0 && (
              <button class="link-btn" type="button" data-open-dialog="size-chart"><Icon name="ruler" size={16} />Size chart{sizeAttr ? ` (${sizeAttr.label})` : ''}</button>
            )}
            <div class="qty">
              <span>Quantity</span>
              <div class="stepper">
                <button type="button" data-qty="-1" aria-label="One less"><Icon name="minus" size={18} /></button>
                <input type="number" name="qty" value="1" min="1" max="99" inputmode="numeric" aria-label="Quantity" />
                <button type="button" data-qty="1" aria-label="One more"><Icon name="plus" size={18} /></button>
              </div>
            </div>
            <div class="pdp-actions" data-actions hidden={!a.canBuy}>
              <button class="btn btn-outline btn-lg" type="button" data-pdp-add>Add to Cart</button>
              <button class="btn btn-primary btn-lg" type="button" data-pdp-order>{a.state === 'pre_order' ? 'Pre-order now' : 'Order Now'}</button>
            </div>
            {wa && a.canBuy && (
              <a class="btn btn-whatsapp btn-lg btn-block" href={`https://wa.me/${wa}`} target="_blank" rel="noopener" data-wa-product>
                <Icon name="whatsapp" size={20} />WhatsApp-এ অর্ডার করুন
              </a>
            )}
          </form>

          {d.availability.state === 'out_of_season' && (
            <form class="notify" id="notify" data-notify={String(prod.id)}>
              <p class="notify-title"><Icon name="clock" size={18} />{d.availability.label}. Want a text when it’s back?</p>
              <div class="notify-row">
                <label class="sr-only" for="notify-phone">Mobile number</label>
                <input id="notify-phone" name="phone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="01XXXXXXXXX" required />
                <select name="channel" aria-label="How should we tell you?"><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option></select>
                <button class="btn btn-primary" type="submit">Notify me</button>
              </div>
              <p class="form-msg" data-msg aria-live="polite" />
            </form>
          )}

          {chips.length > 0 && <ul class="chips">{chips.map(c => <CheckChip>{c}</CheckChip>)}</ul>}

          <div class="delivery-box">
            <p><Icon name="truck" size={18} /><strong>Delivery</strong>{prod.shipping_profile === 'heavy_bulky' ? ' · large item' : ''}</p>
            <ul>{p.zones.map(z => <li><span>{z.name}</span><span>{z.eta_text}{prod.free_delivery ? ' · Free' : ''}</span></li>)}</ul>
            {p.freeThresholdPaisa > 0 && !prod.free_delivery && prod.shipping_profile !== 'heavy_bulky' && <p class="small">Free delivery on orders over {formatTaka(p.freeThresholdPaisa)}. Exact charge shown at checkout.</p>}
            {prod.shipping_profile === 'heavy_bulky' && <p class="small">Large items need the delivery charge paid in advance by bKash/Nagad.</p>}
            {prod.fulfilment_mode === 'pre_order' && <p class="small">Pre-order: ships from {String(prod.preorder_dispatch_date ?? 'the season start')}. {prod.preorder_advance_type === 'fixed' ? `Advance ${formatTaka(Number(prod.preorder_advance_paisa))} to book.` : 'Delivery charge paid in advance to book.'}</p>}
            <p class="small"><Icon name="cash" size={16} />Cash on Delivery available. Check the parcel before you pay.</p>
          </div>
        </div>
      </div>

      <section class="pdp-panels">
        {prod.description && (
          <details open><summary>Description</summary><div class="prose">{String(prod.description).split(/\n{2,}/).map(par => <p>{par}</p>)}</div></details>
        )}
        {panels.map(panel => (
          <details open={panel.panel === 'food' || panel.panel === 'specs'}>
            <summary>{panel.title}</summary>
            <dl class="spec-list">{panel.rows.map(r => <><dt>{r.label}</dt><dd>{r.type === 'file' ? <a href={r.value} target="_blank" rel="noopener"><Icon name="file" size={16} />Download</a> : r.value}</dd></>)}</dl>
          </details>
        ))}
        {manual && <p><a class="btn btn-outline" href={manual.url} target="_blank" rel="noopener"><Icon name="file" size={18} />Download the user manual (PDF)</a></p>}
      </section>

      {vid && (
        <section class="section">
          <h2 class="brush-title"><span>How it works</span></h2>
          <div class="video-lite" data-youtube={vid}>
            <img src={`https://i.ytimg.com/vi/${vid}/hqdefault.jpg`} alt="" loading="lazy" width="480" height="360" />
            <button class="video-play" type="button" aria-label="Play the how-it-works video"><Icon name="play" size={28} /></button>
          </div>
        </section>
      )}

      {p.reviews && (p.reviews.count > 0 || p.settings.reviews_enabled !== '0') && <ReviewsSection productId={Number(prod.id)} s={p.reviews} canWrite={p.settings.reviews_enabled !== '0'} />}

      {p.related.length > 0 && (
        <section class="section">
          <SectionTitle title="You may also like" href={`/c/${d.category.slug}`} />
          <Rail items={p.related} label="Related products" />
        </section>
      )}

      {d.sizeChart && d.sizeChart.rows.length > 0 && (
        <dialog id="size-chart" class="dialog">
          <div class="sheet-head"><h2>Size chart</h2><button class="icon-btn" type="button" data-close-dialog aria-label="Close"><Icon name="close" /></button></div>
          <div class="table-wrap">
            <table><thead><tr><th>Size</th>{d.sizeChart.columns.map(c => <th>{c}</th>)}</tr></thead>
              <tbody>{d.sizeChart.rows.map(r => <tr><th>{r.size}</th>{r.values.map(v => <td>{v}</td>)}</tr>)}</tbody></table>
          </div>
        </dialog>
      )}

      <div class="sticky-buy" data-sticky-buy hidden={!a.canBuy}>
        <div><strong data-price>{first ? formatTaka(first.pricePaisa) : ''}</strong><small data-variant-label>{first ? Object.values(first.attributes).join(' · ') : ''}</small></div>
        <button class="btn btn-outline" type="button" data-pdp-add>Add</button>
        <button class="btn btn-primary" type="button" data-pdp-order>{a.state === 'pre_order' ? 'Pre-order' : 'Order Now'}</button>
      </div>
    </div>
  );
}

export function productPageData(d: ProductDetail) {
  const attrs = effectiveVariantAttributes(d.template, d.promotedSpecKeys).filter(a => d.variants.some(v => v.attributes[a.attributeTypeId]));
  const media = Object.fromEntries(d.media.filter(m => m.kind === 'image').map(m => [m.id, m.url]));
  return {
    product: { id: d.product.id, slug: d.product.slug, name: d.product.name },
    attributes: attrs.map(a => a.attributeTypeId),
    variants: d.variants.map(v => ({
      id: v.id, attributes: v.attributes, pricePaisa: v.pricePaisa, compareAtPricePaisa: v.compareAtPricePaisa, stock: v.available, tiers: v.wholesaleTiers,
      unit: formatUnitPrice(unitPrice(v.pricePaisa, v.netValue, v.netUnit)), net: formatNetQuantity(v.netValue, v.netUnit),
      image: v.imageIds.map(id => media[id]).find(Boolean) ?? null, availability: d.availabilityByVariant[v.id],
    })),
  };
}

// ───────────── Cart, checkout, order ─────────────

export function CartPage() {
  return (
    <div class="container narrow">
      <h1>Your cart</h1>
      <div data-cart-page>
        <p class="muted">Loading your cart…</p>
      </div>
      <noscript><p>Please turn on JavaScript to use the cart, or call us to order.</p></noscript>
    </div>
  );
}

export function CheckoutPage(p: { wallets: Array<{ wallet: string; number: string; type?: string }>; areas: CheckoutArea[]; whatsapp?: string | null; turnstileSiteKey?: string }) {
  return (
    <div class="container" lang="bn">
      <div class="co-head">
        <div><h1>অর্ডার সম্পন্ন করুন</h1><p>আপনার তথ্য দিন, আমরা দ্রুত আপনার অর্ডারটি পৌঁছে দেব।</p></div>
        <span class="co-safe"><Icon name="shield" size={18} />নিরাপদ অর্ডার</span>
      </div>
      <noscript><p class="notice">অর্ডার করতে ব্রাউজারে JavaScript চালু রাখুন, অথবা ফোন করে অর্ডার দিন।</p></noscript>
      <CheckoutForm wallets={p.wallets} areas={p.areas} whatsapp={p.whatsapp} turnstileSiteKey={p.turnstileSiteKey} />
    </div>
  );
}

/** A delivery area the customer can choose at checkout: its name, the short line under it and the charge for up to 1 kg (the exact charge follows). */
export interface CheckoutArea { id: number; name: string; note?: string; baseChargePaisa: number }

/** ৳70 → ৳৭০, the way the delivery charges read at checkout. */
const bnTaka = (paisa: number) => formatTaka(paisa).replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[Number(d)]);

/**
 * The one-page checkout form (public/js/checkout.js drives it). The checkout page and every landing page use it, so a
 * landing-page order gets the same delivery areas, coupon, fraud checks and incomplete-order capture. In Bangla:
 * 1 your details (name, mobile), 2 the address in the customer's own words (Bangla or English) and a note, 3 payment;
 * the summary beside it shows the products with their photos and prices, the delivery-charge choices (the charge is
 * worked out for this cart and added to the total by itself), the coupon and the total. The admin stays in English.
 */
export function CheckoutForm(p: { wallets: Array<{ wallet: string; number: string; type?: string }>; areas: CheckoutArea[]; whatsapp?: string | null; turnstileSiteKey?: string; couponCode?: string | null; placeLabel?: string; compact?: boolean }) {
  return (
      <form class={`checkout${p.compact ? ' checkout-compact' : ''}`} id="checkout-form" data-checkout lang="bn" novalidate>
        <div class="co-main">
          <p class="co-account" data-co-account hidden />
          <fieldset class="co-step">
            <legend><span class="step-no">১</span>আপনার তথ্য</legend>
            <label class="field"><span>আপনার নাম <b class="req">*</b></span><input name="name" autocomplete="name" placeholder="আপনার পুরো নাম" maxlength={120} required /></label>
            <label class="field">
              <span>মোবাইল নম্বর <b class="req">*</b></span>
              <input name="phone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="01XXXXXXXXX" maxlength={14} required />
              <small class="field-hint">অর্ডার নিশ্চিত করতে এই নম্বরে কল করা হবে।</small>
            </label>
            {/* Honeypot: hidden from people, filled by bots. Orders with it filled are rejected. */}
            <label class="hp" aria-hidden="true">Website<input name="website" tabindex={-1} autocomplete="off" /></label>
          </fieldset>
          <fieldset class="co-step">
            <legend><span class="step-no">২</span>ডেলিভারি ঠিকানা</legend>
            <label class="field"><span>সম্পূর্ণ ঠিকানা <b class="req">*</b></span><textarea name="addressLine" rows={3} autocomplete="street-address" placeholder="বাসা/বাড়ি, রোড, এলাকা, থানা ও জেলা (বাংলা বা ইংরেজিতে), যেমন: বাসা ১২, রোড ৫, মিরপুর ১০, ঢাকা" maxlength={300} required /></label>
            <label class="field"><span>অতিরিক্ত নোট <small class="opt">ঐচ্ছিক</small></span><textarea name="note" rows={2} maxlength={500} placeholder="যেমন: বিকেলে ডেলিভারি দিলে ভালো হয়" /></label>
          </fieldset>
          <fieldset class="co-step">
            <legend><span class="step-no">৩</span>পেমেন্ট</legend>
            <label class="pay-option"><input type="radio" name="paymentMethod" value="cod" checked /><span><strong>ক্যাশ অন ডেলিভারি</strong><small>পণ্য হাতে পেয়ে মূল্য পরিশোধ করুন।</small></span></label>
            <label class="pay-option" data-pay-mobile hidden={!p.wallets.length}><input type="radio" name="paymentMethod" value="manual_mobile" /><span><strong>bKash / Nagad / Rocket</strong><small>আগে পেমেন্ট করে ট্রানজেকশন আইডি দিন।</small></span></label>
            <div class="advance" data-advance hidden>
              <p class="advance-title" data-advance-title />
              <ul class="advance-reasons" data-advance-reasons />
              {p.wallets.length > 0 && (
                <div class="wallets">
                  <p>অ্যাডভান্স পাঠান এই নম্বরে:</p>
                  <ul>{p.wallets.map(w => <li><strong>{w.wallet}</strong> {w.number}{w.type ? ` (${w.type})` : ''}</li>)}</ul>
                  <div class="row-2">
                    <label class="field"><span>কোন ওয়ালেট থেকে পাঠালেন</span><select name="advanceWallet">{p.wallets.map(w => <option>{w.wallet}</option>)}</select></label>
                    <label class="field"><span>ট্রানজেকশন আইডি</span><input name="advanceTrxId" autocomplete="off" placeholder="যেমন: 9JK4L2M8QX" maxlength={30} /></label>
                  </div>
                </div>
              )}
              <p class="small">অ্যাডভান্সের টাকা মোট দাম থেকে বাদ যাবে। ডেলিভারি দিতে না পারলে পুরো টাকা ফেরত দেওয়া হবে।</p>
            </div>
          </fieldset>
        </div>
        <aside class="co-summary" aria-label="অর্ডারের বিবরণ">
          <p class="co-kicker">আপনার পছন্দ</p>
          <h2>অর্ডারের বিবরণ</h2>
          <div class="co-lines" data-co-lines><p class="muted">লোড হচ্ছে…</p></div>
          <div class="co-areas">
            <h3>ডেলিভারি চার্জ</h3>
            <div class="area-options" role="radiogroup" aria-label="ডেলিভারি চার্জ" data-areas>
              {p.areas.map(a => (
                <label class="area-option">
                  <input type="radio" name="zoneId" value={String(a.id)} checked={p.areas.length === 1} />
                  <span class="area-text"><strong>{a.name}</strong>{a.note && <small>{a.note}</small>}</span>
                  <b class="area-charge" data-area-charge={String(a.id)}>{a.baseChargePaisa ? bnTaka(a.baseChargePaisa) : 'ফ্রি'}</b>
                  <span class="area-tick" aria-hidden="true"><Icon name="check" size={16} /></span>
                </label>
              ))}
            </div>
            <p class="field-note">আপনার ঠিকানা অনুযায়ী একটি অপশন নির্বাচন করুন।</p>
            <p class="co-delivery" data-co-delivery aria-live="polite" hidden />
          </div>
          <div class="coupon-box">
            <label class="field"><span>কুপন কোড <small class="opt">ঐচ্ছিক</small></span>
              <span class="coupon-row"><input name="couponCode" value={p.couponCode ?? ''} autocomplete="off" autocapitalize="characters" maxlength={30} placeholder="যেমন: EID100" /><button class="btn btn-outline" type="button" data-coupon-apply>প্রয়োগ</button></span>
            </label>
            <p class="coupon-msg" data-coupon-msg aria-live="polite" />
          </div>
          <dl class="totals">
            <dt>পণ্যের মূল্য</dt><dd data-subtotal>—</dd>
            <dt data-discount-row hidden>ছাড়</dt><dd data-discount hidden>—</dd>
            <dt>ডেলিভারি চার্জ</dt><dd data-delivery>এলাকা বেছে নিন</dd>
            <dt data-cod-row hidden>COD চার্জ</dt><dd data-cod-fee hidden>—</dd>
            <dt class="total">সর্বমোট</dt><dd class="total" data-total>—</dd>
          </dl>
          <ul class="explain" data-explain />
          <p class="eta" data-eta />
          {p.turnstileSiteKey && <div class="cf-turnstile" data-sitekey={p.turnstileSiteKey} data-theme="light" data-size="flexible" data-appearance="interaction-only" data-callback="absvaiTurnstile" data-error-callback="absvaiTurnstileError" />}
          <p class="form-msg error" data-co-error role="alert" />
          <button class="btn btn-primary btn-lg btn-block" type="submit" data-place>{p.placeLabel ?? 'অর্ডার কনফার্ম করুন'}</button>
          {p.whatsapp && (
            <a class="btn btn-whatsapp btn-lg btn-block" href={`https://wa.me/${p.whatsapp}`} target="_blank" rel="noopener" data-wa-order>
              <Icon name="whatsapp" size={20} />WhatsApp-এ অর্ডার করুন
            </a>
          )}
          <p class="small muted" data-capture-note>অর্ডারে সমস্যা হলে যেন আমরা সাহায্য করতে পারি, তাই লেখার সাথে সাথে আপনার তথ্য সেভ হয়। <a href="/policies/privacy">প্রাইভেসি</a></p>
        </aside>
      </form>
  );
}

export function OrderPage(p: { o: Record<string, unknown>; items: Array<Record<string, unknown>>; codeSent: boolean; wallets: Array<{ wallet: string; number: string; type?: string }> }) {
  const o = p.o;
  const status = o.status as OrderStatus;
  const waiting = o.payment_method === 'cod' && !o.otp_verified_at && status === 'new';
  const needsOtp = waiting && p.codeSent;
  const needsAdvance = Boolean(o.advance_required) && (o.advance_status === 'pending');
  const phone = localPhone(String(o.phone));
  return (
    <div class="container narrow order-done" data-order={String(o.order_no)} data-token={String(o.access_token)}>
      <div class="done-head">
        <span class="done-tick"><Icon name="check" size={32} /></span>
        <h1>Thank you, {String(o.customer_name).split(' ')[0]}!</h1>
        <p>Your order number is <strong class="order-no">{String(o.order_no)}</strong>.</p>
        <p class="status-pill">{STATUS_LABELS[status]}</p>
        <div class="done-actions" lang="bn">
          <a class="btn btn-primary" href={`/order/${encodeURIComponent(String(o.order_no))}/invoice?t=${encodeURIComponent(String(o.access_token))}`} target="_blank" rel="noopener" data-invoice><Icon name="download" size={18} />ইনভয়েস ডাউনলোড করুন</a>
          <a class="btn btn-outline" href="/account"><Icon name="user" size={18} />আমার অ্যাকাউন্ট</a>
        </div>
      </div>
      {needsOtp && (
        <form class="otp card-box" data-otp>
          <h2>Confirm faster with the SMS code</h2>
          <p>We sent a 6-digit code to {maskPhone(phone)}. Enter it so we can confirm without calling.</p>
          <div class="otp-row">
            <label class="sr-only" for="otp-code">Code</label>
            <input id="otp-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength={6} pattern="\d{6}" placeholder="••••••" required />
            <button class="btn btn-primary" type="submit">Verify</button>
          </div>
          <button class="link-btn" type="button" data-otp-resend>Send a new code</button>
          <p class="form-msg" data-msg aria-live="polite" />
        </form>
      )}
      {o.otp_verified_at && <p class="notice notice-ok"><Icon name="check" size={18} />Phone verified. We’ll confirm your order shortly.</p>}
      {waiting && !needsOtp && <p class="notice notice-ok" data-call-confirm><Icon name="phone" size={18} />We’ll call you on {maskPhone(phone)} to confirm your order. Please keep your phone nearby.</p>}
      {Boolean(o.advance_required) && (
        <div class="card-box">
          <h2>Advance payment</h2>
          <p>{String(o.advance_reason ?? '')}</p>
          <p>Amount: <strong>{o.advance_amount_paisa == null ? 'we will tell you when we call' : formatTaka(Number(o.advance_amount_paisa))}</strong> · Status: <strong>{String(o.advance_status).replace('_', ' ')}</strong></p>
          {needsAdvance && p.wallets.length > 0 && (
            <form data-advance-form>
              <p>Send it to {p.wallets.map(w => `${w.wallet} ${w.number}`).join(' or ')}, then enter the transaction ID:</p>
              <div class="otp-row">
                <select name="wallet" aria-label="Wallet">{p.wallets.map(w => <option>{w.wallet}</option>)}</select>
                <input name="trxId" placeholder="Transaction ID" required maxlength={30} aria-label="Transaction ID" />
                <button class="btn btn-primary" type="submit">Submit</button>
              </div>
              <p class="form-msg" data-msg aria-live="polite" />
            </form>
          )}
        </div>
      )}
      <div class="card-box">
        <h2>Your order</h2>
        <ul class="line-list">
          {p.items.map(i => <li><span>{String(i.name)}{i.variant_label ? <small> · {String(i.variant_label)}</small> : null} × {String(i.qty)}</span><strong>{formatTaka(Number(i.line_total_paisa))}</strong></li>)}
        </ul>
        <dl class="totals">
          <dt>Subtotal</dt><dd>{formatTaka(Number(o.subtotal_paisa))}</dd>
          <dt>Delivery</dt><dd>{o.delivery_charge_paisa == null ? 'To be confirmed by phone' : Number(o.delivery_charge_paisa) === 0 ? 'Free' : formatTaka(Number(o.delivery_charge_paisa))}</dd>
          {Number(o.cod_fee_paisa) > 0 && <><dt>COD fee</dt><dd>{formatTaka(Number(o.cod_fee_paisa))}</dd></>}
          <dt class="total">Total</dt><dd class="total">{formatTaka(Number(o.total_paisa))}</dd>
        </dl>
        <p class="small"><Icon name="pin" size={16} />{orderAddress(o)}{o.eta_text ? ` · usually ${String(o.eta_text)}` : ''}</p>
      </div>
      <ol class="next-steps">
        <li><strong>We confirm</strong> with a quick call.</li>
        <li><strong>We pack and ship</strong>, and text you the tracking number.</li>
        <li><strong>You check the parcel</strong> in front of the delivery person, then pay.</li>
      </ol>
      <p><a class="btn btn-outline" href="/track">Track an order</a> <a class="btn btn-ghost" href="/">Continue shopping</a></p>
    </div>
  );
}

export function TrackPage(p: { q?: string; result?: TrackResult | null; error?: string }) {
  const orders = p.result?.orders ?? [];
  return (
    <div class="container track-page">
      <h1>Track your order</h1>
      <form class="card-box track-form" method="get" action="/track">
        <label class="field"><span>Mobile number or order number</span>
          <input name="q" value={p.q ?? ''} placeholder="01XXXXXXXXX or AV-261030-0001" required maxlength={40} autocomplete="tel" enterkeyhint="search" />
        </label>
        <button class="btn btn-primary" type="submit">Track</button>
        <p class="small muted track-hint">Type either one: the mobile number you ordered with shows all its recent orders; an order number (or invoice or courier tracking code) shows that order. মোবাইল নম্বর অথবা অর্ডার নম্বর, যেকোনো একটি দিন।</p>
      </form>
      {p.error && <p class="notice notice-error" role="alert">{p.error}</p>}
      {orders.length > 1 && (
        <section class="card-box">
          <h2>{orders.length} orders on {orders[0].phone}</h2>
          <div class="table-wrap"><table class="track-table">
            <thead><tr><th>Order</th><th>Date</th><th>Items</th><th class="num">Total</th><th>Status</th></tr></thead>
            <tbody>{orders.map(o => (
              <tr><td><a href={`#o-${o.orderNo}`}><b>{o.orderNo}</b></a></td><td>{formatDate(o.placedAt)}</td><td>{o.items.reduce((s, i) => s + i.qty, 0)}</td><td class="num">{formatTaka(o.totalPaisa)}</td><td><span class={`track-status st-${o.status}`}>{o.statusLabel}</span></td></tr>
            ))}</tbody>
          </table></div>
        </section>
      )}
      {orders.map(o => <TrackedOrderCard o={o} />)}
    </div>
  );
}

function TrackedOrderCard({ o }: { o: TrackedOrder }) {
  const steps = [...o.steps].reverse();
  return (
    <section class="card-box tracked" id={`o-${o.orderNo}`}>
      <div class="tracked-head"><h2>{o.orderNo}</h2><span class={`track-status st-${o.status}`}>{o.statusLabel}</span></div>
      {o.stage >= 0 ? (
        <ol class="track-bar" aria-label="Order progress">{TRACK_STAGES.map(([, en, bn], i) => (
          <li class={i <= o.stage ? 'done' : ''} aria-current={i === o.stage ? 'step' : undefined}><span>{en}</span><small lang="bn">{bn}</small></li>
        ))}</ol>
      ) : <p class="notice">{o.status === 'cancelled' ? 'This order was cancelled.' : 'This parcel came back to the shop.'} Questions? Call or WhatsApp us.</p>}
      <h3>Order details</h3>
      <div class="table-wrap"><table class="track-table track-kv"><tbody>
        <tr><th>Order number</th><td>{o.orderNo}{o.invoiceNo ? ` · Invoice ${o.invoiceNo}` : ''}{o.preOrder ? ' · Pre-order' : ''}</td></tr>
        <tr><th>Placed on</th><td>{formatDateTime(o.placedAt)}</td></tr>
        <tr><th>Name</th><td>{o.name}</td></tr>
        <tr><th>Mobile</th><td>{o.phone}</td></tr>
        <tr><th>Delivery area</th><td>{o.area || '—'}</td></tr>
        <tr><th>Payment</th><td>{o.payment} · {o.paymentState}</td></tr>
        <tr><th>Courier</th><td>{o.courier ?? 'Not handed over yet'}{o.trackingCode ? <> · Tracking code <b>{o.trackingCode}</b></> : ''}</td></tr>
        {o.eta && <tr><th>Usual delivery time</th><td>{o.eta}</td></tr>}
      </tbody></table></div>
      <h3>Items</h3>
      <div class="table-wrap"><table class="track-table">
        <thead><tr><th>Product</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Total</th></tr></thead>
        <tbody>{o.items.map(i => (
          <tr><td>{i.name}{i.variant ? <span class="muted"> · {i.variant}</span> : ''}{i.returned ? <span class="muted"> ({i.returned} returned)</span> : ''}</td><td class="num">{i.qty}</td><td class="num">{formatTaka(i.unitPaisa)}</td><td class="num">{formatTaka(i.linePaisa)}</td></tr>
        ))}</tbody>
        <tfoot>
          <tr><th colspan={3}>Subtotal</th><td class="num">{formatTaka(o.subtotalPaisa)}</td></tr>
          <tr><th colspan={3}>Delivery</th><td class="num">{o.deliveryPaisa ? formatTaka(o.deliveryPaisa) : 'Free'}</td></tr>
          {o.codFeePaisa > 0 && <tr><th colspan={3}>Cash on Delivery fee</th><td class="num">{formatTaka(o.codFeePaisa)}</td></tr>}
          {o.discountPaisa > 0 && <tr><th colspan={3}>Discount</th><td class="num">−{formatTaka(o.discountPaisa)}</td></tr>}
          <tr class="grand"><th colspan={3}>Total</th><td class="num">{formatTaka(o.totalPaisa)}</td></tr>
          {o.paidPaisa > 0 && <tr><th colspan={3}>Paid</th><td class="num">{formatTaka(o.paidPaisa)}</td></tr>}
          {o.stage >= 0 && <tr class="grand"><th colspan={3}>To pay on delivery</th><td class="num">{formatTaka(o.duePaisa)}</td></tr>}
        </tfoot>
      </table></div>
      <h3>Tracking history</h3>
      <div class="table-wrap"><table class="track-table">
        <thead><tr><th>Date & time</th><th>Update</th></tr></thead>
        <tbody>{steps.map(s => (
          <tr><td class="track-when">{formatDateTime(s.at)}</td><td><b>{s.title}</b>{s.titleBn && <small class="muted" lang="bn"><br />{s.titleBn}</small>}{s.detail && <><br /><span class="track-detail">{s.detail}</span></>}</td></tr>
        ))}</tbody>
      </table></div>
    </section>
  );
}

export function SellPage(p: { settings: Record<string, string>; open: boolean }) {
  const store = storeName(p.settings);
  return (
    <div class="container narrow sell-page">
      <div class="sell-hero">
        <h1>Sell on {store}</h1>
        <p>Add your products to our shop. We take the orders, call the customers, deliver all over Bangladesh with Cash on Delivery, and pay you for every delivered sale.</p>
        <ol class="sell-steps">
          <li><b>Register</b> with the form below.</li>
          <li><b>Sign in</b> to the <a href="/seller/">seller portal</a> right away and add your products, photos, prices and your bKash, Nagad, Rocket or bank account.</li>
          <li><b>We approve</b> your seller account (usually within 1–2 days), then <b>each product</b> before it shows in the shop and <b>your payment account</b> before we pay into it.</li>
          <li><b>We sell and deliver.</b> You see every order and your earnings in the portal.</li>
        </ol>
        <p class="small">Already registered? <a href="/seller/">Sign in to the seller portal</a>.</p>
      </div>
      {p.open ? (
        <form class="card-box sell-form" data-sell novalidate>
          <h2>Seller registration</h2>
          <div class="sell-grid">
            <label class="field"><span>Shop or business name</span><input name="shopName" required maxlength={80} autocomplete="organization" /></label>
            <label class="field"><span>Your name</span><input name="ownerName" required maxlength={100} autocomplete="name" /></label>
            <label class="field"><span>Mobile number</span><input name="phone" type="tel" inputmode="numeric" required placeholder="01XXXXXXXXX" autocomplete="tel" /></label>
            <label class="field"><span>Email (you sign in with it)</span><input name="email" type="email" required maxlength={120} autocomplete="email" /></label>
            <label class="field"><span>Password (10+ characters with a number)</span><input name="password" type="password" required minlength={10} autocomplete="new-password" /></label>
            <label class="field"><span>District</span><input name="district" maxlength={60} placeholder="e.g. Jashore" /></label>
            <label class="field"><span>What kind of business?</span><select name="businessType"><option value="">Choose…</option><option>Home business</option><option>Shop</option><option>Farmer / producer</option><option>Wholesaler</option><option>Brand</option></select></label>
            <label class="field"><span>Get paid by</span><select name="payoutMethod"><option value="bkash">bKash</option><option value="nagad">Nagad</option><option value="rocket">Rocket</option></select></label>
            <label class="field"><span>bKash / Nagad / Rocket number (optional)</span><input name="payoutNumber" type="tel" inputmode="numeric" maxlength={20} placeholder="01XXXXXXXXX" /></label>
          </div>
          <p class="small muted sell-note">Bank account instead? Add it in the seller portal after you sign in.</p>
          <label class="field"><span>Address</span><input name="address" maxlength={300} /></label>
          <label class="field"><span>What do you want to sell?</span><textarea name="sells" rows={3} maxlength={500} placeholder="e.g. Khejur gur from our own trees, about 200 kg each winter" /></label>
          <label class="hp" aria-hidden="true">Website<input name="website" tabindex={-1} autocomplete="off" /></label>
          <label class="check-line"><input type="checkbox" name="agree" required /> <span>I sell only genuine products I am allowed to sell, and I agree that {store} takes a commission on delivered sales.</span></label>
          <button class="btn btn-primary btn-block" type="submit">Send my application</button>
          <p class="form-msg" data-msg aria-live="polite" />
        </form>
      ) : <p class="notice">Seller registration is closed right now. Please check back soon.</p>}
    </div>
  );
}

export function SimplePage(p: { title: string; children: unknown }) {
  return <div class="container narrow prose-page"><h1>{p.title}</h1>{p.children as never}</div>;
}

export function CategoriesPage(p: { categories: CategoryNode[] }) {
  return (
    <div class="container">
      <h1>All categories</h1>
      <ul class="cat-grid">
        {p.categories.map(c => (
          <li>
            <a class="cat-tile" href={`/c/${c.slug}`}><img src={c.icon} srcset={srcsetOf(c.icon)} sizes={SIZES.catTile} alt="" width="160" height="160" loading="lazy" decoding="async" /><span>{c.name}</span></a>
            {c.children.length > 0 && <ul class="cat-children">{c.children.map(k => <li><a href={`/c/${k.slug}`}>{k.name}</a></li>)}</ul>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Order statuses as customers read them on their account page. */
export const STATUS_BN: Record<string, string> = {
  new: 'নতুন (কনফার্মের অপেক্ষায়)', confirmed: 'কনফার্মড', packed: 'প্যাক হয়েছে', in_courier: 'কুরিয়ারে আছে', delivered: 'ডেলিভারি হয়েছে',
  partial_delivered: 'আংশিক ডেলিভারি', cancelled: 'বাতিল', returned: 'ফেরত এসেছে',
};
const bnDate = (iso: string) => new Date(Date.parse(iso) + 6 * 3_600_000).toISOString().slice(0, 10).split('-').reverse().join('/').replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[Number(d)]);

export interface AccountView {
  account: { name: string; email: string; phone: string; addressLine: string; offers: boolean };
  orders: Array<{ orderNo: string; token: string; createdAt: string; status: string; totalPaisa: number; items: number; firstItem: string | null; image: string | null }>;
  offers: Array<{ code: string; label: string; detail: string }>;
}

const AccountLinks = () => (
  <div class="account-links">
    <a class="card-box link-box" href="/track"><Icon name="pin" /><span><strong>অর্ডার ট্র্যাক করুন</strong><small>মোবাইল নম্বর বা অর্ডার নম্বর দিয়ে</small></span></a>
    <a class="card-box link-box" href="/wishlist"><Icon name="heart" /><span><strong>পছন্দের তালিকা</strong><small>যে পণ্যগুলো সেভ করেছেন</small></span></a>
    <a class="card-box link-box" href="/contact"><Icon name="phone" /><span><strong>সাহায্য ও যোগাযোগ</strong><small>WhatsApp, Messenger বা ফোন</small></span></a>
    <a class="card-box link-box" href="/policies/returns"><Icon name="return" /><span><strong>রিটার্ন ও রিফান্ড</strong><small>কীভাবে ফেরত দেবেন</small></span></a>
  </div>
);

/**
 * /account: signed out, a sign-in / open-an-account form (email, then the 6-digit code from the email; public/js/account.js);
 * signed in, the customer's orders with tracking and invoices, the offers for members and their details.
 */
export function AccountPage(p: { view: AccountView | null; turnstileSiteKey?: string; next?: string | null }) {
  if (!p.view) {
    return (
      <div class="container narrow acct" lang="bn" data-account-page data-next={p.next ?? ''}>
        <div class="acct-hero">
          <h1>আমার অ্যাকাউন্ট</h1>
          <p>অ্যাকাউন্ট খুললে সব অর্ডার এক জায়গায় দেখবেন, অর্ডার ট্র্যাক করবেন, ইনভয়েস ডাউনলোড করবেন আর সদস্যদের জন্য বিশেষ অফার পাবেন। পাসওয়ার্ড লাগবে না: প্রতিবার ইমেইলে একটি কোড আসবে।</p>
          <ul class="acct-perks">
            <li><Icon name="box" size={18} />সব অর্ডার ও ট্র্যাকিং</li>
            <li><Icon name="file" size={18} />ইনভয়েস ডাউনলোড</li>
            <li><Icon name="tag" size={18} />সদস্যদের অফার</li>
            <li><Icon name="check" size={18} />পরের অর্ডারে তথ্য নিজে থেকে বসে যাবে</li>
          </ul>
        </div>
        <div class="card-box acct-box">
          <div class="acct-tabs" role="tablist">
            <button type="button" role="tab" aria-selected="true" data-acct-tab="signin">সাইন ইন</button>
            <button type="button" role="tab" aria-selected="false" data-acct-tab="signup">নতুন অ্যাকাউন্ট খুলুন</button>
          </div>
          <form data-acct-form novalidate>
            <div data-signup-only hidden>
              <label class="field"><span>আপনার নাম <b class="req">*</b></span><input name="name" autocomplete="name" maxlength={120} placeholder="আপনার পুরো নাম" /></label>
              <label class="field"><span>মোবাইল নম্বর <b class="req">*</b></span><input name="phone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="01XXXXXXXXX" maxlength={14} /></label>
            </div>
            <label class="field"><span>ইমেইল <b class="req">*</b></span><input name="email" type="email" inputmode="email" autocomplete="email" placeholder="you@gmail.com" maxlength={120} required /></label>
            <label class="check-line" data-signup-only hidden><input type="checkbox" name="offers" checked /> <span>নতুন অফার ও ছাড়ের খবর ইমেইলে পেতে চাই</span></label>
            {p.turnstileSiteKey && <div class="cf-turnstile" data-sitekey={p.turnstileSiteKey} data-theme="light" data-size="flexible" data-appearance="interaction-only" data-callback="vmAccountTurnstile" />}
            <p class="form-msg error" data-acct-error role="alert" />
            <button class="btn btn-primary btn-lg btn-block" type="submit" data-acct-send>ইমেইলে কোড পাঠান</button>
            <p class="small muted">কোড আসতে এক মিনিট লাগতে পারে। ইনবক্সে না পেলে Spam / Promotions দেখুন।</p>
          </form>
          <form data-code-form hidden novalidate>
            <p class="acct-sent" data-code-sent />
            <label class="field"><span>ইমেইলে আসা ৬ সংখ্যার কোড</span><input class="code-input" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength={6} placeholder="••••••" /></label>
            <p class="form-msg error" data-code-error role="alert" />
            <button class="btn btn-primary btn-lg btn-block" type="submit" data-code-go>যাচাই করে প্রবেশ করুন</button>
            <p class="small acct-again"><button type="button" class="link-btn" data-code-again>নতুন কোড পাঠান</button> · <button type="button" class="link-btn" data-code-back>ইমেইল বদলান</button></p>
          </form>
        </div>
        <AccountLinks />
      </div>
    );
  }
  const { account: a, orders, offers } = p.view;
  return (
    <div class="container acct" lang="bn" data-account-page>
      <div class="acct-head">
        <div><p class="co-kicker">আমার অ্যাকাউন্ট</p><h1>আসসালামু আলাইকুম, {a.name}</h1><p class="muted">{a.email}</p></div>
        <button type="button" class="btn btn-outline" data-logout>সাইন আউট</button>
      </div>
      <div class="acct-grid">
        <section class="card-box acct-orders">
          <h2>আমার অর্ডার</h2>
          {orders.length ? orders.map(o => (
            <div class="acct-order">
              {o.image ? <img src={o.image} alt="" loading="lazy" width={56} height={56} /> : <span class="acct-noimg"><Icon name="box" /></span>}
              <div class="acct-order-main">
                <b>{o.orderNo}</b>
                <small>{bnDate(o.createdAt)} · {String(o.items).replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[Number(d)])}টি পণ্য{o.firstItem ? ` · ${o.firstItem}` : ''}</small>
                <span class={`acct-status st-${o.status}`}>{STATUS_BN[o.status] ?? o.status}</span>
              </div>
              <div class="acct-order-end">
                <b>{formatTaka(o.totalPaisa)}</b>
                <a class="btn btn-sm btn-outline" href={`/order/${encodeURIComponent(o.orderNo)}?t=${encodeURIComponent(o.token)}`}>ট্র্যাক করুন</a>
                <a class="btn btn-sm btn-ghost" href={`/order/${encodeURIComponent(o.orderNo)}/invoice?t=${encodeURIComponent(o.token)}`} target="_blank" rel="noopener"><Icon name="download" size={16} />ইনভয়েস</a>
              </div>
            </div>
          )) : (
            <div class="acct-empty"><p>এখনো কোনো অর্ডার নেই। এই ইমেইল দিয়ে অর্ডার করলে এখানে দেখাবে।</p><a class="btn btn-primary" href="/shop">কেনাকাটা শুরু করুন</a></div>
          )}
        </section>
        <div class="acct-side">
          <section class="card-box acct-offers">
            <h2>আমার অফার</h2>
            {offers.length ? offers.map(o => (
              <div class="acct-offer"><div><b class="mono">{o.code}</b><span>{o.label}</span>{o.detail && <small>{o.detail}</small>}</div><button type="button" class="btn btn-sm btn-outline" data-copy={o.code}>কপি</button></div>
            )) : <p class="muted">এই মুহূর্তে কোনো অফার নেই। নতুন অফার এলে ইমেইলে জানিয়ে দেব।</p>}
            <p class="small muted">চেকআউটে “কুপন কোড” ঘরে কোডটি লিখে “প্রয়োগ” চাপুন।</p>
          </section>
          <section class="card-box">
            <h2>আমার তথ্য</h2>
            <form data-profile novalidate>
              <label class="field"><span>নাম</span><input name="name" value={a.name} maxlength={120} autocomplete="name" /></label>
              <label class="field"><span>মোবাইল নম্বর</span><input name="phone" value={a.phone} type="tel" inputmode="numeric" maxlength={14} placeholder="01XXXXXXXXX" autocomplete="tel" /></label>
              <label class="field"><span>ঠিকানা <small class="opt">চেকআউটে নিজে থেকে বসে যাবে</small></span><textarea name="addressLine" rows={2} maxlength={300}>{a.addressLine}</textarea></label>
              <label class="check-line"><input type="checkbox" name="offers" checked={a.offers} /> <span>নতুন অফার ও ছাড়ের খবর ইমেইলে পেতে চাই</span></label>
              <p class="form-msg" data-profile-msg role="status" />
              <button class="btn btn-primary" type="submit">সেভ করুন</button>
            </form>
          </section>
        </div>
      </div>
      <AccountLinks />
    </div>
  );
}

export function WishlistPage(p: { items: ProductCard[] | null }) {
  return (
    <div class="container" data-wishlist-page>
      <h1>Wishlist</h1>
      {p.items === null ? <p class="muted" data-wishlist-loading>Loading…</p> : p.items.length ? <Grid items={p.items} /> : <Empty title="Your wishlist is empty"><p>Tap the heart on any product to save it here.</p><a class="btn btn-primary" href="/shop">Browse products</a></Empty>}
    </div>
  );
}

export function ContactPage(p: { settings: Record<string, string> }) {
  const s = p.settings;
  const wa = s.whatsapp_number?.replace(/\D/g, '');
  return (
    <div class="container narrow">
      <h1>Contact us</h1>
      <div class="account-links">
        {wa && <a class="card-box link-box" href={`https://wa.me/${wa}`} rel="noopener"><Icon name="whatsapp" /><span><strong>WhatsApp</strong><small>Fastest reply</small></span></a>}
        {s.messenger_page && <a class="card-box link-box" href={`https://m.me/${s.messenger_page}`} rel="noopener"><Icon name="messenger" /><span><strong>Messenger</strong><small>Facebook page inbox</small></span></a>}
        {s.support_phone && <a class="card-box link-box" href={`tel:${s.support_phone.replace(/[^\d+]/g, '')}`}><Icon name="phone" /><span><strong>Call {s.support_phone}</strong><small>10am – 8pm, every day</small></span></a>}
      </div>
      <h2 id="wholesale" class="brush-title"><span>Become a dealer / bulk inquiry</span></h2>
      <p>Buying Master Masala, machines or packaging in bulk for your shop? Tell us what you need and our wholesale team will call you.</p>
      <form class="card-box" data-wholesale>
        <div class="row-2">
          <label class="field"><span>Your name</span><input name="name" required maxlength={120} autocomplete="name" /></label>
          <label class="field"><span>Mobile number</span><input name="phone" type="tel" inputmode="numeric" required autocomplete="tel" placeholder="01XXXXXXXXX" /></label>
        </div>
        <div class="row-2">
          <label class="field"><span>Business name (optional)</span><input name="business" maxlength={120} /></label>
          <label class="field"><span>District (optional)</span><input name="district" maxlength={60} /></label>
        </div>
        <label class="field"><span>What do you need?</span><textarea name="message" rows={3} maxlength={1000} placeholder="e.g. 50 packs of Master Masala 1kg every month" /></label>
        <button class="btn btn-primary" type="submit">Send inquiry</button>
        <p class="form-msg" data-msg aria-live="polite" />
      </form>
    </div>
  );
}

export function NotFoundPage() {
  return <div class="container narrow"><Empty title="We couldn’t find that page"><p>It may have moved. Try searching, or start from the homepage.</p><a class="btn btn-primary" href="/">Go to the homepage</a></Empty></div>;
}
