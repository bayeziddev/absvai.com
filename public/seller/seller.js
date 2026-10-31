// Seller portal: sign in, overview, products (add / edit / photos / price and stock), orders and profile.
// Talks only to /api/seller, which limits every request to the signed-in seller's own products.
const app = document.getElementById('app');
const S = { csrf: '', seller: null, attrTypes: null, cats: null };

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const taka = p => `৳${Math.round((Number(p) || 0) / 100).toLocaleString('en-US')}`;
const toPaisa = v => (v === '' || v === null || v === undefined ? null : Math.round(Number(String(v).replace(/[^\d.]/g, '')) * 100));
const date = s => (s ? new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' }) : '');
const STATUS = { new: 'New', confirmed: 'Confirmed', packed: 'Packed', in_courier: 'With courier', delivered: 'Delivered', partial_delivered: 'Partly delivered', cancelled: 'Cancelled', returned: 'Returned' };

let toastTimer;
function toast(msg, err = false) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = `toast${err ? ' err' : ''}`; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
}

async function api(path, method = 'GET', body) {
  const opts = { method, credentials: 'same-origin', headers: { 'x-csrf-token': S.csrf } };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(`/api/seller${path}`, opts);
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : {};
  if (r.status === 401 && path !== '/login') { S.seller = null; login(data.error); throw new Error(data.error ?? 'Please sign in.'); }
  if (!r.ok) throw Object.assign(new Error(data.error ?? 'Something went wrong.'), { status: r.status, data });
  return data;
}

function busy(btn, fn) {
  btn?.addEventListener('click', async e => {
    e.preventDefault();
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Working…';
    try { await fn(); } catch (err) { toast(err.message, true); } finally { btn.disabled = false; btn.textContent = label; }
  });
}

/** Photos are shrunk in the browser (at most 1600 px) with 480 and 960 px copies, like the admin does. */
async function compressImage(file) {
  if (!/^image\/(jpeg|png|webp|avif)$/.test(file.type)) throw new Error('Choose a JPG, PNG or WebP photo.');
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const encode = (cw, ch, type) => { const c = document.createElement('canvas'); c.width = cw; c.height = ch; c.getContext('2d').drawImage(bmp, 0, 0, cw, ch); return new Promise(r => c.toBlob(r, type, type === 'image/webp' ? 0.82 : 0.85)); };
  let blob = await encode(w, h, 'image/webp');
  if (blob.type !== 'image/webp') blob = await encode(w, h, 'image/jpeg');
  const type = blob.type;
  const ext = type === 'image/webp' ? 'webp' : 'jpg';
  const fd = new FormData();
  fd.append('file', new File([blob], `photo.${ext}`, { type }));
  for (const cw of [480, 960]) if (cw < w) fd.append(`file_${cw}`, new File([await encode(cw, Math.round((h * cw) / w), type)], `photo-${cw}.${ext}`, { type }));
  fd.append('width', String(w)); fd.append('height', String(h));
  return fd;
}

// ───────────── Sign in ─────────────

function login(message) {
  app.innerHTML = `<div class="sp-login"><h1 style="margin-top:0">Seller portal</h1><p class="muted">Sign in with the email and password you registered with.</p>
    ${message && message !== 'Please sign in.' ? `<p class="notice">${esc(message)}</p>` : ''}
    <form id="lf"><label class="f">Email<input name="email" type="email" autocomplete="username" required></label>
      <label class="f">Password<input name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn btn-primary" style="width:100%">Sign in</button></form>
    <p class="small" style="margin-top:14px">New seller? <a href="/sell">Register here</a>. Your account works after the shop approves it.</p></div>`;
  const f = app.querySelector('#lf');
  f.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const r = await api('/login', 'POST', { email: f.email.value, password: f.password.value });
      S.csrf = r.csrf; S.seller = r.seller;
      location.hash = '#/overview';
      shell();
    } catch (err) { login(err.message); }
  });
}

