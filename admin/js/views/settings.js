import { api, badge, busy, can, confirmBox, date, esc, fromPaisa, qs, slideOver, state, toast, toPaisa } from '../app.js';
import { bannerEditor, linkOptions } from './banners.js';

const SOCIAL = [['facebook', 'Facebook page', 'https://www.facebook.com/absvai'], ['instagram', 'Instagram', 'https://www.instagram.com/absvai'], ['youtube', 'YouTube', 'https://www.youtube.com/@absvai'], ['tiktok', 'TikTok', 'https://www.tiktok.com/@absvai']];
const parse = (raw, fallback) => { try { return JSON.parse(raw || '') ?? fallback; } catch { return fallback; } };

const GROUPS = [
  ['store', 'Store', 'Your store name, contact numbers and social media links.'],
  ['branding', 'Branding', 'Your own logo and colours. Every page refreshes at the edge when you save.'],
  ['banners', 'Homepage banners', 'The big pictures at the top of the homepage (when no season is live), and one more banner further down. Seasons have their own banners in Seasons.'],
  ['delivery', 'Delivery', 'Free-delivery threshold, the Cash on Delivery fee and the checkout map.'],
  ['payments', 'Payments', 'Wallet numbers customers send advances to.'],
  ['tracking', 'Tracking', 'IDs only (never paste script code). Tags load only on public pages, never on checkout, cart or account pages.'],
  ['fraud', 'Fraud protection', 'Holds go to “On hold” for a human to look at; nothing is rejected automatically.'],
  ['incomplete', 'Incomplete orders & manual orders', ''],
  ['sms', 'SMS', 'The SMS provider itself is chosen in the deployment; these are the account details.'],
  ['couriers', 'Courier credentials', 'Saved encrypted for the Phase 2 courier booking. Confirm each provider’s API with them before switching it on.'],
];
const COLOR_LABELS = { chili: 'Main (buttons, prices)', turmeric: 'Accent (badges)', cream: 'Page background', leaf: 'Success / in season', clove: 'Text', husk: 'Lines and borders' };

function fieldHtml(f, value, { write, canSecrets }) {
  const dis = write ? '' : 'disabled';
  const help = f.help ? `<span class="help">${esc(f.help)}</span>` : '';
  switch (f.kind) {
    case 'secret': {
      const st = value ?? { set: false };
      const locked = !canSecrets;
      return `<label class="f">${esc(f.label)} ${st.set ? `<span class="badge b-green">saved ${esc(st.masked ?? '')}</span>` : '<span class="badge b-grey">not set</span>'}
        <input type="password" autocomplete="off" data-secret="${f.key}" placeholder="${st.set ? 'Leave empty to keep the saved value' : 'Paste the value'}" ${locked || !write ? 'disabled' : ''}>
        ${st.set && canSecrets && write ? `<span class="small"><label class="check"><input type="checkbox" data-clear="${f.key}"> Remove the saved value</label></span>` : ''}${locked ? '<span class="help">Only the Super Admin can change credentials.</span>' : ''}</label>`;
    }
    case 'bool': return `<label class="check"><input type="checkbox" name="${f.key}" data-kind="bool" ${value === '1' || value === '' && f.key === 'free_delivery_excludes_bulky' ? 'checked' : ''} ${dis}> ${esc(f.label)}</label>`;
    case 'paisa': return `<label class="f">${esc(f.label)} (৳) ${help}<input name="${f.key}" data-kind="paisa" inputmode="decimal" value="${esc(fromPaisa(value))}" ${dis}></label>`;
    case 'int': return `<label class="f">${esc(f.label)} ${help}<input name="${f.key}" data-kind="int" inputmode="numeric" value="${esc(value)}" ${dis}></label>`;
    case 'longtext': return `<label class="f">${esc(f.label)} ${help}<textarea name="${f.key}" rows="3" ${dis}>${esc(value)}</textarea></label>`;
    case 'json': return `<label class="f">${esc(f.label)} ${help}<textarea name="${f.key}" data-kind="json" rows="4" ${dis}>${esc(value)}</textarea></label>`;
    default: return `<label class="f">${esc(f.label)} ${help}<input name="${f.key}" value="${esc(value)}" ${dis}></label>`;
  }
}

