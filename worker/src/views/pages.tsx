import type { CategoryNode, ProductCard, ProductDetail } from '../repo/catalog';
import { formatDate } from '../lib/dates';
import { SIZES, smallOf, srcsetOf } from '../lib/images';
import { formatTaka, formatUnitPrice, unitPrice } from '../lib/money';
import { localPhone, maskPhone } from '../lib/phone';
import { STATUS_LABELS, type OrderStatus } from '../lib/state-machine';
import { effectiveVariantAttributes, formatNetQuantity, infoPanels } from '../lib/templates';
import { Banner, Breadcrumbs, Burst, CategoryCarousel, CheckChip, Empty, Grid, HeroCarousel, OriginalsSeal, Pagination, PromoBanner, Rail, SectionTitle, TrustStrip } from './components';
import { Icon } from './icons';

// ───────────── Home ─────────────

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
          <SectionTitle title="Abs Vai Originals" href="/originals" />
          <p class="section-lead">Made and packed by ABS VAI LTD.</p>
          <Rail items={p.originals} label="Abs Vai Originals" />
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
          <img src="/img/placeholders/press.svg" alt="" width="600" height="600" loading="lazy" />
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

export function ProductPage(p: { d: ProductDetail; related: ProductCard[]; zones: Array<{ name: string; eta_text: string; base_charge_paisa: number }>; freeThresholdPaisa: number; settings: Record<string, string> }) {
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
          {prod.is_original ? <OriginalsSeal /> : null}
          <h1 class="pdp-title">{prod.name}</h1>
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

export function CheckoutPage(p: { wallets: Array<{ wallet: string; number: string; type?: string }>; turnstileSiteKey?: string }) {
  return (
    <div class="container">
      <h1>Checkout</h1>
      <noscript><p class="notice">Checkout needs JavaScript. You can also order by phone.</p></noscript>
      <form class="checkout" id="checkout-form" data-checkout novalidate>
        <div class="co-main">
          <fieldset class="co-step">
            <legend><span class="step-no">1</span>Mobile number</legend>
            <label class="field">
              <span>We’ll call or text this number to confirm your order.</span>
              <input name="phone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="01XXXXXXXXX" maxlength={14} required />
            </label>
            <p class="field-note" data-capture-note>We save your details as you type so we can help if your order doesn’t go through. <a href="/policies/privacy">Privacy</a></p>
            {/* Honeypot: hidden from people, filled by bots. Orders with it filled are rejected. */}
            <label class="hp" aria-hidden="true">Website<input name="website" tabindex={-1} autocomplete="off" /></label>
          </fieldset>
          <fieldset class="co-step">
            <legend><span class="step-no">2</span>Your name</legend>
            <label class="field"><span class="sr-only">Full name</span><input name="name" autocomplete="name" placeholder="Full name" maxlength={120} required /></label>
          </fieldset>
          <fieldset class="co-step">
            <legend><span class="step-no">3</span>Delivery address</legend>
            <div class="finder" role="group" aria-label="Find your address">
              <label class="field finder-postcode">
                <span>Postcode (fills your area for you)</span>
                <input name="postcode" inputmode="numeric" maxlength={4} pattern="\d{4}" placeholder="e.g. 1000" autocomplete="postal-code" />
              </label>
              <span class="finder-or">or</span>
              <button class="btn btn-outline" type="button" data-locate><Icon name="pin" size={18} />Use my location</button>
            </div>
            <p class="finder-msg" data-finder-msg aria-live="polite" />
            <div class="po-picker" data-po-picker hidden />
            <div class="selects">
              <label class="field"><span>Division</span><select name="divisionId" required><option value="">Loading…</option></select></label>
              <label class="field"><span>District</span><select name="districtId" required disabled><option value="">Select district</option></select></label>
              <label class="field"><span>Area / Upazila / Thana</span><select name="upazilaId" required disabled><option value="">Select area</option></select></label>
              <label class="field"><span>Union (optional)</span><select name="unionId" disabled><option value="">Select union</option></select></label>
            </div>
            <div class="map-card" data-map-card hidden>
              <div class="map" data-map role="img" aria-label="Map of your district" />
              <p data-map-label />
            </div>
            <label class="field"><span>House, road / village</span><input name="addressLine" autocomplete="street-address" placeholder="House 12, Road 5, Block C" maxlength={300} required /></label>
            <label class="field"><span>Nearby landmark (optional)</span><input name="landmark" placeholder="Opposite the mosque, next to Sonali Bank" maxlength={200} /></label>
            <label class="field"><span>Email (optional) <small class="muted">for your receipt and invoice</small></span><input name="email" type="email" inputmode="email" autocomplete="email" maxlength={120} placeholder="you@example.com" /></label>
            <label class="check-line"><input type="checkbox" name="emailOffers" /> <span>Email me offers and new arrivals (you can stop any time)</span></label>
            <label class="field"><span>Note for us (optional)</span><textarea name="note" rows={2} maxlength={500} /></label>
          </fieldset>
          <fieldset class="co-step">
            <legend><span class="step-no">4</span>Payment</legend>
            <label class="pay-option"><input type="radio" name="paymentMethod" value="cod" checked /><span><strong>Cash on Delivery</strong><small>Pay the delivery person when it arrives.</small></span></label>
            <label class="pay-option" data-pay-mobile hidden={!p.wallets.length}><input type="radio" name="paymentMethod" value="manual_mobile" /><span><strong>bKash / Nagad / Rocket</strong><small>Send money first, then enter the transaction ID.</small></span></label>
            <div class="advance" data-advance hidden>
              <p class="advance-title" data-advance-title />
              <ul class="advance-reasons" data-advance-reasons />
              {p.wallets.length > 0 && (
                <div class="wallets">
                  <p>Send the advance to:</p>
                  <ul>{p.wallets.map(w => <li><strong>{w.wallet}</strong> {w.number}{w.type ? ` (${w.type})` : ''}</li>)}</ul>
                  <div class="row-2">
                    <label class="field"><span>Wallet used</span><select name="advanceWallet">{p.wallets.map(w => <option>{w.wallet}</option>)}</select></label>
                    <label class="field"><span>Transaction ID</span><input name="advanceTrxId" autocomplete="off" placeholder="e.g. 9JK4L2M8QX" maxlength={30} /></label>
                  </div>
                </div>
              )}
              <p class="small">The advance is taken off your total. If we cannot deliver, we refund it in full.</p>
            </div>
          </fieldset>
        </div>
        <aside class="co-summary" aria-label="Order summary">
          <h2>Order summary</h2>
          <div data-co-lines><p class="muted">Loading…</p></div>
          <dl class="totals">
            <dt>Subtotal</dt><dd data-subtotal>—</dd>
            <dt>Delivery</dt><dd data-delivery>Choose your area</dd>
            <dt data-cod-row hidden>COD fee</dt><dd data-cod-fee hidden>—</dd>
            <dt class="total">Total</dt><dd class="total" data-total>—</dd>
          </dl>
          <ul class="explain" data-explain />
          <p class="eta" data-eta />
          {p.turnstileSiteKey && <div class="cf-turnstile" data-sitekey={p.turnstileSiteKey} data-theme="light" data-size="flexible" data-appearance="interaction-only" data-callback="absvaiTurnstile" />}
          <p class="form-msg error" data-co-error role="alert" />
          <button class="btn btn-primary btn-lg btn-block" type="submit" data-place>Place order</button>
          <p class="small muted">We save your details as you type so our team can help if checkout fails. We never store your GPS location.</p>
        </aside>
      </form>
    </div>
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
        <p class="small"><Icon name="pin" size={16} />{String(o.address_line)}, {String(o.upazila_name)}, {String(o.district_name)}{o.eta_text ? ` · usually ${String(o.eta_text)}` : ''}</p>
      </div>
      <ol class="next-steps">
        <li><strong>We confirm</strong> by SMS code or a quick call.</li>
        <li><strong>We pack and ship</strong>, and text you the tracking number.</li>
        <li><strong>You check the parcel</strong> in front of the delivery person, then pay.</li>
      </ol>
      <p><a class="btn btn-outline" href="/track">Track an order</a> <a class="btn btn-ghost" href="/">Continue shopping</a></p>
    </div>
  );
}

export function TrackPage(p: { phone?: string; orderNo?: string; result?: { orderNo: string; status: OrderStatus; courier: string | null; trackingId: string | null; eta: string | null; timeline: Array<{ status: OrderStatus; at: string }> } | null; error?: string }) {
  return (
    <div class="container narrow">
      <h1>Track your order</h1>
      <form class="card-box track-form" method="get" action="/track">
        <label class="field"><span>Mobile number</span><input name="phone" type="tel" inputmode="numeric" value={p.phone ?? ''} placeholder="01XXXXXXXXX" required /></label>
        <label class="field"><span>Order number</span><input name="order" value={p.orderNo ?? ''} placeholder="AV-261030-0001" required /></label>
        <button class="btn btn-primary" type="submit">Track</button>
      </form>
      {p.error && <p class="notice notice-error" role="alert">{p.error}</p>}
      {p.result && (
        <div class="card-box">
          <h2>{p.result.orderNo}: {STATUS_LABELS[p.result.status]}</h2>
          {p.result.trackingId && <p>Courier: <strong>{p.result.courier}</strong> · Tracking: <strong>{p.result.trackingId}</strong></p>}
          {p.result.eta && <p class="muted">Usual delivery time: {p.result.eta}</p>}
          <ol class="timeline">{p.result.timeline.map(t => <li><strong>{STATUS_LABELS[t.status]}</strong><span>{formatDate(t.at)}</span></li>)}</ol>
        </div>
      )}
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

export function AccountPage() {
  return (
    <div class="container narrow">
      <h1>Your account</h1>
      <div class="account-links">
        <a class="card-box link-box" href="/track"><Icon name="pin" /><span><strong>Track an order</strong><small>With your phone and order number</small></span></a>
        <a class="card-box link-box" href="/wishlist"><Icon name="heart" /><span><strong>Wishlist</strong><small>Products you saved on this phone</small></span></a>
        <a class="card-box link-box" href="/contact"><Icon name="phone" /><span><strong>Help & contact</strong><small>WhatsApp, Messenger or call</small></span></a>
        <a class="card-box link-box" href="/policies/returns"><Icon name="return" /><span><strong>Returns & refunds</strong><small>How returns work</small></span></a>
      </div>
      <p class="muted small">Sign-in with an SMS code, saved addresses and one-tap reorder are coming next.</p>
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
