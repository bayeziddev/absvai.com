// Reviews: customers' reviews wait here until you publish them. "Verified buyer" means that mobile number received the
// product. Reply in public, hide, delete, or add a review a customer sent you on Facebook or WhatsApp.
import { api, busy, can, confirmBox, date, esc, qs, slideOver, toast } from '../app.js';

const TABS = [['pending', 'Waiting'], ['approved', 'Published'], ['rejected', 'Hidden']];
const stars = n => `<span class="rv-stars" aria-label="${n} stars">${'★'.repeat(n)}<span>${'★'.repeat(5 - n)}</span></span>`;

export async function reviews(v) {
  const status = qs().get('status') || 'pending';
  const d = await api(`/reviews?status=${status}`);
  const write = can('catalog:write');
  v.innerHTML = `<div class="page-head"><div><h1>Reviews</h1><p>Customers write reviews on each product page. They show after you publish them, with the star rating in Google. Only publish real reviews.</p></div>${write ? '<button class="btn btn-primary" id="add">+ Add a review</button>' : ''}</div>
    ${write ? `<div class="card sell-switch"><label class="switch"><input type="checkbox" id="on" ${d.settings.enabled ? 'checked' : ''}><span></span></label><div><b>${d.settings.enabled ? 'Customers can write reviews' : 'Review form is hidden'}</b><p class="small muted">The “Write a review” form on product pages.</p></div>
      <label class="check com"><input type="checkbox" id="auto" ${d.settings.autoPublishVerified ? 'checked' : ''}> Publish verified buyers’ reviews at once</label></div>` : ''}
    <div class="tabs">${TABS.map(([k, l]) => `<a href="#/reviews?status=${k}" aria-current="${k === status}">${l}${d.counts[k] ? ` <span class="pill">${d.counts[k]}</span>` : ''}</a>`).join('')}</div>
    <div class="rv-cards">${d.reviews.map(r => `<article class="card rv-card" data-id="${r.id}">
        <div class="rv-head"><div>${stars(r.rating)} <b>${esc(r.name)}</b>${r.verified ? ' <span class="badge b-green">Verified buyer</span>' : ''}${r.source === 'shop' ? ' <span class="badge b-grey">added by the shop</span>' : ''}
          <br><span class="small muted">${date(r.created_at)}${r.phone ? ` · ${esc(r.phone)}` : ''} · <a href="/p/${esc(r.product_slug)}#reviews" target="_blank" rel="noopener">${esc(r.product_name)}</a></span></div></div>
        ${r.body ? `<p>${esc(r.body)}</p>` : ''}
        ${r.reply ? `<p class="rv-reply"><b>Your reply:</b> ${esc(r.reply)}</p>` : ''}
        ${write ? `<div class="row">${r.status !== 'approved' ? `<button class="btn btn-sm btn-primary" data-st="approved">Publish</button>` : ''}${r.status !== 'rejected' ? `<button class="btn btn-sm btn-ghost" data-st="rejected">Hide</button>` : ''}
          <button class="btn btn-sm btn-outline" data-reply>${r.reply ? 'Edit reply' : 'Reply'}</button><button class="btn btn-sm btn-ghost" data-del>Delete</button></div>` : ''}
      </article>`).join('') || `<p class="muted">${status === 'pending' ? 'No reviews waiting. 🎉' : 'None here.'}</p>`}</div>`;
  if (!write) return;
  const settings = async () => { await api('/reviews/settings', 'PUT', { enabled: v.querySelector('#on').checked, autoPublishVerified: v.querySelector('#auto').checked }); toast('Saved.'); reviews(v); };
  v.querySelector('#on').addEventListener('change', settings);
  v.querySelector('#auto').addEventListener('change', settings);
  v.querySelectorAll('.rv-card').forEach(card => {
    const id = card.dataset.id;
    card.querySelectorAll('[data-st]').forEach(b => busy(b, async () => { await api(`/reviews/${id}/status`, 'POST', { status: b.dataset.st }); toast(b.dataset.st === 'approved' ? 'Published: it shows on the product page.' : 'Hidden.'); reviews(v); }));
    busy(card.querySelector('[data-reply]'), async () => {
      const r = d.reviews.find(x => String(x.id) === id);
      const reply = prompt('Your public reply (leave empty to remove it):', r.reply ?? '');
      if (reply === null) return;
      await api(`/reviews/${id}/reply`, 'POST', { reply }); toast('Reply saved.'); reviews(v);
    });
    busy(card.querySelector('[data-del]'), async () => { if (!(await confirmBox('Delete this review for good?'))) return; await api(`/reviews/${id}`, 'DELETE'); toast('Deleted.'); reviews(v); });
  });
  v.querySelector('#add').addEventListener('click', async () => {
    const products = await api('/products?status=published');
    const so = slideOver('Add a review');
    so.body.innerHTML = `<p class="small muted">For a review a customer sent you (Facebook, WhatsApp, phone). It is published at once, without the “Verified buyer” badge.</p>
      <label class="f">Product<select id="p"><option value="">Choose…</option>${products.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
      <label class="f">Customer’s name<input id="n" maxlength="60"></label>
      <label class="f">Stars<select id="r">${[5, 4, 3, 2, 1].map(n => `<option value="${n}">${'★'.repeat(n)}</option>`).join('')}</select></label>
      <label class="f">What they said<textarea id="b" rows="4" maxlength="1000"></textarea></label>`;
    so.foot.innerHTML = '<span></span><button class="btn btn-primary" id="s">Add review</button>';
    const g = x => so.body.querySelector(`#${x}`).value;
    busy(so.foot.querySelector('#s'), async () => { await api('/reviews', 'POST', { productId: Number(g('p')), name: g('n'), rating: Number(g('r')), body: g('b') }); toast('Review added.'); so.close(); location.hash = '#/reviews?status=approved'; });
  });
}
