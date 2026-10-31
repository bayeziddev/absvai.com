// Website & banners: everything the owner changes about how the shop looks, on one page, without any code:
// shop name and logo, the running message, the homepage banners, the popup banner and the second banner.
import { api, busy, can, esc, toast } from '../app.js';
import { bannerEditor, linkOptions } from './banners.js';

const parse = (raw, fallback) => { try { return JSON.parse(raw || '') ?? fallback; } catch { return fallback; } };

export async function website(v) {
  const d = await api('/settings');
  const write = can('settings:write');
  const val = d.values;
  const pop = parse(val.popup_banner, null) ?? {};
  const dis = write ? '' : 'disabled';
  const opt = (value, label, now) => `<option value="${value}" ${String(now) === String(value) ? 'selected' : ''}>${label}</option>`;
  v.innerHTML = `<div class="page-head"><div><h1>Website & banners</h1><p>${write ? 'Your shop name, logo, the homepage pictures and the popup. Change what you need, then press <b>Save</b> at the bottom.' : 'Read only. Ask a Manager or the Super Admin to change the website.'}</p></div>
      <a class="btn btn-outline" href="/" target="_blank" rel="noopener">View the shop</a></div>
    <form id="f">
      <div class="card"><h2>Shop name and logo</h2>
        <div class="ws-head" aria-label="How the top of your shop looks"><span class="ws-menu"></span><span id="ws-mark"></span><span class="ws-icons"><i></i><i></i><i></i></span></div>
        <div class="grid-2">
          <label class="f">Shop name <span class="req">*</span><input name="store_name" value="${esc(val.store_name || 'Abs Vai')}" maxlength="40" required ${dis}></label>
          <label class="f">Short line about the shop <span class="help">Shown in Google results and the browser tab.</span><input name="tagline" value="${esc(val.tagline)}" maxlength="80" placeholder="Seasonal goods, honest prices." ${dis}></label>
        </div>
        <div class="row ws-logo">
          ${write ? `<label class="btn btn-outline btn-sm">${val.brand_logo_url ? 'Change logo' : '+ Upload logo'}<input type="file" id="logo" accept="image/png,image/webp,image/svg+xml,image/jpeg" hidden></label>
            ${val.brand_logo_url ? '<button type="button" class="btn btn-ghost btn-sm" id="logo-off">Remove logo (show the shop name)</button>' : ''}` : ''}
          <span class="small muted">PNG or SVG with a transparent background looks best. Without a logo the shop name is shown.</span>
        </div>
        <label class="f">Running message at the very top <span class="help">For example: Cash on Delivery all over Bangladesh. Leave empty to hide it.</span><input name="announcement" value="${esc(val.announcement)}" maxlength="140" ${dis}></label>
      </div>

      <div class="card"><h2>Big banners at the top of the homepage</h2>
        <p class="small muted">They slide one after another. Add a picture, a headline and the page the button opens.</p>
        <p class="notice small" id="season-note" hidden></p>
        <div id="bn-home" class="bn-list"></div>
      </div>

      <div class="card"><h2>Popup banner</h2>
        <p class="small muted">Pops up a few seconds after a customer opens the shop. Good for offers and new arrivals. It never shows on the cart, checkout or account pages, and customers can close it.</p>
        <label class="check ws-switch"><input type="checkbox" id="pop-on" ${pop.enabled ? 'checked' : ''} ${dis}> Show the popup</label>
        <div id="bn-pop" class="bn-list"></div>
        <div class="grid-3">
          <label class="f">Show it after<select id="pop-delay" ${dis}>${[[2, '2 seconds'], [4, '4 seconds'], [8, '8 seconds'], [15, '15 seconds'], [30, '30 seconds']].map(([s, l]) => opt(s, l, pop.delay ?? 4)).join('')}</select></label>
          <label class="f">How often<select id="pop-freq" ${dis}>${opt('day', 'Once a day', pop.frequency ?? 'day')}${opt('once', 'Only once per customer', pop.frequency)}${opt('visit', 'Every visit', pop.frequency)}</select></label>
          <label class="f">Where<select id="pop-where" ${dis}>${opt('home', 'Homepage only', pop.where ?? 'home')}${opt('all', 'Every page', pop.where)}</select></label>
        </div>
      </div>

      <div class="card"><h2>Second banner</h2><p class="small muted">One wide banner further down the homepage.</p><div id="bn-promo" class="bn-list"></div></div>
    </form>
    ${write ? '<div class="save-bar"><button class="btn btn-primary" id="save">Save</button></div>' : ''}`;

  const $ = s => v.querySelector(s);
  const mark = () => {
    const name = $('[name=store_name]').value.trim() || 'Abs Vai';
    const [first, ...rest] = name.split(/\s+/);
    $('#ws-mark').innerHTML = val.brand_logo_url ? `<img src="${esc(val.brand_logo_url)}" alt="${esc(name)}">` : `<b>${esc(first)}<span>${esc(rest.join(' '))}</span></b>`;
  };
  mark();
  $('[name=store_name]').addEventListener('input', mark);

  // A live season's banners take over the top of the homepage, so say why these may not show yet.
  api('/seasons').then(list => {
    const live = list.find(x => x.state === 'active');
    if (!live) return;
    $('#season-note').hidden = false;
    $('#season-note').textContent = `${live.name} is live now, so its own banners show at the top of the homepage. These come back when no season is live. To change the ${live.name} banners, open Seasons.`;
  }).catch(() => {});

  const links = await linkOptions();
  const home = bannerEditor($('#bn-home'), parse(val.default_banners, []), { max: 6, links, readOnly: !write });
  const popEd = bannerEditor($('#bn-pop'), pop.headline ? [pop] : [], { max: 1, links, readOnly: !write });
  const promoNow = parse(val.promo_banner, null);
  const promo = bannerEditor($('#bn-promo'), promoNow ? [promoNow] : [], { max: 1, links, readOnly: !write });
  if (!write) return;

  $('#logo')?.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try { await api('/brand-asset', 'POST', fd); toast('Logo saved. The shop shows it in a few seconds.'); website(v); } catch (err) { toast(err.message, true); }
  });
  if ($('#logo-off')) busy($('#logo-off'), async () => { await api('/settings', 'PUT', { brand_logo_url: '' }); toast('Logo removed: the shop name is shown instead.'); website(v); });

  busy($('#save'), async () => {
    const name = $('[name=store_name]').value.trim();
    if (!name) throw new Error('Type your shop name.');
    const popup = popEd.value()[0];
    if ($('#pop-on').checked && !popup) throw new Error('Give the popup a headline, or untick “Show the popup”.');
    const body = {
      store_name: name, tagline: $('[name=tagline]').value.trim(), announcement: $('[name=announcement]').value.trim(),
      default_banners: JSON.stringify(home.value()),
      promo_banner: JSON.stringify(promo.value()[0] ?? null),
      popup_banner: JSON.stringify(popup ? { ...popup, enabled: $('#pop-on').checked, delay: Number($('#pop-delay').value), frequency: $('#pop-freq').value, where: $('#pop-where').value } : null),
    };
    const r = await api('/settings', 'PUT', body);
    toast(r.changed.length ? `Saved. The shop shows the change in a few seconds.` : 'Saved.');
  });
}
