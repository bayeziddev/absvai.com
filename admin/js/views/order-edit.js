// Order screen extras: the WhatsApp message drafts (Bangla, written by the server from the order) and the edit form.
import { api, busy, can, esc, fromPaisa, slideOver, taka, toast, toPaisa } from '../app.js';

// ── WhatsApp: choose a message, check it, open WhatsApp with it written ──
export function waCardHtml(d) {
  const w = d.whatsapp;
  if (!w?.drafts.length) return '';
  const first = w.drafts.find(x => x.suggested) ?? w.drafts[0];
  return `<div class="card wa-card"><h2><span class="wa-dot" aria-hidden="true"></span>WhatsApp message</h2>
    <p class="small muted">Choose a message, check it (change anything you like), then tap <b>Open WhatsApp</b>. The chat with the customer opens with the message written. Nothing is sent until you press send in WhatsApp. Words between *stars* show in bold there.</p>
    <div class="chips" role="group" aria-label="Message">${w.drafts.map(x => `<button type="button" class="chip" data-wa="${esc(x.kind)}" aria-pressed="${x === first}">${esc(x.label)}</button>`).join('')}</div>
    <textarea class="i wa-text" id="wa-text" rows="13" lang="bn" aria-label="WhatsApp message">${esc(first.text)}</textarea>
    <div class="row"><a class="btn btn-wa" id="wa-send" href="https://wa.me/${esc(w.number)}" target="_blank" rel="noopener">Open WhatsApp</a><button type="button" class="btn btn-outline btn-sm" id="wa-copy">Copy</button></div>
    ${d.order.status === 'new' && can('orders:write') ? '<button type="button" class="btn btn-ghost btn-sm wa-yes" id="wa-yes">✓ The customer said “yes” on WhatsApp</button>' : ''}
  </div>`;
}

export function bindWaCard(root, d, id, after) {
  const w = d.whatsapp;
  const text = root.querySelector('#wa-text');
  if (!w || !text) return;
  let kind = (w.drafts.find(x => x.suggested) ?? w.drafts[0]).kind;
  root.querySelectorAll('[data-wa]').forEach(b => b.addEventListener('click', () => {
    kind = b.dataset.wa;
    root.querySelectorAll('[data-wa]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    text.value = w.drafts.find(x => x.kind === kind).text;
  }));
  const send = root.querySelector('#wa-send');
  send.addEventListener('click', () => {
    send.href = `https://wa.me/${w.number}?text=${encodeURIComponent(text.value.trim())}`;
    // Noted in the order's history, so the team can see the customer was messaged.
    api(`/orders/${id}/whatsapp`, 'POST', { kind }).catch(() => {});
  });
  root.querySelector('#wa-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(text.value); toast('Copied.'); } catch { text.select(); toast('Select the text and copy it.', true); }
  });
  const yes = root.querySelector('#wa-yes');
  if (yes) busy(yes, async () => {
    await api(`/orders/${id}/call`, 'POST', { outcome: 'confirmed', note: 'Customer confirmed on WhatsApp' });
    await after('Noted: the customer confirmed on WhatsApp. You can move the order to Confirmed now.');
  });
}

