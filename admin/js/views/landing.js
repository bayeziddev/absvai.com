// Landing pages: one sales page per offer, as many as you like. The list shows each page's visits, orders, sales and
// conversion; the editor fills every section (top, photos, description, details, video, reviews, FAQ, order button).
import { api, badge, busy, can, confirmBox, esc, fromPaisa, taka, toast, toPaisa } from '../app.js';
import { appendImage, compressImage } from './products.js';

const ACCENTS = [['chili', '#B3261E', 'Red'], ['leaf', '#2E7D32', 'Green'], ['clove', '#2A1F1A', 'Dark'], ['blue', '#1D4ED8', 'Blue'], ['purple', '#7C3AED', 'Purple']];
const DEFAULT_FAQ = [
  { q: 'ডেলিভারি পেতে কত দিন লাগে?', a: 'ঢাকা সিটিতে ১–২ দিন, ঢাকার আশেপাশে ২–৩ দিন, সারা দেশে ৩–৫ দিন।' },
  { q: 'টাকা কখন দেব?', a: 'পণ্য হাতে পেয়ে, দেখে, তারপর ডেলিভারি ম্যানকে টাকা দেবেন (ক্যাশ অন ডেলিভারি)।' },
  { q: 'পণ্য পছন্দ না হলে কী করব?', a: 'ডেলিভারির সময় পণ্য দেখে নিন। সমস্যা থাকলে ডেলিভারি ম্যানের সামনেই ফেরত দিতে পারবেন।' },
];

