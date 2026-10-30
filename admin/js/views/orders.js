import { api, badge, busy, can, confirmBox, date, esc, qs, slideOver, state, taka, toast, toPaisa } from '../app.js';

const CALLS = [['confirmed', 'Confirmed'], ['no_answer', 'No answer'], ['call_back', 'Call back later'], ['wrong_number', 'Wrong number'], ['cancel_requested', 'Wants to cancel']];
let META = null;
const meta = async () => (META ??= await api('/orders/meta'));
const canMove = () => can('orders:write') || can('orders:pack');

function rowHtml(o, pick) {
  return `<tr class="clickable" data-id="${o.id}">${pick ? `<td><input type="checkbox" data-pick="${o.id}" aria-label="Select ${esc(o.order_no)}"></td>` : ''}
    <td><b>${esc(o.order_no)}</b>${o.is_test ? ' <span class="badge b-grey">test</span>' : ''}${o.duplicate_of_order_id ? ' <span class="badge b-red">possible duplicate</span>' : ''}${o.hold_reason ? ' <span class="badge b-red">on hold</span>' : ''}
      <br><span class="small muted">${date(o.created_at)} · ${o.item_count} item(s) · ${esc(META?.sources[o.source] ?? o.source)}</span></td>
    <td>${esc(o.customer_name)}<br><span class="small muted">${esc(o.phone)}</span></td>
    <td>${esc(o.upazila_name)}<br><span class="small muted">${esc(o.district_name)}</span></td>
    <td class="right">${taka(o.total_paisa)}</td>
    <td>${o.payment_method === 'cod' ? 'COD' : 'Mobile wallet'}${o.advance_status !== 'not_required' ? `<br>${badge(o.advance_status)}` : ''}</td>
    <td>${badge(o.status)}${o.sub_status ? `<br><span class="small muted">${esc(o.sub_status.replace(/_/g, ' '))}</span>` : ''}${o.fulfilment_type === 'pre_order' ? '<br><span class="badge b-yellow">pre-order</span>' : ''}</td>
    <td>${badge(o.risk_level)}${(o.risk_reasons ?? []).slice(0, 1).map(r => `<br><span class="small muted">${esc(r.detail)}</span>`).join('')}</td></tr>`;
}