// ───────────── Shell and pages ─────────────

const PAGES = { overview: 'Overview', products: 'Products', orders: 'Orders', profile: 'Profile' };

function shell() {
  app.innerHTML = `<header class="sp-top"><a class="wordmark" href="#/overview">${esc(S.seller.shopName)}<small>Seller</small></a>
      <a class="btn btn-outline btn-sm" href="/store/${esc(S.seller.slug)}" target="_blank" rel="noopener">My store page</a><button class="btn btn-ghost btn-sm" id="out">Sign out</button></header>
    <nav class="sp-tabs">${Object.entries(PAGES).map(([k, l]) => `<a href="#/${k}" data-tab="${k}">${l}</a>`).join('')}</nav>
    <main class="sp-main" id="view"></main>`;
  app.querySelector('#out').onclick = async () => { await api('/logout', 'POST', {}).catch(() => {}); S.seller = null; login(); };
  route();
}

function route() {
  if (!S.seller) return;
  const [page, id] = (location.hash.slice(2) || 'overview').split('/');
  app.querySelectorAll('[data-tab]').forEach(a => a.classList.toggle('on', a.dataset.tab === page));
  const v = document.getElementById('view');
  v.innerHTML = '<p class="muted">Loading…</p>';
  const run = page === 'product' ? editProduct(v, Number(id)) : page === 'products' ? products(v) : page === 'orders' ? orders(v) : page === 'profile' ? profile(v) : overview(v);
  run.catch(err => { v.innerHTML = `<p class="notice">${esc(err.message)}</p>`; });
}
addEventListener('hashchange', route);

async function overview(v) {
  const d = await api('/summary');
  v.innerHTML = `<h1>Hello, ${esc(S.seller.ownerName.split(' ')[0])}!</h1>
    <div class="sp-cards">
      <div class="kpi"><span>Live in the shop</span><b>${d.live}</b></div>
      <div class="kpi"><span>Waiting for approval</span><b>${d.waiting}</b></div>
      <div class="kpi"><span>Sold this month</span><b>${d.unitsMonth} item(s)</b><span class="small muted">${taka(d.salesMonthPaisa)}</span></div>
      <div class="kpi"><span>Your earnings (delivered)</span><b>${taka(d.earnedPaisa)}</b><span class="small muted">after ${d.commissionPercent}% commission</span></div>
      <div class="kpi"><span>On the way to customers</span><b>${taka(d.onTheWayPaisa)}</b><span class="small muted">paid once delivered</span></div>
    </div>
    ${d.changesNeeded ? `<p class="notice">${d.changesNeeded} product(s) need changes before they can go live. <a href="#/products">See what to change</a>.</p>` : ''}
    <div class="card"><h2>How it works</h2><ol><li><b>Add a product</b> with photos, a clear name, prices and stock.</li><li>Press <b>Send for approval</b>. The shop checks it and puts it live.</li><li>Customers order on the shop; the shop calls them, delivers and collects the money.</li><li>You see every sale under <b>Orders</b>, and get paid for delivered sales (after commission) to your ${esc(({ bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket', bank: 'bank' })[S.seller.payoutMethod] ?? 'payment')} account.</li></ol>
      <a class="btn btn-primary" href="#/products">+ Add a product</a></div>`;
}

const reviewBadge = p => p.status === 'published' ? '<span class="badge b-green">Live</span>' : p.review_status === 'pending' ? '<span class="badge b-yellow">Waiting for approval</span>' : p.review_status === 'rejected' ? '<span class="badge b-red">Changes needed</span>' : '<span class="badge b-grey">Draft</span>';