export async function landing(v, args = []) {
  if (args[0]) return editor(v, args[0] === 'new' ? null : Number(args[0]));
  const rows = await api('/landing-pages');
  const write = can('catalog:write');
  const origin = location.origin;
  v.innerHTML = `<div class="page-head"><div><h1>Landing pages</h1><p>A sales page for one product, made for Facebook and Google ads: big photos, the details, a video, reviews, questions and <b>Order now</b> buttons that open the order form on the same page. Make as many as you like.</p></div>
      ${write ? '<a class="btn btn-primary" href="#/landing/new">+ New landing page</a>' : ''}</div>
    ${rows.length ? `<div class="table-wrap"><table><thead><tr><th></th><th>Page</th><th>Product</th><th>Status</th><th class="right">Visits</th><th class="right">Orders</th><th class="right">Sales</th><th class="right">Conversion</th><th></th></tr></thead><tbody>
      ${rows.map(r => `<tr><td><img class="thumb" src="${esc(r.image_url ?? '/img/placeholders/none.svg')}" alt=""></td>
        <td><b>${esc(r.title)}</b><br><a class="small" href="/lp/${esc(r.slug)}" target="_blank" rel="noopener">/lp/${esc(r.slug)}</a></td>
        <td class="small">${esc(r.product_name ?? '—')}${r.product_status && r.product_status !== 'published' ? ` ${badge(r.product_status)}` : ''}</td>
        <td>${badge(r.status)}</td><td class="right">${r.views}</td><td class="right">${r.orders}</td><td class="right">${taka(r.revenue_paisa)}</td>
        <td class="right">${r.views ? `${((r.orders / r.views) * 100).toFixed(1)}%` : '—'}</td>
        <td class="row">${write ? `<a class="btn btn-sm btn-primary" href="#/landing/${r.id}">Edit</a>` : ''}<button class="btn btn-sm btn-outline" data-copy-link="${esc(`${origin}/lp/${r.slug}`)}">Copy link</button>${write ? `<button class="btn btn-sm btn-ghost" data-dup="${r.id}">Copy page</button><button class="btn btn-sm btn-ghost" data-del="${r.id}">Delete</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="card empty-state"><h2>No landing page yet</h2><p>Make your first one: choose a product and the page fills itself with its name, photos and description. Add a headline and an offer, then publish and put the link in your ad.</p>${write ? '<a class="btn btn-primary" href="#/landing/new">+ New landing page</a>' : ''}</div>`}`;
  v.querySelectorAll('[data-copy-link]').forEach(b => b.addEventListener('click', async () => { try { await navigator.clipboard.writeText(b.dataset.copyLink); toast('Link copied. Paste it in your ad or post.'); } catch { prompt('Copy the link:', b.dataset.copyLink); } }));
  v.querySelectorAll('[data-dup]').forEach(b => busy(b, async () => { const r = await api(`/landing-pages/${b.dataset.dup}/copy`, 'POST', {}); toast('Copied as a draft.'); location.hash = `#/landing/${r.id}`; }));
  v.querySelectorAll('[data-del]').forEach(b => busy(b, async () => { if (!(await confirmBox('Delete this landing page? Its link stops working. Orders it brought stay in Orders and Reports.'))) return; await api(`/landing-pages/${b.dataset.del}`, 'DELETE'); toast('Deleted.'); landing(v); }));
}

const blank = () => ({
  badge: '', headline: '', subheadline: '', heroImage: null, regularPricePaisa: null, gallery: [], description: '', points: [], details: [], video: { title: '', url: '', description: '' },
  reviews: [], showProductReviews: true, faq: DEFAULT_FAQ.map(f => ({ ...f })), ctaText: 'এখনই অর্ডার করুন', ctaNote: 'ক্যাশ অন ডেলিভারি · পণ্য হাতে পেয়ে টাকা দিন', couponCode: null, variantIds: null,
  accent: 'chili', stickyBar: true, focusMode: true,
});

async function uploadPhoto(file) {
  const fd = new FormData();
  appendImage(fd, await compressImage(file));
  return (await api('/landing-image', 'POST', fd)).url;
}

async function editor(v, id) {
  const [page, products, coupons] = await Promise.all([id ? api(`/landing-pages/${id}`) : null, api('/products?status=published'), api('/coupons').catch(() => [])]);
  const meta = { title: page?.title ?? '', slug: page?.slug ?? '', productId: page?.product_id ?? null, status: page?.status ?? 'draft' };
  const c = { ...blank(), ...(page?.content ?? {}) };
  if (!c.video) c.video = { title: '', url: '', description: '' };
  let product = null;
  const loadProduct = async () => { product = meta.productId ? await api(`/products/${meta.productId}`).catch(() => null) : null; };
  await loadProduct();
  const write = can('catalog:write');

  /** A new page takes the product's name, line, description, photos and benefit chips into the empty sections. */
  const fillFromProduct = () => {
    if (!product) return;
    const p = product.product;
    if (!meta.title) meta.title = p.name;
    if (!c.headline) c.headline = p.name;
    if (!c.subheadline && p.short_description) c.subheadline = p.short_description;
    if (!c.description && p.description) c.description = p.description;
    if (!c.points.length && p.benefit_chips?.length) c.points = [...p.benefit_chips];
    const photos = product.media.filter(m => m.kind === 'image').map(m => m.url);
    if (!c.heroImage && photos[0]) c.heroImage = photos[0];
    if (!c.gallery.length && photos.length > 1) c.gallery = photos.slice(1, 9);
    if (!c.video.url && p.video_url) c.video.url = p.video_url;
  };

  const thumb = (url, i, list) => `<div class="lp-thumb"><img src="${esc(url)}" alt=""><div class="row">${i > 0 ? `<button type="button" class="btn btn-sm btn-ghost" data-move="${list}:${i}:-1" aria-label="Move left">←</button>` : ''}<button type="button" class="btn btn-sm btn-ghost" data-rm="${list}:${i}">Remove</button></div></div>`;
  const rows = (list, fields) => c[list].map((x, i) => `<div class="lp-rowedit" data-row="${list}:${i}">${fields.map(([k, label, kind]) => kind === 'area'
    ? `<label class="f">${label}<textarea rows="2" data-rk="${k}">${esc(x[k] ?? '')}</textarea></label>`
    : kind === 'stars' ? `<label class="f">${label}<select data-rk="${k}">${[5, 4, 3, 2, 1].map(n => `<option value="${n}" ${Number(x[k]) === n ? 'selected' : ''}>${'★'.repeat(n)}</option>`).join('')}</select></label>`
    : `<label class="f">${label}<input data-rk="${k}" value="${esc(x[k] ?? '')}"></label>`).join('')}
      ${list === 'reviews' ? `<div class="lp-rev-photo">${x.image ? `<img src="${esc(x.image)}" alt="">` : ''}<label class="btn btn-sm btn-outline">${x.image ? 'Change photo' : '+ Photo (optional)'}<input type="file" accept="image/*" hidden data-rev-photo="${i}"></label></div>` : ''}
      <button type="button" class="btn btn-sm btn-ghost" data-rm="${list}:${i}">Remove</button></div>`).join('');

  const draw = () => {
    const variants = product?.variants?.filter(x => x.isActive !== false) ?? [];
    const shown = c.variantIds ?? variants.map(x => x.id);
    v.innerHTML = `<div class="page-head"><div><h1>${id ? 'Edit landing page' : 'New landing page'}</h1><p>Fill what you need; empty sections don’t show on the page. ${meta.slug && id ? `Link: <a href="/lp/${esc(meta.slug)}" target="_blank" rel="noopener">${esc(location.origin)}/lp/${esc(meta.slug)}</a>` : ''}</p></div><a class="btn btn-outline" href="#/landing">← All landing pages</a></div>
      <form id="lpf" class="lp-editor">
      <div class="card"><h2>1. Page and product</h2>
        <div class="grid-2"><label class="f">Product this page sells *<select id="product"><option value="">Choose…</option>${products.map(p => `<option value="${p.id}" ${p.id === meta.productId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
          <label class="f">Page name (for you) *<input id="title" value="${esc(meta.title)}" maxlength="120" placeholder="e.g. Khejur gur winter offer"></label></div>
        <label class="f">Page address <span class="help">Letters, numbers and dashes. Leave empty to make one from the page name.</span><span class="row"><span class="muted small">${esc(location.origin)}/lp/</span><input id="slug" value="${esc(meta.slug)}" maxlength="60" placeholder="khejur-gur-offer" style="flex:1"></span></label>
        ${!products.length ? '<p class="notice err">Publish a product first; a landing page sells a live product.</p>' : ''}</div>

      <div class="card"><h2>2. Top of the page</h2>
        <label class="f">Offer badge <span class="help">A short line on a coloured tag, e.g. “আজকের অফার ২০% ছাড়”.</span><input data-k="badge" value="${esc(c.badge)}" maxlength="60"></label>
        <label class="f">Headline * <span class="help">The first thing people read: what it is and why they want it.</span><input data-k="headline" value="${esc(c.headline)}" maxlength="140"></label>
        <label class="f">Line under the headline<textarea data-k="subheadline" rows="2" maxlength="300">${esc(c.subheadline)}</textarea></label>
        <div class="grid-2"><div class="f"><b>Main photo</b><div class="lp-hero-edit">${c.heroImage ? `<img src="${esc(c.heroImage)}" alt="">` : '<span class="muted small">No photo: the product’s first photo is used.</span>'}</div>
            <label class="btn btn-sm btn-outline">${c.heroImage ? 'Change photo' : '+ Upload photo'}<input type="file" accept="image/*" hidden id="hero-file"></label> ${c.heroImage ? '<button type="button" class="btn btn-sm btn-ghost" id="hero-rm">Remove</button>' : ''}</div>
          <label class="f">Regular price, crossed out (৳) <span class="help">Optional. Shows “৳X ছাড়” next to the real price${variants[0] ? ` (${taka(variants[0].pricePaisa)})` : ''}.</span><input id="was" inputmode="decimal" value="${esc(fromPaisa(c.regularPricePaisa))}"></label></div></div>

      <div class="card"><h2>3. More photos</h2><p class="small muted">Up to 12. They show in a grid; tapping one opens it big.</p>
        <div class="lp-thumbs">${c.gallery.map((u, i) => thumb(u, i, 'gallery')).join('') || '<span class="muted small">No photos yet.</span>'}</div>
        <label class="btn btn-outline" style="margin-top:10px">+ Add photos<input type="file" accept="image/*" multiple hidden id="gallery-file"></label></div>

      <div class="card"><h2>4. Description and benefits</h2>
        <label class="f">Description <span class="help">A blank line starts a new paragraph.</span><textarea data-k="description" rows="6" maxlength="4000">${esc(c.description)}</textarea></label>
        <label class="f">Benefits <span class="help">One per line; each shows with a green tick. e.g. “১০০% খাঁটি, কোনো ভেজাল নেই”.</span><textarea id="points" rows="5">${esc(c.points.join('\n'))}</textarea></label>
        <h3>Details table <span class="help">e.g. Weight → 1 kg, Origin → Jashore.</span></h3><div id="details">${rows('details', [['label', 'Name'], ['value', 'Value']])}</div>
        <button type="button" class="btn btn-sm btn-outline" data-add="details">+ Add a detail</button></div>

      <div class="card"><h2>5. Video</h2>
        <div class="grid-2"><label class="f">Video title<input data-vk="title" value="${esc(c.video.title)}" maxlength="120" placeholder="e.g. দেখুন কীভাবে তৈরি হয়"></label>
          <label class="f">YouTube link <span class="help">Plays on the page when tapped.</span><input data-vk="url" value="${esc(c.video.url)}" maxlength="300" placeholder="https://www.youtube.com/watch?v=…"></label></div>
        <label class="f">About the video<textarea data-vk="description" rows="2" maxlength="1000">${esc(c.video.description)}</textarea></label></div>

      <div class="card"><h2>6. Reviews</h2>
        <label class="check"><input type="checkbox" id="prodrev" ${c.showProductReviews ? 'checked' : ''}> Also show the product’s published customer reviews (<a href="#/reviews">Reviews</a>)</label>
        <p class="small muted">Add what customers told you (Facebook, WhatsApp). Only real reviews.</p>
        <div id="reviews">${rows('reviews', [['name', 'Name'], ['place', 'Place (optional)'], ['rating', 'Stars', 'stars'], ['text', 'What they said', 'area']])}</div>
        <button type="button" class="btn btn-sm btn-outline" data-add="reviews">+ Add a review</button></div>

      <div class="card"><h2>7. Questions (FAQ)</h2>
        <div id="faq">${rows('faq', [['q', 'Question'], ['a', 'Answer', 'area']])}</div>
        <button type="button" class="btn btn-sm btn-outline" data-add="faq">+ Add a question</button></div>

      <div class="card"><h2>8. Order button and form</h2>
        <div class="grid-2"><label class="f">Button text<input data-k="ctaText" value="${esc(c.ctaText)}" maxlength="40"></label>
          <label class="f">Line under the button<input data-k="ctaNote" value="${esc(c.ctaNote)}" maxlength="120"></label></div>
        <label class="f">Coupon applied for everyone on this page <span class="help">Optional. Make it in <a href="#/coupons">Coupons</a>.</span><select id="coupon"><option value="">No coupon</option>${coupons.filter(x => x.is_active).map(x => `<option ${x.code === c.couponCode ? 'selected' : ''}>${esc(x.code)}</option>`).join('')}</select></label>
        ${variants.length > 1 ? `<div class="f"><b>Options customers can choose</b><div class="lp-variants">${variants.map(x => `<label class="check"><input type="checkbox" data-variant="${x.id}" ${shown.includes(x.id) ? 'checked' : ''}> ${esc(Object.values(x.attributes ?? {}).join(' · ') || x.sku)} · ${taka(x.pricePaisa)}</label>`).join('')}</div></div>` : ''}
        <div class="f"><b>Page colour</b><div class="row">${ACCENTS.map(([k, hex, label]) => `<button type="button" class="lp-swatch ${c.accent === k ? 'on' : ''}" data-accent="${k}" style="background:${hex}" aria-label="${label}" title="${label}"></button>`).join('')}</div></div>
        <label class="check"><input type="checkbox" id="sticky" ${c.stickyBar ? 'checked' : ''}> Order bar that follows the customer down the page</label>
        <label class="check"><input type="checkbox" id="focus" ${c.focusMode ? 'checked' : ''}> Focus mode: hide the shop menu, search and cart (recommended for ads)</label></div>
      </form>
      ${write ? `<div class="save-bar"><span class="small muted">${meta.status === 'published' ? `${badge('published')} Live` : `${badge('draft')} Draft`}</span>
        <button class="btn btn-outline" id="save-draft">${meta.status === 'published' ? 'Unpublish (draft)' : 'Save draft'}</button>${id ? '<button class="btn btn-outline" id="preview">Preview</button>' : ''}<button class="btn btn-primary" id="publish">${meta.status === 'published' ? 'Save' : 'Publish'}</button></div>` : ''}`;
    wire();
  };

  const read = () => {
    const $ = s => v.querySelector(s);
    meta.title = $('#title').value.trim(); meta.slug = $('#slug').value.trim();
    v.querySelectorAll('[data-k]').forEach(i => { c[i.dataset.k] = i.value; });
    v.querySelectorAll('[data-vk]').forEach(i => { c.video[i.dataset.vk] = i.value.trim(); });
    c.points = $('#points').value.split('\n').map(x => x.trim()).filter(Boolean);
    const was = $('#was').value.trim();
    c.regularPricePaisa = was ? toPaisa(was) : null;
    v.querySelectorAll('[data-row]').forEach(r => { const [list, i] = r.dataset.row.split(':'); r.querySelectorAll('[data-rk]').forEach(f => { c[list][Number(i)][f.dataset.rk] = f.dataset.rk === 'rating' ? Number(f.value) : f.value; }); });
    c.showProductReviews = $('#prodrev').checked; c.stickyBar = $('#sticky').checked; c.focusMode = $('#focus').checked;
    c.couponCode = $('#coupon').value || null;
    const boxes = [...v.querySelectorAll('[data-variant]')];
    c.variantIds = boxes.length && boxes.some(b => !b.checked) ? boxes.filter(b => b.checked).map(b => Number(b.dataset.variant)) : null;
  };

  const wire = () => {
    const $ = s => v.querySelector(s);
    $('#product').addEventListener('change', async e => { read(); meta.productId = Number(e.target.value) || null; c.variantIds = null; await loadProduct(); if (!id) fillFromProduct(); draw(); });
    v.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => { read(); const list = b.dataset.add; c[list].push(list === 'reviews' ? { name: '', place: '', rating: 5, text: '', image: null } : list === 'faq' ? { q: '', a: '' } : { label: '', value: '' }); draw(); }));
    v.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { read(); const [list, i] = b.dataset.rm.split(':'); c[list].splice(Number(i), 1); draw(); }));
    v.querySelectorAll('[data-move]').forEach(b => b.addEventListener('click', () => { read(); const [list, i, d] = b.dataset.move.split(':').map((x, k) => (k ? Number(x) : x)); [c[list][i + d], c[list][i]] = [c[list][i], c[list][i + d]]; draw(); }));
    v.querySelectorAll('[data-accent]').forEach(b => b.addEventListener('click', () => { read(); c.accent = b.dataset.accent; draw(); }));
    $('#hero-rm')?.addEventListener('click', () => { read(); c.heroImage = null; draw(); });
    $('#hero-file').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; read(); try { toast('Uploading…'); c.heroImage = await uploadPhoto(f); draw(); toast('Photo added. Remember to save.'); } catch (err) { toast(err.message, true); } });
    $('#gallery-file').addEventListener('change', async e => {
      read();
      const files = [...e.target.files].slice(0, 12 - c.gallery.length);
      for (const [n, f] of files.entries()) { try { toast(`Uploading ${n + 1} of ${files.length}…`); c.gallery.push(await uploadPhoto(f)); } catch (err) { toast(err.message, true); } }
      draw(); if (files.length) toast('Photos added. Remember to save.');
    });
    v.querySelectorAll('[data-rev-photo]').forEach(inp => inp.addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; read(); try { c.reviews[Number(inp.dataset.revPhoto)].image = await uploadPhoto(f); draw(); } catch (err) { toast(err.message, true); } }));
    const save = async status => {
      read();
      if (!meta.productId) throw new Error('Choose the product this page sells.');
      const body = { title: meta.title, slug: meta.slug, productId: meta.productId, status, content: c };
      const r = await api(id ? `/landing-pages/${id}` : '/landing-pages', id ? 'PUT' : 'POST', body);
      meta.status = status; meta.slug = r.slug;
      return r;
    };
    if ($('#publish')) busy($('#publish'), async () => { const r = await save('published'); toast(`Live at /lp/${r.slug}. Copy the link from the list for your ad.`); if (!id) location.hash = `#/landing/${r.id}`; else draw(); });
    if ($('#save-draft')) busy($('#save-draft'), async () => { const r = await save('draft'); toast('Saved as a draft (only you can see it with Preview).'); if (!id) location.hash = `#/landing/${r.id}`; else draw(); });
    if ($('#preview')) busy($('#preview'), async () => { const r = await save(meta.status); window.open(`/lp/${r.slug}`, '_blank', 'noopener'); });
  };

  if (!id) fillFromProduct();
  draw();
}