export async function orders(v, [id]) {
  const m = await meta();
  const p = qs();
  const filter = new URLSearchParams();
  for (const k of ['status', 'q', 'risk', 'advance', 'fulfilment', 'source', 'assigned']) if (p.get(k)) filter.set(k, p.get(k));
  const first = await api(`/orders?${filter}`);
  const tab = p.get('status') ?? '';
  const pick = true;
  const staff = can('orders:write') ? await api('/staff-options').catch(() => []) : [];
  v.innerHTML = `
    <div class="page-head"><div><h1>Orders</h1><p>New → Confirmed → Packed → In Courier → Delivered. Stock is held at confirmation and leaves with the courier.</p></div>
      <div class="row">${can('orders:write') ? '<a class="btn btn-primary" href="#/manual">+ New manual order</a>' : ''}${can('orders:export') ? `<a class="btn btn-outline" href="/api/admin/orders/export.csv?${filter}">Export CSV</a>` : ''}</div></div>
    <nav class="tabs"><a href="#/orders" aria-current="${tab === '' && !p.get('advance') && !p.get('risk') && !p.get('assigned')}">All</a>
      ${m.stages.map(s => `<a href="#/orders?status=${s.value}" aria-current="${tab === s.value}" title="${esc(s.meaning)}">${esc(s.label)}</a>`).join('')}
      <a href="#/orders?status=held" aria-current="${tab === 'held'}">On hold</a><a href="#/orders?advance=submitted" aria-current="${p.get('advance') === 'submitted'}">Advances to verify</a>
      <a href="#/orders?risk=high" aria-current="${p.get('risk') === 'high'}">High risk</a><a href="#/orders?assigned=me" aria-current="${p.get('assigned') === 'me'}">Mine</a><a href="#/orders?assigned=unassigned" aria-current="${p.get('assigned') === 'unassigned'}">Unassigned</a></nav>
    <form class="filters" id="of"><input class="i" name="q" value="${esc(p.get('q') ?? '')}" placeholder="Phone (017…), order no (AV-…), invoice (INV-…) or name">
      <select class="i" name="source"><option value="">All channels</option>${Object.entries(m.sources).map(([k, l]) => `<option value="${k}" ${p.get('source') === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <button class="btn btn-outline">Search</button></form>
    <div class="filters" id="bulk" hidden><b id="bulk-n"></b>
      ${canMove() ? `<select class="i" id="bulk-to"><option value="">Move to…</option>${can('orders:write') ? '<option value="confirmed">Confirmed</option>' : ''}<option value="packed">Packed</option><option value="in_courier">In Courier</option>${can('orders:write') ? '<option value="delivered">Delivered</option><option value="cancelled">Cancelled</option>' : ''}</select>
        <select class="i" id="bulk-courier" hidden>${Object.entries(m.couriers).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select>
        <button class="btn btn-primary btn-sm" id="bulk-go">Apply</button>` : ''}
      ${can('orders:write') ? `<select class="i" id="bulk-assign"><option value="">Assign to…</option><option value="-">Nobody</option>${staff.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select>` : ''}
      <button class="btn btn-outline btn-sm" data-print="invoice-a4">Invoices (A4)</button><button class="btn btn-outline btn-sm" data-print="invoice-thermal">Invoices (4×6)</button>
      <button class="btn btn-outline btn-sm" data-print="slip-a4">Packing slips</button><button class="btn btn-outline btn-sm" data-print="picking">Picking list</button></div>
    <div class="table-wrap"><table><thead><tr>${pick ? '<th><input type="checkbox" id="all" aria-label="Select all"></th>' : ''}<th>Order</th><th>Customer</th><th>Area</th><th class="right">Total</th><th>Payment</th><th>Stage</th><th>Risk</th></tr></thead>
      <tbody id="rows">${first.items.map(o => rowHtml(o, pick)).join('') || '<tr><td colspan="8" class="empty">No orders here.</td></tr>'}</tbody></table></div>
    <p class="center"><button class="btn btn-outline" id="more" ${first.nextCursor ? '' : 'hidden'}>Load more</button></p>`;

  let cursor = first.nextCursor;
  const $ = s => v.querySelector(s);
  const picked = () => [...v.querySelectorAll('[data-pick]:checked')].map(c => Number(c.dataset.pick));
  const sync = () => { const n = picked().length; $('#bulk').hidden = n === 0; $('#bulk-n').textContent = `${n} selected`; };
  const bindRows = scope => {
    scope.querySelectorAll('tr[data-id]').forEach(r => r.addEventListener('click', e => { if (!e.target.closest('input')) openOrder(Number(r.dataset.id), { onChange: () => orders(v, []) }); }));
    scope.querySelectorAll('[data-pick]').forEach(c => c.addEventListener('change', sync));
  };
  bindRows(v);
  $('#of').addEventListener('submit', e => {
    e.preventDefault();
    const n = new URLSearchParams(filter);
    for (const k of ['q', 'source']) { const x = e.target[k].value.trim(); if (x) n.set(k, x); else n.delete(k); }
    location.hash = `#/orders?${n}`;
  });
  busy($('#more'), async () => {
    const page = await api(`/orders?${filter}&cursor=${encodeURIComponent(cursor)}`);
    const tb = document.createElement('tbody');
    tb.innerHTML = page.items.map(o => rowHtml(o, pick)).join('');
    bindRows(tb);
    $('#rows').append(...tb.children);
    cursor = page.nextCursor;
    $('#more').hidden = !cursor;
  });
  $('#all')?.addEventListener('change', e => { v.querySelectorAll('[data-pick]').forEach(c => { c.checked = e.target.checked; }); sync(); });
  $('#bulk-to')?.addEventListener('change', e => { $('#bulk-courier').hidden = e.target.value !== 'in_courier'; });
  if ($('#bulk-go')) busy($('#bulk-go'), async () => {
    const to = $('#bulk-to').value;
    if (!to) return toast('Choose the stage to move them to.', true);
    const ids = picked();
    const body = { ids, to };
    if (to === 'in_courier') {
      body.courier = $('#bulk-courier').value;
      body.trackingIds = {};
      if (body.courier !== 'own_delivery') for (const oid of ids) {
        const t = prompt(`Tracking ID for order #${oid} (${m.couriers[body.courier]})`);
        if (!t) return;
        body.trackingIds[oid] = t;
      }
    }
    if (to === 'cancelled' && !(await confirmBox(`Cancel ${ids.length} order(s)? Held stock is released.`))) return;
    const r = await api('/orders/bulk', 'POST', body);
    const failed = r.results.filter(x => !x.ok);
    toast(failed.length ? `${r.summary}. First problem: ${failed[0].message}` : r.summary, failed.length > 0);
    orders(v, []);
  });
  $('#bulk-assign')?.addEventListener('change', async e => {
    if (!e.target.value) return;
    try {
      await api('/orders/assign', 'POST', { ids: picked(), adminId: e.target.value === '-' ? null : e.target.value });
      toast('Assigned.');
      orders(v, []);
    } catch (err) { toast(err.message, true); }
  });
  v.querySelectorAll('[data-print]').forEach(b => b.addEventListener('click', () => {
    const ids = picked().join(',');
    const kind = b.dataset.print;
    const url = kind === 'picking' ? `/api/admin/print/picking-list?ids=${ids}`
      : `/api/admin/print/slips.pdf?ids=${ids}&kind=${kind.startsWith('slip') ? 'packing_slip' : 'invoice'}&layout=${kind.endsWith('thermal') ? 'thermal' : 'a4'}`;
    window.open(url, '_blank');
  }));
  if (id) openOrder(Number(id), { onChange: () => orders(v, []) });
}