async function products(v) {
  const list = await api('/products');
  v.innerHTML = `<div class="page-head"><div><h1>Products</h1><p>Price and stock changes go live right away. Other changes are checked by the shop first.</p></div><button class="btn btn-primary" id="new">+ Add a product</button></div>
    <div class="sp-list">${list.map(p => `<button class="sp-item" data-id="${p.id}"><img src="${esc(p.image_url ?? '/img/placeholders/none.svg')}" alt=""><span><b>${esc(p.name)}</b><small>${esc(p.category_name)} · ${p.min_price ? taka(p.min_price) : 'no price yet'} · stock ${p.stock ?? 0}</small>${p.review_status === 'rejected' && p.review_note ? `<small style="color:#B3261E">To change: ${esc(p.review_note)}</small>` : ''}</span>${reviewBadge(p)}</button>`).join('') || '<p class="muted">No products yet. Add your first one.</p>'}</div>`;
  v.querySelectorAll('.sp-item').forEach(b => b.addEventListener('click', () => { location.hash = `#/product/${b.dataset.id}`; }));
  v.querySelector('#new').addEventListener('click', () => newProduct(v));
}

async function newProduct(v) {
  S.cats ??= await api('/categories');
  const byParent = id => S.cats.filter(c => (c.parentId ?? null) === id);
  const options = (id, depth) => byParent(id).map(c => `<option value="${c.id}">${'— '.repeat(depth)}${esc(c.name)}</option>${options(c.id, depth + 1)}`).join('');
  v.innerHTML = `<h1>Add a product</h1><div class="card"><label class="f">Category <span class="help">It decides which details the product needs.</span><select id="cat"><option value="">Choose…</option>${options(null, 0)}</select></label>
    <label class="f">Product name<input id="name" maxlength="160" placeholder="e.g. Khejur Patali Gur 500g"></label><div class="row"><button class="btn btn-primary" id="go">Continue</button><a class="btn btn-ghost" href="#/products">Cancel</a></div></div>`;
  busy(v.querySelector('#go'), async () => {
    const categoryId = Number(v.querySelector('#cat').value);
    if (!categoryId) throw new Error('Choose a category.');
    const r = await api('/products', 'POST', { categoryId, name: v.querySelector('#name').value.trim() });
    location.hash = `#/product/${r.id}`;
  });
}

/** Every combination of the chosen option values (e.g. 500g and 1kg × Plain and Spicy). */
function combos(attrs, chosen) {
  const used = attrs.filter(a => (chosen[a.attributeTypeId] ?? []).length);
  return used.reduce((acc, a) => acc.flatMap(c => chosen[a.attributeTypeId].map(val => ({ ...c, [a.attributeTypeId]: val }))), [{}]);
}
const keyOf = attrs => JSON.stringify(Object.keys(attrs).sort().map(k => [k, attrs[k]]));

