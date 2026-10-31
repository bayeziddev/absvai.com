import type { Child } from 'hono/jsx';
import type { CategoryNode, ProductCard } from '../repo/catalog';
import { SIZES, srcsetOf } from '../lib/images';
import { formatTaka } from '../lib/money';
import { Icon } from './icons';

export interface Banner { headline: string; subline?: string; cta_text?: string; cta_href?: string; theme?: string; image?: string; kicker?: string }

export function Burst({ savePaisa }: { savePaisa: number }) {
  if (savePaisa <= 0) return null;
  return (
    <span class="burst" aria-label={`Save ${formatTaka(savePaisa)}`}>
      <span>Save</span>
      <strong>{formatTaka(savePaisa)}</strong>
    </span>
  );
}

export function CheckChip({ children }: { children: Child }) {
  return <li class="chip-check"><span class="chip-tick"><Icon name="check" size={12} /></span>{children}</li>;
}

export function SectionTitle({ title, href, linkText = 'View all', id }: { title: string; href?: string; linkText?: string; id?: string }) {
  return (
    <div class="section-head">
      <h2 class="brush-title" id={id}><span>{title}</span></h2>
      {href && <a class="btn btn-primary btn-sm" href={href}>{linkText}</a>}
    </div>
  );
}

export function OriginalsSeal({ small }: { small?: boolean }) {
  return <span class={`seal${small ? ' seal-sm' : ''}`} title="Made by Abs Vai"><Icon name="leaf" size={small ? 12 : 14} />Made by Abs Vai</span>;
}

export function Card({ p, eager, sizes = SIZES.card }: { p: ProductCard; eager?: boolean; sizes?: string }) {
  const a = p.availability;
  const href = `/p/${p.slug}`;
  return (
    <article class="card" data-product={p.slug} data-product-id={String(p.id)} data-variant={p.variantCount === 1 && p.defaultVariantId ? String(p.defaultVariantId) : undefined} data-name={p.name}>
      <a class="card-media" href={href} tabindex={-1} aria-hidden="true">
        <img src={p.image} srcset={srcsetOf(p.image)} sizes={sizes} alt="" width="600" height="600" loading={eager ? 'eager' : 'lazy'} decoding="async" />
        <Burst savePaisa={p.savePaisa} />
        <span class="card-tags">
          {a.state === 'pre_order' && <span class="tag tag-turmeric">Pre-order</span>}
          {a.state === 'made_to_order' && <span class="tag tag-turmeric">Made to order</span>}
          {a.state === 'out_of_season' && <span class="tag tag-muted">Out of season</span>}
          {p.freeDelivery && <span class="tag tag-leaf">Free delivery</span>}
        </span>
      </a>
      <button class="wish" type="button" data-wish={String(p.id)} aria-label={`Save ${p.name} to wishlist`} aria-pressed="false"><Icon name="heart" size={18} /></button>
      <div class="card-body">
        {p.isOriginal && <OriginalsSeal small />}
        <h3 class="card-title"><a href={href}>{p.name}</a></h3>
        {p.keySpecs && <p class="card-spec">{p.keySpecs}</p>}
        <p class="price">
          <strong>{p.variantCount > 1 ? <><small>from </small>{formatTaka(p.pricePaisa)}</> : formatTaka(p.pricePaisa)}</strong>
          {p.compareAtPaisa && <s aria-label={`was ${formatTaka(p.compareAtPaisa)}`}>{formatTaka(p.compareAtPaisa)}</s>}
        </p>
        {p.unitPriceText && <p class="unit-price">{p.unitPriceText}</p>}
        {a.state === 'out_of_season' && <p class="avail avail-muted">{a.label}</p>}
        <div class="card-actions">
          {a.canBuy ? (
            <>
              <button class="btn btn-outline btn-sm" type="button" data-action="add">Add to Cart</button>
              <button class="btn btn-primary btn-sm" type="button" data-action="order">{a.state === 'pre_order' ? 'Pre-order' : 'Order Now'}</button>
            </>
          ) : a.state === 'out_of_season' ? (
            <a class="btn btn-ghost btn-sm btn-block" href={`${href}#notify`}>Notify me</a>
          ) : (
            <button class="btn btn-ghost btn-sm btn-block" type="button" disabled>Out of stock</button>
          )}
        </div>
      </div>
    </article>
  );
}

export function Grid({ items, eagerCount = 0 }: { items: ProductCard[]; eagerCount?: number }) {
  return <div class="grid">{items.map((p, i) => <Card p={p} eager={i < eagerCount} />)}</div>;
}

export function Rail({ items, label, eagerCount = 0 }: { items: ProductCard[]; label: string; eagerCount?: number }) {
  return (
    <div class="rail" role="region" aria-label={label} tabindex={0}>
      {items.map((p, i) => <div class="rail-item"><Card p={p} eager={i < eagerCount} sizes={SIZES.rail} /></div>)}
    </div>
  );
}

