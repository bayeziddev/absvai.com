// Banner editor for the owner, used for the homepage banners, each season's banners, the second banner and the popup.
// Every banner shows exactly how customers will see it, on a phone and on a computer, and changes as you type. Editing
// is four short steps (photo, words, button, colour) with friendly warnings: a photo too small to look sharp, a photo of
// the wrong shape, a headline too long for phones. No codes or links to type.
import { api, confirmBox, esc, toast } from '../app.js';
import { appendImage, compressImage } from './products.js';

const THEMES = [['chili', 'Red', '#B3261E'], ['turmeric', 'Yellow', '#F2B705'], ['clove', 'Dark', '#2A1F1A'], ['leaf', 'Green', '#2E7D32']];
/** Photos at least this much wider than tall fill the whole banner. */
const WIDE_RATIO = 1.8;
/** Banner photos are kept up to 2400 px wide (sharp on big screens), with copies for phones. */
const UPLOAD = { max: 2400, copies: [480, 960, 1600] };
const GUIDE = '<a href="/admin/photo-guide-bn.html" target="_blank" rel="noopener">Photo guide (ছবি গাইড)</a>';

/** Pages a banner button can open: the shop, deals, every category and season, or another link. */
export async function linkOptions() {
  const [cats, seasons] = await Promise.all([api('/categories').catch(() => []), api('/season-options').catch(() => [])]);
  return [
    ['/', 'Homepage'], ['/shop', 'All products'], ['/deals', 'Deals'], ['/new', 'New arrivals'], ['/originals', 'Our Originals'],
    ...cats.filter(c => c.is_active).map(c => [`/c/${c.slug}`, `Category: ${c.name}`]),
    ...seasons.filter(s => s.slug).map(s => [`/season/${s.slug}`, `Season: ${s.name}`]),
  ];
}

const blank = () => ({ headline: '', subline: '', cta_text: 'Shop now', cta_href: '/shop', theme: 'chili', image: '' });
const layoutOf = b => (!b.image ? 'none' : /\.svg$/.test(b.image) ? 'art' : b.wide ? 'wide' : 'side');

/** The banner as the shop draws it (same layout, colours and proportions), at phone or computer size. */
function preview(b, size, kind, kicker) {
  const theme = THEMES.some(t => t[0] === b.theme) ? b.theme : 'chili';
  const words = `<b class="bnp-title">${esc(b.headline || 'Your headline')}</b>${b.subline ? `<span class="bnp-sub">${esc(b.subline)}</span>` : ''}<span class="bnp-btn">${esc(b.cta_text || 'Shop now')} ›</span>`;
  if (kind === 'popup') {
    return `<div class="bnp bnp-popup bnt-${theme}">${b.image ? `<img class="${/\.svg$/.test(b.image) ? 'bnp-pop-art' : 'bnp-pop-photo'}" src="${esc(b.image)}" alt="">` : ''}<div class="bnp-copy">${words}</div><span class="bnp-x">✕</span></div>`;
  }
  const layout = kind === 'promo' && layoutOf(b) === 'wide' ? 'side' : layoutOf(b);
  const img = b.image ? esc(b.image) : '';
  return `<div class="bnp bnp-${size}${kind === 'promo' ? ' bnp-promo' : ''}"><div class="bnp-slide bnp-${layout} bnt-${theme}">
    ${layout === 'wide' ? `<img class="bnp-bg" src="${img}" alt="">` : layout === 'side' ? `<img class="bnp-photo" src="${img}" alt="">` : ''}
    <div class="bnp-copy">${kicker && kind === 'hero' ? `<span class="bnp-kicker">${esc(kicker)}</span>` : ''}${words}</div>
    ${layout === 'art' ? `<img class="bnp-art" src="${img}" alt="">` : ''}</div></div>`;
}

