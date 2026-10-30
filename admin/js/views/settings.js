import { api, badge, busy, can, date, esc, fromPaisa, qs, slideOver, state, toast, toPaisa } from '../app.js';

export async function settings(v) {
  const s = await api('/settings');
  const write = state.user.role === 'super_admin';
  const wallets = JSON.parse(s.manual_wallets || '[]');
  v.innerHTML = `<div class="page-head"><div><h1>Settings</h1><p>${write ? 'Only Super Admins can change these.' : 'Read only. Ask a Super Admin to change settings.'}</p></div></div>
    <form id="f">
      <div class="card"><h2>Store</h2><div class="grid-2">
        <label class="f">Store name<input name="store_name" value="${esc(s.store_name)}"></label><label class="f">Tagline<input name="tagline" value="${esc(s.tagline)}"></label>
        <label class="f">Company (on invoices)<input name="company_name" value="${esc(s.company_name)}"></label><label class="f">Company address (on invoices)<input name="company_address" value="${esc(s.company_address)}"></label></div>
        <label class="f">Announcement bar<input name="announcement" value="${esc(s.announcement)}"></label></div>
      <div class="card"><h2>Delivery & payments</h2><div class="grid-2">
        <label class="f">Free delivery over (৳) <span class="help">0 turns it off.</span><input name="free_delivery_threshold_paisa" data-money value="${esc(fromPaisa(s.free_delivery_threshold_paisa))}"></label>
        <label class="check"><input type="checkbox" name="free_delivery_excludes_bulky" ${s.free_delivery_excludes_bulky !== '0' ? 'checked' : ''}> Free-delivery threshold does not cover large items</label>
        <label class="f">COD fee (৳) <span class="help">Shown as its own line. 0 = none.</span><input name="cod_fee_paisa" data-money value="${esc(fromPaisa(s.cod_fee_paisa))}"></label>
        <label class="f">Advance for new customers over (৳)<input name="advance_high_value_threshold_paisa" data-money value="${esc(fromPaisa(s.advance_high_value_threshold_paisa))}"></label></div>
        <h3>bKash / Nagad / Rocket numbers for advances</h3><div id="wallets">${[...wallets, {}, {}].slice(0, 4).map(w => `<div class="grid-3 wallet"><input class="i" placeholder="Wallet (bKash)" value="${esc(w.wallet ?? '')}"><input class="i" placeholder="Number" value="${esc(w.number ?? '')}"><input class="i" placeholder="Merchant / Personal" value="${esc(w.type ?? '')}"></div>`).join('')}</div></div>
      <div class="card"><h2>Contact & chat</h2><div class="grid-3"><label class="f">Support phone<input name="support_phone" value="${esc(s.support_phone)}"></label><label class="f">WhatsApp number <span class="help">With country code, e.g. 88017…</span><input name="whatsapp_number" value="${esc(s.whatsapp_number)}"></label><label class="f">Facebook page username<input name="messenger_page" value="${esc(s.messenger_page)}"></label></div></div>
      <div class="card"><h2>Map on the checkout page</h2><p class="small muted">Leave empty to show only the district outline (no third-party tiles). OpenStreetMap’s own servers are not for commercial use; use a provider like MapTiler or Stadia with your key.</p>
        <div class="grid-2"><label class="f">Tile URL<input name="map_tile_url" value="${esc(s.map_tile_url)}" placeholder="https://…/{z}/{x}/{y}.png?key=…"></label><label class="f">Attribution<input name="map_tile_attribution" value="${esc(s.map_tile_attribution)}"></label></div></div>
      <div class="card"><h2>Tracking (Phase 2)</h2><div class="grid-2"><label class="f">Meta Pixel ID<input name="pixel_id" value="${esc(s.pixel_id)}"></label><label class="f">GA4 ID<input name="ga4_id" value="${esc(s.ga4_id)}"></label></div><p class="small muted">Saved now; the Pixel + Conversions API (with a shared event_id, Purchase only on confirmed orders) is part of Phase 2.</p></div>
      <div class="card"><h2>Homepage banners (when no season is live)</h2><label class="f">Default banners (JSON)<textarea name="default_banners" rows="6">${esc(s.default_banners)}</textarea></label><label class="f">Second promo banner (JSON)<textarea name="promo_banner" rows="4">${esc(s.promo_banner)}</textarea></label></div>
    </form>
    ${write ? '<button class="btn btn-primary" id="save">Save settings</button>' : ''}`;
  if (!write) { v.querySelectorAll('input,textarea').forEach(i => { i.disabled = true; }); return; }
  busy(v.querySelector('#save'), async () => {
    const f = v.querySelector('#f');
    const body = {};
    f.querySelectorAll('[name]').forEach(i => { body[i.name] = i.type === 'checkbox' ? (i.checked ? '1' : '0') : i.dataset.money !== undefined ? String(toPaisa(i.value || '0') ?? 0) : i.value; });
    body.manual_wallets = JSON.stringify([...f.querySelectorAll('.wallet')].map(w => { const [a, b, c] = w.querySelectorAll('input'); return { wallet: a.value.trim(), number: b.value.trim(), type: c.value.trim() }; }).filter(w => w.wallet && w.number));
    await api('/settings', 'PUT', body);
    toast('Settings saved.');
  });
}

