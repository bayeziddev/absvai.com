// Abs Vai storefront: shared behaviour for every page. No framework. Third-party tracking only runs through track.js when
// the owner turns it on, and never for a prerendered page the visitor did not open.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const taka = paisa => `৳${Math.floor(Math.abs(paisa) / 100).toLocaleString('en-US')}${paisa % 100 ? `.${String(Math.abs(paisa) % 100).padStart(2, '0')}` : ''}`;
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// Uploaded photos also come 480 and 960 px wide (worker/src/lib/images.ts); built-in pictures don't.
const RESIZABLE = /^\/media\/(p\/\d+|c|b)\/[\w-]+\.(webp|jpg)$/;
const copy = (u, w) => u.replace(/\.(webp|jpg)$/, `-${w}.$1`);
/** The small copy of a photo, for thumbnails. */
export const small = u => (u && RESIZABLE.test(u) ? copy(u, 480) : u);
/** Shows a photo in an <img> that has `sizes`, letting the browser pick the right width. */
export function showPhoto(img, u) {
  img.srcset = u && RESIZABLE.test(u) ? `${copy(u, 480)} 480w, ${copy(u, 960)} 960w, ${u} 1600w` : '';
  img.src = u;
}

function store(key, fallback) {
  return {
    get() { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
    set(v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode: keep working without saving */ } },
  };
}

const cartStore = store('absvai.cart', []);
const wishStore = store('absvai.wish', []);

/** Tracking events for track.js (Pixel/GA4). Queued, so nothing is lost if track.js loads later or never. */
export function track(name, data = {}) {
  (window.__absvaiq ||= []).push({ name, data });
  dispatchEvent(new CustomEvent('absvai:track', { detail: { name, data } }));
}

export const cart = {
  lines: () => cartStore.get().filter(l => Number.isInteger(l.variantId) && l.qty > 0),
  // Optimistic: the badge updates immediately; prices are checked on the server at cart and checkout.
  add(variantId, qty = 1) {
    const lines = cart.lines();
    const hit = lines.find(l => l.variantId === variantId);
    if (hit) hit.qty = Math.min(99, hit.qty + qty); else lines.push({ variantId, qty });
    cartStore.set(lines);
    badges();
    track('AddToCart', { variantId, qty });
  },
  setQty(variantId, qty) {
    cartStore.set(cart.lines().map(l => (l.variantId === variantId ? { ...l, qty } : l)).filter(l => l.qty > 0));
    badges();
  },
  clear() { cartStore.set([]); badges(); },
};

export const wish = {
  ids: () => wishStore.get(),
  toggle(id) { const ids = wish.ids(); const on = !ids.includes(id); wishStore.set(on ? [...ids, id] : ids.filter(x => x !== id)); badges(); return on; },
};

function badges() {
  const n = cart.lines().reduce((s, l) => s + l.qty, 0);
  $$('[data-cart-count]').forEach(b => { b.textContent = String(n); b.hidden = n === 0; });
  const w = wish.ids().length;
  $$('[data-wish-count]').forEach(b => { b.textContent = String(w); b.hidden = w === 0; });
  $$('[data-wish]').forEach(btn => btn.setAttribute('aria-pressed', String(wish.ids().includes(Number(btn.dataset.wish)))));
}

let toastTimer;
export function toast(html, ms = 3500) {
  const t = $('[data-toast]');
  if (!t) return;
  t.innerHTML = html;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

export async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let data = {};
  try { data = await r.json(); } catch { /* empty */ }
  if (!r.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Please try again.'), { status: r.status, data });
  return data;
}

export function buyNow(variantId, qty = 1) {
  location.href = `/checkout?buy=${variantId}&qty=${qty}`;
}

export function added(name) {
  toast(`<span>Added${name ? ` <strong>${esc(name)}</strong>` : ''} to your cart.</span><a href="/cart">View cart</a>`);
}

// ── Drawer & overlays ──
function setupDrawer() {
  const drawer = $('#drawer');
  const backdrop = $('.drawer-backdrop');
  const opener = $('[data-drawer-open]');
  if (!drawer) return;
  const close = () => { drawer.hidden = true; backdrop.hidden = true; opener?.setAttribute('aria-expanded', 'false'); opener?.focus(); };
  opener?.addEventListener('click', () => { drawer.hidden = false; backdrop.hidden = false; opener.setAttribute('aria-expanded', 'true'); $('a, button, summary', drawer)?.focus(); });
  $$('[data-drawer-close]').forEach(b => b.addEventListener('click', close));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !drawer.hidden) close(); });
}