/** Plain-language warnings for one banner; `photo` is the loaded photo's size, when known. */
function warnings(b, kind, photo) {
  const out = [];
  if (!b.image && kind !== 'popup') out.push('Add a photo: banners with a photo get many more clicks.');
  if (photo && kind === 'hero') {
    const ratio = photo.w / photo.h;
    if (b.wide && photo.w < 1600) out.push(`This photo is only ${photo.w} px wide, so it can look soft on big screens. Best: about 2000 × 860 px, straight from the camera.`);
    if (!b.wide && Math.min(photo.w, photo.h) < 700) out.push(`This photo is small (${photo.w} × ${photo.h} px) and can look soft. Use a bigger photo, 1000 px or more.`);
    if (b.wide && ratio < 1.6) out.push('This photo is not wide, so its top and bottom are cut off. Choose “Photo on the right half”, or use a wide photo.');
    if (!b.wide && ratio >= WIDE_RATIO) out.push('This is a wide photo: “Photo fills the banner” shows it much better.');
  } else if (photo && Math.min(photo.w, photo.h) < 600) out.push(`This photo is small (${photo.w} × ${photo.h} px) and can look soft. Use a bigger photo.`);
  if (b.headline.trim().length > 42) out.push('Long headline: on phones it takes three lines. Try 3 to 6 words.');
  if ((b.cta_text || '').trim().length > 18) out.push('Short button words read best on phones: 1 to 3 words, like “Shop now”.');
  return out;
}

/**
 * Renders an editable list of banners into `el` and returns { value() } with the cleaned list.
 * @param {HTMLElement} el
 * @param {object[]} initial
 * @param {{ max?: number, links: Array<[string, string]>, readOnly?: boolean, kind?: 'hero' | 'promo' | 'popup', kicker?: string, saveLabel?: string }} opts
 */
