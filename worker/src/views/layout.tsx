import type { Child } from 'hono/jsx';
import type { CategoryNode } from '../repo/catalog';
import { DEFAULT_COLORS, parseBrandColors, SOCIAL_NETWORKS, TRACKING_FORMATS, type PopupBanner } from '../lib/settings-schema';
import { smallOf, srcsetOf } from '../lib/images';
import { Icon } from './icons';

export interface LayoutProps {
  title: string;
  description?: string;
  path: string;
  siteUrl: string;
  image?: string;
  jsonLd?: object[];
  noindex?: boolean;
  settings: Record<string, string>;
  categories: CategoryNode[];
  activeSeason?: { slug: string; name: string } | null;
  tab?: 'home' | 'categories' | 'cart' | 'wishlist' | 'account';
  pageData?: object;
  scripts?: string[];
  children: Child;
  turnstileSiteKey?: string;
  bodyClass?: string;
  /** The stylesheet, put inside the page (lib/page-css); without it the page links /css/app.css. */
  css?: string | null;
}

const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

/** Pages that handle phone numbers, addresses or payments never load Google Tag Manager (Section 19). */
const PRIVATE_PATHS = /^\/(cart|checkout|account|order|track|wishlist)(\/|$)/;

/**
 * Speculation Rules (Section 2.3): prefetch same-site links on hover/touch, prerender product pages on press.
 * Never pages with side effects. Browsers without support fall back to the IntersectionObserver prefetch in app.js.
 */
const SPECULATION_RULES = {
  prefetch: [{ where: { and: [{ href_matches: '/*' }, { not: { href_matches: '/cart*' } }, { not: { href_matches: '/checkout*' } }, { not: { href_matches: '/account*' } }, { not: { href_matches: '/order/*' } }, { not: { href_matches: '/api/*' } }, { not: { href_matches: '/admin*' } }, { not: { selector_matches: '[rel~=nofollow]' } }] }, eagerness: 'moderate' }],
  prerender: [{ where: { href_matches: '/p/*' }, eagerness: 'conservative' }],
};

/** The popup banner for this page: on, with a headline, never on cart/checkout/account pages, homepage only unless set to every page. */
function popupFor(s: Record<string, string>, path: string): (PopupBanner & { key: string }) | null {
  let p: PopupBanner | null = null;
  try { p = JSON.parse(s.popup_banner || 'null') as PopupBanner | null; } catch { return null; }
  if (!p?.enabled || !p.headline || PRIVATE_PATHS.test(path) || (p.where !== 'all' && path !== '/')) return null;
  // A changed popup gets a new key, so customers who closed the old one see the new one.
  let h = 5381;
  for (const ch of JSON.stringify(p)) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0;
  return { ...p, key: h.toString(36) };
}

function trackingConfig(s: Record<string, string>, path: string) {
  const ok = (k: keyof typeof TRACKING_FORMATS) => (s[k] && TRACKING_FORMATS[k].test(s[k]) ? s[k] : null);
  const cfg = { pixelId: ok('pixel_id'), ga4Id: ok('ga4_id'), clarityId: ok('clarity_id'), gtmId: PRIVATE_PATHS.test(path) ? null : ok('gtm_id') };
  return Object.values(cfg).some(Boolean) ? cfg : null;
}

