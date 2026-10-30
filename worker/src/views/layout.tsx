import type { Child } from 'hono/jsx';
import type { CategoryNode } from '../data/catalog';
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
}

const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

export function Layout(p: LayoutProps) {
  const s = p.settings;
  const store = s.store_name || 'Abs Vai';
  const fullTitle = p.path === '/' ? `${store} · ${s.tagline || 'Seasonal goods, honest prices.'}` : `${p.title} · ${store}`;
  const canonical = `${p.siteUrl}${p.path}`;
  const image = p.image ? (p.image.startsWith('http') ? p.image : `${p.siteUrl}${p.image}`) : `${p.siteUrl}/img/og-default.png`;
  const wa = s.whatsapp_number?.replace(/\D/g, '');
  const announce = s.announcement || '';
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>{fullTitle}</title>
        {p.description && <meta name="description" content={p.description} />}
        <link rel="canonical" href={canonical} />
        {p.noindex && <meta name="robots" content="noindex" />}
        <meta name="theme-color" content="#B3261E" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={store} />
        <meta property="og:title" content={p.title} />
        {p.description && <meta property="og:description" content={p.description} />}
        <meta property="og:url" content={canonical} />
        <meta property="og:image" content={image} />
        <meta name="twitter:card" content="summary_large_image" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@700;800&display=swap" />
        <link rel="stylesheet" href="/css/app.css" />
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
            <a class="wordmark" href="/" aria-label={`${store} home`}>Abs<span>Vai</span></a>
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
            </nav>
            <button class="icon-btn search-toggle" type="button" data-search-toggle aria-label="Search" aria-expanded="false"><Icon name="search" /></button>
            <a class="icon-btn" href="/wishlist" aria-label="Wishlist"><Icon name="heart" /><span class="badge" data-wish-count hidden>0</span></a>
            <a class="icon-btn" href="/cart" aria-label="Cart"><Icon name="bag" /><span class="badge" data-cart-count>0</span></a>
          </div>
        </header>

        <div class="drawer-backdrop" data-drawer-close hidden />
        <nav class="drawer" id="drawer" aria-label="Menu" hidden>
          <div class="drawer-head">
            <a class="wordmark" href="/">Abs<span>Vai</span></a>
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
                      <a href={`/c/${c.slug}`}><img src={c.icon} alt="" width="36" height="36" loading="lazy" />{c.name}</a>
                      {c.children.length > 0 && <ul>{c.children.map(k => <li><a href={`/c/${k.slug}`}>{k.name}</a></li>)}</ul>}
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
            <li><a href="/contact"><Icon name="phone" />Contact</a></li>
          </ul>
          <button class="btn btn-primary btn-block" type="button" data-install hidden><Icon name="download" />Install App</button>
        </nav>

        <main id="main">{p.children}</main>

        <footer class="site-footer">
          <div class="footer-inner">
            <div>
              <a class="wordmark wordmark-light" href="/">Abs<span>Vai</span></a>
              <p>{s.tagline || 'Seasonal goods, honest prices.'}</p>
              <p class="small">{s.company_name || 'ABS VAI LTD'}{s.company_address ? ` · ${s.company_address}` : ''}</p>
            </div>
            <ul>
              <li><a href="/shop">All products</a></li>
              <li><a href="/categories">Categories</a></li>
              <li><a href="/track">Track your order</a></li>
              <li><a href="/contact">Contact &amp; wholesale</a></li>
            </ul>
            <ul>
              <li><a href="/policies/delivery">Delivery &amp; payment</a></li>
              <li><a href="/policies/returns">Returns &amp; refunds</a></li>
              <li><a href="/policies/privacy">Privacy</a></li>
              <li><a href="/policies/credits">Credits</a></li>
            </ul>
          </div>
          <p class="footer-copy">© {new Date().getFullYear()} {s.company_name || 'ABS VAI LTD'}. Prices in Bangladeshi taka.</p>
        </footer>

        <nav class="tabbar" aria-label="Quick links">
          <a href="/" aria-current={p.tab === 'home' ? 'page' : undefined}><Icon name="home" /><span>Home</span></a>
          <a href="/categories" aria-current={p.tab === 'categories' ? 'page' : undefined}><Icon name="grid" /><span>Categories</span></a>
          <a href="/cart" class="tab-cart" aria-current={p.tab === 'cart' ? 'page' : undefined}><span class="tab-cart-btn"><Icon name="bag" size={26} /><span class="badge" data-cart-count>0</span></span><span>Cart</span></a>
          <a href="/wishlist" aria-current={p.tab === 'wishlist' ? 'page' : undefined}><Icon name="heart" /><span>Wishlist</span></a>
          <a href="/account" aria-current={p.tab === 'account' ? 'page' : undefined}><Icon name="user" /><span>Account</span></a>
        </nav>

        <div class="chat" data-chat>
          <div class="chat-panel" id="chat-panel" hidden>
            <p class="chat-title">How would you like to talk to us?</p>
            {wa && <a class="chat-option" href={`https://wa.me/${wa}?text=${encodeURIComponent('Hi Abs Vai, I have a question.')}`} target="_blank" rel="noopener"><Icon name="whatsapp" />WhatsApp</a>}
            {s.messenger_page && <a class="chat-option" href={`https://m.me/${s.messenger_page}`} target="_blank" rel="noopener"><Icon name="messenger" />Messenger</a>}
            {s.support_phone && <a class="chat-option" href={`tel:${s.support_phone.replace(/[^\d+]/g, '')}`}><Icon name="phone" />Call {s.support_phone}</a>}
            {!wa && !s.messenger_page && !s.support_phone && <a class="chat-option" href="/contact"><Icon name="phone" />Contact us</a>}
          </div>
          <button class="chat-fab" type="button" aria-expanded="false" aria-controls="chat-panel" aria-label="Chat with us"><Icon name="chat" size={26} /></button>
        </div>

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
        {p.turnstileSiteKey && <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />}
        <script type="module" src="/js/app.js" />
        {(p.scripts ?? []).map(src => <script type="module" src={src} />)}
      </body>
    </html>
  );
}
