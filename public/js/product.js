// Product page: the selectors come from the product's template; price, stock, unit price and photo follow the chosen option.
import { added, buyNow, cart, showPhoto, taka } from './app.js';

const data = JSON.parse(document.getElementById('page-data').textContent);
const form = document.querySelector('[data-pdp-form]');
const choice = {};
for (const a of data.attributes) choice[a] = form.querySelector(`input[name="opt-${a}"]:checked`)?.value;

const buyable = v => v && v.availability?.canBuy && (v.stock > 0 || v.availability.state === 'made_to_order');
const match = () => data.variants.find(v => data.attributes.every(a => v.attributes[a] === choice[a]));
const qtyInput = form.querySelector('input[name=qty]');

function update() {
  const v = match();
  const ok = buyable(v);
  document.querySelectorAll('[data-price]').forEach(el => { el.textContent = v ? taka(v.pricePaisa) : '—'; });
  const compare = document.querySelector('[data-compare]');
  const save = document.querySelector('[data-save]');
  const saving = v && v.compareAtPricePaisa > v.pricePaisa ? v.compareAtPricePaisa - v.pricePaisa : 0;
  compare.hidden = !saving; save.hidden = !saving;
  if (saving) { compare.textContent = taka(v.compareAtPricePaisa); save.textContent = `Save ${taka(saving)}`; }
  document.querySelector('[data-unit]').textContent = v?.unit ?? '';
  const avail = document.querySelector('[data-avail]');
  const state = !v ? 'out_of_stock' : v.availability.state === 'available' && v.stock <= 0 ? 'out_of_stock' : v.availability.state;
  avail.className = `avail avail-${state}`;
  avail.textContent = !v ? 'This combination is not available' : state === 'out_of_stock' ? 'Out of stock' : v.availability.label + (state === 'available' && v.stock <= 5 ? ` · only ${v.stock} left` : '');
  document.querySelectorAll('[data-actions], [data-sticky-buy]').forEach(el => { el.hidden = !ok; });
  const label = document.querySelector('[data-variant-label]');
  if (label && v) label.textContent = Object.values(v.attributes).join(' · ');
  for (const a of data.attributes) {
    const shown = document.querySelector(`[data-selected-label="${a}"]`);
    if (shown) shown.textContent = choice[a] ?? '';
    // Grey out values that have no option with the other current choices.
    form.querySelectorAll(`input[name="opt-${a}"]`).forEach(r => {
      const possible = data.variants.some(x => x.attributes[a] === r.value && data.attributes.every(b => b === a || x.attributes[b] === choice[b]) && buyable(x));
      r.disabled = !possible && !r.checked;
    });
  }
  if (v?.image) showPhoto(document.getElementById('pdp-main'), v.image);
  const max = v && v.availability.state !== 'made_to_order' ? Math.max(1, Math.min(99, v.stock)) : 20;
  qtyInput.max = String(max);
  if (Number(qtyInput.value) > max) qtyInput.value = String(max);
}

form.addEventListener('change', e => {
  if (e.target.name?.startsWith('opt-')) { choice[e.target.name.slice(4)] = e.target.value; update();

// The page itself is served from the edge cache; current price and stock come from /api/live (Section 2.2).
fetch(`/api/live?ids=${data.product.id}`).then(r => (r.ok ? r.json() : null)).then(live => {
  const p = live?.products?.[data.product.id];
  if (!p) return;
  for (const lv of p.variants) {
    const v = data.variants.find(x => x.id === lv.id);
    if (!v) continue;
    v.pricePaisa = lv.pricePaisa;
    v.compareAtPricePaisa = lv.compareAtPricePaisa;
    v.stock = lv.available;
    v.availability = { ...v.availability, canBuy: lv.canBuy, label: lv.label, state: lv.available > 0 || v.availability.state !== 'available' ? v.availability.state : 'out_of_stock' };
  }
  update();
}).catch(() => {}); }
});
form.querySelectorAll('[data-qty]').forEach(b => b.addEventListener('click', () => {
  qtyInput.value = String(Math.min(Number(qtyInput.max) || 99, Math.max(1, (Number(qtyInput.value) || 1) + Number(b.dataset.qty))));
}));

const qty = () => Math.max(1, Math.min(Number(qtyInput.max) || 99, Number(qtyInput.value) || 1));
document.querySelectorAll('[data-pdp-add]').forEach(b => b.addEventListener('click', () => { const v = match(); if (buyable(v)) { cart.add(v.id, qty()); added(data.product.name); } }));
document.querySelectorAll('[data-pdp-order]').forEach(b => b.addEventListener('click', () => { const v = match(); if (buyable(v)) buyNow(v.id, qty()); }));

document.querySelectorAll('[data-thumb]').forEach(t => t.addEventListener('click', () => {
  showPhoto(document.getElementById('pdp-main'), t.dataset.thumb);
  document.querySelectorAll('[data-thumb]').forEach(x => x.setAttribute('aria-current', String(x === t)));
}));

update();

// The page itself is served from the edge cache; current price and stock come from /api/live (Section 2.2).
fetch(`/api/live?ids=${data.product.id}`).then(r => (r.ok ? r.json() : null)).then(live => {
  const p = live?.products?.[data.product.id];
  if (!p) return;
  for (const lv of p.variants) {
    const v = data.variants.find(x => x.id === lv.id);
    if (!v) continue;
    v.pricePaisa = lv.pricePaisa;
    v.compareAtPricePaisa = lv.compareAtPricePaisa;
    v.stock = lv.available;
    v.availability = { ...v.availability, canBuy: lv.canBuy, label: lv.label, state: lv.available > 0 || v.availability.state !== 'available' ? v.availability.state : 'out_of_stock' };
  }
  update();
}).catch(() => {});