export function Layout(p: LayoutProps) {
  const s = p.settings;
  const store = s.store_name || 'Abs Vai';
  // Admin → Sellers has the on/off switch: off hides these links and closes /sell.
  const sellersOpen = s.sellers_open !== '0';
  const fullTitle = p.path === '/' ? `${store} · ${s.tagline || 'Seasonal goods, honest prices.'}` : `${p.title} · ${store}`;
  const canonical = `${p.siteUrl}${p.path}`;
  const image = p.image ? (p.image.startsWith('http') ? p.image : `${p.siteUrl}${p.image}`) : `${p.siteUrl}/img/og-default.png`;
  const wa = s.whatsapp_number?.replace(/\D/g, '');
  // Social links saved in Settings (validated https links to the four networks).
  const social = (() => { try { return Object.entries(JSON.parse(s.social_links || '{}') as Record<string, string>).filter(([k, v]) => k in SOCIAL_NETWORKS && /^https:\/\//.test(v)); } catch { return []; } })();
  const announce = s.announcement || '';
  const logo = /^\/media\/brand\/[\w-]+\.(png|webp|svg|jpg)$/.test(s.brand_logo_url ?? '') ? s.brand_logo_url : null;
  const colors = parseBrandColors(JSON.parse(s.brand_colors || '{}'));
  // Brand colours changed in Settings (checked hex values), as CSS variables after the stylesheet.
  const brandVars = (Object.keys(DEFAULT_COLORS) as Array<keyof typeof DEFAULT_COLORS>).filter(k => colors[k] !== DEFAULT_COLORS[k]).map(k => `--${k}:${colors[k]}`).join(';');
  const tracking = trackingConfig(s, p.path);
  const popup = popupFor(s, p.path);
  // Without a logo the shop name is the wordmark: first word in ink, the rest in the main colour ("Abs" "Vai").
  const [firstWord, ...restWords] = store.split(/\s+/);
  const Wordmark = (props: { light?: boolean }) => (
    <a class={`wordmark${props.light ? ' wordmark-light' : ''}`} href="/" aria-label={`${store} home`}>{logo ? <img src={logo} alt={store} height="32" /> : <>{firstWord}{restWords.length > 0 && <span>{restWords.join(' ')}</span>}</>}</a>
  );
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>{fullTitle}</title>
        {p.description && <meta name="description" content={p.description} />}
        <link rel="canonical" href={canonical} />
        {p.noindex && <meta name="robots" content="noindex" />}
        <meta name="theme-color" content={colors.chili} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={store} />
        <meta property="og:title" content={p.title} />
        {p.description && <meta property="og:description" content={p.description} />}
        <meta property="og:url" content={canonical} />
        <meta property="og:image" content={image} />
        <meta name="twitter:card" content="summary_large_image" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="manifest" href="/manifest.webmanifest" />
        {/* Headings and body text: both start downloading with the page, before the browser reaches the text. */}
        <link rel="preload" href="/fonts/poppins-latin-800-normal.woff2" as="font" type="font/woff2" crossorigin="anonymous" />
        <link rel="preload" href="/fonts/inter-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin="anonymous" />
        {p.css ? <style dangerouslySetInnerHTML={{ __html: p.css }} /> : <link rel="stylesheet" href="/css/app.css" />}
        {brandVars && <style dangerouslySetInnerHTML={{ __html: `:root{${brandVars}}` }} />}
        <script type="speculationrules" dangerouslySetInnerHTML={{ __html: json(SPECULATION_RULES) }} />
        {(p.jsonLd ?? []).map(d => <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json(d) }} />)}
      </head>
      <body class={p.bodyClass}>
        <a class="skip" href="#main">Skip to content</a>
        {announce && (
          <div class="announce" role="note">
            <div class="announce-track"><span>{announce}</span><span aria-hidden="true">{announce}</span></div>
          </div>
        )}
        <header class="site-header">
          <div class="header-inner">
            <button class="icon-btn" type="button" data-drawer-open aria-controls="drawer" aria-expanded="false" aria-label="Open menu"><Icon name="menu" /></button>
            <Wordmark />
            <form class="search" action="/search" method="get" role="search" data-search>
              <label class="sr-only" for="q">Search products</label>
              <input id="q" name="q" type="search" placeholder="Search gur, masala, sealer…" autocomplete="off" enterkeyhint="search" />
              <button type="submit" aria-label="Search"><Icon name="search" size={20} /></button>
              <div class="suggest" role="listbox" hidden data-suggest />
            </form>
            <nav class="header-links" aria-label="Main">
              <a href="/shop">Shop</a>
              <a href="/deals">Hot Deals</a>
              <a href="/originals">Abs Vai Originals</a>
              <a href="/track">Track Order</a>
              {sellersOpen && <a href="/sell">Sell with us</a>}
            </nav>
            <button class="icon-btn search-toggle" type="button" data-search-toggle aria-label="Search" aria-expanded="false"><Icon name="search" /></button>
            <a class="icon-btn" href="/wishlist" aria-label="Wishlist"><Icon name="heart" /><span class="badge" data-wish-count hidden>0</span></a>
            <a class="icon-btn" href="/cart" aria-label="Cart"><Icon name="bag" /><span class="badge" data-cart-count hidden>0</span></a>
          </div>
        </header>

        <div class="drawer-backdrop" data-drawer-close hidden />
        <nav class="drawer" id="drawer" aria-label="Menu" hidden>
          <div class="drawer-head">
            <Wordmark />
            <button class="icon-btn" type="button" data-drawer-close aria-label="Close menu"><Icon name="close" /></button>
          </div>
          <ul class="drawer-list">
            {p.activeSeason && <li><a href={`/season/${p.activeSeason.slug}`}><Icon name="sun" />In Season Now <span class="pill">{p.activeSeason.name}</span></a></li>}
            <li>
              <details>
                <summary><Icon name="grid" />All Categories<Icon name="down" size={18} /></summary>
                <ul class="drawer-sub">
                  {p.categories.map(c => (
                    <li>
                      <a href={`/c/${c.slug}`}><img src={smallOf(c.icon)} alt="" width="36" height="36" loading="lazy" decoding="async" />{c.name}</a>
                      {c.children.length > 0 && (
                        <ul>{c.children.map(k => (
                          <li><a href={`/c/${k.slug}`}>{k.name}</a>
                            {k.children.length > 0 && <ul class="drawer-sub-3">{k.children.map(g => <li><a href={`/c/${g.slug}`}>{g.name}</a></li>)}</ul>}
                          </li>
                        ))}</ul>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            </li>
            <li><a href="/originals"><Icon name="leaf" />Abs Vai Originals</a></li>
            <li><a href="/deals"><Icon name="tag" />Hot Deals</a></li>
            <li><a href="/free-delivery"><Icon name="truck" />Free Delivery</a></li>
            <li><a href="/new"><Icon name="box" />New Arrivals</a></li>
            <li><a href="/c/food-business-machines"><Icon name="cash" />For Food Businesses</a></li>
            <li><a href="/track"><Icon name="pin" />Track Order</a></li>
            {sellersOpen && <li><a href="/sell"><Icon name="user" />Sell with us</a></li>}
            <li><a href="/contact"><Icon name="phone" />Contact</a></li>
          </ul>
          <button class="btn btn-primary btn-block" type="button" data-install hidden><Icon name="download" />Install App</button>
        </nav>

        <main id="main">{p.children}</main>

        <footer class="site-footer">
          <div class="footer-inner">
            <div>
              <Wordmark light />
              <p>{s.tagline || 'Seasonal goods, honest prices.'}</p>
              <p class="small">{s.company_name || 'ABS VAI LTD'}{s.company_address ? ` · ${s.company_address}` : ''}</p>
            </div>
            <ul>
              <li><a href="/shop">All products</a></li>
              <li><a href="/categories">Categories</a></li>
              <li><a href="/track">Track your order</a></li>
              <li><a href="/contact">Contact &amp; wholesale</a></li>
              {sellersOpen && <li><a href="/sell">Sell on {store}</a></li>}
            </ul>
            <ul>
              <li><a href="/policies/delivery">Delivery &amp; payment</a></li>
              <li><a href="/policies/returns">Returns &amp; refunds</a></li>
              <li><a href="/policies/privacy">Privacy</a></li>
              <li><a href="/policies/credits">Credits</a></li>
            </ul>
          </div>
          {social.length > 0 && (
            <ul class="footer-social" aria-label="Follow us">
              {social.map(([k, v]) => <li><a href={v} target="_blank" rel="noopener">{SOCIAL_NETWORKS[k as keyof typeof SOCIAL_NETWORKS].replace(' page', '')}</a></li>)}
            </ul>
          )}
          <p class="footer-copy">© {new Date().getFullYear()} {s.company_name || 'ABS VAI LTD'}. Prices in Bangladeshi taka.</p>
        </footer>

        <nav class="tabbar" aria-label="Quick links">
          <a href="/" aria-current={p.tab === 'home' ? 'page' : undefined}><Icon name="home" /><span>Home</span></a>
          <a href="/categories" aria-current={p.tab === 'categories' ? 'page' : undefined}><Icon name="grid" /><span>Categories</span></a>
          <a href="/cart" class="tab-cart" aria-current={p.tab === 'cart' ? 'page' : undefined}><span class="tab-cart-btn"><Icon name="bag" size={26} /><span class="badge" data-cart-count hidden>0</span></span><span>Cart</span></a>
          <a href="/wishlist" aria-current={p.tab === 'wishlist' ? 'page' : undefined}><Icon name="heart" /><span>Wishlist</span></a>
          <a href="/account" aria-current={p.tab === 'account' ? 'page' : undefined}><Icon name="user" /><span>Account</span></a>
        </nav>

        <div class="chat" data-chat>
          <div class="chat-panel" id="chat-panel" role="dialog" aria-label="Chat with us" hidden>
            <div class="chat-menu" data-chat-menu>
              <div class="chat-hello"><b>Hi! 👋 How can we help?</b><span>Choose how you’d like to chat.</span></div>
              <button class="chat-option chat-ai" type="button" data-chat-ai><span class="chat-ico"><Icon name="chat" /></span><span><b>Ask our shop assistant</b><small>Instant answers about products, delivery and payment</small></span></button>
              {wa && <a class="chat-option chat-wa" href={`https://wa.me/${wa}?text=${encodeURIComponent(`Hi ${store}, I have a question.`)}`} target="_blank" rel="noopener"><span class="chat-ico"><Icon name="whatsapp" /></span><span><b>Chat on WhatsApp</b><small>Talk to our team</small></span></a>}
              {s.messenger_page && <a class="chat-option" href={`https://m.me/${s.messenger_page}`} target="_blank" rel="noopener"><span class="chat-ico"><Icon name="messenger" /></span><span><b>Messenger</b></span></a>}
              {s.support_phone && <a class="chat-option" href={`tel:${s.support_phone.replace(/[^\d+]/g, '')}`}><span class="chat-ico"><Icon name="phone" /></span><span><b>Call {s.support_phone}</b></span></a>}
              {!wa && !s.messenger_page && !s.support_phone && <a class="chat-option" href="/contact"><span class="chat-ico"><Icon name="phone" /></span><span><b>Contact us</b></span></a>}
            </div>
            <div class="chat-box" data-chat-box hidden>
              <div class="chat-head">
                <button class="icon-btn" type="button" data-chat-back aria-label="Back"><Icon name="left" /></button>
                <span><b>Shop assistant</b><small>Usually answers in seconds</small></span>
              </div>
              <div class="chat-log" data-chat-log aria-live="polite" />
              <div class="chat-chips" data-chat-chips>
                <button type="button">Delivery charge?</button><button type="button">Cash on Delivery?</button><button type="button">What’s in season?</button><button type="button">Track my order</button>
              </div>
              <form class="chat-form" data-chat-form>
                <label class="sr-only" for="chat-q">Your question</label>
                <input id="chat-q" name="q" maxlength={300} autocomplete="off" enterkeyhint="send" placeholder="Ask about a product, delivery…" />
                <button class="chat-send" type="submit" aria-label="Send"><Icon name="right" /></button>
              </form>
              <p class="chat-note">Answers come from our shop’s information. For anything about your order, WhatsApp or call us.</p>
            </div>
          </div>
          <button class="chat-fab" type="button" aria-expanded="false" aria-controls="chat-panel" aria-label="Chat with us"><span class="chat-fab-open"><Icon name="chat" size={26} /></span><span class="chat-fab-close"><Icon name="close" size={24} /></span></button>
        </div>

        {popup && (
          <dialog class={`popup theme-${popup.theme ?? 'chili'}`} data-popup data-key={popup.key} data-delay={String(popup.delay ?? 4)} data-freq={popup.frequency ?? 'day'} aria-labelledby="popup-title">
            <button class="popup-close" type="button" data-popup-close aria-label="Close"><Icon name="close" /></button>
            {popup.image && <img class="popup-img" src={popup.image} srcset={srcsetOf(popup.image)} sizes="(max-width: 480px) 90vw, 420px" alt="" width="600" height="400" loading="lazy" decoding="async" />}
            <div class="popup-copy">
              <p class="popup-title" id="popup-title">{popup.headline}</p>
              {popup.subline && <p class="popup-sub">{popup.subline}</p>}
              <a class="btn btn-cta" href={popup.cta_href ?? '/shop'} data-popup-go>{popup.cta_text ?? 'Shop now'}<Icon name="right" size={18} /></a>
            </div>
          </dialog>
        )}

        <div class="sheet-backdrop" data-sheet-close hidden />
        <section class="sheet" id="pick-sheet" role="dialog" aria-modal="true" aria-labelledby="pick-title" hidden>
          <div class="sheet-head">
            <h2 id="pick-title">Choose options</h2>
            <button class="icon-btn" type="button" data-sheet-close aria-label="Close"><Icon name="close" /></button>
          </div>
          <div class="sheet-body" data-sheet-body />
        </section>
        <div class="toast" role="status" aria-live="polite" data-toast hidden />

        {p.pageData && <script type="application/json" id="page-data" dangerouslySetInnerHTML={{ __html: json(p.pageData) }} />}
        {tracking && <script type="application/json" id="tracking-config" dangerouslySetInnerHTML={{ __html: json(tracking) }} />}
        {tracking && <script src="/js/track.js" defer />}
        {p.turnstileSiteKey && <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />}
        <script type="module" src="/js/app.js" />
        {(p.scripts ?? []).map(src => <script type="module" src={src} />)}
      </body>
    </html>
  );
}