export function HeroCarousel({ banners }: { banners: Banner[] }) {
  if (!banners.length) return null;
  return (
    <section class="hero" aria-roledescription="carousel" aria-label="Offers">
      <div class="hero-track" data-carousel>
        {banners.map((b, i) => (
          <a class={`hero-slide theme-${b.theme ?? 'chili'}`} href={b.cta_href ?? '/shop'} aria-roledescription="slide" aria-label={`${i + 1} of ${banners.length}: ${b.headline}`}>
            <div class="hero-copy">
              {b.kicker && <span class="hero-kicker">{b.kicker}</span>}
              {i === 0 ? <h1 class="hero-title">{b.headline}</h1> : <p class="hero-title">{b.headline}</p>}
              {b.subline && <p class="hero-sub">{b.subline}</p>}
              <span class="btn btn-cta">{b.cta_text ?? 'Shop now'}<Icon name="right" size={18} /></span>
            </div>
            {b.image && <img class="hero-img" src={b.image} srcset={srcsetOf(b.image)} sizes={SIZES.hero} alt="" width="600" height="600" loading={i === 0 ? 'eager' : 'lazy'} fetchpriority={i === 0 ? 'high' : undefined} />}
          </a>
        ))}
      </div>
      {banners.length > 1 && (
        <div class="hero-dots" data-dots>
          {banners.map((_, i) => <button type="button" aria-label={`Show offer ${i + 1}`} aria-current={i === 0 ? 'true' : undefined} />)}
        </div>
      )}
    </section>
  );
}

export function CategoryCarousel({ categories, seasonal }: { categories: CategoryNode[]; seasonal: Set<number> }) {
  return (
    <nav class="cat-carousel" aria-label="Shop by category">
      <button class="scroll-btn scroll-prev" type="button" data-scroll="-1" aria-label="Scroll categories left"><Icon name="left" /></button>
      <ul class="cat-track" data-scroller>
        {categories.map((c, i) => (
          <li>
            <a class="cat-item" href={`/c/${c.slug}`}>
              <span class="cat-circle">
                {/* The first few are on screen at once, so they load with the page instead of popping in later. */}
                <img src={c.icon} srcset={srcsetOf(c.icon)} sizes={SIZES.catCircle} alt="" width="160" height="160" loading={i < 6 ? 'eager' : 'lazy'} decoding="async" />
                {seasonal.has(c.id) && <span class="cat-season" title="In season now"><Icon name="sun" size={12} /></span>}
              </span>
              <span class="cat-name">{c.name}</span>
            </a>
          </li>
        ))}
      </ul>
      <button class="scroll-btn scroll-next" type="button" data-scroll="1" aria-label="Scroll categories right"><Icon name="right" /></button>
    </nav>
  );
}

export function PromoBanner({ b }: { b: Banner | null }) {
  if (!b) return null;
  return (
    <a class={`promo theme-${b.theme ?? 'clove'}`} href={b.cta_href ?? '/shop'}>
      <div>
        <p class="promo-title">{b.headline}</p>
        {b.subline && <p class="promo-sub">{b.subline}</p>}
        <span class="btn btn-cta btn-sm">{b.cta_text ?? 'Shop now'}</span>
      </div>
      {b.image && <img src={b.image} srcset={srcsetOf(b.image)} sizes={SIZES.promo} alt="" width="600" height="600" loading="lazy" decoding="async" />}
    </a>
  );
}

export function TrustStrip({ whatsapp, phone }: { whatsapp?: string; phone?: string }) {
  return (
    <section class="trust" aria-label="Why shop with us">
      <div class="trust-item"><Icon name="cash" /><div><strong>Cash on Delivery</strong><span>Pay when it arrives</span></div></div>
      <div class="trust-item"><Icon name="truck" /><div><strong>All over Bangladesh</strong><span>64 districts</span></div></div>
      <div class="trust-item"><Icon name="return" /><div><strong>Easy returns</strong><span>Check before you pay</span></div></div>
      <div class="trust-item"><Icon name="whatsapp" /><div><strong>WhatsApp support</strong><span>{whatsapp ? <a href={`https://wa.me/${whatsapp}`} rel="noopener">{phone || 'Chat with us'}</a> : phone || 'Call us'}</span></div></div>
    </section>
  );
}

export function Breadcrumbs({ items }: { items: Array<{ name: string; href?: string }> }) {
  return (
    <nav class="crumbs" aria-label="Breadcrumb">
      <ol>{items.map((it, i) => <li>{it.href && i < items.length - 1 ? <a href={it.href}>{it.name}</a> : <span aria-current="page">{it.name}</span>}</li>)}</ol>
    </nav>
  );
}

export function Pagination({ page, total, perPage, baseUrl }: { page: number; total: number; perPage: number; baseUrl: URL }) {
  const pages = Math.ceil(total / perPage);
  if (pages <= 1) return null;
  const link = (p: number) => { const u = new URL(baseUrl); u.searchParams.set('page', String(p)); return `${u.pathname}${u.search}`; };
  return (
    <nav class="pager" aria-label="Pages">
      {page > 1 && <a class="btn btn-outline btn-sm" href={link(page - 1)} rel="prev">Previous</a>}
      <span>Page {page} of {pages}</span>
      {page < pages && <a class="btn btn-outline btn-sm" href={link(page + 1)} rel="next">Next</a>}
    </nav>
  );
}

export function Empty({ title, children }: { title: string; children?: Child }) {
  return <div class="empty"><Icon name="box" size={40} /><h2>{title}</h2>{children}</div>;
}
