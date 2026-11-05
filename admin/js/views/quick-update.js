// Prices and stock in one table: every option of every product with its price, old price (a "was" price shows a sale)
// and stock. Change any number, changed rows turn yellow, and one Save stores them all. Search narrows the list.
import { api, busy, can, esc, fromPaisa, toast, toPaisa } from '../app.js';

/** The small copy of a photo for the thumbnail (uploads have a 480 px copy, the built-in photos a 240 px one). */
const smallPhoto = u => (/^\/media\/(p\/\d+|c|b)\/[\w-]+\.(webp|jpg)$/.test(u) ? u.replace(/\.(webp|jpg)$/, '-480.$1') : /^\/img\/photos\/sq\/[\w-]+\.webp$/.test(u) ? u.replace(/\.webp$/, '-240.webp') : u);

export async function quickUpdate(v) {
  const rows = await api('/quick-update');
  const write = can('catalog:write');
  const stockWrite = can('inventory:write');
  const label = r => Object.values(r.attributes ?? {}).join(' · ');
  v.innerHTML = `<div class="page-head"><div><h1>Update prices &amp; stock</h1><p>Every product option in one list. Change the numbers you need, then press <b>Save</b> once. An <b>old price</b> higher than the price shows the product on sale (Hot Deals).</p></div></div>
    <div class="card qu-tools"><input class="i" type="search" id="qu-q" placeholder="Search a product…" aria-label="Search a product"><span class="small muted" id="qu-n">${rows.length} option(s)</span></div>
    <div class="table-wrap"><table class="qu-table"><thead><tr><th>Product</th><th>Price (৳)</th><th>Old price (৳)</th><th>In stock</th></tr></thead><tbody>
      ${rows.map(r => `<tr data-id="${r.id}" data-name="${esc(`${r.name} ${label(r)} ${r.sku}`.toLowerCase())}">
        <td><div class="qu-prod">${r.image_url ? `<img src="${esc(smallPhoto(r.image_url))}" alt="" loading="lazy">` : '<span class="qu-noimg"></span>'}<span><b>${esc(r.name)}</b>${label(r) ? `<br><span class="small">${esc(label(r))}</span>` : ''}${r.status !== 'published' ? ` <span class="badge b-grey">${esc(r.status)}</span>` : ''}</span></div></td>
        <td><input data-f="price" inputmode="decimal" value="${esc(fromPaisa(r.price_paisa))}" ${write ? '' : 'disabled'} aria-label="Price"></td>
        <td><input data-f="was" inputmode="decimal" value="${r.compare_at_price_paisa ? esc(fromPaisa(r.compare_at_price_paisa)) : ''}" placeholder="—" ${write ? '' : 'disabled'} aria-label="Old price"></td>
        <td><input data-f="stock" type="number" min="${Number(r.reserved) || 0}" value="${r.stock}" ${write && stockWrite ? '' : 'disabled'} aria-label="In stock">${Number(r.reserved) ? `<span class="small muted qu-held">${r.reserved} held</span>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No products yet.</td></tr>'}
    </tbody></table></div>
    ${write ? '<div class="save-bar"><span class="small muted" id="qu-changed">No changes yet</span><button class="btn btn-primary" id="qu-save">Save</button></div>' : ''}`;
  const byId = new Map(rows.map(r => [String(r.id), r]));
  const changed = tr => {
    const r = byId.get(tr.dataset.id);
    const val = f => tr.querySelector(`[data-f=${f}]`).value.trim();
    return toPaisa(val('price')) !== r.price_paisa || (val('was') ? toPaisa(val('was')) : null) !== (r.compare_at_price_paisa ?? null) || Number(val('stock')) !== Number(r.stock);
  };
  const count = () => {
    const n = [...v.querySelectorAll('tr[data-id]')].filter(tr => { const c = changed(tr); tr.classList.toggle('qu-changed', c); return c; }).length;
    const out = v.querySelector('#qu-changed');
    if (out) out.textContent = n ? `${n} change(s) to save` : 'No changes yet';
  };
  v.querySelector('tbody').addEventListener('input', count);
  v.querySelector('#qu-q').addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    let shown = 0;
    v.querySelectorAll('tr[data-id]').forEach(tr => { const ok = !q || tr.dataset.name.includes(q); tr.hidden = !ok; shown += ok; });
    v.querySelector('#qu-n').textContent = `${shown} option(s)`;
  });
  if (!write) return;
  busy(v.querySelector('#qu-save'), async () => {
    const list = [...v.querySelectorAll('tr[data-id]')].filter(changed).map(tr => {
      const val = f => tr.querySelector(`[data-f=${f}]`).value.trim();
      return { variantId: Number(tr.dataset.id), pricePaisa: toPaisa(val('price')), compareAtPricePaisa: val('was') ? toPaisa(val('was')) : null, stock: Number(val('stock')) };
    });
    if (!list.length) return toast('Nothing changed yet.');
    const r = await api('/quick-update', 'PUT', { rows: list });
    toast(`Saved ${r.saved} change(s). The shop shows them in a few seconds.`);
    quickUpdate(v);
  });
}
