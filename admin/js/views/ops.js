import { api, badge, busy, can, confirmBox, date, esc, qs, slideOver, taka, toast } from '../app.js';

// ───────────── Seasons ─────────────

export async function seasons(v) {
  const list = await api('/seasons');
  v.innerHTML = `
    <div class="page-head"><div><h1>Seasons</h1><p>When a season starts, its banners take over the homepage, its products fill “In Season Now” and its categories move to the front. Ramadan and Eid move every year, so set exact dates each year.</p></div>
      <div class="row">${can('seasons:write') ? '<button class="btn btn-outline" id="copy">Copy last year’s seasons</button><button class="btn btn-primary" id="new">+ New season</button>' : ''}</div></div>
    <div class="table-wrap"><table><thead><tr><th>Season</th><th>Dates</th><th>State</th><th class="right">Products</th><th class="right">Categories</th><th>Banners</th></tr></thead><tbody>
    ${list.map(s => `<tr class="clickable" data-id="${s.id}"><td><b>${esc(s.name)}</b><br><span class="small muted">/season/${esc(s.slug)}</span></td><td>${s.starts_on ? `${date(s.starts_on)} – ${date(s.ends_on)}` : '<span class="muted">not set</span>'}</td>
      <td>${badge(s.state)} ${s.daysUntil !== null ? `<span class="small muted">in ${s.daysUntil} day(s)</span>` : s.daysLeft !== null ? `<span class="small muted">${s.daysLeft} day(s) left</span>` : ''}</td><td class="right">${s.product_count}</td><td class="right">${s.category_count}</td><td>${s.banners.length}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="small muted">Add products to a season from the product form (step 6). Show a category only in season from the category form.</p>`;
  const open = s => {
    const so = slideOver(s ? `Season · ${s.name}` : 'New season', { wide: true });
    const banners = [...(s?.banners ?? []), { headline: '' }];
    so.body.innerHTML = `<div class="grid-2"><label class="f">Name<input id="name" value="${esc(s?.name ?? '')}"></label>${s ? '' : '<label class="f">Web address<input id="slug" placeholder="made from the name"></label>'}</div>
      <div class="grid-3"><label class="f">Starts (Bangladesh date)<input type="date" id="st" value="${esc(s?.starts_on ?? '')}"></label><label class="f">Ends<input type="date" id="en" value="${esc(s?.ends_on ?? '')}"></label><label class="check"><input type="checkbox" id="on" ${s?.is_enabled !== 0 ? 'checked' : ''}> Enabled</label></div>
      <div class="grid-3"><label class="f">Badge text<input id="al" value="${esc(s?.accent_label ?? '')}" placeholder="Winter special"></label><label class="f">Accent colour<input type="color" id="ac" value="${esc(s?.accent_color ?? '#B3261E')}"></label><label class="f">“Back in season from …”<input id="back" value="${esc(s?.back_in_season_text ?? '')}" placeholder="November"></label></div>
      <label class="f">Landing page intro<input id="intro" value="${esc(s?.landing_intro ?? '')}"></label>
      <h3>Hero banners</h3><p class="small muted">Shown first on the homepage while the season is live. Use your own photo URL or a product photo.</p>
      <div id="banners">${banners.map(b => `<div class="card banner"><div class="grid-2"><label class="f">Headline<input data-b="headline" value="${esc(b.headline ?? '')}"></label><label class="f">Sub-line<input data-b="subline" value="${esc(b.subline ?? '')}"></label>
        <label class="f">Button text<input data-b="cta_text" value="${esc(b.cta_text ?? 'Shop now')}"></label><label class="f">Button link<input data-b="cta_href" value="${esc(b.cta_href ?? (s ? `/season/${s.slug}` : '/'))}"></label>
        <label class="f">Image URL<input data-b="image" value="${esc(b.image ?? '')}"></label><label class="f">Colour<select data-b="theme">${['chili', 'turmeric', 'clove', 'leaf'].map(t => `<option ${b.theme === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div></div>`).join('')}</div>`;
    so.foot.innerHTML = `${s && can('seasons:write') ? '<button class="btn btn-ghost" id="del">Delete</button>' : '<span></span>'}${can('seasons:write') ? '<button class="btn btn-primary" id="save">Save season</button>' : ''}`;
    const g = id => so.body.querySelector(`#${id}`);
    if (!can('seasons:write')) return;
    busy(so.foot.querySelector('#save'), async () => {
      const body = { name: g('name').value, slug: g('slug')?.value, startsOn: g('st').value, endsOn: g('en').value, isEnabled: g('on').checked, accentLabel: g('al').value, accentColor: g('ac').value, backInSeasonText: g('back').value, landingIntro: g('intro').value,
        banners: [...so.body.querySelectorAll('.banner')].map(el => Object.fromEntries([...el.querySelectorAll('[data-b]')].map(i => [i.dataset.b, i.value]))).filter(x => x.headline) };
      await api(s ? `/seasons/${s.id}` : '/seasons', s ? 'PUT' : 'POST', body);
      toast('Season saved.'); so.close(); seasons(v);
    });
    if (s) busy(so.foot.querySelector('#del'), async () => { if (await confirmBox(`Delete the ${s.name} season? Products stay, but lose this season link.`)) { await api(`/seasons/${s.id}`, 'DELETE'); so.close(); seasons(v); } });
  };
  v.querySelectorAll('tr[data-id]').forEach(r => r.addEventListener('click', () => open(list.find(s => s.id === Number(r.dataset.id)))));
  v.querySelector('#new')?.addEventListener('click', () => open(null));
  const copy = v.querySelector('#copy');
  if (copy) busy(copy, async () => {
    if (!(await confirmBox('Seasons that have ended keep their products and banners, and their dates are cleared so you can enter this year’s dates. Continue?'))) return;
    const r = await api('/seasons/copy-last-year', 'POST', {});
    toast(`${r.reset} season(s) ready for new dates.`); seasons(v);
  });
}

// ───────────── Pre-orders & Notify-me ─────────────

export async function preorders(v) {
  const [pre, notify] = await Promise.all([api('/preorders'), api('/notify-requests')]);
  v.innerHTML = `
    <div class="page-head"><div><h1>Pre-orders & Notify-me</h1><p>Use the pre-order list to know exactly how much stock to buy before the season.</p></div></div>
    <div class="card"><h2>Pre-orders by product</h2><div class="table-wrap"><table><thead><tr><th>Product</th><th>Dispatch</th><th class="right">Orders</th><th class="right">Quantity</th><th class="right">Advance paid</th><th class="right">Advance due</th><th></th></tr></thead><tbody>
      ${pre.map(p => `<tr><td><b>${esc(p.name)}</b></td><td>${date(p.preorder_dispatch_date)}</td><td class="right">${p.orders}</td><td class="right"><b>${p.qty}</b></td><td class="right">${p.advance_paid}</td><td class="right">${p.advance_due}</td>
        <td><a class="btn btn-sm btn-outline" href="/api/admin/preorders/${p.product_id}/export.csv">Export</a> <a class="btn btn-sm btn-ghost" href="#/orders?fulfilment=pre_order">Orders</a></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No pre-orders yet.</td></tr>'}
    </tbody></table></div></div>
    <div class="card"><h2>Notify me when it’s back</h2><div class="table-wrap"><table><thead><tr><th>Product</th><th class="right">Waiting</th><th class="right">Already told</th><th>Last request</th><th></th></tr></thead><tbody>
      ${notify.map(n => `<tr><td><b>${esc(n.name)}</b></td><td class="right">${n.waiting}</td><td class="right">${n.sent}</td><td>${date(n.last_at)}</td><td>${can('orders:write') && n.waiting ? `<button class="btn btn-sm btn-primary" data-send="${n.product_id}">Send back-in-season message</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nobody is waiting.</td></tr>'}
    </tbody></table></div><p class="small muted">Messages also go out automatically when a season starts and the product can be bought.</p></div>`;
  v.querySelectorAll('[data-send]').forEach(b => busy(b, async () => { const r = await api('/notify-requests/send', 'POST', { productId: Number(b.dataset.send) }); toast(`${r.sent} message(s) sent.`); preorders(v); }));
}

// ───────────── Customers ─────────────

export async function customers(v) {
  const q = qs().get('q') ?? '';
  const rows = await api(`/customers?q=${encodeURIComponent(q)}`);
  v.innerHTML = `<div class="page-head"><div><h1>Customers</h1><p>Trusted customers skip the extra advance and risk checks.</p></div></div>
    <form class="filters" id="f"><input class="i" name="q" value="${esc(q)}" placeholder="Phone or name"><button class="btn btn-outline">Search</button></form>
    <div class="table-wrap"><table><thead><tr><th>Customer</th><th class="right">Orders</th><th class="right">Delivered</th><th class="right">Returned</th><th>Since</th><th>Trusted</th></tr></thead><tbody>
    ${rows.map(c => `<tr><td><b>${esc(c.name ?? '—')}</b><br><a href="#/orders?q=${esc(c.phone)}">${esc(c.phone)}</a></td><td class="right">${c.order_count}</td><td class="right">${c.delivered_count}</td><td class="right">${c.returned_count}</td><td>${date(c.created_at)}</td>
      <td><label class="check"><input type="checkbox" data-trust="${c.id}" ${c.is_trusted ? 'checked' : ''} ${can('orders:write') ? '' : 'disabled'}> trusted</label></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No customers yet.</td></tr>'}
    </tbody></table></div>`;
  v.querySelector('#f').addEventListener('submit', e => { e.preventDefault(); location.hash = `#/customers?q=${encodeURIComponent(e.target.q.value)}`; });
  v.querySelectorAll('[data-trust]').forEach(c => c.addEventListener('change', async () => { await api(`/customers/${c.dataset.trust}/trusted`, 'POST', { trusted: c.checked }); toast('Saved.'); }));
}

// ───────────── Inventory ─────────────

const KIND_LABELS = { initial: 'Opening stock', purchase_received: 'Received', reserve: 'Held for an order', release: 'Hold released', sale: 'Sent with courier', pos_sale: 'Shop sale', return_received: 'Return scanned in', adjustment: 'Adjustment', transfer: 'Transfer' };

export async function inventory(v) {
  const [d, reasons] = await Promise.all([api('/inventory'), api('/inventory/reasons')]);
  const rows = d.items;
  v.innerHTML = `<div class="page-head"><div><h1>Inventory</h1><p>Lowest available first. <b>Available</b> = on hand minus what confirmed orders are holding. Every change is kept in the stock history with a reason.</p></div></div>
    ${d.stockValue ? `<div class="kpis"><div class="kpi"><span>Stock value at cost</span><b>${taka(d.stockValue.valuePaisa)}</b></div>${d.stockValue.unitsWithoutCost ? `<div class="kpi alert"><span>Options with stock but no cost price</span><b>${d.stockValue.unitsWithoutCost}</b></div>` : ''}</div>` : ''}
    <div class="table-wrap"><table><thead><tr><th>Product / option</th><th>SKU · shelf</th><th class="right">On hand</th><th class="right">Held</th><th class="right">Available</th>${d.stockValue ? '<th class="right">Value</th>' : ''}<th>Status</th><th></th></tr></thead><tbody>
    ${rows.map(r => `<tr><td><b>${esc(r.name)}</b><br><span class="small muted">${esc(Object.values(r.attributes).join(' · ') || 'Single option')}</span></td><td class="small">${esc(r.sku)}${r.shelf_location ? `<br><span class="muted">shelf ${esc(r.shelf_location)}</span>` : ''}</td>
      <td class="right">${r.stock}</td><td class="right">${r.reserved || ''}</td>
      <td class="right"><b style="color:${r.available <= 5 && r.fulfilment_mode === 'in_stock' ? 'var(--chili)' : 'inherit'}">${r.available}</b></td>
      ${d.stockValue ? `<td class="right">${r.cost_paisa == null ? '<span class="muted small">no cost</span>' : taka(r.stock_value_paisa)}</td>` : ''}<td>${badge(r.status)}</td>
      <td class="nowrap">${can('inventory:write') ? `<button class="btn btn-sm btn-outline" data-adj="${r.id}">Adjust</button>` : ''} <button class="btn btn-sm btn-ghost" data-log="${r.id}">History</button></td></tr>`).join('')}
    </tbody></table></div>`;
  v.querySelectorAll('[data-adj]').forEach(b => b.addEventListener('click', () => {
    const r = rows.find(x => x.id === Number(b.dataset.adj));
    const so = slideOver(`Adjust stock · ${r.sku}`);
    so.body.innerHTML = `<p>On hand: <b>${r.stock}</b>${r.reserved ? ` · held for confirmed orders: <b>${r.reserved}</b>` : ''}</p>
      <label class="f">Reason *<select id="re"><option value="">Choose…</option>${Object.entries(reasons).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></label>
      <label class="f">Change <span class="help">Positive adds, negative removes, e.g. 20 or -2. Returned parcels come back through Returns scan, not here.</span><input id="ch" type="number"></label><label class="f">Batch no. (food)<input id="ba"></label><label class="f">Note<input id="no"></label>`;
    so.foot.innerHTML = '<span></span><button class="btn btn-primary" id="s">Save</button>';
    busy(so.foot.querySelector('#s'), async () => {
      await api('/inventory/adjust', 'POST', { variantId: r.id, change: Number(so.body.querySelector('#ch').value), reason: so.body.querySelector('#re').value, batchNo: so.body.querySelector('#ba').value, note: so.body.querySelector('#no').value });
      so.close(); toast('Stock updated.'); inventory(v);
    });
  }));
  v.querySelectorAll('[data-log]').forEach(b => b.addEventListener('click', async () => {
    const log = await api(`/inventory/log?variantId=${b.dataset.log}`);
    const so = slideOver('Stock history');
    so.body.innerHTML = `<div class="table-wrap"><table><thead><tr><th>When</th><th class="right">On hand</th><th class="right">Held</th><th>What</th><th>Batch</th><th>By</th></tr></thead><tbody>${log.map(l => `<tr><td class="nowrap">${date(l.created_at)}</td><td class="right">${l.change > 0 ? '+' : ''}${l.change || ''}</td><td class="right">${l.reserved_change > 0 ? '+' : ''}${l.reserved_change || ''}</td>
      <td>${esc(KIND_LABELS[l.kind] ?? l.kind)}${l.reason ? ` · ${esc(reasons[l.reason] ?? l.reason)}` : ''}${l.order_id ? ` <a href="#/orders/${l.order_id}">${esc(l.order_no ?? 'order')}</a>` : ''}${l.note ? `<br><span class="small muted">${esc(l.note)}</span>` : ''}</td><td>${esc(l.batch_no ?? '')}</td><td>${esc(l.admin_name ?? '')}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No changes yet.</td></tr>'}</tbody></table></div>`;
  }));
}

/** "Load older" for append-only logs paged by id. */
async function paged(v, path, render) {
  const tbody = v.querySelector('tbody');
  const more = v.querySelector('#more');
  let rows = await api(path);
  tbody.innerHTML = rows.map(render).join('') || '<tr><td colspan="5" class="empty">Nothing yet.</td></tr>';
  more.hidden = rows.length < 100;
  more.onclick = async () => {
    rows = await api(`${path}?before=${rows[rows.length - 1].id}`);
    tbody.insertAdjacentHTML('beforeend', rows.map(render).join(''));
    more.hidden = rows.length < 100;
  };
}

// ───────────── Wholesale, outbox, audit ─────────────

export async function wholesale(v) {
  const rows = await api('/wholesale');
  v.innerHTML = `<div class="page-head"><div><h1>Wholesale Inquiries</h1><p>From the “Become a dealer / bulk inquiry” form on the contact page.</p></div></div>
    <div class="table-wrap"><table><thead><tr><th>From</th><th>Business</th><th>Message</th><th>When</th><th>Status</th></tr></thead><tbody>
    ${rows.map(w => `<tr><td><b>${esc(w.name)}</b><br><a href="tel:${esc(w.phone)}">${esc(w.phone)}</a></td><td>${esc(w.business ?? '')}<br><span class="small muted">${esc(w.district ?? '')}</span></td><td class="small">${esc(w.message ?? '')}</td><td>${date(w.created_at)}</td>
      <td><select class="i" data-w="${w.id}" ${can('orders:write') ? '' : 'disabled'}>${['new', 'contacted', 'won', 'lost'].map(s => `<option ${s === w.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td></tr>`).join('') || '<tr><td colspan="5" class="empty">No inquiries yet.</td></tr>'}</tbody></table></div>`;
  v.querySelectorAll('[data-w]').forEach(s => s.addEventListener('change', async () => { await api(`/wholesale/${s.dataset.w}`, 'PUT', { status: s.value }); toast('Saved.'); }));
}

export async function outbox(v) {
  v.innerHTML = `<div class="page-head"><div><h1>SMS outbox</h1><p>Every message the store sends. Until an SMS provider is connected, messages are <b>logged</b> here and not delivered.</p></div></div>
    <div class="table-wrap"><table><thead><tr><th>When</th><th>To</th><th>Kind</th><th>Message</th><th>Status</th></tr></thead><tbody></tbody></table></div>
    <p class="center"><button class="btn btn-outline" id="more" hidden>Load older</button></p>`;
  await paged(v, '/sms-outbox', s => `<tr><td class="nowrap">${date(s.created_at)}</td><td>${esc(s.to_phone)}</td><td>${esc(s.kind)}</td><td class="small">${esc(s.body)}<br><span class="muted">${s.body.length} chars</span></td><td>${badge(s.status)}</td></tr>`);
}

export async function audit(v) {
  v.innerHTML = `<div class="page-head"><div><h1>Audit log</h1><p>Who changed what, and when. Settings changes keep the before and after values; credentials are never written here.</p></div></div>
    <div class="table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Item</th><th>Detail</th></tr></thead><tbody></tbody></table></div>
    <p class="center"><button class="btn btn-outline" id="more" hidden>Load older</button></p>`;
  await paged(v, '/audit', a => `<tr><td class="nowrap">${date(a.created_at)}</td><td>${esc(a.admin_name ?? 'system')}</td><td>${esc(a.action)}</td><td>${esc(a.entity ?? '')} ${esc(a.entity_id ?? '')}</td><td class="small muted"><details><summary>${esc((a.detail ?? '').slice(0, 80))}</summary><pre style="white-space:pre-wrap">${esc(a.detail ?? '')}</pre></details></td></tr>`);
}