// ── Search with live suggestions (synonym-aware on the server) ──
function setupSearch() {
  const form = $('[data-search]');
  if (!form) return;
  const input = $('input', form);
  const box = $('[data-suggest]', form);
  const toggle = $('[data-search-toggle]');
  toggle?.addEventListener('click', () => { const open = form.classList.toggle('open'); toggle.setAttribute('aria-expanded', String(open)); if (open) input.focus(); });
  let timer;
  let seq = 0;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { box.hidden = true; return; }
    timer = setTimeout(async () => {
      const mine = ++seq;
      try {
        const r = await api(`/api/search/suggest?q=${encodeURIComponent(q)}`);
        if (mine !== seq) return;
        const cats = r.categories.map(c => `<a role="option" href="/c/${esc(c.slug)}"><span class="suggest-cat">${esc(c.name)}</span></a>`).join('');
        const prods = r.products.map(p => `<a role="option" href="/p/${esc(p.slug)}"><img src="${esc(small(p.image))}" alt=""><span>${esc(p.name)}<small>${taka(p.pricePaisa)}${p.keySpecs ? ` · ${esc(p.keySpecs)}` : ''}</small></span></a>`).join('');
        box.innerHTML = cats + prods || `<a href="/search?q=${encodeURIComponent(q)}"><span>Search for “${esc(q)}”</span></a>`;
        box.hidden = false;
      } catch { box.hidden = true; }
    }, 180);
  });
  input.addEventListener('keydown', e => {
    const opts = $$('a', box);
    if (box.hidden || !opts.length || !['ArrowDown', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const i = opts.findIndex(o => o.getAttribute('aria-selected') === 'true');
    const next = e.key === 'ArrowDown' ? (i + 1) % opts.length : (i - 1 + opts.length) % opts.length;
    opts.forEach((o, j) => o.setAttribute('aria-selected', String(j === next)));
    opts[next].focus();
  });
  document.addEventListener('click', e => { if (!form.contains(e.target)) box.hidden = true; });
}

// ── Carousels ──
function setupCarousels() {
  $$('[data-carousel]').forEach(track => {
    const dots = $$('button', track.parentElement.querySelector('[data-dots]') ?? document.createElement('div'));
    const slides = [...track.children];
    let index = 0;
    const go = i => { index = (i + slides.length) % slides.length; track.scrollTo({ left: slides[index].offsetLeft - track.offsetLeft, behavior: 'smooth' }); };
    dots.forEach((d, i) => d.addEventListener('click', () => { go(i); stop(); }));
    track.addEventListener('scroll', () => {
      const i = Math.round(track.scrollLeft / track.clientWidth);
      if (i !== index) index = i;
      dots.forEach((d, j) => d.setAttribute('aria-current', String(j === i)));
    }, { passive: true });
    let timer = null;
    const stop = () => { clearInterval(timer); timer = null; };
    if (slides.length > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      timer = setInterval(() => { if (!document.hidden) go(index + 1); }, 5500);
      ['pointerdown', 'focusin', 'wheel'].forEach(ev => track.addEventListener(ev, stop, { passive: true, once: true }));
    }
  });
  $$('[data-scroll]').forEach(btn => btn.addEventListener('click', () => {
    const scroller = btn.parentElement.querySelector('[data-scroller]');
    scroller?.scrollBy({ left: Number(btn.dataset.scroll) * scroller.clientWidth * 0.8, behavior: 'smooth' });
  }));
}

// ── Quick option picker for multi-option products on cards ──
async function openPicker(slug, mode) {
  const sheet = $('#pick-sheet');
  const body = $('[data-sheet-body]', sheet);
  const backdrop = $('.sheet-backdrop');
  body.innerHTML = '<p class="muted">Loading options…</p>';
  sheet.hidden = false; backdrop.hidden = false;
  const close = () => { sheet.hidden = true; backdrop.hidden = true; };
  $$('[data-sheet-close]').forEach(b => { b.onclick = close; });
  let p;
  try { p = await api(`/api/catalog/products/${encodeURIComponent(slug)}`); } catch (e) { body.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
  const buyable = p.variants.filter(v => v.availability?.canBuy && (v.stock > 0 || v.availability.state === 'made_to_order'));
  const choice = Object.fromEntries(p.attributes.map(a => [a.id, (buyable[0] ?? p.variants[0])?.attributes[a.id]]));
  const match = () => p.variants.find(v => p.attributes.every(a => v.attributes[a.id] === choice[a.id]));
  const render = () => {
    const v = match();
    const ok = v && v.availability?.canBuy && (v.stock > 0 || v.availability.state === 'made_to_order');
    body.innerHTML = `
      <div class="sheet-product"><img src="${esc(small(p.image) ?? '/img/placeholders/none.svg')}" alt=""><div><strong>${esc(p.name)}</strong><p class="price"><strong>${v ? taka(v.pricePaisa) : '—'}</strong>${v?.compareAtPricePaisa > v?.pricePaisa ? `<s>${taka(v.compareAtPricePaisa)}</s>` : ''}</p></div></div>
      ${p.attributes.map(a => `<fieldset class="opt"><legend>${esc(a.label)}</legend><div class="opt-values">${a.values.map(val => `
        <label class="opt-chip"><input type="radio" name="sheet-${esc(a.id)}" value="${esc(val)}" ${choice[a.id] === val ? 'checked' : ''}><span>${esc(val)}</span></label>`).join('')}</div></fieldset>`).join('')}
      <p class="avail ${ok ? 'avail-available' : 'avail-muted'}">${v ? esc(ok ? v.availability.label : v.stock <= 0 ? 'Out of stock' : v.availability.label) : 'This combination is not available'}</p>
      <div class="sheet-actions"><button class="btn btn-outline" type="button" data-s-add ${ok ? '' : 'disabled'}>Add to Cart</button><button class="btn btn-primary" type="button" data-s-order ${ok ? '' : 'disabled'}>${v?.availability?.state === 'pre_order' ? 'Pre-order' : 'Order Now'}</button></div>`;
    $$('input[type=radio]', body).forEach(r => r.addEventListener('change', () => { choice[r.name.slice(6)] = r.value; render(); }));
    $('[data-s-add]', body).onclick = () => { cart.add(v.id); close(); added(p.name); };
    $('[data-s-order]', body).onclick = () => buyNow(v.id);
  };
  render();
  if (mode === 'order' && p.variants.length === 1) buyNow(p.variants[0].id);
}

function setupCards() {
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (btn) {
      const card = btn.closest('[data-product]');
      const variant = Number(card.dataset.variant);
      if (variant) {
        if (btn.dataset.action === 'order') buyNow(variant);
        else { cart.add(variant); added(card.dataset.name); }
      } else openPicker(card.dataset.product, btn.dataset.action);
      return;
    }
    const w = e.target.closest('[data-wish]');
    if (w) {
      const on = wish.toggle(Number(w.dataset.wish));
      toast(on ? 'Saved to your wishlist. <a href="/wishlist">View</a>' : 'Removed from your wishlist.');
    }
  });
}

