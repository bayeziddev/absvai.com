// Sellers (marketplace): approve seller applications, set commission, pause sellers, and approve each seller
// product before it shows in the shop.
import { api, badge, busy, can, confirmBox, date, esc, qs, slideOver, taka, toast } from '../app.js';

const STATE = { pending: 'Waiting for you', approved: 'Approved', rejected: 'Not approved', suspended: 'Paused' };
const STATE_BADGE = { pending: 'new', approved: 'active', rejected: 'cancelled', suspended: 'off' };

export async function sellers(v) {
  const p = qs();
  const tab = p.get('tab') === 'products' ? 'products' : 'sellers';
  const write = can('catalog:write');
  const [list, queue] = await Promise.all([api('/sellers'), api('/seller-products')]);
  const pending = list.filter(s => s.status === 'pending').length;
  v.innerHTML = `<div class="page-head"><div><h1>Sellers</h1><p>Other sellers can sell through your shop. Step 1: they register at <a href="/sell" target="_blank">/sell</a> and you approve them here. Step 2: they add products in their seller portal (<a href="/seller/" target="_blank">/seller/</a>) and you approve each product before it shows in the shop.</p></div></div>
    <div class="tabs"><a href="#/sellers" aria-current="${tab === 'sellers'}">Sellers${pending ? ` <span class="pill">${pending}</span>` : ''}</a><a href="#/sellers?tab=products" aria-current="${tab === 'products'}">Products to approve${queue.length ? ` <span class="pill">${queue.length}</span>` : ''}</a></div>
    <div id="body"></div>`;
  const body = v.querySelector('#body');
  if (tab === 'products') {
    body.innerHTML = queue.length ? `<div class="table-wrap"><table><thead><tr><th></th><th>Product</th><th>Seller</th><th>Price</th><th></th></tr></thead><tbody>
      ${queue.map(q => `<tr data-id="${q.id}"><td><img src="${esc(q.image_url ?? '/img/placeholders/none.svg')}" alt="" width="48" height="48" style="border-radius:8px;object-fit:cover"></td><td><b>${esc(q.name)}</b><br><span class="small muted">${esc(q.category_name)} · ${date(q.updated_at)}</span></td><td>${esc(q.shop_name)}</td><td>${q.min_price ? taka(q.min_price) : '—'}</td>
        <td class="row">${write ? `<a class="btn btn-sm btn-outline" href="#/products/${q.id}">Open</a><button class="btn btn-sm btn-primary" data-approve="${q.id}">Approve & publish</button><button class="btn btn-sm btn-ghost" data-back="${q.id}">Send back</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">No seller products waiting. 🎉</p>';
    body.querySelectorAll('[data-approve]').forEach(b => busy(b, async () => { await api(`/seller-products/${b.dataset.approve}/approve`, 'POST', {}); toast('Approved: it is live in the shop.'); sellers(v); }));
    body.querySelectorAll('[data-back]').forEach(b => busy(b, async () => {
      const note = prompt('What should the seller change? (they see this)');
      if (!note) return;
      await api(`/seller-products/${b.dataset.back}/reject`, 'POST', { note });
      toast('Sent back to the seller.'); sellers(v);
    }));
    return;
  }
  body.innerHTML = list.length ? `<div class="table-wrap"><table><thead><tr><th>Shop</th><th>Contact</th><th>Products</th><th>Commission</th><th>Status</th></tr></thead><tbody>
    ${list.map(s => `<tr data-id="${s.id}" style="cursor:pointer"><td><b>${esc(s.shop_name)}</b><br><span class="small muted">${esc(s.district ?? '')} · applied ${date(s.created_at)}</span></td><td class="small">${esc(s.owner_name)}<br>${esc(s.email)}<br>0${esc(String(s.phone).slice(3))}</td><td>${s.live_count} live / ${s.product_count}</td><td>${s.commission_percent}%</td><td>${badge(STATE_BADGE[s.status])} ${esc(STATE[s.status])}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">No seller has registered yet. Share the link <b>/sell</b> with sellers you want to work with.</p>';
  body.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', () => openSeller(Number(tr.dataset.id), () => sellers(v))));
  const open = Number(p.get('id'));
  if (open) openSeller(open, () => sellers(v));
}

async function openSeller(id, done) {
  const d = await api(`/sellers/${id}`);
  const s = d.seller;
  const write = can('catalog:write');
  const so = slideOver(s.shop_name, { wide: true });
  so.body.innerHTML = `<p>${badge(STATE_BADGE[s.status])} <b>${esc(STATE[s.status])}</b>${s.review_note ? ` · <span class="muted">${esc(s.review_note)}</span>` : ''}</p>
    <dl class="kv"><dt>Owner</dt><dd>${esc(s.owner_name)}</dd><dt>Phone</dt><dd><a href="tel:0${esc(String(s.phone).slice(3))}">0${esc(String(s.phone).slice(3))}</a></dd><dt>Email</dt><dd>${esc(s.email)}</dd>
      <dt>District</dt><dd>${esc(s.district ?? '—')}</dd><dt>Address</dt><dd>${esc(s.address ?? '—')}</dd><dt>Business</dt><dd>${esc(s.business_type ?? '—')}</dd>
      <dt>Wants to sell</dt><dd>${esc(s.sells ?? '—')}</dd><dt>Paid by</dt><dd>${esc(s.payout_method ?? '—')} ${esc(s.payout_number ?? '')}</dd><dt>Store page</dt><dd>${s.status === 'approved' ? `<a href="/store/${esc(s.slug)}" target="_blank">/store/${esc(s.slug)}</a>` : 'after approval'}</dd></dl>
    ${write ? `<div class="card"><h3>Decision</h3><label class="f">Commission on delivered sales (%)<input id="com" type="number" min="0" max="90" value="${s.commission_percent}"></label>
      <label class="f">Note for the seller <span class="help">Needed when you don’t approve; they see it when they try to sign in.</span><input id="note" maxlength="500" value=""></label>
      <div class="row">${s.status !== 'approved' ? `<button class="btn btn-primary" data-act="${s.status === 'suspended' ? 'reopen' : 'approve'}">${s.status === 'suspended' ? 'Re-open seller' : 'Approve seller'}</button>` : '<button class="btn btn-outline" data-act="approve">Save commission</button>'}
        ${s.status === 'pending' ? '<button class="btn btn-ghost" data-act="reject">Don’t approve</button>' : ''}${s.status === 'approved' ? '<button class="btn btn-ghost" data-act="suspend">Pause seller (hides their products)</button>' : ''}</div></div>` : ''}
    <h3>Products (${d.products.length})</h3>
    ${d.products.map(p => `<p class="small">${esc(p.name)} · ${p.min_price ? taka(p.min_price) : ''} · ${p.status === 'published' ? badge('published') : p.review_status ? badge(p.review_status === 'pending' ? 'waiting' : p.review_status) : badge('draft')}</p>`).join('') || '<p class="muted small">No products yet.</p>'}`;
  so.body.querySelectorAll('[data-act]').forEach(b => busy(b, async () => {
    const action = b.dataset.act;
    if (action === 'suspend' && !(await confirmBox('Pause this seller? Their products leave the shop until you re-open them.'))) return;
    await api(`/sellers/${id}/review`, 'POST', { action, note: so.body.querySelector('#note').value.trim(), commissionPercent: so.body.querySelector('#com').value });
    toast({ approve: s.status === 'approved' ? 'Saved.' : 'Seller approved: they can sign in now.', reject: 'Application not approved.', suspend: 'Seller paused.', reopen: 'Seller re-opened.' }[action]);
    so.close(); done();
  }));
}
