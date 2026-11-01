// Banner editor for the owner: picture upload, headline, a short line, the button, where it opens and a colour, with a live
// preview. Used for the homepage banners, the second banner and each season's banners. No codes or links to type.
// A wide photo (about twice as wide as it is tall) fills the whole banner; a square one takes the right half.
import { api, esc, toast } from '../app.js';
import { appendImage, compressImage } from './products.js';

const THEMES = [['chili', 'Red', '#B3261E', '#fff'], ['turmeric', 'Yellow', '#F2B705', '#2A1F1A'], ['clove', 'Dark', '#2A1F1A', '#FFF8EC'], ['leaf', 'Green', '#2E7D32', '#fff']];

/** Pages a banner button can open: the shop, deals, every category and season, or another link. */
export async function linkOptions() {
  const [cats, seasons] = await Promise.all([api('/categories').catch(() => []), api('/season-options').catch(() => [])]);
  return [
    ['/', 'Homepage'], ['/shop', 'All products'], ['/deals', 'Deals'], ['/new', 'New arrivals'], ['/originals', 'Abs Vai Originals'],
    ...cats.filter(c => c.is_active).map(c => [`/c/${c.slug}`, `Category: ${c.name}`]),
    ...seasons.filter(s => s.slug).map(s => [`/season/${s.slug}`, `Season: ${s.name}`]),
  ];
}

const blank = () => ({ headline: '', subline: '', cta_text: 'Shop now', cta_href: '/shop', theme: 'chili', image: '', wide: false });
/** Photos at least this much wider than tall fill the whole banner. */
const WIDE_RATIO = 1.8;

/**
 * Renders an editable list of banners into `el` and returns { value() } with the cleaned list.
 * @param {HTMLElement} el
 * @param {object[]} initial
 * @param {{ max?: number, links: Array<[string, string]>, readOnly?: boolean }} opts
 */