export function bannerEditor(el, initial, { max = 4, links, readOnly = false, kind = 'hero', kicker = '', saveLabel = 'Save' }) {
  const list = (Array.isArray(initial) ? initial : []).map(b => ({ ...blank(), ...b }));
  /** Banners with a headline, trimmed; empty optional fields dropped. */
  const clean = items => items.filter(b => b.headline.trim()).map(b => {
    const out = { headline: b.headline.trim(), cta_text: b.cta_text.trim() || 'Shop now', cta_href: b.cta_href.trim() || '/shop', theme: b.theme };
    if (b.subline.trim()) out.subline = b.subline.trim();
    if (b.image) out.image = b.image;
    if (b.image && kind === 'hero' && typeof b.wide === 'boolean') out.wide = b.wide;
    return out;
  });
  // Defence in depth: if the mount point is missing, don't take the whole page down — just skip this editor.
  if (!el) { console.warn('bannerEditor: no element to render into; skipping'); return { value: () => clean(list) }; }
  const sizes = new Map(); // photo url → { w, h } once it has loaded
  let open = -1;
  const one = max === 1;
  const what = kind === 'popup' ? 'popup' : 'banner';

  const previews = b => (kind === 'popup'
    ? `<figure class="bnp-fig"><figcaption>How it pops up (যেমন দেখাবে)</figcaption>${preview(b, 'phone', kind, kicker)}</figure>`
    : `<figure class="bnp-fig bnp-fig-phone"><figcaption>📱 On a phone (মোবাইলে)</figcaption>${preview(b, 'phone', kind, kicker)}</figure>
       <figure class="bnp-fig bnp-fig-pc"><figcaption>🖥 On a computer (কম্পিউটারে)</figcaption>${preview(b, 'pc', kind, kicker)}</figure>`);
  const tips = b => warnings(b, kind, sizes.get(b.image)).map(t => `<p class="bn-warn">⚠ ${esc(t)}</p>`).join('');

  function fields(b) {
    const known = links.some(([href]) => href === b.cta_href);
    const step = (n, title, bn, body) => `<section class="bn-step"><h4><span class="bn-num">${n}</span>${title} <span class="bn-bn">${bn}</span></h4>${body}</section>`;
    const layoutPick = kind === 'hero' && b.image && layoutOf(b) !== 'art' ? `<div class="bn-layouts" role="radiogroup" aria-label="Photo style">
        <button type="button" class="bn-layout" role="radio" aria-checked="${Boolean(b.wide)}" data-layout="wide"><span class="bn-mini bn-mini-wide"><i></i></span><b>Photo fills the banner</b><small>Best for wide photos</small></button>
        <button type="button" class="bn-layout" role="radio" aria-checked="${!b.wide}" data-layout="side"><span class="bn-mini bn-mini-side"><i></i></span><b>Photo on the right half</b><small>Best for square photos</small></button></div>` : '';
    return `<div class="bn-fields">
      ${step(1, 'Photo', 'ছবি', `<div class="row"><label class="btn btn-outline bn-pick">📷 ${b.image ? 'Change photo' : 'Choose a photo'}<input type="file" data-b="file" accept="image/png,image/jpeg,image/webp" hidden></label>
          ${b.image ? '<button type="button" class="btn btn-sm btn-ghost" data-b="noimg">Remove photo</button>' : ''}</div>
        <p class="small muted">${kind === 'hero' ? 'Best: a wide photo about 2000 × 860 px, products on the right, empty space on the left for the words. A square photo works too.' : kind === 'popup' ? 'Best: a photo about 1200 × 800 px.' : 'Best: a square photo, 1000 px or more.'} Use the photo straight from the camera, not from WhatsApp. ${GUIDE}</p>${layoutPick}`)}
      ${step(2, 'Words', 'লেখা', `<label class="f">Headline <span class="req">*</span> <span class="bn-count" data-count="headline">${b.headline.length}/60</span><input data-b="headline" value="${esc(b.headline)}" maxlength="60" placeholder="e.g. Fresh khejur gur is here"></label>
        <label class="f">Short line under it <span class="help">${kind === 'hero' ? 'Shows on computers and big phones.' : 'Optional.'}</span><input data-b="subline" value="${esc(b.subline)}" maxlength="120" placeholder="e.g. Patali and liquid gur from Jashore. Cash on Delivery."></label>`)}
      ${step(3, 'Button', 'বাটন', `<div class="grid-2"><label class="f">Button words<input data-b="cta_text" value="${esc(b.cta_text)}" maxlength="24" placeholder="Shop now"></label>
          <label class="f">When tapped, open<select data-b="link">${links.map(([href, label]) => `<option value="${esc(href)}" ${href === b.cta_href ? 'selected' : ''}>${esc(label)}</option>`).join('')}<option value="other" ${known ? '' : 'selected'}>Another link…</option></select></label></div>
        <label class="f" ${known ? 'hidden' : ''}>Link<input data-b="cta_href" value="${esc(b.cta_href)}" placeholder="/c/khejur-gur or https://…"></label>`)}
      ${step(4, 'Colour', 'রঙ', `<div class="bn-colors" role="radiogroup" aria-label="Colour">${THEMES.map(([id, name, bg]) => `<button type="button" class="bn-color" role="radio" aria-checked="${b.theme === id}" data-theme="${id}"><span style="background:${bg}"></span>${name}</button>`).join('')}</div>
        ${b.wide && kind === 'hero' ? '<p class="small muted">With the photo filling the banner, the colour shows on the button and the small label.</p>' : ''}`)}
      <div class="row bn-done"><button type="button" class="btn btn-primary btn-sm" data-b="close">✓ Done</button><span class="small muted">Then press <b>${esc(saveLabel)}</b> at the bottom.</span></div>
    </div>`;
  }

  function card(b, i) {
    const isOpen = open === i && !readOnly;
    const title = one ? (kind === 'popup' ? 'Your popup' : 'Your banner') : `Banner ${i + 1}${i === 0 ? ' <span class="small muted">· shows first</span>' : ''}`;
    return `<div class="bn-card${isOpen ? ' is-open' : ''}" data-i="${i}">
      <div class="bn-head"><b>${title}</b>${readOnly ? '' : `<span class="bn-tools">
        <button type="button" class="btn btn-sm ${isOpen ? 'btn-ghost' : 'btn-outline'}" data-b="edit">${isOpen ? 'Close' : '✏️ Edit'}</button>
        ${one ? '' : `<button type="button" class="btn btn-sm btn-ghost" data-b="up" ${i === 0 ? 'disabled' : ''} aria-label="Move up" title="Show earlier">↑</button><button type="button" class="btn btn-sm btn-ghost" data-b="down" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Move down" title="Show later">↓</button>`}
        <button type="button" class="btn btn-sm btn-ghost" data-b="remove" aria-label="Remove" title="Remove">🗑</button></span>`}</div>
      <div class="bn-previews${kind === 'popup' ? ' bn-previews-one' : ''}">${previews(b)}</div>
      <div class="bn-tips">${tips(b)}</div>
      ${isOpen ? fields(b) : ''}
    </div>`;
  }

  function draw() {
    el.innerHTML = `${list.map(card).join('')}
      ${!readOnly && list.length < max ? `<button type="button" class="btn btn-outline bn-add" data-b="add">+ Add ${list.length ? `another ${what}` : `a ${what}`}</button>` : ''}
      ${!list.length && readOnly ? `<p class="muted small">No ${what}s.</p>` : ''}`;
    wire();
  }

  /** Refreshes one card's pictures and warnings without redrawing its fields (so typing is not interrupted). */
  function refresh(card, b) {
    card.querySelector('.bn-previews').innerHTML = previews(b);
    card.querySelector('.bn-tips').innerHTML = tips(b);
    measure(card, b);
  }

  /** Learns the photo's size once it loads: for the warnings, and to choose the photo style for a photo that never had one. */
  function measure(card, b) {
    const img = card.querySelector('.bnp img');
    if (!img || !b.image || sizes.has(b.image)) return;
    const done = () => {
      if (!img.naturalWidth || sizes.has(b.image)) return;
      sizes.set(b.image, { w: img.naturalWidth, h: img.naturalHeight });
      if (b.wide === undefined && kind === 'hero') b.wide = img.naturalWidth / img.naturalHeight >= WIDE_RATIO;
      draw();
    };
    if (img.complete) done(); else img.addEventListener('load', done, { once: true });
  }

  function wire() {
    el.querySelectorAll('.bn-card').forEach(card => {
      const i = Number(card.dataset.i);
      const b = list[i];
      measure(card, b);
      const on = (name, fn) => card.querySelector(`[data-b=${name}]`)?.addEventListener('click', fn);
      on('edit', () => { open = open === i ? -1 : i; draw(); el.querySelector(`.bn-card[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); });
      on('close', () => { open = -1; draw(); });
      on('up', () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; if (open === i) open = i - 1; draw(); });
      on('down', () => { [list[i + 1], list[i]] = [list[i], list[i + 1]]; if (open === i) open = i + 1; draw(); });
      on('remove', async () => { if (!(await confirmBox(`Remove ${one ? `this ${what}` : `banner ${i + 1}`}? It goes away from the shop when you press Save.`))) return; list.splice(i, 1); open = -1; draw(); });
      on('noimg', () => { b.image = ''; delete b.wide; draw(); });
      card.querySelectorAll('input[data-b]:not([type=file])').forEach(inp => inp.addEventListener('input', () => {
        b[inp.dataset.b] = inp.value;
        const count = card.querySelector(`[data-count=${inp.dataset.b}]`);
        if (count) count.textContent = `${inp.value.length}/60`;
        refresh(card, b);
      }));
      card.querySelector('[data-b=link]')?.addEventListener('change', e => {
        const other = e.target.value === 'other';
        card.querySelector('[data-b=cta_href]').closest('label').hidden = !other;
        if (!other) b.cta_href = e.target.value;
      });
      card.querySelectorAll('.bn-color').forEach(btn => btn.addEventListener('click', () => { b.theme = btn.dataset.theme; draw(); }));
      card.querySelectorAll('.bn-layout').forEach(btn => btn.addEventListener('click', () => { b.wide = btn.dataset.layout === 'wide'; draw(); }));
      card.querySelector('[data-b=file]')?.addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;
        const pick = card.querySelector('.bn-pick');
        pick.classList.add('is-busy');
        pick.firstChild.textContent = '⏳ Uploading… ';
        try {
          const photo = await compressImage(file, UPLOAD);
          const fd = new FormData();
          appendImage(fd, photo);
          b.image = (await api('/banner-image', 'POST', fd)).url;
          if (photo.width) { sizes.set(b.image, { w: photo.width, h: photo.height }); b.wide = photo.width / photo.height >= WIDE_RATIO; }
          toast(`Photo added${kind === 'hero' && b.wide ? ': it fills the whole banner' : ''}. Press ${saveLabel} to show it in the shop.`);
        } catch (err) { toast(err.message, true); }
        draw();
      });
    });
    el.querySelector('[data-b=add]')?.addEventListener('click', () => {
      list.push(blank());
      open = list.length - 1;
      draw();
      el.querySelector('.bn-card.is-open')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  }

  draw();
  return {
    /** Banners with a headline, trimmed; empty optional fields dropped. */
    value() { return clean(list); },
  };
}
