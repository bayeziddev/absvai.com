// Sales screens added in v2: incomplete-order recovery, manual/social order entry and the warehouse returns scan.
import { api, badge, busy, can, date, esc, qs, taka, toast, toPaisa } from '../app.js';

const STATUSES = [['new', 'New'], ['contacted', 'Contacted'], ['converted', 'Converted'], ['not_interested', 'Not interested'], ['unreachable', 'Unreachable'], ['spam', 'Spam']];
const ago = iso => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} day(s) ago`; };

// ───────────── Incomplete orders (Section 8.3) ─────────────

export async function incomplete(v) {
  const p = qs();
  const status = p.get('status') ?? 'new';
  const assigned = p.get('assigned') ?? '';
  const f = new URLSearchParams({ status });
  if (assigned) f.set('assigned', assigned);
  const [list, report, staff] = await Promise.all([api(`/incomplete?${f}`), api('/incomplete/report?days=30'), can('orders:write') ? api('/staff-options').catch(() => []) : []]);
  const t = report.totals;
  v.innerHTML = `
    <div class="page-head"><div><h1>Incomplete orders</h1><p>Checkouts where the customer typed a valid phone number but did not place the order. One row per checkout; unconverted rows are deleted after 60 days.</p></div></div>
    <div class="kpis">
      <div class="kpi"><span>Captured (30 days)</span><b>${t.captured ?? 0}</b></div>
      <div class="kpi"><span>Contacted</span><b>${t.contacted ?? 0}</b></div>
      <div class="kpi"><span>Recovered by staff</span><b>${t.recovered ?? 0}</b></div>
      <div class="kpi"><span>Recovered revenue</span><b>${taka(t.recovered_revenue_paisa)}</b></div>
      <div class="kpi"><span>Recovery rate</span><b>${report.recoveryRate}%</b></div>
    </div>
    <nav class="tabs">${STATUSES.map(([s, l]) => `<a href="#/incomplete?status=${s}${assigned ? `&assigned=${assigned}` : ''}" aria-current="${status === s}">${l}</a>`).join('')}
      <a href="#/incomplete?status=${status}&assigned=me" aria-current="${assigned === 'me'}">Mine</a><a href="#/incomplete?status=${status}&assigned=unassigned" aria-current="${assigned === 'unassigned'}">Unassigned</a></nav>
    <div class="table-wrap"><table><thead><tr><th>Customer</th><th>Cart</th><th class="right">Value</th><th>Source</th><th>Risk</th><th>Assigned</th><th></th></tr></thead><tbody>
    ${list.items.map(a => `<tr data-id="${a.id}">
      <td><b>${esc(a.name ?? 'No name yet')}</b><br><span class="small">${esc(a.phone)}</span>${a.same_phone_count ? ` <span class="badge b-yellow">${a.same_phone_count} more from this phone</span>` : ''}<br><span class="small muted">${ago(a.updated_at)}${a.address?.line ? ` · ${esc(a.address.line)}` : ''}</span></td>
      <td class="small">${a.cart.map(l => `${l.qty} × ${esc(l.name)}`).join('<br>') || '<span class="muted">Empty</span>'}</td>
      <td class="right">${taka(a.subtotal_paisa)}</td>
      <td class="small">${esc(a.source?.utm?.utm_source ?? (a.source?.landingPageId ? 'Landing page' : 'Direct'))}</td>
      <td>${badge(a.risk_level)}${(a.risk_reasons ?? []).map(r => `<br><span class="small muted">${esc(r)}</span>`).join('')}</td>
      <td>${can('orders:write') ? `<select class="i" data-assign="${a.id}" aria-label="Assigned to" style="min-width:110px"><option value="">Nobody</option>${staff.map(s => `<option value="${esc(s.id)}" ${a.assigned_to === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>` : esc(a.assignee_name ?? '—')}</td>
      <td>${a.status === 'converted' ? `${badge('converted')} ${a.converted_order_id ? `<a href="#/orders/${a.converted_order_id}">${esc(a.converted_order_no ?? 'Order')}</a>` : ''}` : `<div class="row" style="gap:6px;min-width:220px">
        ${a.phone.includes('X') ? '' : `<a class="btn btn-sm btn-outline" href="tel:${esc(a.phone)}">Call</a><a class="btn btn-sm btn-outline" href="https://wa.me/88${esc(a.phone)}" target="_blank" rel="noopener">WhatsApp</a>`}
        ${can('orders:write') ? `<a class="btn btn-sm btn-primary" href="#/manual?from=${a.id}">Convert to order</a>
        <select class="i" data-status="${a.id}" aria-label="Status">${STATUSES.filter(([s]) => s !== 'converted').map(([s, l]) => `<option value="${s}" ${a.status === s ? 'selected' : ''}>${l}</option>`).join('')}</select>` : ''}</div>`}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nothing here.</td></tr>'}
    </tbody></table></div>
    <div class="split" style="margin-top:16px">
      <div class="card"><h2>By source (30 days)</h2><table><thead><tr><th>Source</th><th class="right">Captured</th><th class="right">Recovered</th></tr></thead><tbody>${report.bySource.map(s => `<tr><td>${esc(s.source)}</td><td class="right">${s.captured}</td><td class="right">${s.recovered ?? 0}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No data yet.</td></tr>'}</tbody></table></div>
      <div class="card"><h2>By agent (30 days)</h2><table><thead><tr><th>Agent</th><th class="right">Contacted</th><th class="right">Recovered</th><th class="right">Revenue</th></tr></thead><tbody>${report.byAgent.map(s => `<tr><td>${esc(s.agent)}</td><td class="right">${s.contacted ?? 0}</td><td class="right">${s.recovered ?? 0}</td><td class="right">${taka(s.revenue_paisa)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No data yet.</td></tr>'}</tbody></table></div>
    </div>`;
  v.querySelectorAll('[data-status]').forEach(s => s.addEventListener('change', async () => {
    try { await api(`/incomplete/${s.dataset.status}/status`, 'POST', { status: s.value }); toast('Saved.'); incomplete(v); } catch (err) { toast(err.message, true); }
  }));
  v.querySelectorAll('[data-assign]').forEach(s => s.addEventListener('change', async () => {
    try { await api(`/incomplete/${s.dataset.assign}/assign`, 'POST', { adminId: s.value || null }); toast('Assigned.'); } catch (err) { toast(err.message, true); }
  }));
}

// ───────────── Manual / social order (Section 12.1) ─────────────

let GEO = null;
async function geo() {
  if (GEO) return GEO;
  const { version } = await (await fetch('/api/geo/version')).json();
  const [h, postcodes] = await Promise.all([fetch(`/api/geo/${version}/hierarchy.json`).then(r => r.json()), fetch(`/api/geo/${version}/postcodes.json`).then(r => r.json())]);
  GEO = { ...h, postcodes };
  return GEO;
}

export async function manual(v) {
  const p = qs();
  const fromId = Number(p.get('from')) || null;
  const [g, m, pre] = await Promise.all([geo(), api('/orders/meta'), fromId ? api(`/incomplete/${fromId}`).catch(() => null) : null]);
  const lines = new Map(); // variantId → { variant, qty }
  let quoteTimer;
  if (pre) for (const l of pre.cart) lines.set(l.variantId, { variant: { id: l.variantId, name: l.name, label: '', sku: l.sku, price_paisa: l.pricePaisa }, qty: l.qty });
  v.innerHTML = `
    <div class="page-head"><div><h1>New manual order</h1><p>For Facebook, Messenger, WhatsApp and phone orders. Same pipeline, invoice numbers and fraud checks as the website. The order is credited to you.</p></div></div>
    ${pre ? `<div class="notice">Converting the incomplete checkout from ${date(pre.updated_at)}. Check the details with the customer.</div>` : ''}
    <form id="mo" class="split" autocomplete="off">
      <div>
        <div class="card"><h2>1. Customer</h2>
          <div class="grid-2"><label class="f">Mobile number *<input name="phone" inputmode="numeric" placeholder="01XXXXXXXXX" value="${esc(pre?.phone ?? '')}" required></label>
            <label class="f">Name *<input name="name" value="${esc(pre?.name ?? '')}" required></label></div>
          <div id="lookup" class="small muted">Enter the number to see the customer's history.</div>
          <details style="margin-top:10px"><summary class="small">Paste chat: find phone numbers in a Messenger/WhatsApp conversation</summary>
            <textarea class="i" id="chat" rows="4" placeholder="Paste the conversation here" style="margin-top:8px;width:100%"></textarea>
            <button class="btn btn-sm btn-outline" type="button" id="find" style="margin-top:6px">Find phone numbers</button><div id="found" class="row" style="margin-top:6px"></div></details>
        </div>
        <div class="card"><h2>2. Where did the order come from? *</h2>
          <div class="grid-2"><label class="f">Channel<select name="source" required><option value="">Choose…</option>${m.manualSources.map(s => `<option value="${s}">${esc(m.sources[s])}</option>`).join('')}</select></label>
            <label class="f">Detail (optional)<input name="sourceDetail" placeholder="e.g. post link, ad name"></label></div></div>
        <div class="card"><h2>3. Products</h2>
          <input class="i" id="psearch" placeholder="Search by name, SKU or scan a barcode" style="width:100%"><div id="presults" class="search-results"></div>
          <div class="table-wrap"><table><thead><tr><th>Item</th><th class="right">Price</th><th>Qty</th><th></th></tr></thead><tbody id="lines"></tbody></table></div></div>
        <div class="card"><h2>4. Address</h2>
          <div class="grid-2"><label class="f">Postcode<input name="postcode" inputmode="numeric" maxlength="4" value="${esc(pre?.address?.postcode ?? '')}"></label><span class="small muted" id="pc-msg"></span>
            <label class="f">Division *<select name="divisionId" required><option value="">Select</option>${g.divisions.map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join('')}</select></label>
            <label class="f">District *<select name="districtId" required><option value="">Select</option></select></label>
            <label class="f">Area (upazila / thana) *<select name="upazilaId" required><option value="">Select</option></select></label>
            <label class="f">House, road, village *<input name="addressLine" value="${esc(pre?.address?.line ?? '')}" required></label>
            <label class="f">Landmark<input name="landmark" value="${esc(pre?.address?.landmark ?? '')}"></label></div>
          <div id="prev" class="row" style="margin-top:6px"></div></div>
      </div>
      <div>
        <div class="card"><h2>Payment & total</h2>
          <label class="f">Payment<select name="paymentMethod"><option value="cod">Cash on Delivery</option><option value="manual_mobile">bKash / Nagad / Rocket advance</option></select></label>
          <div class="grid-2"><label class="f">Advance TrxID<input name="advanceTrxId"></label><label class="f">Wallet<input name="advanceWallet" placeholder="bKash"></label></div>
          <label class="f">Discount ৳<input name="discount" inputmode="decimal" placeholder="0"></label>
          <label class="f">Note for the order<input name="note"></label>
          <div id="quote" class="small" style="margin:10px 0"></div>
          <button class="btn btn-primary" id="place" style="width:100%">Create order</button></div>
      </div>
    </form>`;
  const f = v.querySelector('#mo');
  const $ = s => v.querySelector(s);
  const fill = (sel, rows) => { const cur = sel.value; sel.innerHTML = `<option value="">Select</option>${rows.map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join('')}`; if (rows.some(([id]) => String(id) === cur)) sel.value = cur; };
  const setArea = (div, dist, up) => {
    f.divisionId.value = String(div ?? '');
    fill(f.districtId, g.districts.filter(d => d[1] === Number(f.divisionId.value)).map(d => [d[0], d[2]]));
    f.districtId.value = String(dist ?? '');
    fill(f.upazilaId, g.upazilas.filter(u => u[1] === Number(f.districtId.value)).map(u => [u[0], u[2]]));
    f.upazilaId.value = String(up ?? '');
    quoteSoon();
  };
  f.divisionId.addEventListener('change', () => setArea(f.divisionId.value, null, null));
  f.districtId.addEventListener('change', () => setArea(f.divisionId.value, f.districtId.value, null));
  f.upazilaId.addEventListener('change', quoteSoon);
  f.postcode.addEventListener('input', () => {
    const hits = g.postcodes[f.postcode.value] ?? [];
    $('#pc-msg').textContent = f.postcode.value.length === 4 ? (hits.length ? hits.map(h => h[0]).join(', ') : 'Postcode not found: choose the area below.') : '';
    if (hits[0]) setArea(hits[0][1], hits[0][2], hits[0][3]);
  });
  if (pre?.address?.districtId) setArea(pre.address.divisionId, pre.address.districtId, pre.address.upazilaId);

  async function lookup() {
    const box = $('#lookup');
    if (!/^(\+?88)?01[3-9]\d{8}$/.test(f.phone.value.replace(/[\s-]/g, ''))) { box.textContent = 'Enter the number to see the customer’s history.'; return; }
    try {
      const r = await api(`/customers/lookup?phone=${encodeURIComponent(f.phone.value)}`);
      box.innerHTML = `${badge(r.risk.level)} ${r.risk.reasons.map(esc).join(' · ')}${r.incompleteCount ? ` · ${r.incompleteCount} unfinished checkout(s)` : ''}
        ${r.orders.length ? `<br>Recent: ${r.orders.map(o => `<a href="#/orders/${o.id}">${esc(o.order_no)}</a> ${badge(o.status)}`).join(' ')}` : ''}`;
      if (r.customer?.name && !f.name.value) f.name.value = r.customer.name;
      $('#prev').innerHTML = r.addresses.map((a, i) => `<button class="btn btn-sm btn-outline" type="button" data-prev="${i}">Use: ${esc(a.address_line)}, ${esc(a.upazila_name)}</button>`).join('');
      $('#prev').querySelectorAll('[data-prev]').forEach(b => b.addEventListener('click', () => {
        const a = r.addresses[Number(b.dataset.prev)];
        setArea(a.division_id, a.district_id, a.upazila_id);
        f.addressLine.value = a.address_line; f.landmark.value = a.landmark ?? ''; f.postcode.value = a.postcode ?? '';
      }));
    } catch (err) { box.textContent = err.message; }
  }
  f.phone.addEventListener('change', lookup);
  if (pre) lookup();

  $('#find').addEventListener('click', async () => {
    const r = await api('/tools/extract-phones', 'POST', { text: $('#chat').value });
    $('#found').innerHTML = r.phones.length ? r.phones.map(ph => `<button class="btn btn-sm btn-outline" type="button" data-ph="${esc(ph)}">${esc(ph)}</button>`).join('') : '<span class="small muted">No Bangladeshi mobile numbers found.</span>';
    $('#found').querySelectorAll('[data-ph]').forEach(b => b.addEventListener('click', () => { f.phone.value = b.dataset.ph; lookup(); quoteSoon(); }));
  });

  let searchTimer;
  $('#psearch').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(search, 250); });
  // USB/Bluetooth barcode scanners type the code and press Enter.
  $('#psearch').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); search(true); } });
  async function search(addExact = false) {
    const q = $('#psearch').value.trim();
    if (q.length < 2) { $('#presults').innerHTML = ''; return; }
    const rows = await api(`/variants/search?q=${encodeURIComponent(q)}`);
    const exact = rows.find(r => r.sku === q.toUpperCase() || r.gtin === q);
    if (addExact && exact) { add(exact); $('#psearch').value = ''; $('#presults').innerHTML = ''; return; }
    $('#presults').innerHTML = rows.map((r, i) => `<button type="button" class="result" data-i="${i}"><b>${esc(r.name)}</b> ${esc(r.label)} · ${taka(r.price_paisa)} · <span class="${r.available > 0 || r.fulfilment_mode === 'made_to_order' ? '' : 'muted'}">${r.available} available</span><br><span class="small muted">${esc(r.sku)}</span></button>`).join('') || '<p class="small muted">No products match.</p>';
    $('#presults').querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', () => { add(rows[Number(b.dataset.i)]); $('#presults').innerHTML = ''; $('#psearch').value = ''; }));
  }
  function add(variant) {
    const cur = lines.get(variant.id);
    lines.set(variant.id, { variant, qty: (cur?.qty ?? 0) + 1 });
    renderLines();
  }
  function renderLines() {
    $('#lines').innerHTML = [...lines.values()].map(({ variant: x, qty }) => `<tr><td>${esc(x.name)} ${esc(x.label ?? '')}<br><span class="small muted">${esc(x.sku)}</span></td><td class="right">${taka(x.price_paisa)}</td>
      <td><input type="number" min="1" max="99" value="${qty}" data-qty="${x.id}" style="width:64px"></td><td><button class="btn btn-sm btn-ghost" type="button" data-rm="${x.id}">Remove</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted small">No products yet.</td></tr>';
    $('#lines').querySelectorAll('[data-qty]').forEach(i => i.addEventListener('change', () => { lines.get(Number(i.dataset.qty)).qty = Math.max(1, Number(i.value) || 1); quoteSoon(); }));
    $('#lines').querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { lines.delete(Number(b.dataset.rm)); renderLines(); }));
    quoteSoon();
  }
  renderLines();

  const body = () => ({
    phone: f.phone.value, name: f.name.value, source: f.source.value, sourceDetail: f.sourceDetail.value,
    divisionId: Number(f.divisionId.value), districtId: Number(f.districtId.value), upazilaId: Number(f.upazilaId.value), postcode: f.postcode.value || null,
    addressLine: f.addressLine.value, landmark: f.landmark.value, note: f.note.value, paymentMethod: f.paymentMethod.value,
    advanceTrxId: f.advanceTrxId.value || null, advanceWallet: f.advanceWallet.value || null, discountPaisa: toPaisa(f.discount.value) ?? 0,
    lines: [...lines.values()].map(l => ({ variantId: l.variant.id, qty: l.qty })), fromIncompleteId: fromId,
  });
  function quoteSoon() { clearTimeout(quoteTimer); quoteTimer = setTimeout(doQuote, 300); }
  async function doQuote() {
    const b = body();
    if (!b.lines.length) { $('#quote').textContent = ''; return; }
    try {
      const q = await api('/orders/quote', 'POST', b);
      $('#quote').innerHTML = `Subtotal ${taka(q.subtotalPaisa)}${q.discountPaisa ? ` · discount −${taka(q.discountPaisa)}` : ''} · delivery ${q.delivery ? (q.delivery.chargePaisa === null ? 'to confirm' : taka(q.delivery.chargePaisa)) : '—'}
        <br><b>Total ${q.totalPaisa === null ? 'after delivery charge' : taka(q.totalPaisa)}</b>${q.advance.required ? `<br><span class="badge b-yellow">advance ${taka(q.advance.amountPaisa)}</span> ${q.advance.reasons.map(esc).join(' ')}` : ''}${q.problems.length ? `<br><span class="err">${q.problems.map(esc).join(' ')}</span>` : ''}`;
    } catch (err) { $('#quote').textContent = err.message; }
  }
  [f.paymentMethod, f.discount].forEach(x => x.addEventListener('change', quoteSoon));

  busy($('#place'), async () => {
    if (!f.reportValidity()) return;
    const r = await api('/orders/manual', 'POST', body());
    toast(`Order ${r.orderNo} created${r.held ? ' and put on hold for review' : ''}.`);
    location.hash = `#/orders/${r.orderId}`;
  });
}

// ───────────── Returns scan (Section 9.1, stage 8) ─────────────

export async function returns(v) {
  v.innerHTML = `
    <div class="page-head"><div><h1>Returns scan</h1><p>Scan the invoice or tracking barcode on a returned parcel (or type the order number). Stock comes back only when a parcel is scanned here.</p></div></div>
    <div class="card" style="max-width:560px"><form id="scan" class="row"><input class="i" name="code" placeholder="Scan or type INV-…, AV-… or tracking code" autofocus style="flex:1"><button class="btn btn-primary">Receive</button></form>
      <ul class="attention" id="log" style="margin-top:12px"></ul></div>`;
  const form = v.querySelector('#scan');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const code = form.code.value.trim();
    if (!code) return;
    form.code.value = '';
    const li = document.createElement('li');
    try {
      const r = await api('/returns/scan', 'POST', { code });
      li.innerHTML = `<a href="#/orders/${r.orderId}"><span class="dot ok"></span>${esc(r.message)}</a>`;
    } catch (err) {
      li.innerHTML = `<span><span class="dot alert"></span>${esc(code)}: ${esc(err.message)}</span>`;
    }
    v.querySelector('#log').prepend(li);
    form.code.focus();
  });
}