// ── Small things ──
function setupMisc() {
  const fab = $('.chat-fab');
  const panel = $('#chat-panel');
  fab?.addEventListener('click', () => { panel.hidden = !panel.hidden; fab.setAttribute('aria-expanded', String(!panel.hidden)); });

  $$('[data-autosubmit]').forEach(s => s.addEventListener('change', () => s.form.requestSubmit()));
  const filters = $('[data-filters]');
  $('[data-filter-open]')?.addEventListener('click', () => filters?.showModal());
  $('[data-filter-close]')?.addEventListener('click', () => filters?.close());
  $$('[data-open-dialog]').forEach(b => b.addEventListener('click', () => document.getElementById(b.dataset.openDialog)?.showModal()));
  $$('[data-close-dialog]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));

  $$('[data-youtube]').forEach(box => box.querySelector('button').addEventListener('click', () => {
    box.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(box.dataset.youtube)}?autoplay=1&rel=0" title="How it works" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe>`;
  }));

  $$('[data-countdown]').forEach(el => {
    // Counts down to the season's real end date (23:59 Bangladesh time), never a fake timer.
    const end = Date.parse(`${el.dataset.countdown}T23:59:59+06:00`);
    const tick = () => {
      const ms = end - Date.now();
      if (ms <= 0) { el.textContent = 'This season has ended.'; return; }
      const d = Math.floor(ms / 86400000);
      const h = Math.floor((ms % 86400000) / 3600000);
      el.textContent = `Season ends in ${d} day${d === 1 ? '' : 's'} ${h} hour${h === 1 ? '' : 's'}`;
    };
    tick();
    setInterval(tick, 60000);
  });

  const notify = $('[data-notify]');
  notify?.addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('[data-msg]', notify);
    try {
      const r = await api('/api/notify', { productId: Number(notify.dataset.notify), phone: notify.phone.value, channel: notify.channel.value });
      msg.className = 'form-msg ok'; msg.textContent = r.message; notify.reset();
    } catch (err) { msg.className = 'form-msg error'; msg.textContent = err.message; }
  });

  const ws = $('[data-wholesale]');
  ws?.addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('[data-msg]', ws);
    try {
      const r = await api('/api/wholesale-inquiry', Object.fromEntries(new FormData(ws)));
      msg.className = 'form-msg ok'; msg.textContent = r.message; ws.reset();
    } catch (err) { msg.className = 'form-msg error'; msg.textContent = err.message; }
  });

  // Wishlist lives on this device; the server renders the cards for the saved IDs.
  const wl = $('[data-wishlist-page]');
  if (wl && !new URLSearchParams(location.search).has('ids')) location.replace(`/wishlist?ids=${wish.ids().join(',')}`);

  // Remember ad/UTM parameters for the order (saved on the order for attribution).
  const params = new URLSearchParams(location.search);
  const utm = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid']) if (params.get(k)) utm[k] = params.get(k);
  if (Object.keys(utm).length) try { sessionStorage.setItem('absvai.utm', JSON.stringify(utm)); } catch { /* ignore */ }

  let deferred;
  const install = $('[data-install]');
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; if (install) install.hidden = false; });
  install?.addEventListener('click', async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; install.hidden = true; });
}