export async function settings(v) {
  const d = await api('/settings');
  const write = can('settings:write');
  const ctx = { write, canSecrets: d.canEditSecrets };
  const val = d.values;
  const wallets = (() => { try { return JSON.parse(val.manual_wallets || '[]'); } catch { return []; } })();
  const colors = (() => { try { return JSON.parse(val.brand_colors || '{}'); } catch { return {}; } })();
  const DEFAULTS = { chili: '#B3261E', turmeric: '#F2B705', cream: '#FFF8EC', leaf: '#2E7D32', clove: '#2A1F1A', husk: '#E9DCC6' };
  const special = new Set(['manual_wallets', 'brand_colors', 'brand_logo_url', 'social_links', 'default_banners', 'promo_banner']);
  const social = parse(val.social_links, {});
  const group = g => d.fields.filter(f => f.group === g && !special.has(f.key));
  // Everyday groups first; tracking, fraud, SMS and courier settings live in one closed "Advanced" section.
  const ADVANCED = new Set(['tracking', 'fraud', 'incomplete', 'sms', 'couriers']);
  const card = ([g, title, intro]) => `<div class="card"><h2>${esc(title)}</h2>${intro ? `<p class="small muted">${esc(intro)}</p>` : ''}`;
  v.innerHTML = `<div class="page-head"><div><h1>Settings</h1><p>${write ? 'Your shop’s details, banners and delivery charges. Change what you need, then press <b>Save</b> at the bottom of the screen.' : 'Read only. Ask a Manager or the Super Admin to change settings.'}</p></div>
      ${write ? '<button class="btn btn-outline" id="purge">Refresh every page now</button>' : ''}</div>
    <form id="f">${GROUPS.map(([g, title, intro], idx) => `${g === [...ADVANCED][0] ? '<details class="adv-settings"><summary>Advanced settings: tracking, fraud protection, SMS, couriers</summary>' : ''}${card([g, title, intro])}
      ${g === 'banners' ? '<p class="notice small" id="season-note" hidden></p>' : ''}
      ${g === 'branding' ? `<div class="row" style="align-items:center;gap:16px;margin-bottom:12px">${val.brand_logo_url ? `<img src="${esc(val.brand_logo_url)}" alt="Current logo" style="max-height:48px;max-width:200px">` : '<span class="muted small">No logo yet: the store shows the “Abs Vai” wordmark.</span>'}
          ${write ? '<label class="btn btn-outline btn-sm">Upload logo<input type="file" id="logo" accept="image/png,image/webp,image/svg+xml,image/jpeg" hidden></label>' : ''}</div>
        <div class="grid-3">${Object.keys(DEFAULTS).map(k => `<label class="f">${esc(COLOR_LABELS[k])}<span class="row"><input type="color" data-color="${k}" value="${esc(colors[k] ?? DEFAULTS[k])}" ${write ? '' : 'disabled'}><code class="small">${esc(colors[k] ?? DEFAULTS[k])}</code></span></label>`).join('')}</div>
        <div id="contrast">${d.contrastWarnings.map(w => `<p class="notice err small">${esc(w)}</p>`).join('')}</div>
        ${write ? '<button class="btn btn-ghost btn-sm" type="button" id="reset-colors">Back to the default colours</button>' : ''}` : ''}
      ${g === 'banners' ? '<div id="bn-home" class="bn-list"></div><h3 style="margin-top:18px">Second banner (further down the homepage)</h3><div id="bn-promo" class="bn-list"></div>' : ''}
      ${g === 'store' ? `<h3>Social media</h3><p class="small muted">Paste the link to each page. They show in the footer of every page. Leave empty if you don’t use it.</p>
        <div class="grid-2">${SOCIAL.map(([k, label, eg]) => `<label class="f">${esc(label)}<input data-social="${k}" value="${esc(social[k] ?? '')}" placeholder="${esc(eg)}" inputmode="url" ${write ? '' : 'disabled'}></label>`).join('')}</div><h3 style="margin-top:14px">Store details</h3>` : ''}
      ${g === 'payments' ? `<h3>bKash / Nagad / Rocket numbers for advances</h3><div id="wallets">${[...wallets, {}, {}].slice(0, Math.max(4, wallets.length + 1)).map(w => `<div class="grid-3 wallet"><input class="i" placeholder="Wallet (bKash)" value="${esc(w.wallet ?? '')}" ${write ? '' : 'disabled'}><input class="i" placeholder="Number" value="${esc(w.number ?? '')}" ${write ? '' : 'disabled'}><input class="i" placeholder="Merchant / Personal" value="${esc(w.type ?? '')}" ${write ? '' : 'disabled'}></div>`).join('')}</div>` : ''}
      <div class="grid-2">${group(g).map(f => fieldHtml(f, val[f.key], ctx)).join('')}</div></div>${idx === GROUPS.length - 1 ? '</details>' : ''}`).join('')}
    </form>
    ${write ? '<div class="save-bar"><button class="btn btn-primary" id="save">Save</button></div>' : ''}`;
  // A live season's banners take over the homepage, so say why these may not show yet.
  api('/seasons').then(list => {
    const live = list.find(x => x.state === 'active');
    const note = v.querySelector('#season-note');
    if (live && note) { note.hidden = false; note.textContent = `${live.name} is live now, so its own banners show at the top of the homepage. These banners come back when no season is live. To change the ${live.name} banners, open Seasons.`; }
  }).catch(() => {});
  const links = await linkOptions();
  const home = bannerEditor(v.querySelector('#bn-home'), parse(val.default_banners, []), { max: 6, links, readOnly: !write });
  const promoNow = parse(val.promo_banner, null);
  const promo = bannerEditor(v.querySelector('#bn-promo'), promoNow ? [promoNow] : [], { max: 1, links, readOnly: !write });
  if (!write) return;
  const $ = s => v.querySelector(s);
  v.querySelectorAll('[data-color]').forEach(i => i.addEventListener('input', () => { i.nextElementSibling.textContent = i.value.toUpperCase(); }));
  $('#reset-colors')?.addEventListener('click', () => v.querySelectorAll('[data-color]').forEach(i => { i.value = DEFAULTS[i.dataset.color]; i.nextElementSibling.textContent = i.value; }));
  $('#logo')?.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try { await api('/brand-asset', 'POST', fd); toast('Logo saved. Pages refresh in a few seconds.'); settings(v); } catch (err) { toast(err.message, true); }
  });
  busy($('#purge'), async () => { await api('/cache/purge-all', 'POST', {}); toast('Every page will be rebuilt on its next visit.'); });
  busy($('#save'), async () => {
    const f = $('#f');
    const body = {};
    f.querySelectorAll('[name]').forEach(i => {
      const kind = i.dataset.kind;
      body[i.name] = kind === 'bool' ? (i.checked ? '1' : '0') : kind === 'paisa' ? String(toPaisa(i.value || '0') ?? 0) : i.value.trim();
    });
    body.social_links = JSON.stringify(Object.fromEntries([...f.querySelectorAll('[data-social]')].map(i => [i.dataset.social, i.value.trim()]).filter(([, x]) => x)));
    body.default_banners = JSON.stringify(home.value());
    body.promo_banner = JSON.stringify(promo.value()[0] ?? null);
    body.manual_wallets = JSON.stringify([...f.querySelectorAll('.wallet')].map(w => { const [a, b, c] = w.querySelectorAll('input'); return { wallet: a.value.trim(), number: b.value.trim(), type: c.value.trim() }; }).filter(w => w.wallet && w.number));
    const picked = Object.fromEntries([...f.querySelectorAll('[data-color]')].map(i => [i.dataset.color, i.value.toUpperCase()]));
    body.brand_colors = Object.entries(picked).every(([k, x]) => x === DEFAULTS[k]) ? '' : JSON.stringify(picked);
    f.querySelectorAll('[data-secret]').forEach(i => { if (i.value.trim()) body[i.dataset.secret] = i.value.trim(); });
    f.querySelectorAll('[data-clear]:checked').forEach(c => { body[c.dataset.clear] = { clear: true }; });
    const r = await api('/settings', 'PUT', body);
    toast(r.changed.length ? `Saved ${r.changed.length} change(s).` : 'Saved.');
    $('#contrast').innerHTML = r.contrastWarnings.map(w => `<p class="notice err small">${esc(w)}</p>`).join('');
    f.querySelectorAll('[data-secret]').forEach(i => { i.value = ''; });
    if (f.querySelector('[data-clear]:checked') || Object.keys(body).some(k => f.querySelector(`[data-secret="${k}"]`))) settings(v);
  });
}