async function editProduct(v, id) {
  S.attrTypes ??= await api('/attribute-types');
  let d = await api(`/products/${id}`);
  const live = d.product.status === 'published';
  const attrs = d.effectiveVariantAttributes;
  const chosen = {};
  for (const a of attrs) chosen[a.attributeTypeId] = [...new Set(d.variants.map(x => x.attributes[a.attributeTypeId]).filter(Boolean))];
  const rows = new Map(d.variants.map(x => [keyOf(x.attributes), { ...x }]));

  const field = f => {
    const val = d.specs[f.key] ?? '';
    const label = `${esc(f.label)}${f.unit ? ` (${esc(f.unit)})` : ''}${f.required ? ' <span class="req">*</span>' : ''}${f.helpText ? ` <span class="help">${esc(f.helpText)}</span>` : ''}`;
    if (f.type === 'longtext') return `<label class="f">${label}<textarea data-spec="${f.key}" rows="3">${esc(val)}</textarea></label>`;
    if (f.type === 'select') return `<label class="f">${label}<select data-spec="${f.key}"><option value="">Choose…</option>${(f.options ?? []).map(o => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
    if (f.type === 'boolean') return `<label class="check"><input type="checkbox" data-spec="${f.key}" ${val === '1' ? 'checked' : ''}> ${label}</label>`;
    if (f.type === 'file') return '';
    return `<label class="f">${label}<input data-spec="${f.key}" type="${f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}" value="${esc(val)}" placeholder="${esc(f.placeholder ?? '')}"></label>`;
  };

  function optionRows() {
    const list = attrs.length ? combos(attrs, chosen) : [{}];
    return list.map(a => { const r = rows.get(keyOf(a)) ?? {}; return `<div class="sp-opt" data-key="${esc(keyOf(a))}"><b>${esc(Object.values(a).join(' · ') || 'Price and stock')}</b>
      <label>Price ৳<input data-r="price" inputmode="decimal" value="${r.pricePaisa ? r.pricePaisa / 100 : ''}"></label><label>Was ৳ <small>optional</small><input data-r="compare" inputmode="decimal" value="${r.compareAtPricePaisa ? r.compareAtPricePaisa / 100 : ''}"></label>
      <label>Stock<input data-r="stock" inputmode="numeric" value="${r.stock ?? 0}"></label><label>Parcel weight (g)<input data-r="weight" inputmode="numeric" value="${r.packedWeightGrams || ''}"></label></div>`; }).join('');
  }

  function draw() {
    const state = live ? ['live', 'Live in the shop. Price and stock changes go live at once; other changes hide the product until the shop approves them.'] : d.review.status === 'pending' ? ['pending', 'Waiting for the shop’s approval. You can still make changes.'] : d.review.status === 'rejected' ? ['rejected', `Changes needed: ${d.review.note ?? ''}`] : ['', 'Draft: finish the details below, then press Send for approval.'];
    v.innerHTML = `<a href="#/products" class="small">← All products</a><h1>${esc(d.product.name)}</h1>
      <div class="sp-state ${state[0]}">${esc(state[1])}</div>
      <div class="card"><h2>Photos</h2><div class="sp-photos">${d.media.filter(m => m.kind === 'image').map(m => `<figure><img src="${esc(m.url)}" alt=""><button type="button" data-del="${m.id}" aria-label="Remove photo">×</button></figure>`).join('')}
        <label class="sp-add-photo">+ Add photo<input type="file" id="photo" accept="image/png,image/jpeg,image/webp" multiple hidden></label></div><p class="small muted">Clear photos on a plain background sell best. The first photo shows on the product card.</p></div>
      <div class="card"><h2>Basics</h2>
        <label class="f">Product name <span class="req">*</span><input id="name" value="${esc(d.product.name)}" maxlength="160"></label>
        <label class="f">One line about it <span class="help">Shown on the product card.</span><input id="short" value="${esc(d.product.short_description ?? '')}" maxlength="300"></label>
        <label class="f">Description<textarea id="desc" rows="5" maxlength="10000">${esc(d.product.description ?? '')}</textarea></label>
        ${d.template.requiresBrand ? `<label class="f">Brand <span class="req">*</span><input id="brand" value="${esc(d.product.brand ?? '')}" maxlength="80"></label>` : ''}</div>
      ${d.effectiveSpecFields.length ? `<div class="card"><h2>Details</h2>${d.effectiveSpecFields.map(field).join('')}</div>` : ''}
      <div class="card"><h2>Options, prices and stock</h2>
        ${attrs.map(a => { const pool = [...new Set([...(a.presetValues ?? []), ...(S.attrTypes.find(t => t.id === a.attributeTypeId)?.values ?? []).map(x => x.value), ...chosen[a.attributeTypeId]])]; return `<p style="margin:8px 0 0"><b>${esc(a.label)}</b>${a.required ? ' <span class="req">*</span>' : ''} <span class="help">Tap the ones you sell</span></p>
          <div class="sp-chips" data-attr="${a.attributeTypeId}">${pool.map(val => `<button type="button" aria-pressed="${chosen[a.attributeTypeId].includes(val)}" data-val="${esc(val)}">${esc(val)}</button>`).join('')}${a.allowCustomValues ? '<button type="button" data-custom>+ Other</button>' : ''}</div>`; }).join('')}
        <div id="rows">${optionRows()}</div>
        <p class="small muted">Parcel weight is the packed weight with the box, for the delivery charge.</p></div>
      <div class="card"><h2>Before it can go live</h2>${d.checklist.ready ? '<p class="sp-ready">✓ Everything is filled in.</p>' : `<ul class="sp-check">${d.checklist.items.filter(i => !i.ok).map(i => `<li>${esc(i.message)}</li>`).join('')}</ul>`}<p class="small muted">This list updates when you press Save.</p></div>
      <div class="sp-actions">${live ? '<button class="btn btn-outline" id="stock">Save price & stock only</button>' : ''}<button class="btn btn-primary" id="save">Save</button>${!live && d.review.status !== 'pending' ? '<button class="btn btn-leaf" id="submit">Send for approval</button>' : ''}${d.product.status === 'draft' ? '<button class="btn btn-ghost" id="del">Delete</button>' : ''}</div>`;
    wire();
  }

  const readRows = () => [...v.querySelectorAll('#rows [data-key]')].map(tr => {
    const key = tr.dataset.key;
    const before = rows.get(key);
    const get = n => tr.querySelector(`[data-r=${n}]`).value;
    return { id: before?.id ?? null, attributes: Object.fromEntries(JSON.parse(key)), pricePaisa: toPaisa(get('price')) ?? 0, compareAtPricePaisa: toPaisa(get('compare')), stock: Number(get('stock')) || 0, packedWeightGrams: Number(get('weight')) || 0 };
  });
  const keepTyped = () => { for (const r of readRows()) rows.set(keyOf(r.attributes), { ...(rows.get(keyOf(r.attributes)) ?? {}), ...r }); };

  function wire() {
    v.querySelectorAll('[data-attr]').forEach(group => group.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      keepTyped();
      const list = chosen[group.dataset.attr];
      if (b.dataset.custom !== undefined) { const val = prompt('Type the option (e.g. 2kg)')?.trim(); if (val && !list.includes(val)) list.push(val); }
      else { const val = b.dataset.val; const i = list.indexOf(val); if (i >= 0) list.splice(i, 1); else list.push(val); }
      draw();
    }));
    v.querySelector('#photo').addEventListener('change', async e => {
      for (const file of e.target.files) {
        try { const fd = await compressImage(file); fd.append('productId', String(id)); fd.append('kind', 'image'); fd.append('alt', d.product.name); await api('/media', 'POST', fd); } catch (err) { toast(err.message, true); }
      }
      keepTyped(); d = { ...d, media: (await api(`/products/${id}`)).media }; draw(); toast('Photo added.');
    });
    v.querySelectorAll('[data-del]').forEach(b => busy(b, async () => { await api(`/products/${id}/media/${b.dataset.del}`, 'DELETE'); keepTyped(); d = { ...d, media: (await api(`/products/${id}`)).media }; draw(); }));
    const body = () => ({
      name: v.querySelector('#name').value.trim(), shortDescription: v.querySelector('#short').value.trim(), description: v.querySelector('#desc').value.trim(), brand: v.querySelector('#brand')?.value.trim(),
      specs: Object.fromEntries([...v.querySelectorAll('[data-spec]')].map(i => [i.dataset.spec, i.type === 'checkbox' ? (i.checked ? '1' : '0') : i.value.trim()]).filter(([, x]) => x !== '')),
      variants: readRows(),
    });
    busy(v.querySelector('#save'), async () => {
      const r = await api(`/products/${id}`, 'PUT', body());
      toast(r.message ?? 'Saved.');
      d = r; route();
    });
    busy(v.querySelector('#stock'), async () => {
      const r = await api(`/products/${id}/stock`, 'PUT', { variants: readRows().filter(x => x.id) });
      toast(r.message ?? 'Saved.'); d = r; draw();
    });
    busy(v.querySelector('#submit'), async () => {
      await api(`/products/${id}`, 'PUT', body());
      const r = await api(`/products/${id}/submit`, 'POST', {});
      toast(r.message); route();
    });
    busy(v.querySelector('#del'), async () => { if (!confirm('Delete this draft?')) return; await api(`/products/${id}`, 'DELETE'); location.hash = '#/products'; });
  }
  draw();
}

async function orders(v) {
  const list = await api('/orders');
  v.innerHTML = `<h1>Orders</h1><p class="muted">Every order with your products. The shop confirms, packs and delivers them; you are paid for delivered sales.</p>
    <div class="table-wrap"><table><thead><tr><th>Order</th><th>Product</th><th>Qty</th><th>Amount</th><th>Area</th><th>Status</th></tr></thead><tbody>
    ${list.map(o => `<tr><td><b>${esc(o.order_no)}</b><br><span class="small muted">${date(o.created_at)}</span></td><td>${esc(o.name)}${o.variant_label ? ` <span class="muted">(${esc(o.variant_label)})</span>` : ''}</td><td>${o.qty}</td><td>${taka(o.line_total_paisa)}</td><td class="small">${esc(o.upazila_name)}, ${esc(o.district_name)}</td><td>${esc(STATUS[o.status] ?? o.status)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No orders yet.</td></tr>'}
    </tbody></table></div>`;
}

async function profile(v) {
  const s = (await api('/me')).seller;
  S.seller = s;
  v.innerHTML = `<h1>Profile</h1><div class="card"><p class="small muted">Shop: <b>${esc(s.shopName)}</b> · Email: ${esc(s.email)} · Commission: ${s.commissionPercent}% · To change the shop name or email, contact the shop.</p>
      <div class="grid-2"><label class="f">Mobile<input id="phone" value="${esc(s.phone)}"></label><label class="f">District<input id="district" value="${esc(s.district ?? '')}"></label></div>
      <label class="f">Address<input id="address" value="${esc(s.address ?? '')}"></label>
      <label class="f">About your shop <span class="help">Shown on your store page.</span><textarea id="about" rows="3" maxlength="600">${esc(s.about ?? '')}</textarea></label>
      <div class="grid-2"><label class="f">Get paid by<select id="pm">${['bkash', 'nagad', 'rocket', 'bank'].map(m => `<option value="${m}" ${s.payoutMethod === m ? 'selected' : ''}>${m === 'bank' ? 'Bank account' : m[0].toUpperCase() + m.slice(1)}</option>`).join('')}</select></label><label class="f">Payment number / account<input id="pn" value="${esc(s.payoutNumber ?? '')}"></label></div>
      <button class="btn btn-primary" id="save">Save</button></div>
    <div class="card"><h2>Change password</h2><div class="grid-2"><label class="f">Current password<input id="cur" type="password" autocomplete="current-password"></label><label class="f">New password <span class="help">10+ characters with a number</span><input id="nw" type="password" autocomplete="new-password"></label></div><button class="btn btn-outline" id="pw">Change password</button></div>`;
  const g = s2 => v.querySelector(s2).value.trim();
  busy(v.querySelector('#save'), async () => { const r = await api('/profile', 'PUT', { phone: g('#phone'), district: g('#district'), address: g('#address'), about: g('#about'), payoutMethod: g('#pm'), payoutNumber: g('#pn') }); S.seller = r.seller; toast('Saved.'); });
  busy(v.querySelector('#pw'), async () => { await api('/password', 'PUT', { current: g('#cur'), next: g('#nw') }); toast('Password changed.'); v.querySelector('#cur').value = ''; v.querySelector('#nw').value = ''; });
}

// ───────────── Start ─────────────

(async () => {
  try {
    const r = await api('/me');
    S.csrf = r.csrf; S.seller = r.seller;
    shell();
  } catch { /* login() already shown */ }
})();
