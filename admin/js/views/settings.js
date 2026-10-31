import { api, badge, busy, can, confirmBox, date, esc, fromPaisa, qs, slideOver, state, toast, toPaisa } from '../app.js';

const SOCIAL = [['facebook', 'Facebook page', 'https://www.facebook.com/absvai'], ['instagram', 'Instagram', 'https://www.instagram.com/absvai'], ['youtube', 'YouTube', 'https://www.youtube.com/@absvai'], ['tiktok', 'TikTok', 'https://www.tiktok.com/@absvai']];
const parse = (raw, fallback) => { try { return JSON.parse(raw || '') ?? fallback; } catch { return fallback; } };

const GROUPS = [
  ['store', 'Store', 'Contact numbers and social media links. The shop name, logo and banners are in Website & banners.'],
  ['branding', 'Colours', 'The shop’s colours. Every page refreshes at the edge when you save.'],
  ['delivery', 'Delivery charges', 'What customers pay for delivery. Checkout picks the charge from the customer’s district by itself.'],
  ['payments', 'Payments', 'Wallet numbers customers send advances to.'],
  ['tracking', 'Tracking', 'IDs only (never paste script code). Tags load only on public pages, never on checkout, cart or account pages.'],
  ['fraud', 'Fraud protection', 'Holds go to “On hold” for a human to look at; nothing is rejected automatically.'],
  ['incomplete', 'Incomplete orders & manual orders', ''],
  ['sms', 'SMS', 'The SMS provider itself is chosen in the deployment; these are the account details.'],
  ['ai', 'AI assistants', 'The shop chat and the admin assistant run on Cloudflare Workers AI. These limits keep it inside the free daily allowance.'],
  ['couriers', 'Courier credentials', 'The same keys as on the Couriers page (easier there, with a Test button).'],
  ['map', 'Checkout map', 'The map customers can use to show their location. Leave it as it is unless your developer asks.'],
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

// Delivery charges per zone, in plain words: the charge, each extra kg and the delivery time. Which districts are in which
// zone rarely changes, so it stays one link away (#/zones).
function zoneAreas(z, zd) {
  const over = zd.overrides.filter(o => o.zone_id === z.id).map(o => o.name.replace(' City Corporation', ' City'));
  const dists = zd.districts.filter(x => x.zone_id === z.id).map(x => x.name);
  const all = [...over, ...dists];
  if (z.is_default) return all.length ? `${all.join(', ')} and every other district` : 'Every district not in another zone';
  return all.join(', ') || 'No district yet';
}
function zonesHtml(zd, write) {
  const dis = write ? '' : 'disabled';
  return `<h3>Charge by area</h3><div class="zone-rows">${zd.zones.map(z => `<div class="zone-row" data-zone="${z.id}">
      <div><b>${esc(z.name)}</b><span class="small muted">${esc(zoneAreas(z, zd))}</span></div>
      <label class="f">Charge up to ${z.base_weight_grams / 1000} kg (৳)<input data-zf="base" inputmode="decimal" value="${esc(fromPaisa(z.base_charge_paisa))}" ${dis}></label>
      <label class="f">Each extra kg (৳)<input data-zf="extra" inputmode="decimal" value="${esc(fromPaisa(z.extra_per_kg_paisa))}" ${dis}></label>
      <label class="f">Delivery time<input data-zf="eta" maxlength="40" value="${esc(z.eta_text)}" ${dis}></label></div>`).join('')}</div>
    <p class="small muted">To move a district to another zone (rarely needed): <a href="#/zones">zone details</a>.</p><h3 style="margin-top:14px">Free delivery and the COD fee</h3>`;
}

export async function settings(v) {
  const [d, zd] = await Promise.all([api('/settings'), api('/zones').catch(() => null)]);
  const zoneWrite = can('geo:write');
  const write = can('settings:write');
  const ctx = { write, canSecrets: d.canEditSecrets };
  const val = d.values;
  const wallets = (() => { try { return JSON.parse(val.manual_wallets || '[]'); } catch { return []; } })();
  const colors = (() => { try { return JSON.parse(val.brand_colors || '{}'); } catch { return {}; } })();
  const DEFAULTS = { chili: '#B3261E', turmeric: '#F2B705', cream: '#FFF8EC', leaf: '#2E7D32', clove: '#2A1F1A', husk: '#E9DCC6' };
  const special = new Set(['manual_wallets', 'brand_colors', 'brand_logo_url', 'social_links', 'default_banners', 'promo_banner', 'popup_banner', 'store_name', 'tagline', 'announcement']);
  const social = parse(val.social_links, {});
  const groupOf = f => (f.key.startsWith('map_') ? 'map' : f.group);
  const group = g => d.fields.filter(f => groupOf(f) === g && !special.has(f.key));
  // Everyday groups first; tracking, fraud, SMS and courier settings live in one closed "Advanced" section.
  const ADVANCED = new Set(['tracking', 'fraud', 'incomplete', 'sms', 'ai', 'couriers', 'map']);
  const card = ([g, title, intro]) => `<div class="card"><h2>${esc(title)}</h2>${intro ? `<p class="small muted">${esc(intro)}</p>` : ''}`;
  v.innerHTML = `<div class="page-head"><div><h1>Settings</h1><p>${write ? 'Contact details, delivery charges and payment numbers. Change what you need, then press <b>Save</b> at the bottom of the screen.' : 'Read only. Ask a Manager or the Super Admin to change settings.'}</p></div>
      ${write ? '<button class="btn btn-outline" id="purge">Refresh every page now</button>' : ''}</div>
    <a class="notice ws-link" href="#/website"><b>Shop name, logo, homepage banners and the popup</b> are in <u>Website &amp; banners</u>.</a>
    <form id="f">${GROUPS.map(([g, title, intro], idx) => `${g === [...ADVANCED][0] ? '<details class="adv-settings"><summary>Advanced settings: tracking, fraud protection, SMS, AI, couriers, map</summary>' : ''}${card([g, title, intro])}
      ${g === 'branding' ? `<div class="grid-3">${Object.keys(DEFAULTS).map(k => `<label class="f">${esc(COLOR_LABELS[k])}<span class="row"><input type="color" data-color="${k}" value="${esc(colors[k] ?? DEFAULTS[k])}" ${write ? '' : 'disabled'}><code class="small">${esc(colors[k] ?? DEFAULTS[k])}</code></span></label>`).join('')}</div>
        <div id="contrast">${d.contrastWarnings.map(w => `<p class="notice err small">${esc(w)}</p>`).join('')}</div>
        ${write ? '<button class="btn btn-ghost btn-sm" type="button" id="reset-colors">Back to the default colours</button>' : ''}` : ''}
      ${g === 'store' ? `<h3>Social media</h3><p class="small muted">Paste the link to each page. They show in the footer of every page. Leave empty if you don’t use it.</p>
        <div class="grid-2">${SOCIAL.map(([k, label, eg]) => `<label class="f">${esc(label)}<input data-social="${k}" value="${esc(social[k] ?? '')}" placeholder="${esc(eg)}" inputmode="url" ${write ? '' : 'disabled'}></label>`).join('')}</div><h3 style="margin-top:14px">Store details</h3>` : ''}
      ${g === 'delivery' && zd ? zonesHtml(zd, write && zoneWrite) : ''}
      ${g === 'payments' ? `<h3>bKash / Nagad / Rocket numbers for advances</h3><div id="wallets">${[...wallets, {}, {}].slice(0, Math.max(4, wallets.length + 1)).map(w => `<div class="grid-3 wallet"><input class="i" placeholder="Wallet (bKash)" value="${esc(w.wallet ?? '')}" ${write ? '' : 'disabled'}><input class="i" placeholder="Number" value="${esc(w.number ?? '')}" ${write ? '' : 'disabled'}><input class="i" placeholder="Merchant / Personal" value="${esc(w.type ?? '')}" ${write ? '' : 'disabled'}></div>`).join('')}</div>` : ''}
      <div class="grid-2">${group(g).map(f => fieldHtml(f, val[f.key], ctx)).join('')}</div></div>${idx === GROUPS.length - 1 ? '</details>' : ''}`).join('')}
    </form>
    ${write ? '<div class="save-bar"><button class="btn btn-primary" id="save">Save</button></div>' : ''}`;
  if (!write) return;
  const $ = s => v.querySelector(s);
  v.querySelectorAll('[data-color]').forEach(i => i.addEventListener('input', () => { i.nextElementSibling.textContent = i.value.toUpperCase(); }));
  $('#reset-colors')?.addEventListener('click', () => v.querySelectorAll('[data-color]').forEach(i => { i.value = DEFAULTS[i.dataset.color]; i.nextElementSibling.textContent = i.value; }));
  busy($('#purge'), async () => { await api('/cache/purge-all', 'POST', {}); toast('Every page will be rebuilt on its next visit.'); });
  busy($('#save'), async () => {
    const f = $('#f');
    const body = {};
    f.querySelectorAll('[name]').forEach(i => {
      const kind = i.dataset.kind;
      body[i.name] = kind === 'bool' ? (i.checked ? '1' : '0') : kind === 'paisa' ? String(toPaisa(i.value || '0') ?? 0) : i.value.trim();
    });
    body.social_links = JSON.stringify(Object.fromEntries([...f.querySelectorAll('[data-social]')].map(i => [i.dataset.social, i.value.trim()]).filter(([, x]) => x)));
    body.manual_wallets = JSON.stringify([...f.querySelectorAll('.wallet')].map(w => { const [a, b, c] = w.querySelectorAll('input'); return { wallet: a.value.trim(), number: b.value.trim(), type: c.value.trim() }; }).filter(w => w.wallet && w.number));
    const picked = Object.fromEntries([...f.querySelectorAll('[data-color]')].map(i => [i.dataset.color, i.value.toUpperCase()]));
    body.brand_colors = Object.entries(picked).every(([k, x]) => x === DEFAULTS[k]) ? '' : JSON.stringify(picked);
    f.querySelectorAll('[data-secret]').forEach(i => { if (i.value.trim()) body[i.dataset.secret] = i.value.trim(); });
    f.querySelectorAll('[data-clear]:checked').forEach(c => { body[c.dataset.clear] = { clear: true }; });
    if (zd && zoneWrite) {
      for (const row of f.querySelectorAll('[data-zone]')) {
        const z = zd.zones.find(x => x.id === Number(row.dataset.zone));
        const val = k => row.querySelector(`[data-zf="${k}"]`).value.trim();
        const next = { base: toPaisa(val('base') || '0'), extra: toPaisa(val('extra') || '0'), eta: val('eta') };
        if (next.base === null || next.extra === null) throw new Error(`Check the charges for ${z.name}: numbers only.`);
        if (next.base === z.base_charge_paisa && next.extra === z.extra_per_kg_paisa && next.eta === z.eta_text) continue;
        await api(`/zones/${z.id}`, 'PUT', { name: z.name, baseChargePaisa: next.base, baseWeightGrams: z.base_weight_grams, extraPerKgPaisa: next.extra, bulkyChargePaisa: z.bulky_charge_paisa, etaText: next.eta, isDefault: Boolean(z.is_default), sortOrder: z.sort_order, defaultCourier: z.default_courier ?? null });
        Object.assign(z, { base_charge_paisa: next.base, extra_per_kg_paisa: next.extra, eta_text: next.eta });
      }
    }
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
  v.innerHTML = `<div class="page-head"><div><h1>Help Center</h1><p>Short guides for the team. The full guide in Bangla has a direct link to every page.</p></div></div>
    <a class="card guide-card" href="/admin/guide-bn.html" target="_blank" rel="noopener"><span class="guide-ico">📘</span><span><b>সম্পূর্ণ বাংলা গাইড (Full guide in Bangla)</b><br><span class="small muted">অ্যাডমিন ড্যাশবোর্ডের প্রতিটি পেইজ কীভাবে ব্যবহার করবেন, ধাপে ধাপে, সরাসরি লিংকসহ। Opens in a new tab.</span></span></a>
    <div class="card"><h2>Confirm a Cash on Delivery order</h2><ol><li><a href="#/orders?status=new">Orders → New</a>: open the order and call the customer.</li><li>Choose the result (Confirmed, No answer…) and press <b>Log call</b>.</li><li>Move it to <b>Confirmed</b>: the invoice number (INV-…) is created and the customer is told.</li><li>Pre-orders and large items need the advance marked as received first.</li></ol></div>
    <div class="card"><h2>Send parcels</h2><ol><li>Pack the confirmed orders, then <b>Move to → Packed</b>.</li><li>Open a packed order → <b>Book with Steadfast</b> or <b>Book with Pathao</b> (or tick several and book them together).</li><li>The tracking ID comes back by itself and the order moves to In Courier. Set up the courier keys once in <a href="#/courier">Couriers</a>.</li></ol></div>
    <div class="card"><h2>Add a product</h2><ol><li><a href="#/products?new=1">Products → + Add product</a>. Pick the category first: it decides the form.</li><li>Add photos, sizes, prices, stock and the parcel weight.</li><li>Press <b>Save and publish</b>; it tells you if something is missing.</li></ol></div>
    <div class="card"><h2>Order tracking</h2><p>Customers type their <b>mobile number or order number</b> at <a href="/track" target="_blank">/track</a> and see every step. To tell a customer something, open the order → <b>Message for the customer</b> → <b>Post</b>.</p></div>
    <div class="card"><h2>Sell more</h2><ul><li><a href="#/landing/new">Landing pages</a>: a sales page for one product with Order now buttons and the order form, for your ads. Copy the link from the list.</li><li><a href="#/coupons">Coupons</a>: percent off, taka off or free delivery, with dates and limits.</li><li><a href="#/reviews">Reviews</a>: publish customers’ reviews and reply to them.</li><li><a href="#/reports">Reports</a>: sales for any dates, with CSV downloads.</li></ul></div>
    <div class="card"><h2>Sellers</h2><p>Turn seller registration on or off at the top of <a href="#/sellers">Sellers</a>. Approve the seller, then each product (Products to approve) and each payment account before you pay into it.</p></div>
    <div class="card"><h2>Delivery charges</h2><p><a href="#/settings">Settings → Delivery charges</a>: the charge for Inside Dhaka City, Dhaka Suburbs (Dhaka, Gazipur, Narayanganj) and Outside Dhaka, the free-delivery amount and the COD fee. Postcodes and areas need no setup.</p></div>
    <div class="card"><h2>Start a season</h2><ol><li><a href="#/seasons">Seasons</a> → open the season → set this year’s start and end dates (Ramadan and Eid change every year).</li><li>Add banners and tick the season on its products.</li><li>On the start date the homepage and menu switch by themselves, and “Notify me” customers get an SMS.</li></ol></div>
    <div class="card"><h2>Stuck?</h2><p>Press <b>Assistant</b> (bottom right) and ask in Bangla or English, for example “কীভাবে অর্ডার কনফার্ম করব?”.</p></div>`;
}