export async function staff(v) {
  if (state.user.role !== 'super_admin') { v.innerHTML = '<div class="notice">Only Super Admins can manage staff.</div>'; return; }
  const rows = await api('/staff');
  const ROLES = {
    super_admin: 'Owner / Super Admin: everything, credentials and staff', manager: 'Manager: catalog, orders, discounts, settings, security',
    order_processor: 'Sales Agent: orders assigned to them, manual orders, incomplete checkouts', warehouse: 'Warehouse: pack, print, ship, returns scan, stock',
    accountant: 'Accountant: orders, exports, cost prices, reports', viewer: 'Viewer: read only',
  };
  v.innerHTML = `<div class="page-head"><div><h1>Staff & Roles</h1><p>Roles are checked on the server for every action.</p></div><button class="btn btn-primary" id="new">+ Add staff</button></div>
    <div class="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Last sign-in</th><th>On duty</th><th>Active</th></tr></thead><tbody>
    ${rows.map(a => `<tr><td><b>${esc(a.name)}</b><br><span class="small muted">${esc(a.email)}</span></td><td><select class="i" data-role="${a.id}">${Object.entries(ROLES).map(([k, l]) => `<option value="${k}" ${k === a.role ? 'selected' : ''}>${l}</option>`).join('')}</select></td><td>${date(a.last_login_at)}</td><td><input type="checkbox" data-duty="${a.id}" ${a.on_duty ? 'checked' : ''} aria-label="On duty"></td><td><input type="checkbox" data-active="${a.id}" ${a.is_active ? 'checked' : ''} aria-label="Active"></td></tr>`).join('')}</tbody></table></div>`;
  v.querySelectorAll('[data-role]').forEach(s => s.addEventListener('change', async () => { try { await api(`/staff/${s.dataset.role}`, 'PUT', { role: s.value }); toast('Role changed.'); } catch (e) { toast(e.message, true); staff(v); } }));
  v.querySelectorAll('[data-active]').forEach(c => c.addEventListener('change', async () => { try { await api(`/staff/${c.dataset.active}`, 'PUT', { isActive: c.checked }); toast('Saved.'); } catch (e) { toast(e.message, true); staff(v); } }));
  v.querySelectorAll('[data-duty]').forEach(c => c.addEventListener('change', async () => { try { await api(`/staff/${c.dataset.duty}`, 'PUT', { onDuty: c.checked }); toast('Saved.'); } catch (e) { toast(e.message, true); staff(v); } }));
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