// ── Edit an order: customer, address, area and charge, discount, items ──
export function editOrderForm(d, { onSaved }) {
  const o = d.order;
  const e = d.edit;
  const masked = o.phone.includes('X');
  const lines = d.items.map(i => ({ itemId: i.id, variantId: i.variant_id, name: i.name, label: i.variant_label ?? '', sku: i.sku, qty: i.qty, unit: i.unit_price_paisa }));
  const so = slideOver(`Edit order ${o.order_no}`, { wide: true });
  so.body.innerHTML = `
    ${e.holdsStock ? `<div class="notice">This order already holds stock. Changing the items updates the stock it holds.${o.status === 'packed' ? ' It is packed: repack the parcel after saving.' : ''}</div>` : ''}
    <form id="ef" novalidate>
      <div class="card"><h2>Customer</h2>
        <div class="grid-2"><label class="f">Name<input name="name" value="${esc(o.customer_name)}" maxlength="120" required></label>
          <label class="f">Mobile${masked ? ' <span class="small muted">(assign the order to yourself to change it)</span>' : ''}<input name="phone" inputmode="tel" value="${esc(o.phone)}" ${masked ? 'disabled' : ''}></label></div>
        <label class="f">Full address<textarea name="addressLine" rows="2" maxlength="300">${esc(o.address_line)}</textarea></label>
        <label class="f">Customer’s note<input name="note" value="${esc(o.customer_note ?? '')}" maxlength="500" placeholder="Optional"></label>
      </div>
      <div class="card"><h2>Items</h2>
        <div class="table-wrap"><table class="edit-items"><thead><tr><th>Item</th><th class="right">Qty</th><th class="right">Price ৳</th><th class="right">Total</th><th><span class="sr-only">Remove</span></th></tr></thead><tbody id="el"></tbody></table></div>
        <label class="f" style="margin-top:10px">Add a product<input id="es" placeholder="Type its name or SKU" autocomplete="off"></label><div id="er" class="search-results"></div>
      </div>
      <div class="card"><h2>Delivery and money</h2>
        <div class="grid-2"><label class="f">Delivery area<select name="zoneId" id="ez">${e.areas.map(a => `<option value="${a.id}" ${a.id === o.delivery_zone_id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}${o.delivery_zone_id ? '' : '<option value="" selected>Not set</option>'}</select></label>
          <label class="f">Delivery charge ৳<input name="charge" id="ec" inputmode="decimal" value="${o.delivery_charge_paisa === null ? '' : fromPaisa(o.delivery_charge_paisa)}" placeholder="e.g. 70"></label></div>
        <label class="check"><input type="checkbox" id="efree" ${o.delivery_charge_paisa === 0 ? 'checked' : ''}> Free delivery (৳0)</label>
        <p class="small muted" id="ehint"></p>
        <label class="f" style="max-width:240px">Discount ৳<input name="discount" id="ed" inputmode="decimal" value="${fromPaisa(o.discount_paisa)}" placeholder="0"></label>
        ${e.canPrice ? '' : `<p class="small muted">You can give up to ${e.maxDiscountPercent}% off. A manager can change prices.</p>`}
        <dl class="kv" id="esum" style="margin-top:12px"></dl>
      </div>
    </form>`;
  so.foot.innerHTML = '<button class="btn btn-ghost" type="button" id="ex">Cancel</button><button class="btn btn-primary" type="button" id="esave">Save changes</button>';
  const $ = s => so.body.querySelector(s);
  const f = $('#ef');

  const charge = () => ($('#efree').checked ? 0 : toPaisa($('#ec').value));
  function summary() {
    const sub = lines.reduce((s, l) => s + l.unit * l.qty, 0);
    const ch = charge();
    const disc = toPaisa($('#ed').value) ?? 0;
    const total = sub + (ch ?? 0) + (o.cod_fee_paisa ?? 0) - disc;
    $('#esum').innerHTML = `<dt>Subtotal</dt><dd>${taka(sub)}</dd><dt>Delivery</dt><dd>${ch === null ? 'to confirm' : ch === 0 ? 'Free' : taka(ch)}</dd>${disc ? `<dt>Discount</dt><dd>−${taka(disc)}</dd>` : ''}${o.cod_fee_paisa ? `<dt>COD fee</dt><dd>${taka(o.cod_fee_paisa)}</dd>` : ''}<dt>New total</dt><dd><b>${taka(Math.max(0, total))}</b>${total !== o.total_paisa ? ` <span class="small muted">(was ${taka(o.total_paisa)})</span>` : ''}</dd>`;
  }
  function render() {
    $('#el').innerHTML = lines.map((l, i) => `<tr><td>${esc(l.name)}${l.label ? `<br><span class="small muted">${esc(l.label)}</span>` : ''}${l.itemId ? '' : ' <span class="badge b-green">new</span>'}</td>
      <td class="right"><input class="i qty-in" type="number" min="1" max="${e.maxQty}" value="${l.qty}" data-q="${i}" aria-label="Quantity of ${esc(l.name)}"></td>
      <td class="right"><input class="i price-in" inputmode="decimal" value="${fromPaisa(l.unit)}" data-p="${i}" ${e.canPrice ? '' : 'readonly'} aria-label="Price of ${esc(l.name)}"></td>
      <td class="right" data-t="${i}">${taka(l.unit * l.qty)}</td>
      <td><button type="button" class="btn btn-sm btn-ghost" data-rm="${i}" aria-label="Remove ${esc(l.name)}" ${lines.length === 1 ? 'disabled title="An order needs at least one item"' : ''}>✕</button></td></tr>`).join('');
    // Typing a quantity or price updates that row and the totals in place (re-drawing the table under a field that is
    // still being typed in would lose it).
    const row = i => { $(`[data-t="${i}"]`).textContent = taka(lines[i].unit * lines[i].qty); summary(); };
    $('#el').querySelectorAll('[data-q]').forEach(x => {
      const i = Number(x.dataset.q);
      x.addEventListener('input', () => { const q = Math.round(Number(x.value)); if (q >= 1 && q <= e.maxQty) { lines[i].qty = q; row(i); } });
      x.addEventListener('change', () => { lines[i].qty = Math.max(1, Math.min(e.maxQty, Math.round(Number(x.value) || lines[i].qty))); x.value = String(lines[i].qty); row(i); });
    });
    $('#el').querySelectorAll('[data-p]').forEach(x => {
      const i = Number(x.dataset.p);
      x.addEventListener('input', () => { const p = toPaisa(x.value); if (p !== null && p >= 0) { lines[i].unit = p; row(i); } });
      x.addEventListener('change', () => { x.value = fromPaisa(lines[i].unit); });
    });
    $('#el').querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { lines.splice(Number(b.dataset.rm), 1); render(); }));
    summary();
  }

  // The chosen area's own charge for these items, filled in when the area changes (it can still be typed over).
  async function areaCharge(fill) {
    const zoneId = Number($('#ez').value) || null;
    if (!zoneId) return;
    try {
      const q = await api('/orders/quote', 'POST', { lines: lines.map(l => ({ variantId: l.variantId, qty: l.qty })), zoneId, paymentMethod: o.payment_method });
      const c = q.delivery?.chargePaisa;
      $('#ehint').textContent = c === null || c === undefined ? 'This area’s charge for these items is set by phone.' : `This area’s charge for these items: ${c === 0 ? 'free' : taka(c)}.`;
      if (fill && c !== null && c !== undefined) { $('#efree').checked = c === 0; $('#ec').value = fromPaisa(c); summary(); }
    } catch { /* the typed charge stays */ }
  }
  $('#ez').addEventListener('change', () => areaCharge(true));
  $('#efree').addEventListener('change', () => { if ($('#efree').checked) $('#ec').value = '0'; summary(); });
  $('#ec').addEventListener('input', () => { $('#efree').checked = toPaisa($('#ec').value) === 0; summary(); });
  $('#ed').addEventListener('input', summary);

  let timer;
  $('#es').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = $('#es').value.trim();
      if (q.length < 2) { $('#er').innerHTML = ''; return; }
      const rows = await api(`/variants/search?q=${encodeURIComponent(q)}`).catch(() => []);
      $('#er').innerHTML = rows.map((r, i) => `<button type="button" class="result" data-i="${i}"><b>${esc(r.name)}</b> ${esc(r.label)} · ${taka(r.price_paisa)} · <span class="${r.available > 0 || r.fulfilment_mode === 'made_to_order' ? '' : 'muted'}">${r.available} available</span><br><span class="small muted">${esc(r.sku)}</span></button>`).join('') || '<p class="small muted">No products match.</p>';
      $('#er').querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', () => {
        const r = rows[Number(b.dataset.i)];
        const same = lines.find(l => l.variantId === r.id);
        if (same) same.qty = Math.min(e.maxQty, same.qty + 1);
        else lines.push({ itemId: null, variantId: r.id, name: r.name, label: r.label, sku: r.sku, qty: 1, unit: r.price_paisa });
        $('#er').innerHTML = '';
        $('#es').value = '';
        render();
      }));
    }, 250);
  });

  so.foot.querySelector('#ex').addEventListener('click', () => so.close());
  busy(so.foot.querySelector('#esave'), async () => {
    if (!lines.length) throw new Error('An order needs at least one item. To drop the whole order, cancel it instead.');
    const r = await api(`/orders/${o.id}`, 'PUT', {
      name: f.name.value, ...(masked ? {} : { phone: f.phone.value }), addressLine: f.addressLine.value, note: f.note.value,
      zoneId: Number($('#ez').value) || null, deliveryChargePaisa: charge(), discountPaisa: toPaisa($('#ed').value) ?? 0,
      items: lines.map(l => ({ itemId: l.itemId, variantId: l.variantId, qty: l.qty, unitPaisa: l.itemId || e.canPrice ? l.unit : null })),
    });
    so.close();
    toast(r.changed.length ? `Saved: ${r.changed.length} change${r.changed.length === 1 ? '' : 's'}. New total ${taka(r.totalPaisa)}.` : 'Nothing changed.');
    await onSaved?.();
  });
  render();
  areaCharge(false);
}