export function bannerEditor(el, initial, { max = 4, links, readOnly = false }) {
  let list = (Array.isArray(initial) ? initial : []).map(b => ({ ...blank(), ...b }));

  const preview = b => {
    const [, , bg, fg] = THEMES.find(t => t[0] === b.theme) ?? THEMES[0];
    const wide = b.image && b.wide;
    return `<div class="bn-preview${wide ? ' bn-wide' : ''}" style="background:${wide ? '#24170F' : bg};color:${wide ? '#fff' : fg}">
      ${wide ? `<img class="bn-bg" src="${esc(b.image)}" alt="">` : ''}
      <div class="bn-text"><b>${esc(b.headline || 'Your headline')}</b>${b.subline ? `<span>${esc(b.subline)}</span>` : ''}<em>${esc(b.cta_text || 'Shop now')}</em></div>
      ${wide ? '' : b.image ? `<img src="${esc(b.image)}" alt="">` : '<div class="bn-noimg">No picture yet</div>'}</div>`;
  };

  function draw() {
    el.innerHTML = `${list.map((b, i) => {
      const known = links.some(([href]) => href === b.cta_href);
      return `<div class="bn-card" data-i="${i}">
        ${preview(b)}
        ${readOnly ? '' : `<div class="bn-fields">
          <div class="row"><label class="btn btn-sm btn-outline">${b.image ? 'Change picture' : '+ Add picture'}<input type="file" data-b="file" accept="image/png,image/jpeg,image/webp" hidden></label>
            ${b.image ? '<button type="button" class="btn btn-sm btn-ghost" data-b="noimg">Remove picture</button>' : ''}<span class="small muted">Best: a wide photo about 2000 × 860 px, products on the right, empty space on the left for the text. <a href="/admin/photo-guide-bn.html" target="_blank" rel="noopener">Photo guide</a></span></div>
          ${b.image ? `<label class="check bn-wide-check"><input type="checkbox" data-b="wide" ${b.wide ? 'checked' : ''}> <span>Photo fills the whole banner <span class="small muted">· off: the photo sits on the right half</span></span></label>` : ''}
          <label class="f">Headline <span class="req">*</span><input data-b="headline" value="${esc(b.headline)}" maxlength="80" placeholder="e.g. Fresh khejur gur is here"></label>
          <label class="f">Short line under it<input data-b="subline" value="${esc(b.subline)}" maxlength="160" placeholder="e.g. Patali, liquid and nolen gur from Jessore"></label>
          <div class="grid-2"><label class="f">Button text<input data-b="cta_text" value="${esc(b.cta_text)}" maxlength="30"></label>
            <label class="f">Button opens<select data-b="link">${links.map(([href, label]) => `<option value="${esc(href)}" ${href === b.cta_href ? 'selected' : ''}>${esc(label)}</option>`).join('')}<option value="other" ${known ? '' : 'selected'}>Another link…</option></select></label></div>
          <label class="f" ${known ? 'hidden' : ''}>Link<input data-b="cta_href" value="${esc(b.cta_href)}" placeholder="/c/khejur-gur or https://…"></label>
          <div class="bn-colors" role="radiogroup" aria-label="Colour">${THEMES.map(([id, name, bg]) => `<button type="button" class="bn-color" role="radio" aria-checked="${b.theme === id}" data-theme="${id}" title="${name}"><span style="background:${bg}"></span>${name}</button>`).join('')}</div>
          <div class="row bn-actions"><button type="button" class="btn btn-sm btn-ghost" data-b="up" ${i === 0 ? 'disabled' : ''}>↑ Move up</button><button type="button" class="btn btn-sm btn-ghost" data-b="down" ${i === list.length - 1 ? 'disabled' : ''}>↓ Move down</button><button type="button" class="btn btn-sm btn-ghost" data-b="remove">Remove</button></div>
        </div>`}</div>`;
    }).join('')}
    ${!readOnly && list.length < max ? `<button type="button" class="btn btn-outline" data-b="add">+ Add ${list.length ? 'another ' : 'a '}banner</button>` : ''}
    ${!list.length && readOnly ? '<p class="muted small">No banners.</p>' : ''}`;
    wire();
  }

  // Keeps typed text in the list without redrawing (so the cursor stays put) and refreshes that card's preview.
  function wire() {
    el.querySelectorAll('.bn-card').forEach(card => {
      const i = Number(card.dataset.i);
      const b = list[i];
      const refresh = () => { card.querySelector('.bn-preview').outerHTML = preview(b); };
      card.querySelectorAll('input[data-b]:not([type=file])').forEach(inp => inp.addEventListener('input', () => { b[inp.dataset.b] = inp.value; refresh(); }));
      card.querySelector('[data-b=link]')?.addEventListener('change', e => {
        const other = e.target.value === 'other';
        card.querySelector('[data-b=cta_href]').closest('label').hidden = !other;
        if (!other) b.cta_href = e.target.value;
      });
      card.querySelectorAll('.bn-color').forEach(btn => btn.addEventListener('click', () => { b.theme = btn.dataset.theme; draw(); }));
      card.querySelector('[data-b=file]')?.addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const fd = new FormData();
          const photo = await compressImage(file);
          appendImage(fd, photo);
          b.image = (await api('/banner-image', 'POST', fd)).url;
          b.wide = Boolean(photo.width && photo.width / photo.height >= WIDE_RATIO);
          toast('Picture added. Remember to save.');
          draw();
        } catch (err) { toast(err.message, true); }
      });
      card.querySelector('[data-b=wide]')?.addEventListener('change', e => { b.wide = e.target.checked; refresh(); });
      card.querySelector('[data-b=noimg]')?.addEventListener('click', () => { b.image = ''; b.wide = false; draw(); });
      card.querySelector('[data-b=up]')?.addEventListener('click', () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; draw(); });
      card.querySelector('[data-b=down]')?.addEventListener('click', () => { [list[i + 1], list[i]] = [list[i], list[i + 1]]; draw(); });
      card.querySelector('[data-b=remove]')?.addEventListener('click', () => { list.splice(i, 1); draw(); });
    });
    el.querySelector('[data-b=add]')?.addEventListener('click', () => { list.push(blank()); draw(); el.querySelector('.bn-card:last-of-type [data-b=headline]')?.focus(); });
  }

  draw();
  return {
    /** Banners with a headline, trimmed; empty optional fields dropped. */
    value() {
      return list.filter(b => b.headline.trim()).map(b => {
        const out = { headline: b.headline.trim(), cta_text: b.cta_text.trim() || 'Shop now', cta_href: b.cta_href.trim() || '/shop', theme: b.theme };
        if (b.subline.trim()) out.subline = b.subline.trim();
        if (b.image) out.image = b.image;
        if (b.image && b.wide) out.wide = true;
        return out;
      });
    },
  };
}
