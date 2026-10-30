import { api, badge, busy, can, confirmBox, date, esc, qs, slideOver, taka, toast, toPaisa } from '../app.js';

const TABS = [['', 'All'], ['pending', 'To confirm'], ['confirmed', 'Confirmed'], ['packed', 'Packed'], ['shipped', 'Shipped'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled'], ['returned', 'Returned']];
const CALLS = [['confirmed', 'Confirmed'], ['no_answer', 'No answer'], ['call_back', 'Call back later'], ['wrong_number', 'Wrong number'], ['cancel_requested', 'Wants to cancel']];
const COURIERS = ['Steadfast', 'Pathao', 'RedX', 'Own delivery'];

export async function orders(v, [id]) {
  const p = qs();
  const filter = new URLSearchParams();
  for (const k of ['status', 'q', 'risk', 'advance', 'fulfilment']) if (p.get(k)) filter.set(k, p.get(k));
  const rows = await api(`/orders?${filter}`);
  const tab = p.get('status') ?? '';
  v.innerHTML = `
    <div class="page-head"><div><h1>Orders</h1><p>Pending → Confirmation attempted → Confirmed → Packed → Shipped → Delivered.</p></div>
      <a class="btn btn-outline" href="/api/admin/orders/export.csv">Export CSV</a></div>
    <nav class="tabs">${TABS.map(([s, l]) => `<a href="#/orders${s ? `?status=${s}` : ''}" aria-current="${tab === s}">${l}</a>`).join('')}
      <a href="#/orders?advance=submitted" aria-current="${p.get('advance') === 'submitted'}">Advances to verify</a><a href="#/orders?risk=high" aria-current="${p.get('risk') === 'high'}">High risk</a></nav>
    <form class="filters" id="of"><input class="i" name="q" value="${esc(p.get('q') ?? '')}" placeholder="Order no, invoice, phone or name"><button class="btn btn-outline">Search</button></form>
    ${can('orders:write') ? `<div class="filters" id="bulk" hidden><b id="bulk-n"></b>
      <select class="i" id="bulk-to"><option value="confirmed">Mark confirmed</option><option value="packed">Mark packed</option><option value="shipped">Mark shipped</option><option value="cancelled">Cancel</option></select>
      <select class="i" id="bulk-courier" hidden>${COURIERS.map(c => `<option>${c}</option>`).join('')}</select>
      <button class="btn btn-primary btn-sm" id="bulk-go">Apply</button><button class="btn btn-outline btn-sm" id="bulk-print">Print invoices</button></div>` : ''}
    <div class="table-wrap"><table><thead><tr>${can('orders:write') ? '<th><input type="checkbox" id="all" aria-label="Select all"></th>' : ''}<th>Order</th><th>Customer</th><th>Area</th><th class="right">Total</th><th>Payment</th><th>Status</th><th>Risk</th></tr></thead><tbody>
      ${rows.map(o => `<tr class="clickable" data-id="${o.id}">${can('orders:write') ? `<td><input type="checkbox" data-pick="${o.id}" aria-label="Select ${esc(o.order_no)}"></td>` : ''}
        <td><b>${esc(o.order_no)}</b>${o.is_test ? ' <span class="badge b-grey">test</span>' : ''}${o.duplicate_of_order_id ? ' <span class="badge b-red">possible duplicate</span>' : ''}<br><span class="small muted">${date(o.created_at)} · ${o.item_count} item(s)</span></td>
        <td>${esc(o.customer_name)}<br><span class="small muted">${esc(o.phone)}</span></td>
        <td>${esc(o.upazila_name)}<br><span class="small muted">${esc(o.district_name)}</span></td>
        <td class="right">${taka(o.total_paisa)}</td>
        <td>${o.payment_method === 'cod' ? 'COD' : 'Mobile wallet'}${o.advance_status !== 'not_required' ? `<br>${badge(o.advance_status)}` : ''}</td>
        <td>${badge(o.status)}${o.fulfilment_type === 'pre_order' ? '<br><span class="badge b-yellow">pre-order</span>' : ''}</td><td>${badge(o.risk_level)}</td></tr>`).join('') || `<tr><td colspan="8" class="empty">No orders here.</td></tr>`}
    </tbody></table></div>`;
  v.querySelector('#of').addEventListener('submit', e => { e.preventDefault(); const q = e.target.q.value.trim(); location.hash = `#/orders${q ? `?q=${encodeURIComponent(q)}` : ''}`; });
  v.querySelectorAll('tr[data-id]').forEach(r => r.addEventListener('click', e => { if (!e.target.closest('input')) openOrder(Number(r.dataset.id)); }));

  const picked = () => [...v.querySelectorAll('[data-pick]:checked')].map(c => Number(c.dataset.pick));
  const bulk = v.querySelector('#bulk');
  const sync = () => { if (!bulk) return; const n = picked().length; bulk.hidden = n === 0; v.querySelector('#bulk-n').textContent = `${n} selected`; };
  v.querySelectorAll('[data-pick]').forEach(c => c.addEventListener('change', sync));
  v.querySelector('#all')?.addEventListener('change', e => { v.querySelectorAll('[data-pick]').forEach(c => { c.checked = e.target.checked; }); sync(); });
  v.querySelector('#bulk-to')?.addEventListener('change', e => { v.querySelector('#bulk-courier').hidden = e.target.value !== 'shipped'; });
  if (bulk) {
    busy(v.querySelector('#bulk-go'), async () => {
      const to = v.querySelector('#bulk-to').value;
      const ids = picked();
      const body = { ids, to };
      if (to === 'shipped') {
        body.courier = v.querySelector('#bulk-courier').value;
        body.trackingIds = {};
        for (const id of ids) {
          const t = prompt(`Tracking ID for order #${id} (${body.courier})`);
          if (!t) return;
          body.trackingIds[id] = t;
        }
      }
      if (to === 'cancelled' && !(await confirmBox(`Cancel ${ids.length} order(s)? Stock goes back.`))) return;
      const r = await api('/orders/bulk', 'POST', body);
      const failed = r.results.filter(x => !x.ok);
      toast(failed.length ? `${r.results.length - failed.length} done. ${failed.length} could not change: ${failed[0].message}` : 'Done.', failed.length > 0);
      orders(v, []);
    });
    v.querySelector('#bulk-print').addEventListener('click', () => picked().forEach(id => window.open(`/api/admin/orders/${id}/invoice.pdf`, '_blank')));
  }
  if (id) openOrder(Number(id));
}

async function openOrder(id) {
  const so = slideOver('Order', { wide: true, onClose: () => { if (location.hash.startsWith(`#/orders/${id}`)) history.replaceState(null, '', '#/orders'); } });
  const load = async () => {
    const d = await api(`/orders/${id}`);
    const o = d.order;
    so.head.querySelector('h2').innerHTML = `${esc(o.order_no)} ${badge(o.status)} ${o.invoice_no ? `<span class="badge b-dark">${esc(o.invoice_no)}</span>` : ''}`;
    const write = can('orders:write');
    so.body.innerHTML = `
      ${o.duplicate_of_order_id ? `<div class="notice err">Possible double tap: same phone and items as order #${o.duplicate_of_order_id} a few minutes earlier. ${write ? '<button class="btn btn-sm btn-primary" id="merge">Cancel this one as a duplicate</button>' : ''}</div>` : ''}
      ${d.confirmBlockers.length && ['pending', 'confirmation_attempted'].includes(o.status) ? `<div class="notice"><b>Before confirming:</b><br>${d.confirmBlockers.map(esc).join('<br>')}</div>` : ''}
      <div class="split">
        <div>
          <div class="card"><h2>Items</h2><div class="table-wrap"><table><thead><tr><th>SKU</th><th>Item</th><th class="right">Qty</th><th class="right">Price</th><th class="right">Total</th></tr></thead><tbody>
            ${d.items.map(i => `<tr><td class="small">${esc(i.sku)}</td><td>${esc(i.name)}${i.variant_label ? `<br><span class="small muted">${esc(i.variant_label)}</span>` : ''}${i.fulfilment_mode !== 'in_stock' ? ` ${badge(i.fulfilment_mode)}` : ''}</td><td class="right">${i.qty}</td><td class="right">${taka(i.unit_price_paisa)}</td><td class="right">${taka(i.line_total_paisa)}</td></tr>`).join('')}
          </tbody></table></div>
          <dl class="kv" style="margin-top:12px"><dt>Subtotal</dt><dd>${taka(o.subtotal_paisa)}</dd><dt>Delivery</dt><dd>${o.delivery_charge_status === 'to_confirm' ? '<span class="badge b-red">to confirm by phone</span>' : taka(o.delivery_charge_paisa)}</dd>${o.cod_fee_paisa ? `<dt>COD fee</dt><dd>${taka(o.cod_fee_paisa)}</dd>` : ''}<dt>Total</dt><dd>${taka(o.total_paisa)}</dd><dt>Zone / ETA</dt><dd>${esc(o.eta_text ?? '')}</dd></dl>
          ${write && o.delivery_charge_status === 'to_confirm' ? `<div class="row" style="margin-top:10px"><input class="i" id="dc" placeholder="Delivery charge ৳" style="max-width:180px"><button class="btn btn-primary btn-sm" id="dc-go">Set charge</button></div>` : ''}
          </div>
          <div class="card"><h2>Timeline</h2><ul class="timeline">${d.events.map(e => `<li class="${esc(e.kind)}"><b>${e.kind === 'status' ? `${esc((e.from_status ?? 'new').replace(/_/g, ' '))} → ${esc(e.to_status.replace(/_/g, ' '))}` : e.kind === 'call' ? `Call: ${esc(e.outcome.replace(/_/g, ' '))}` : esc(e.kind)}</b> <span class="small muted">${date(e.created_at)}${e.admin_name ? ` · ${esc(e.admin_name)}` : ''}</span>${e.note ? `<br><span class="small">${esc(e.note)}</span>` : ''}</li>`).join('')}</ul>
            ${write ? `<div class="row" style="margin-top:8px"><input class="i" id="note" placeholder="Add an internal note" style="flex:1"><button class="btn btn-outline btn-sm" id="note-go">Add note</button></div>` : ''}</div>
          <div class="card"><h2>SMS sent</h2>${d.sms.length ? d.sms.map(s => `<p class="small"><b>${esc(s.kind)}</b> ${badge(s.status)} <span class="muted">${date(s.created_at)}</span><br>${esc(s.body)}</p>`).join('') : '<p class="muted small">None.</p>'}</div>
        </div>
        <div>
          <div class="card"><h2>Customer</h2><dl class="kv"><dt>Name</dt><dd>${esc(o.customer_name)}</dd><dt>Phone</dt><dd><a href="tel:${esc(o.phone)}">${esc(o.phone)}</a></dd>
            <dt>Address</dt><dd>${esc(o.address_line)}${o.landmark ? `<br>Near ${esc(o.landmark)}` : ''}<br>${[o.union_name, o.upazila_name, o.district_name, `${o.division_name} Division`].filter(Boolean).map(esc).join(', ')}${o.postcode ? ` ${esc(o.postcode)}` : ''}${o.post_office ? `<br><span class="muted small">Post office: ${esc(o.post_office)}</span>` : ''}</dd>
            <dt>History</dt><dd>${d.customer ? `${d.customer.order_count} orders · ${d.customer.delivered_count} delivered · ${d.customer.returned_count} returned${d.customer.is_trusted ? ' · <span class="badge b-green">trusted</span>' : ''}` : 'New'}</dd>
            <dt>Risk</dt><dd>${badge(o.risk_level)}${o.risk_reasons.map(r => `<br><span class="small">${esc(r.detail)}</span>`).join('')}</dd>
            <dt>Verified</dt><dd>${o.otp_verified_at ? `SMS code ✓ ${date(o.otp_verified_at)}` : 'Not yet'}</dd>
            ${o.customer_note ? `<dt>Note</dt><dd>${esc(o.customer_note)}</dd>` : ''}
            ${Object.keys(o.utm).length ? `<dt>Source</dt><dd class="small">${Object.entries(o.utm).map(([k, x]) => `${esc(k)}=${esc(x)}`).join('<br>')}</dd>` : ''}</dl></div>
          ${o.advance_required ? `<div class="card"><h2>Advance ${badge(o.advance_status)}</h2><p class="small">${esc(o.advance_reason ?? '')}</p><dl class="kv"><dt>Amount</dt><dd>${taka(o.advance_amount_paisa)}</dd><dt>TrxID</dt><dd>${esc(o.advance_trx_id ?? '—')} ${o.advance_wallet ? `(${esc(o.advance_wallet)})` : ''}</dd></dl>
            ${write && o.advance_status !== 'paid' ? `<div class="row" style="margin-top:10px"><input class="i" id="adv-amt" value="${o.advance_amount_paisa ? o.advance_amount_paisa / 100 : ''}" placeholder="Amount received ৳" style="max-width:150px"><button class="btn btn-leaf btn-sm" id="adv-ok">Mark received</button>${o.advance_status === 'submitted' ? '<button class="btn btn-outline btn-sm" id="adv-no">Not found</button>' : ''}</div>` : ''}</div>` : ''}
          ${write ? `<div class="card"><h2>Confirmation call</h2><div class="row"><select class="i" id="call-out" style="flex:1">${CALLS.map(([x, l]) => `<option value="${x}">${l}</option>`).join('')}</select></div><input class="i" id="call-note" placeholder="What did they say? (optional)" style="margin:8px 0"><button class="btn btn-outline btn-sm" id="call-go">Log call</button></div>
          <div class="card"><h2>Move order</h2>
            ${d.nextStatuses.length ? `<select class="i" id="to">${d.nextStatuses.map(s => `<option value="${s.value}">${s.label}</option>`).join('')}</select>
            <div id="ship" hidden class="grid-2" style="margin-top:8px"><label class="f">Courier<select id="courier">${COURIERS.map(c => `<option>${c}</option>`).join('')}</select></label><label class="f">Tracking ID / note<input id="tracking"></label></div>
            <input class="i" id="reason" placeholder="Reason (for cancel / return)" hidden style="margin-top:8px">
            <button class="btn btn-primary" id="move" style="margin-top:10px;width:100%">Update status</button>` : '<p class="muted">This order is closed.</p>'}
            <hr style="border:0;border-top:1px solid #EDE3D3;margin:14px 0">
            <label class="check small"><input type="checkbox" id="test" ${o.is_test ? 'checked' : ''}> Test order (never counted as a sale)</label></div>` : ''}
          <div class="card"><h2>Invoice</h2>${o.invoice_no ? `<div class="row"><a class="btn btn-outline" href="/api/admin/orders/${o.id}/invoice.pdf" target="_blank">Download ${esc(o.invoice_no)} (PDF)</a><button class="btn btn-ghost" id="print">Print (any language)</button></div><p class="small muted">The PDF uses standard fonts, so Bangla names show as “?”. The print view shows every script.</p>` : '<p class="muted small">Created automatically when the order is confirmed.</p>'}
            ${o.courier ? `<p class="small" style="margin-top:8px">Shipped with <b>${esc(o.courier)}</b> · ${esc(o.tracking_id)}</p>` : ''}</div>
        </div>
      </div>`;
    const $ = s => so.body.querySelector(s);
    const after = async msg => { toast(msg); await load(); };
    if ($('#merge')) busy($('#merge'), async () => { if (await confirmBox('Cancel this order as a duplicate? Stock goes back.')) { await api(`/orders/${id}/merge`, 'POST', {}); await after('Cancelled as a duplicate.'); } });
    if ($('#dc-go')) busy($('#dc-go'), async () => { await api(`/orders/${id}/delivery-charge`, 'POST', { chargePaisa: toPaisa($('#dc').value) }); await after('Delivery charge set.'); });
    if ($('#note-go')) busy($('#note-go'), async () => { await api(`/orders/${id}/note`, 'POST', { note: $('#note').value }); await after('Note added.'); });
    if ($('#adv-ok')) busy($('#adv-ok'), async () => { await api(`/orders/${id}/advance`, 'POST', { action: 'verify', amountPaisa: toPaisa($('#adv-amt').value) }); await after('Advance marked as received.'); });
    if ($('#adv-no')) busy($('#adv-no'), async () => { await api(`/orders/${id}/advance`, 'POST', { action: 'reject', note: 'Transaction not found' }); await after('Customer asked to pay again.'); });
    if ($('#call-go')) busy($('#call-go'), async () => { await api(`/orders/${id}/call`, 'POST', { outcome: $('#call-out').value, note: $('#call-note').value }); await after('Call logged.'); });
    const to = $('#to');
    if (to) {
      const sync = () => { $('#ship').hidden = to.value !== 'shipped'; $('#reason').hidden = !['cancelled', 'returned', 'refused_at_delivery'].includes(to.value); };
      to.addEventListener('change', sync); sync();
      busy($('#move'), async () => {
        if (to.value === 'cancelled' && !(await confirmBox('Cancel this order? Stock goes back.'))) return;
        const r = await api(`/orders/${id}/status`, 'POST', { to: to.value, courier: $('#courier').value, trackingId: $('#tracking').value, cancelReason: $('#reason').value });
        await after(r.invoiceNo ? `Confirmed. Invoice ${r.invoiceNo} created and SMS sent.` : 'Status updated.');
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
    <table style="width:320px;margin-left:auto">${row('Subtotal', taka(o.subtotal_paisa))}${row('Delivery', o.delivery_charge_paisa === null ? 'To be confirmed' : taka(o.delivery_charge_paisa))}${o.cod_fee_paisa ? row('COD fee', taka(o.cod_fee_paisa)) : ''}${row('<b>Total</b>', `<b>${taka(o.total_paisa)}</b>`)}${o.advance_status === 'paid' ? row('Advance paid', `−${taka(o.advance_amount_paisa)}`) : ''}</table>
    <p class="muted">Payment: ${o.payment_method === 'cod' ? 'Cash on Delivery' : 'Mobile wallet'} · ${esc(o.payment_status)}. Thank you for shopping with Abs Vai.</p></body></html>`);
  w.document.close();
  w.focus();
  w.print();
}