export async function openOrder(id, { onChange } = {}) {
  const m = await meta();
  const so = slideOver('Order', { wide: true, onClose: () => { if (location.hash.startsWith(`#/orders/${id}`)) history.replaceState(null, '', '#/orders'); } });
  const load = async () => {
    const d = await api(`/orders/${id}`);
    const o = d.order;
    so.head.querySelector('h2').innerHTML = `${esc(o.order_no)} ${badge(o.status)} ${o.invoice_no ? `<span class="badge b-dark">${esc(o.invoice_no)}</span>` : ''}`;
    const write = can('orders:write');
    const returnBack = ['returned', 'partial_delivered'].includes(o.status);
    so.body.innerHTML = `
      ${o.hold_reason ? `<div class="notice err"><b>On hold:</b> ${esc(o.hold_reason)}${write ? `<div class="row" style="margin-top:8px"><input class="i" id="hold-note" placeholder="Why it's fine (e.g. called, both orders wanted)" style="flex:1"><button class="btn btn-sm btn-primary" id="hold-go">Release hold</button></div>` : ''}</div>` : ''}
      ${o.duplicate_of_order_id ? `<div class="notice err">Possible duplicate of order #${o.duplicate_of_order_id}. ${write && o.status === 'new' ? '<button class="btn btn-sm btn-primary" id="merge">Cancel this one as a duplicate</button>' : ''}</div>` : ''}
      ${d.confirmBlockers.length && o.status === 'new' ? `<div class="notice"><b>Before confirming:</b><br>${d.confirmBlockers.map(esc).join('<br>')}</div>` : ''}
      ${returnBack && !o.return_received_at ? '<div class="notice">The parcel is on its way back. Stock returns when the warehouse scans it in <a href="#/returns">Returns scan</a>.</div>' : ''}
      <div class="split">
        <div>
          <div class="card"><h2>Items</h2><div class="table-wrap"><table><thead><tr><th>SKU</th><th>Item</th><th class="right">Qty</th><th class="right">Price</th><th class="right">Total</th></tr></thead><tbody>
            ${d.items.map(i => `<tr><td class="small">${esc(i.sku)}</td><td>${esc(i.name)}${i.variant_label ? `<br><span class="small muted">${esc(i.variant_label)}</span>` : ''}${i.fulfilment_mode !== 'in_stock' ? ` ${badge(i.fulfilment_mode)}` : ''}${i.returned_qty ? `<br><span class="badge b-red">${i.returned_qty} coming back</span>` : ''}</td><td class="right">${i.qty}</td><td class="right">${taka(i.unit_price_paisa)}</td><td class="right">${taka(i.line_total_paisa)}</td></tr>`).join('')}
          </tbody></table></div>
          <dl class="kv" style="margin-top:12px"><dt>Subtotal</dt><dd>${taka(o.subtotal_paisa)}</dd>${o.discount_paisa ? `<dt>Discount</dt><dd>−${taka(o.discount_paisa)}</dd>` : ''}<dt>Delivery</dt><dd>${o.delivery_charge_status === 'to_confirm' ? '<span class="badge b-red">to confirm by phone</span>' : taka(o.delivery_charge_paisa)}</dd>${o.cod_fee_paisa ? `<dt>COD fee</dt><dd>${taka(o.cod_fee_paisa)}</dd>` : ''}<dt>Total</dt><dd>${taka(o.total_paisa)}</dd><dt>Zone / ETA</dt><dd>${esc(o.eta_text ?? '')}</dd></dl>
          ${write && o.delivery_charge_status === 'to_confirm' ? `<div class="row" style="margin-top:10px"><input class="i" id="dc" placeholder="Delivery charge ৳" style="max-width:180px"><button class="btn btn-primary btn-sm" id="dc-go">Set charge</button></div>` : ''}
          </div>
          <div class="card"><h2>History</h2><ul class="timeline">${d.events.map(e => `<li class="${esc(e.kind)}"><b>${e.kind === 'status' ? `${esc((e.from_status ?? 'placed').replace(/_/g, ' '))} → ${esc(e.to_status.replace(/_/g, ' '))}` : e.kind === 'rejected_transition' ? `Refused: ${esc(e.from_status)} → ${esc(e.to_status)}` : e.kind === 'call' ? `Call: ${esc(e.outcome.replace(/_/g, ' '))}` : esc(e.kind.replace(/_/g, ' '))}</b> <span class="small muted">${date(e.created_at)} · ${esc(e.admin_name ?? e.actor_type)}</span>${e.note ? `<br><span class="small">${esc(e.note)}</span>` : ''}</li>`).join('')}</ul>
            ${write ? `<div class="row" style="margin-top:8px"><input class="i" id="note" placeholder="Add an internal note" style="flex:1"><button class="btn btn-outline btn-sm" id="note-go">Add note</button></div>` : ''}</div>
          <div class="card"><h2>SMS sent</h2>${d.sms.length ? d.sms.map(s => `<p class="small"><b>${esc(s.kind)}</b> ${badge(s.status)} <span class="muted">${date(s.created_at)}</span><br>${esc(s.body)}</p>`).join('') : '<p class="muted small">None.</p>'}</div>
        </div>
        <div>
          <div class="card"><h2>Customer</h2><dl class="kv"><dt>Name</dt><dd>${esc(o.customer_name)}</dd><dt>Phone</dt><dd>${o.phone.includes('X') ? `${esc(o.phone)} ${write ? '<button class="btn btn-sm btn-outline" id="claim">Claim to see the number</button>' : ''}` : `<a href="tel:${esc(o.phone)}">${esc(o.phone)}</a> · <a href="https://wa.me/88${esc(o.phone)}" target="_blank" rel="noopener">WhatsApp</a>`}</dd>
            <dt>Address</dt><dd>${esc(o.address_line)}${o.landmark ? `<br>Near ${esc(o.landmark)}` : ''}<br>${[o.union_name, o.upazila_name, o.district_name, `${o.division_name} Division`].filter(Boolean).map(esc).join(', ')}${o.postcode ? ` ${esc(o.postcode)}` : ''}${o.post_office ? `<br><span class="muted small">Post office: ${esc(o.post_office)}</span>` : ''}</dd>
            <dt>History</dt><dd>${d.customer ? `${d.customer.order_count} orders · ${d.customer.delivered_count} delivered · ${d.customer.returned_count} returned${d.customer.is_trusted ? ' · <span class="badge b-green">trusted</span>' : ''}` : 'New'}</dd>
            <dt>Risk</dt><dd>${badge(o.risk_level)}${o.risk_reasons.map(r => `<br><span class="small">${esc(r.detail)}</span>`).join('')}</dd>
            <dt>Verified</dt><dd>${o.otp_verified_at ? `SMS code ✓ ${date(o.otp_verified_at)}` : 'Not yet'}</dd>
            <dt>Channel</dt><dd>${esc(m.sources[o.source] ?? o.source)}${o.source_detail ? ` · ${esc(o.source_detail)}` : ''}${d.creator ? `<br><span class="small muted">Entered by ${esc(d.creator.name)}</span>` : ''}</dd>
            <dt>Assigned</dt><dd>${d.assignee ? esc(d.assignee.name) : '<span class="muted">Nobody</span>'}${write && o.assigned_to !== state.user.id ? ' <button class="btn btn-sm btn-outline" id="claim2">Assign to me</button>' : ''}</dd>
            ${o.customer_note ? `<dt>Note</dt><dd>${esc(o.customer_note)}</dd>` : ''}
            ${Object.keys(o.utm).length ? `<dt>Ad source</dt><dd class="small">${Object.entries(o.utm).map(([k, x]) => `${esc(k)}=${esc(x)}`).join('<br>')}</dd>` : ''}</dl>
            ${can('security:write') ? `<details style="margin-top:10px"><summary class="small">Block this customer…</summary><div class="row" style="margin-top:8px"><select class="i" id="blk-type"><option value="phone">Phone number</option><option value="device">Device</option><option value="ip">Connection (expires)</option></select><input class="i" id="blk-reason" placeholder="Reason" style="flex:1"><button class="btn btn-sm btn-outline" id="blk-go">Block</button></div><p class="small muted">Undo any time in Security → Block list.</p></details>` : ''}</div>
          ${o.advance_required ? `<div class="card"><h2>Advance ${badge(o.advance_status)}</h2><p class="small">${esc(o.advance_reason ?? '')}</p><dl class="kv"><dt>Amount</dt><dd>${taka(o.advance_amount_paisa)}</dd><dt>TrxID</dt><dd>${esc(o.advance_trx_id ?? '—')} ${o.advance_wallet ? `(${esc(o.advance_wallet)})` : ''}</dd></dl>
            ${write && o.advance_status !== 'paid' ? `<div class="row" style="margin-top:10px"><input class="i" id="adv-amt" value="${o.advance_amount_paisa ? o.advance_amount_paisa / 100 : ''}" placeholder="Amount received ৳" style="max-width:150px"><button class="btn btn-leaf btn-sm" id="adv-ok">Mark received</button>${o.advance_status === 'submitted' ? '<button class="btn btn-outline btn-sm" id="adv-no">Not found</button>' : ''}</div>` : ''}</div>` : ''}
          ${write && o.status === 'new' ? `<div class="card"><h2>Confirmation call</h2><div class="row"><select class="i" id="call-out" style="flex:1">${CALLS.map(([x, l]) => `<option value="${x}">${l}</option>`).join('')}</select></div><input class="i" id="call-note" placeholder="What did they say? (optional)" style="margin:8px 0"><button class="btn btn-outline btn-sm" id="call-go">Log call</button>${o.call_attempts ? `<p class="small muted">${o.call_attempts} call attempt(s) so far.</p>` : ''}</div>` : ''}
          ${canMove() ? `<div class="card"><h2>Move order</h2>
            ${d.nextStatuses.length ? `<select class="i" id="to">${d.nextStatuses.map(s => `<option value="${s.value}">${s.label}</option>`).join('')}</select>
            <div id="ship" hidden class="grid-2" style="margin-top:8px"><label class="f">Courier<select id="courier">${Object.entries(m.couriers).map(([k, l]) => `<option value="${k}" ${o.courier === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label><label class="f">Tracking ID<input id="tracking" value="${esc(o.tracking_id ?? '')}"></label></div>
            <label class="f" id="ret-wrap" hidden style="margin-top:8px">Why did it come back?<select id="ret">${Object.entries(m.returnReasons).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></label>
            <div id="partial" hidden style="margin-top:8px"><p class="small"><b>How many of each item are coming back?</b></p>${d.items.map(i => `<label class="f small">${esc(i.name)}${i.variant_label ? ` (${esc(i.variant_label)})` : ''} × ${i.qty}<input type="number" min="0" max="${i.qty}" value="0" data-ret="${i.id}"></label>`).join('')}</div>
            <input class="i" id="reason" placeholder="Reason for cancelling" hidden style="margin-top:8px">
            <button class="btn btn-primary" id="move" style="margin-top:10px;width:100%">Update stage</button>` : `<p class="muted">This order is ${esc(o.status.replace(/_/g, ' '))}.${returnBack ? (o.return_received_at ? ` Received at the warehouse ${date(o.return_received_at)}.` : ' Waiting for the warehouse scan.') : ''}</p>`}
            ${o.status === 'in_courier' && d.subStatuses ? `<label class="f" style="margin-top:10px">Courier status<select id="sub">${Object.entries(d.subStatuses).map(([k, l]) => `<option value="${k}" ${o.sub_status === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>` : ''}
            ${write ? `<hr style="border:0;border-top:1px solid #EDE3D3;margin:14px 0"><label class="check small"><input type="checkbox" id="test" ${o.is_test ? 'checked' : ''}> Test order (never counted as a sale)</label>` : ''}</div>` : ''}
          <div class="card"><h2>Invoice & labels</h2>${o.invoice_no ? `<div class="row"><a class="btn btn-outline" href="/api/admin/orders/${o.id}/invoice.pdf" target="_blank">Invoice ${esc(o.invoice_no)} (PDF)</a><a class="btn btn-outline" href="/api/admin/print/slips.pdf?ids=${o.id}&layout=thermal" target="_blank">4×6 label</a><button class="btn btn-ghost" id="print">Print (any language)</button></div><p class="small muted">The PDF uses standard fonts, so Bangla names show as “?”. The print view shows every script.</p>` : '<p class="muted small">Created automatically when the order is confirmed.</p>'}
            ${o.courier ? `<p class="small" style="margin-top:8px">Courier: <b>${esc(m.couriers[o.courier] ?? o.courier)}</b>${o.tracking_id ? ` · ${esc(o.tracking_id)}` : ''}</p>` : ''}</div>
        </div>
      </div>`;
    const $ = s => so.body.querySelector(s);
    const after = async msg => { toast(msg); await load(); onChange?.(); };
    if ($('#hold-go')) busy($('#hold-go'), async () => { await api(`/orders/${id}/release-hold`, 'POST', { note: $('#hold-note').value }); await after('Hold released.'); });
    if ($('#merge')) busy($('#merge'), async () => { if (await confirmBox('Cancel this order as a duplicate?')) { await api(`/orders/${id}/merge`, 'POST', {}); await after('Cancelled as a duplicate.'); } });
    if ($('#dc-go')) busy($('#dc-go'), async () => { await api(`/orders/${id}/delivery-charge`, 'POST', { chargePaisa: toPaisa($('#dc').value) }); await after('Delivery charge set.'); });
    if ($('#note-go')) busy($('#note-go'), async () => { await api(`/orders/${id}/note`, 'POST', { note: $('#note').value }); await after('Note added.'); });
    if ($('#adv-ok')) busy($('#adv-ok'), async () => { await api(`/orders/${id}/advance`, 'POST', { action: 'verify', amountPaisa: toPaisa($('#adv-amt').value) }); await after('Advance marked as received.'); });
    if ($('#adv-no')) busy($('#adv-no'), async () => { await api(`/orders/${id}/advance`, 'POST', { action: 'reject', note: 'Transaction not found' }); await after('Customer asked to pay again.'); });
    if ($('#call-go')) busy($('#call-go'), async () => { await api(`/orders/${id}/call`, 'POST', { outcome: $('#call-out').value, note: $('#call-note').value }); await after('Call logged.'); });
    for (const b of ['#claim', '#claim2']) if ($(b)) busy($(b), async () => { await api('/orders/assign', 'POST', { ids: [id], adminId: state.user.id }); await after('Assigned to you.'); });
    if ($('#blk-go')) busy($('#blk-go'), async () => { if (await confirmBox('Block this customer from ordering online? You can undo it in Security.')) { await api(`/orders/${id}/block`, 'POST', { type: $('#blk-type').value, reason: $('#blk-reason').value }); await after('Blocked.'); } });
    $('#sub')?.addEventListener('change', async e => { try { await api(`/orders/${id}/courier`, 'POST', { subStatus: e.target.value }); await after('Courier status saved.'); } catch (err) { toast(err.message, true); } });
    const to = $('#to');
    if (to) {
      const sync = () => { $('#ship').hidden = to.value !== 'in_courier'; $('#reason').hidden = to.value !== 'cancelled'; $('#ret-wrap').hidden = !['returned', 'partial_delivered'].includes(to.value); $('#partial').hidden = to.value !== 'partial_delivered'; };
      to.addEventListener('change', sync); sync();
      busy($('#move'), async () => {
        if (to.value === 'cancelled' && !(await confirmBox('Cancel this order?'))) return;
        const returned = Object.fromEntries([...so.body.querySelectorAll('[data-ret]')].map(i => [i.dataset.ret, Number(i.value) || 0]));
        const r = await api(`/orders/${id}/status`, 'POST', { to: to.value, courier: $('#courier').value, trackingId: $('#tracking').value, cancelReason: $('#reason').value, returnReason: $('#ret').value, returned });
        await after(r.invoiceNo ? `Confirmed. Invoice ${r.invoiceNo} created, stock held and SMS sent.` : 'Stage updated.');
      });
    }
    $('#print')?.addEventListener('click', () => printInvoice(d));
    $('#test')?.addEventListener('change', async e => { await api(`/orders/${id}/test`, 'POST', { isTest: e.target.checked }); toast('Saved.'); });
  };
  await load();
}

/** Browser-printed invoice: renders any script (Bangla names included), unlike the standard-font PDF. */
function printInvoice(d) {
  const o = d.order;
  const w = window.open('', '_blank');
  if (!w) { toast('Allow pop-ups to print.', true); return; }
  const row = (l, x) => `<tr><td>${esc(l)}</td><td style="text-align:right">${x}</td></tr>`;
  w.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(o.invoice_no)}</title>
    <style>body{font:14px/1.5 system-ui,sans-serif;color:#2A1F1A;margin:32px}h1{font-size:28px;color:#B3261E;margin:0}table{width:100%;border-collapse:collapse;margin:16px 0}td,th{padding:6px 8px;border-bottom:1px solid #E9DCC6;text-align:left}.r{text-align:right}.head{display:flex;justify-content:space-between}.muted{color:#6B5A4E}</style></head><body>
    <div class="head"><div><h1>Abs Vai</h1><div class="muted">ABS VAI LTD · absvai.com</div></div><div style="text-align:right"><b>INVOICE ${esc(o.invoice_no)}</b><br>Order ${esc(o.order_no)}<br>${date(o.confirmed_at)}</div></div>
    <p><b>${esc(o.customer_name)}</b> · ${esc(o.phone)}<br>${esc(o.address_line)}${o.landmark ? `, near ${esc(o.landmark)}` : ''}<br>${[o.union_name, o.upazila_name, o.district_name, `${o.division_name} Division`].filter(Boolean).map(esc).join(', ')} ${esc(o.postcode ?? '')}</p>
    <table><thead><tr><th>SKU</th><th>Item</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Amount</th></tr></thead><tbody>
    ${d.items.map(i => `<tr><td>${esc(i.sku)}</td><td>${esc(i.name)}${i.variant_label ? ` (${esc(i.variant_label)})` : ''}</td><td class="r">${i.qty}</td><td class="r">${taka(i.unit_price_paisa)}</td><td class="r">${taka(i.line_total_paisa)}</td></tr>`).join('')}</tbody></table>
    <table style="width:320px;margin-left:auto">${row('Subtotal', taka(o.subtotal_paisa))}${o.discount_paisa ? row('Discount', `−${taka(o.discount_paisa)}`) : ''}${row('Delivery', o.delivery_charge_paisa === null ? 'To be confirmed' : taka(o.delivery_charge_paisa))}${o.cod_fee_paisa ? row('COD fee', taka(o.cod_fee_paisa)) : ''}${row('<b>Total</b>', `<b>${taka(o.total_paisa)}</b>`)}${o.advance_status === 'paid' ? row('Advance paid', `−${taka(o.advance_amount_paisa)}`) : ''}</table>
    <p class="muted">Payment: ${o.payment_method === 'cod' ? 'Cash on Delivery' : 'Mobile wallet'} · ${esc(o.payment_status)}. Thank you for shopping with Abs Vai.</p></body></html>`);
  w.document.close();
  w.focus();
  w.print();
}
