// Sellers (marketplace): approve seller applications, set commission, pause sellers, and approve each seller
// product before it shows in the shop.
import { api, badge, busy, can, confirmBox, date, esc, qs, slideOver, taka, toast } from '../app.js';

const STATE = { pending: 'Waiting for you', approved: 'Approved', rejected: 'Not approved', suspended: 'Paused' };
const STATE_BADGE = { pending: 'new', approved: 'active', rejected: 'cancelled', suspended: 'off' };
const METHOD = { bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket', bank: 'Bank account' };

export async function sellers(v) {
  const p = qs();
  const tab = p.get('tab') === 'products' ? 'products' : 'sellers';
  const write = can('catalog:write');
  const [list, queue, st] = await Promise.all([api('/sellers'), api('/seller-products'), can('settings:write') ? api('/settings').catch(() => null) : null]);
  const pending = list.filter(s => s.status === 'pending' || s.payouts_pending > 0).length;
  const regOpen = st ? st.values.sellers_open !== '0' : null;
  v.innerHTML = `<div class="page-head"><div><h1>Sellers</h1><p>Other sellers can sell through your shop. They register at <a href="/sell" target="_blank">/sell</a> and can sign in to their seller portal (<a href="/seller/" target="_blank">/seller/</a>) at once to add products and their bKash / Nagad / bank account. <b>Nothing is used until you approve it here:</b> first the seller, then each product (before it shows in the shop) and each payment account (before you pay into it).</p></div></div>
    ${regOpen === null ? '' : `<div class="card sell-switch"><label class="switch"><input type="checkbox" id="sell-open" ${regOpen ? 'checked' : ''}><span></span></label>
      <div><b id="sell-open-label">${regOpen ? 'Seller registration is ON' : 'Seller registration is OFF'}</b><p class="small muted">${regOpen ? '“Sell with us” shows in the shop menu and footer, and new sellers can register.' : 'The “Sell with us” link is hidden and /sell says registration is closed. Sellers you already have keep working.'}</p></div>
      <label class="f com">New sellers’ commission (%)<input id="com-default" type="number" min="0" max="90" value="${esc(st.values.seller_commission_percent || '10')}"></label></div>`}
    <div class="tabs"><a href="#/sellers" aria-current="${tab === 'sellers'}">Sellers${pending ? ` <span class="pill">${pending}</span>` : ''}</a><a href="#/sellers?tab=products" aria-current="${tab === 'products'}">Products to approve${queue.length ? ` <span class="pill">${queue.length}</span>` : ''}</a></div>
    <div id="body"></div>`;
  v.querySelector('#sell-open')?.addEventListener('change', async e => {
    try { await api('/settings', 'PUT', { sellers_open: e.target.checked ? '1' : '0' }); toast(e.target.checked ? 'Seller registration is on: “Sell with us” is in the shop menu.' : 'Seller registration is off: the link is hidden.'); sellers(v); } catch (err) { e.target.checked = !e.target.checked; toast(err.message, true); }
  });
  v.querySelector('#com-default')?.addEventListener('change', async e => {
    try { await api('/settings', 'PUT', { seller_commission_percent: String(e.target.value) }); toast('Saved: new sellers start with this commission.'); } catch (err) { toast(err.message, true); }
  });
  const body = v.querySelector('#body');
  if (tab === 'products') {
    body.innerHTML = queue.length ? `<div class="table-wrap"><table><thead><tr><th></th><th>Product</th><th>Seller</th><th>Price</th><th></th></tr></thead><tbody>
      ${queue.map(q => `<tr data-id="${q.id}"><td><img src="${esc(q.image_url ?? '/img/placeholders/none.svg')}" alt="" width="48" height="48" style="border-radius:8px;object-fit:cover"></td><td><b>${esc(q.name)}</b><br><span class="small muted">${esc(q.category_name)} · ${date(q.updated_at)}</span></td><td>${esc(q.shop_name)}${q.seller_status === 'approved' ? '' : `<br>${badge(STATE_BADGE[q.seller_status])} <span class="small">${esc(STATE[q.seller_status])}</span>`}</td><td>${q.min_price ? taka(q.min_price) : '—'}</td>
        <td class="row">${write ? `<a class="btn btn-sm btn-outline" href="#/products/${q.id}">Open</a>${q.seller_status === 'approved' ? `<button class="btn btn-sm btn-primary" data-approve="${q.id}">Approve & publish</button>` : `<a class="btn btn-sm btn-primary" href="#/sellers?id=${q.seller_id}">Approve the seller first</a>`}<button class="btn btn-sm btn-ghost" data-back="${q.id}">Send back</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
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
    ${list.map(s => `<tr data-id="${s.id}" style="cursor:pointer"><td><b>${esc(s.shop_name)}</b><br><span class="small muted">${esc(s.district ?? '')} · applied ${date(s.created_at)}</span></td><td class="small">${esc(s.owner_name)}<br>${esc(s.email)}<br>0${esc(String(s.phone).slice(3))}</td><td>${s.live_count} live / ${s.product_count}</td><td>${s.commission_percent}%</td><td>${badge(STATE_BADGE[s.status])} ${esc(STATE[s.status])}${s.payouts_pending ? `<br><span class="small"><span class="pill">${s.payouts_pending}</span> payment account to approve</span>` : ''}</td></tr>`).join('')}</tbody></table></div>`
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
      <dt>Wants to sell</dt><dd>${esc(s.sells ?? '—')}</dd><dt>Store page</dt><dd>${s.status === 'approved' ? `<a href="/store/${esc(s.slug)}" target="_blank">/store/${esc(s.slug)}</a>` : 'after approval'}</dd></dl>
    ${write ? `<div class="card"><h3>Decision</h3><label class="f">Commission on delivered sales (%)<input id="com" type="number" min="0" max="90" value="${s.commission_percent}"></label>
      <label class="f">Note for the seller <span class="help">Needed when you don’t approve; they see it when they try to sign in.</span><input id="note" maxlength="500" value=""></label>
      <div class="row">${s.status !== 'approved' ? `<button class="btn btn-primary" data-act="${s.status === 'suspended' ? 'reopen' : 'approve'}">${s.status === 'suspended' ? 'Re-open seller' : 'Approve seller'}</button>` : '<button class="btn btn-outline" data-act="approve">Save commission</button>'}
        ${s.status === 'pending' ? '<button class="btn btn-ghost" data-act="reject">Don’t approve</button>' : ''}${s.status === 'approved' ? '<button class="btn btn-ghost" data-act="suspend">Pause seller (hides their products)</button>' : ''}</div></div>` : ''}
    <h3>Payment accounts</h3><p class="small muted">Where you pay this seller. Pay only into an <b>approved</b> account; check the name and number with the seller by phone first.</p>
    ${d.payouts.length ? d.payouts.map(a => `<div class="payout ${a.status}"><div><b>${esc(METHOD[a.method] ?? a.method)}</b> ${esc(a.accountNumber)}${a.accountType && a.method !== 'bank' ? ` <span class="small muted">(${esc(a.accountType)})</span>` : ''}
        <br><span class="small">${esc([a.accountName, a.bankName, a.branch].filter(Boolean).join(' · ') || 'No name given')}</span>
        <br><span class="small muted">Added ${date(a.createdAt)}</span> ${badge(a.status === 'pending' ? 'waiting' : a.status === 'approved' ? 'active' : 'cancelled')} <span class="small">${{ pending: 'Waiting for you', approved: 'Approved', rejected: 'Not approved' }[a.status]}</span>${a.reviewNote ? `<br><span class="small muted">${esc(a.reviewNote)}</span>` : ''}</div>
        ${write && a.status !== 'approved' ? `<div class="row"><button class="btn btn-sm btn-primary" data-pay-ok="${a.id}">Approve</button>${a.status === 'pending' ? `<button class="btn btn-sm btn-ghost" data-pay-no="${a.id}">Don’t approve</button>` : ''}</div>` : ''}</div>`).join('') : '<p class="muted small">No payment account yet. The seller adds it in their portal.</p>'}
    <h3>Products (${d.products.length})</h3>
    ${d.products.map(p => `<p class="small">${esc(p.name)} · ${p.min_price ? taka(p.min_price) : ''} · ${p.status === 'published' ? badge('published') : p.review_status ? badge(p.review_status === 'pending' ? 'waiting' : p.review_status) : badge('draft')}</p>`).join('') || '<p class="muted small">No products yet.</p>'}`;
  so.body.querySelectorAll('[data-pay-ok]').forEach(b => busy(b, async () => { await api(`/seller-payouts/${b.dataset.payOk}/review`, 'POST', { action: 'approve' }); toast('Payment account approved.'); so.close(); done(); openSeller(id, done); }));
  so.body.querySelectorAll('[data-pay-no]').forEach(b => busy(b, async () => {
    const note = prompt('Why not? (the seller sees this, e.g. “The name does not match your shop”)');
    if (!note) return;
    await api(`/seller-payouts/${b.dataset.payNo}/review`, 'POST', { action: 'reject', note }); toast('Not approved: the seller sees why.'); so.close(); done(); openSeller(id, done);
  }));
  so.body.querySelectorAll('[data-act]').forEach(b => busy(b, async () => {
    const action = b.dataset.act;
    if (action === 'suspend' && !(await confirmBox('Pause this seller? Their products leave the shop until you re-open them.'))) return;
    await api(`/sellers/${id}/review`, 'POST', { action, note: so.body.querySelector('#note').value.trim(), commissionPercent: so.body.querySelector('#com').value });
    toast({ approve: s.status === 'approved' ? 'Saved.' : 'Seller approved: they can sign in now.', reject: 'Application not approved.', suspend: 'Seller paused.', reopen: 'Seller re-opened.' }[action]);
    so.close(); done();
  }));
}