// ── Live price and stock on edge-cached pages (Section 2.2) ──
async function setupLive() {
  const cards = $$('[data-product-id]');
  const ids = [...new Set(cards.map(c => Number(c.dataset.productId)).filter(Boolean))].sort((a, b) => a - b).slice(0, 60);
  if (!ids.length || $('[data-pdp-form]')) return;
  let live;
  try { live = (await (await fetch(`/api/live?ids=${ids.join(',')}`)).json()).products; } catch { return; }
  for (const card of cards) {
    const p = live?.[card.dataset.productId];
    if (!p || !p.variants.length) continue;
    const cheapest = [...p.variants].sort((a, b) => a.pricePaisa - b.pricePaisa)[0];
    const strong = $('.price strong', card);
    if (strong) strong.innerHTML = p.variants.length > 1 ? `<small>from </small>${taka(cheapest.pricePaisa)}` : taka(cheapest.pricePaisa);
    const struck = $('.price s', card);
    if (struck) struck.hidden = !(cheapest.compareAtPricePaisa > cheapest.pricePaisa);
    const actions = $('.card-actions', card);
    if (actions && !p.variants.some(v => v.canBuy)) {
      actions.innerHTML = `<p class="avail avail-out_of_stock">${esc(p.availability?.label || 'Out of stock')}</p>`;
    }
  }
}

// ── Prefetch fallback for browsers without the Speculation Rules API (Section 2.3) ──
function setupPrefetch() {
  if (HTMLScriptElement.supports?.('speculationrules') || !('IntersectionObserver' in window)) return;
  if (navigator.connection?.saveData) return;
  const done = new Set();
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting || done.size >= 12) continue;
      const href = e.target.getAttribute('href');
      io.unobserve(e.target);
      if (done.has(href)) continue;
      done.add(href);
      (window.requestIdleCallback || setTimeout)(() => {
        const l = document.createElement('link');
        l.rel = 'prefetch';
        l.href = href;
        document.head.append(l);
      });
    }
  }, { rootMargin: '200px' });
  $$('a[href^="/p/"], a[href^="/c/"]').forEach(a => io.observe(a));
}

setupDrawer();
setupSearch();
setupCarousels();
setupCards();
setupMisc();
badges();
setupLive();
setupPrefetch();
if ('serviceWorker' in navigator && location.protocol === 'https:') addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
if ($('[data-pdp-form]')) {
  let pid = null;
  try { pid = JSON.parse($('#page-data').textContent).product?.id ?? null; } catch { /* ignore */ }
  track('ViewContent', { productId: pid });
}
if ($('[data-checkout]')) track('InitiateCheckout', {});