export async function staff(v) {
  if (state.user.role !== 'super_admin') { v.innerHTML = '<div class="notice">Only Super Admins can manage staff.</div>'; return; }
  const rows = await api('/staff');
  const ROLES = { super_admin: 'Super Admin: everything', manager: 'Manager: catalog, seasons, orders, geo', order_processor: 'Order Processor: orders and customers', viewer: 'Viewer: read only' };
  v.innerHTML = `<div class="page-head"><div><h1>Staff & Roles</h1><p>Roles are checked on the server for every action.</p></div><button class="btn btn-primary" id="new">+ Add staff</button></div>
    <div class="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Last sign-in</th><th>Active</th></tr></thead><tbody>
    ${rows.map(a => `<tr><td><b>${esc(a.name)}</b><br><span class="small muted">${esc(a.email)}</span></td><td><select class="i" data-role="${a.id}">${Object.entries(ROLES).map(([k, l]) => `<option value="${k}" ${k === a.role ? 'selected' : ''}>${l}</option>`).join('')}</select></td><td>${date(a.last_login_at)}</td><td><input type="checkbox" data-active="${a.id}" ${a.is_active ? 'checked' : ''}></td></tr>`).join('')}</tbody></table></div>`;
  v.querySelectorAll('[data-role]').forEach(s => s.addEventListener('change', async () => { try { await api(`/staff/${s.dataset.role}`, 'PUT', { role: s.value }); toast('Role changed.'); } catch (e) { toast(e.message, true); staff(v); } }));
  v.querySelectorAll('[data-active]').forEach(c => c.addEventListener('change', async () => { try { await api(`/staff/${c.dataset.active}`, 'PUT', { isActive: c.checked }); toast('Saved.'); } catch (e) { toast(e.message, true); staff(v); } }));
  v.querySelector('#new').addEventListener('click', () => {
    const so = slideOver('Add staff');
    so.body.innerHTML = `<label class="f">Name<input id="n"></label><label class="f">Email<input id="e" type="email"></label><label class="f">Role<select id="r">${Object.entries(ROLES).map(([k, l]) => `<option value="${k}" ${k === 'order_processor' ? 'selected' : ''}>${l}</option>`).join('')}</select></label><label class="f">Temporary password <span class="help">10+ characters with a number. Share it privately.</span><input id="p" type="text" autocomplete="off"></label>`;
    so.foot.innerHTML = '<span></span><button class="btn btn-primary" id="s">Add</button>';
    busy(so.foot.querySelector('#s'), async () => { const g = id => so.body.querySelector(`#${id}`).value; await api('/staff', 'POST', { name: g('n'), email: g('e'), role: g('r'), password: g('p') }); so.close(); staff(v); });
  });
}

export function soon(v) {
  const m = qs().get('m') ?? 'This module';
  v.innerHTML = `<div class="card"><h1>${esc(m)}</h1><p>${esc(m)} is planned for a later phase of the build. Its database tables already exist, so it can be switched on without moving any data.</p><p><a href="#/help">See the phased roadmap in the help center</a></p></div>`;
}

export function help(v) {
  v.innerHTML = `<div class="page-head"><div><h1>Help Center</h1><p>Short guides for the team. The full owner guide is in the repository under docs/.</p></div></div>
    <div class="card"><h2>Add a product</h2><ol><li>Products → <b>+ Add product</b>. Pick the category first: it decides the form.</li><li>Fill the basics, then the details (fields marked * are needed to publish).</li><li>In <b>Options & prices</b>, tap the choices you sell (e.g. 500g, 1kg), press <b>Update option rows</b>, and enter price, stock and the <b>packed weight for delivery</b> for each.</li><li>Add photos (your own or your supplier’s with permission).</li><li>Step 9 shows what is missing. Publish, or schedule it for the season start.</li></ol></div>
    <div class="card"><h2>Start a season</h2><ol><li>Seasons → open the season → set this year’s start and end dates (Ramadan and Eid change every year).</li><li>Add banners. Tick the season on each product (step 6) and on seasonal categories.</li><li>On the start date the homepage, the “In Season Now” rail and the menu switch by themselves, and “Notify me” customers get an SMS.</li></ol></div>
    <div class="card"><h2>Confirm a Cash on Delivery order</h2><ol><li>If the customer entered the SMS code, you can confirm right away.</li><li>Otherwise call them, then <b>Log call</b> with the outcome “Confirmed”.</li><li>Confirming creates the invoice number (INV-…) and texts the customer.</li><li>Pre-orders and large items need the advance marked as received first.</li></ol></div>
    <div class="card"><h2>Fix a postcode</h2><p>Postcodes & Geo → <b>unmatched</b>. Pick the district, tick the postcodes of one area (for example the Dhaka city thanas), choose the area and press <b>Assign</b>.</p></div>
    <div class="card"><h2>What is coming next</h2><p><b>Phase 2:</b> bKash/Nagad/Rocket/SSLCommerz gateways, courier booking and tracking, courier fraud check, Meta Pixel + Conversions API, landing pages with order forms, coupons and reviews.<br><b>Phase 3:</b> Business Starter Kits, Recipes & Business Ideas, AI chat, season planning report, offline app.</p></div>`;
}
