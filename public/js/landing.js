// Landing page (/lp/:slug): order buttons scroll to the form, the option and quantity picker updates the order
// (checkout.js listens for 'absvai:lines'), the sticky order bar hides while the form is on screen, photos open
// larger, and one visit is counted per browser session.
const root = document.querySelector('[data-lp]');
const pd = JSON.parse(document.getElementById('page-data')?.textContent || '{}');
const taka = p => `৳${(Number(p) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

if (root) {
  const id = root.dataset.lp;
  // ── Visit counter (published pages only; the page itself is cached at the edge) ──
  try {
    if (!pd.draft && !sessionStorage.getItem(`lpv:${id}`)) {
      sessionStorage.setItem(`lpv:${id}`, '1');
      navigator.sendBeacon?.(`/api/lp/${id}/view`) || fetch(`/api/lp/${id}/view`, { method: 'POST', keepalive: true }).catch(() => {});
    }
  } catch { /* private mode: not counted */ }

  // ── Order buttons → the form ──
  const order = document.getElementById('order');
  root.querySelectorAll('[data-lp-cta]').forEach(a => a.addEventListener('click', e => {
    if (!order) return;
    e.preventDefault();
    order.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    setTimeout(() => document.querySelector('#checkout-form input[name=phone]')?.focus({ preventScroll: true }), 600);
  }));

  // ── Option and quantity ──
  const qtyInput = root.querySelector('[data-lp-qty-input]');
  const stickyPrice = root.querySelector('[data-lp-sticky-price]');
  const current = () => {
    const picked = root.querySelector('input[name=lpVariant]:checked');
    const variantId = picked ? Number(picked.value) : pd.lines?.[0]?.variantId;
    const qty = Math.max(1, Math.min(20, Number(qtyInput?.value) || 1));
    return { variantId, qty, price: picked ? Number(picked.dataset.price) : null };
  };
  const send = () => {
    const c = current();
    if (qtyInput) qtyInput.value = String(c.qty);
    if (stickyPrice && c.price !== null) stickyPrice.textContent = taka(c.price * c.qty);
    if (c.variantId) document.dispatchEvent(new CustomEvent('absvai:lines', { detail: [{ variantId: c.variantId, qty: c.qty }] }));
  };
  root.querySelectorAll('input[name=lpVariant]').forEach(r => r.addEventListener('change', send));
  root.querySelectorAll('[data-lp-qty]').forEach(b => b.addEventListener('click', () => { qtyInput.value = String((Number(qtyInput.value) || 1) + Number(b.dataset.lpQty)); send(); }));
  qtyInput?.addEventListener('change', send);

  // ── Sticky order bar: shown once the top order button scrolls away, hidden while the form is on screen ──
  const sticky = root.querySelector('[data-lp-sticky]');
  if (sticky && 'IntersectionObserver' in window) {
    let pastHero = false;
    let formVisible = false;
    const update = () => sticky.classList.toggle('show', pastHero && !formVisible);
    const heroCta = root.querySelector('.lp-hero [data-lp-cta]');
    if (heroCta) new IntersectionObserver(([e]) => { pastHero = !e.isIntersecting && e.boundingClientRect.top < 0; update(); }).observe(heroCta);
    else pastHero = true;
    if (order) new IntersectionObserver(([e]) => { formVisible = e.isIntersecting; update(); }, { threshold: 0.05 }).observe(order);
    update();
  }

  // ── Photos open larger ──
  const viewer = root.querySelector('[data-lp-viewer]');
  root.querySelectorAll('[data-lp-photo]').forEach(b => b.addEventListener('click', () => {
    if (!viewer?.showModal) return;
    viewer.querySelector('img').src = b.dataset.lpPhoto;
    viewer.showModal();
  }));
  viewer?.querySelector('[data-lp-close]')?.addEventListener('click', () => viewer.close());
  viewer?.addEventListener('click', e => { if (e.target === viewer) viewer.close(); });
}
