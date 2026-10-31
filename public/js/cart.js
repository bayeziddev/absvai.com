// Cart page: the browser keeps only variant IDs and quantities; every price comes from the server.
import { api, cart, esc, small, taka } from './app.js';

const root = document.querySelector('[data-cart-page]');
const pd = JSON.parse(document.getElementById('page-data')?.textContent || '{}');

async function render() {
  const lines = cart.lines();
  if (!lines.length) {
    root.innerHTML = '<div class="empty"><h2>Your cart is empty</h2><p>Browse the season’s best and add something you like.</p><a class="btn btn-primary" href="/shop">Start shopping</a></div>';
    return;
  }
  let r;
  try { r = await api('/api/cart/price', { lines }); } catch (e) { root.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
  // Drop items that no longer exist.
  const known = new Set(r.lines.map(l => l.variantId));
  lines.filter(l => !known.has(l.variantId)).forEach(l => cart.setQty(l.variantId, 0));
  const gap = pd.freeThresholdPaisa ? pd.freeThresholdPaisa - r.subtotalPaisa : 0;
  root.innerHTML = `
    ${r.problems.length ? `<div class="notice notice-error" role="alert">${r.problems.map(esc).join('<br>')}</div>` : ''}
    ${r.lines.map(l => `
      <article class="cart-line" data-line="${l.variantId}">
        <a href="/p/${esc(l.slug)}"><img src="${esc(small(l.image))}" alt=""></a>
        <div>
          <h3><a href="/p/${esc(l.slug)}">${esc(l.name)}</a></h3>
          ${l.variantLabel ? `<p class="small muted">${esc(l.variantLabel)}</p>` : ''}
          ${l.unitPaisa < l.basePaisa ? `<p class="small" style="color:var(--leaf)">Wholesale price applied</p>` : ''}
          ${l.problem ? `<p class="small error">${esc(l.problem)}</p>` : ''}
          <div class="cart-line-foot">
            <div class="stepper"><button type="button" data-step="-1" aria-label="One less">−</button><input type="number" value="${l.qty}" min="1" max="${l.maxQty || 1}" aria-label="Quantity"><button type="button" data-step="1" aria-label="One more">+</button></div>
            <strong>${taka(l.lineTotalPaisa)}</strong>
          </div>
          <button class="link-btn" type="button" data-remove>Remove</button>
        </div>
      </article>`).join('')}
    <div class="cart-summary">
      <dl class="totals"><dt>Subtotal</dt><dd>${taka(r.subtotalPaisa)}</dd><dt>Delivery</dt><dd>Worked out at checkout</dd></dl>
      ${gap > 0 ? `<p class="small">Add <strong>${taka(gap)}</strong> more for free delivery (large items excluded).</p>` : pd.freeThresholdPaisa ? '<p class="small" style="color:var(--leaf)"><strong>You get free delivery</strong> on regular items.</p>' : ''}
      <a class="btn btn-primary btn-lg btn-block" href="/checkout" ${r.problems.length ? 'aria-disabled="true"' : ''}>Checkout</a>
      <p class="small muted">Cash on Delivery all over Bangladesh.</p>
    </div>`;
  root.querySelectorAll('[data-line]').forEach(row => {
    const id = Number(row.dataset.line);
    const input = row.querySelector('input');
    const set = q => { cart.setQty(id, Math.max(0, Math.min(Number(input.max) || 99, q))); render(); };
    row.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => set(Number(input.value) + Number(b.dataset.step))));
    input.addEventListener('change', () => set(Number(input.value) || 1));
    row.querySelector('[data-remove]').addEventListener('click', () => set(0));
  });
}

render();
