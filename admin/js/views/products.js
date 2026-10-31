import { api, badge, busy, can, confirmBox, date, esc, fromPaisa, qs, slideOver, taka, toast, toPaisa } from '../app.js';
import { quickProduct } from './quick-product.js';

// ───────────── Product list ─────────────

export async function products(v, [id]) {
  const p = qs();
  const status = p.get('status') ?? '';
  const [rows, cats] = await Promise.all([api(`/products?${new URLSearchParams([...p.entries()].filter(([k]) => ['status', 'q', 'category'].includes(k)))}`), api('/categories')]);
  v.innerHTML = `
    <div class="page-head"><div><h1>Products</h1><p>Tap a product to change its photos, prices or stock. “+ Add product” asks only what the category needs.</p></div>
      <div class="row">${can('catalog:write') ? '<button class="btn btn-outline" id="csv">CSV import</button><button class="btn btn-primary" id="new">+ Add product</button>' : ''}</div></div>
    <nav class="tabs">${[['', 'All'], ['published', 'Live'], ['draft', 'Drafts'], ['scheduled', 'Scheduled']].map(([s, l]) => `<a href="#/products${s ? `?status=${s}` : ''}" aria-current="${status === s}">${l}</a>`).join('')}</nav>
    <form class="filters" id="pf"><input class="i" name="q" value="${esc(p.get('q') ?? '')}" placeholder="Name, slug or SKU">
      <select class="i" name="category"><option value="">All categories</option>${cats.map(c => `<option value="${c.id}" ${String(c.id) === p.get('category') ? 'selected' : ''}>${c.parent_id ? '— ' : ''}${esc(c.name)}</option>`).join('')}</select><button class="btn btn-outline">Filter</button></form>
    <div class="table-wrap"><table><thead><tr><th></th><th>Product</th><th>Category / template</th><th class="right">From</th><th class="right">Stock</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map(r => `<tr class="clickable" data-id="${r.id}"><td><img class="thumb" src="${esc(r.image_url ?? '/img/placeholders/none.svg')}" alt=""></td>
      <td><b>${esc(r.name)}</b>${r.is_original ? ' <span class="badge b-green">Original</span>' : ''}<br><span class="small muted">${r.variant_count} option(s) · updated ${date(r.updated_at)}</span></td>
      <td>${esc(r.category_name)}<br><span class="small muted">${esc(r.template_name)}</span></td><td class="right">${taka(r.min_price)}</td><td class="right">${r.fulfilment_mode === 'made_to_order' ? 'made to order' : r.stock ?? 0}</td>
      <td>${badge(r.status)}${r.fulfilment_mode === 'pre_order' ? ' <span class="badge b-yellow">pre-order</span>' : ''}</td>
      <td class="nowrap">${can('catalog:write') ? `<button class="btn btn-sm btn-outline" data-dup="${r.id}">Duplicate</button> ` : ''}<button class="btn btn-sm btn-ghost" data-full="${r.id}" title="Every detail: SEO, seasons, wholesale, barcodes">Full editor</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No products yet. Add your first one.</td></tr>'}
    </tbody></table></div>`;
  v.querySelector('#pf').addEventListener('submit', e => { e.preventDefault(); const f = new URLSearchParams(new FormData(e.target)); for (const [k, x] of [...f]) if (!x) f.delete(k); location.hash = `#/products?${f}`; });
  const refresh = () => products(v, []);
  v.querySelectorAll('tr[data-id]').forEach(r => r.addEventListener('click', e => { if (!e.target.closest('button')) quickProduct(Number(r.dataset.id), { cats, done: refresh }); }));
  v.querySelectorAll('[data-full]').forEach(b => b.addEventListener('click', () => openProduct(Number(b.dataset.full), refresh)));
  v.querySelectorAll('[data-dup]').forEach(b => busy(b, async () => {
    const r = await api(`/products/${b.dataset.dup}/duplicate`, 'POST', {});
    toast('Copied as a draft. SKUs are new and stock is 0.');
    openProduct(r.id, () => products(v, []));
  }));
  v.querySelector('#new')?.addEventListener('click', () => quickProduct(null, { cats, categoryId: Number(p.get('category')) || null, done: refresh }));
  v.querySelector('#csv')?.addEventListener('click', () => csvImport(cats, () => products(v, [])));
  if (p.get('new')) quickProduct(null, { cats, categoryId: Number(p.get('category')) || null, done: refresh });
  if (id) quickProduct(Number(id), { cats, done: refresh });
}

function categoryOptions(cats, selected) {
  // Three levels, in menu order; subcategories that inherit show their parent's template.
  const kids = pid => cats.filter(c => (c.parent_id ?? null) === pid).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const walk = pid => kids(pid).flatMap(c => [c, ...walk(c.id)]);
  const tName = c => c.template_name ?? cats.find(x => x.template_id === c.effective_template_id)?.template_name ?? c.effective_template_id;
  return walk(null)
    .map(c => `<option value="${c.id}" data-template="${esc(c.effective_template_id ?? c.template_id)}" ${c.id === selected ? 'selected' : ''}>${'— '.repeat((c.depth ?? 1) - 1)}${esc(c.name)} (${esc(tName(c))}${c.inherits_template ? ', inherited' : ''})</option>`).join('');
}

function csvImport(cats, done) {
  const so = slideOver('Bulk CSV import');
  so.body.innerHTML = `
    <p>Each template has its own CSV layout, so the columns always match the form. One row per option; rows with the same product name become one product. Everything imports as a <b>draft</b> for you to check and publish.</p>
    <label class="f">Category<select id="cat"><option value="">Choose…</option>${categoryOptions(cats)}</select></label>
    <p><a class="btn btn-outline btn-sm" id="tpl" href="#" aria-disabled="true">Download the CSV template</a></p>
    <label class="f">Your filled-in CSV<input type="file" id="file" accept=".csv,text/csv"></label>
    <div id="res"></div>`;
  so.foot.innerHTML = '<span></span><button class="btn btn-primary" id="go">Import drafts</button>';
  const cat = so.body.querySelector('#cat');
  cat.addEventListener('change', () => { const t = cat.selectedOptions[0]?.dataset.template; so.body.querySelector('#tpl').href = t ? `/api/admin/templates/${t}/csv` : '#'; });
  busy(so.foot.querySelector('#go'), async () => {
    const f = so.body.querySelector('#file').files[0];
    if (!cat.value || !f) throw new Error('Pick the category and the CSV file.');
    const r = await api('/products/import', 'POST', { categoryId: Number(cat.value), csv: await f.text() });
    so.body.querySelector('#res').innerHTML = `<p class="notice ok">${r.created} product(s) imported as drafts.</p>${r.errors.map(e => `<p class="notice err">${esc(e.product)}: ${esc(e.message)}</p>`).join('')}`;
    done();
  });
}

// ───────────── Smart upload form (9 steps) ─────────────

const STEPS = ['Category', 'Basics', 'Details', 'Options & prices', 'Photos & video', 'Season & fulfilment', 'Delivery', 'SEO', 'Publish'];
const PROFILES = { standard: 'Standard parcel', fragile: 'Fragile', heavy_bulky: 'Heavy / bulky', perishable: 'Perishable food' };
const FULFIL = { in_stock: 'In stock', pre_order: 'Pre-order (seasonal)', made_to_order: 'Made to order' };
const keyOf = a => Object.keys(a).filter(k => a[k]).sort().map(k => `${k}=${String(a[k]).toLowerCase()}`).join('|');
const parseNet = s => { const m = String(s ?? '').toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(kg|g|ml|l|pcs|m)\b/); return m ? { value: Number(m[1]), unit: m[2] } : null; };

/** Photos are resized to 1600 px and saved as WebP in the browser before upload. */
/**
 * Shrinks a photo in the browser: at most 1600 px, plus 480 and 960 px wide copies so the store can send phones a
 * small one (worker/src/lib/images.ts). WebP where the browser can make it (Safari can't), JPG otherwise.
 */
export async function compressImage(file) {
  if (!/^image\/(jpeg|png|webp|avif)$/.test(file.type)) return { file, width: null, height: null, copies: [] };
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const encode = async (cw, ch, type) => {
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    canvas.getContext('2d').drawImage(bmp, 0, 0, cw, ch);
    return new Promise(r => canvas.toBlob(r, type, type === 'image/webp' ? 0.82 : 0.85));
  };
  let blob = await encode(w, h, 'image/webp');
  if (blob.type !== 'image/webp') blob = await encode(w, h, 'image/jpeg');
  const type = blob.type;
  const ext = type === 'image/webp' ? 'webp' : 'jpg';
  const name = file.name.replace(/\.\w+$/, '');
  const copies = [];
  for (const cw of [480, 960]) if (cw < w) copies.push([cw, new File([await encode(cw, Math.round((h * cw) / w), type)], `${name}-${cw}.${ext}`, { type })]);
  return { file: new File([blob], `${name}.${ext}`, { type }), width: w, height: h, copies };
}

/** Adds a compressed photo, its smaller copies and its size to an upload form. */
export function appendImage(fd, c) {
  fd.append('file', c.file);
  for (const [cw, f] of c.copies ?? []) fd.append(`file_${cw}`, f);
  if (c.width) { fd.append('width', String(c.width)); fd.append('height', String(c.height)); }
}

/** The full save payload for a product as loaded from the API (both editors start from it, so nothing is lost on save). */
export function productForm(d) {
  const pr = d.product;
  return {
    categoryId: pr.category_id, name: pr.name, slug: pr.slug, code: pr.code, shortDescription: pr.short_description ?? '', description: pr.description ?? '', brand: pr.brand ?? '',
    isOriginal: Boolean(pr.is_original), showOnHome: Boolean(pr.show_on_home), benefitChips: pr.benefit_chips ?? [], specs: { ...d.specs }, promotedSpecKeys: pr.promoted_spec_keys ?? [], seasonIds: d.seasonIds,
    fulfilmentMode: pr.fulfilment_mode, preorderDispatchDate: pr.preorder_dispatch_date ?? '', preorderAdvanceType: pr.preorder_advance_type ?? 'delivery_charge', preorderAdvancePaisa: pr.preorder_advance_paisa,
    madeToOrderLeadDays: pr.made_to_order_lead_days, shippingProfile: pr.shipping_profile, bulkyDeliveryMode: pr.bulky_delivery_mode, freeDelivery: Boolean(pr.free_delivery), videoUrl: pr.video_url ?? '',
    sizeChart: pr.size_chart ?? { columns: d.template.sizeChartColumns, rows: [] }, metaTitle: pr.meta_title ?? '', metaDescription: pr.meta_description ?? '', searchKeywords: pr.search_keywords ?? '',
    variants: d.variants.filter(x => x.isActive).map(x => ({ ...x })),
  };
}

export async function openProduct(id, done, startStep = 1) {
  const [data, cats, seasons, attrTypes] = await Promise.all([api(`/products/${id}`), api('/categories'), api('/season-options'), api('/attribute-types')]);
  let d = data;
  let step = startStep;
  const pr = d.product;
  const f = productForm(d);
  let dirty = false;
  const so = slideOver(`Product · ${pr.name}`, { wide: true, onClose: done });
  const write = can('catalog:write');
  const stepsBar = document.createElement('nav');
  stepsBar.className = 'steps';
  so.head.after(stepsBar);

  const attrsNow = () => {
    const base = d.template.variantAttributes;
    const promoted = d.template.specFields.filter(x => x.canBecomeVariant && f.promotedSpecKeys.includes(x.key)).map(x => ({ attributeTypeId: x.key, label: x.label, required: true, presetValues: [], allowCustomValues: true, promoted: true }));
    return [...base, ...promoted];
  };
  const fieldsNow = () => d.template.specFields.filter(x => !(x.canBecomeVariant && f.promotedSpecKeys.includes(x.key)));
  const images = () => d.media.filter(m => m.kind === 'image');

  function renderSteps() {
    stepsBar.innerHTML = STEPS.map((s, i) => `<button type="button" data-step="${i}" ${i === step ? 'aria-current="step"' : ''}><b>${i + 1}</b>${s}</button>`).join('');
    stepsBar.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { collect(); step = Number(b.dataset.step); render(); }));
  }

  // Reads the current step's inputs into f.
  function collect() {
    so.body.querySelectorAll('[data-k]').forEach(el => {
      const k = el.dataset.k;
      const val = el.type === 'checkbox' ? el.checked : el.value;
      if (k.startsWith('spec.')) {
        const key = k.slice(5);
        if (el.dataset.dim !== undefined) return;
        if (el.type === 'radio') { if (el.checked) f.specs[key] = el.value; return; }
        f.specs[key] = String(val);
      } else if (k === 'preorderAdvancePaisa') f.preorderAdvancePaisa = toPaisa(val);
      else if (k === 'madeToOrderLeadDays') f.madeToOrderLeadDays = val === '' ? null : Number(val);
      else if (el.type === 'radio') { if (el.checked) f[k] = val; }
      else f[k] = val;
    });
    so.body.querySelectorAll('[data-dims]').forEach(box => {
      const parts = [...box.querySelectorAll('input')].map(i => i.value.trim()).filter(Boolean);
      f.specs[box.dataset.dims] = parts.join(' × ');
    });
    const chips = so.body.querySelector('#chips');
    if (chips) f.benefitChips = chips.value.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 4);
    const seasonsBox = so.body.querySelector('#seasons');
    if (seasonsBox) f.seasonIds = [...seasonsBox.querySelectorAll('input:checked')].map(i => Number(i.value));
    const vt = so.body.querySelector('#vt');
    if (vt) {
      vt.querySelectorAll('tr[data-i]').forEach(tr => {
        const v = f.variants[Number(tr.dataset.i)];
        const g = n => tr.querySelector(`[data-v="${n}"]`);
        v.pricePaisa = toPaisa(g('price').value) ?? 0;
        v.compareAtPricePaisa = toPaisa(g('compare').value);
        v.stock = Number(g('stock').value) || 0;
        v.packedWeightGrams = Number(g('packed').value) || 0;
        v.sku = g('sku').value.trim().toUpperCase();
        if (d.canSeeCost) v.costPaisa = toPaisa(g('cost').value);
        v.gtin = g('gtin').value.replace(/\s/g, '') || null;
        v.shelfLocation = g('shelf').value.trim() || null;
        v.isActive = g('active').checked;
        const img = g('image').value;
        v.imageIds = img ? [Number(img)] : [];
        const net = parseNet(g('net').value);
        v.netValue = net?.value ?? null; v.netUnit = net?.unit ?? null;
      });
    }
    const sc = so.body.querySelector('#sizechart');
    if (sc) {
      f.sizeChart = { columns: d.template.sizeChartColumns, rows: [...sc.querySelectorAll('tr[data-size]')].map(tr => ({ size: tr.dataset.size, values: [...tr.querySelectorAll('input')].map(i => i.value) })) };
    }
    dirty = true;
  }

  function field(x) {
    const v = f.specs[x.key] ?? '';
    const req = x.required ? ' <span class="req">*</span>' : '';
    const help = x.helpText ? `<span class="help">${esc(x.helpText)}</span>` : '';
    const promote = x.canBecomeVariant ? `<label class="check small" style="font-weight:400"><input type="checkbox" data-promote="${esc(x.key)}"> Customers choose this (makes it an option with its own price and stock)</label>` : '';
    let input;
    switch (x.type) {
      case 'longtext': input = `<textarea data-k="spec.${esc(x.key)}" rows="3" placeholder="${esc(x.placeholder ?? '')}">${esc(v)}</textarea>`; break;
      case 'number': input = x.unit ? `<div class="unit-wrap"><input type="number" step="any" data-k="spec.${esc(x.key)}" value="${esc(v)}" placeholder="${esc(x.placeholder ?? '')}"><span>${esc(x.unit)}</span></div>` : `<input type="number" step="any" data-k="spec.${esc(x.key)}" value="${esc(v)}">`; break;
      case 'date': input = `<input type="date" data-k="spec.${esc(x.key)}" value="${esc(v)}">`; break;
      case 'select': input = `<select data-k="spec.${esc(x.key)}"><option value="">Choose…</option>${(x.options ?? []).map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`; break;
      case 'boolean': input = `<div class="toggle-yes"><label><input type="radio" name="b-${esc(x.key)}" data-k="spec.${esc(x.key)}" value="1" ${v === '1' ? 'checked' : ''}><span>Yes</span></label><label><input type="radio" name="b-${esc(x.key)}" data-k="spec.${esc(x.key)}" value="0" ${v === '0' ? 'checked' : ''}><span>No</span></label></div>`; break;
      case 'dimensions': { const parts = String(v).split(/\s*[×x]\s*/); input = `<div class="dims" data-dims="${esc(x.key)}">${[0, 1, 2].map(i => `<input type="number" step="any" value="${esc(parts[i] ?? '')}" aria-label="${['Height', 'Width', 'Depth'][i]}" placeholder="${['H', 'W', 'D'][i]}">${i < 2 ? '×' : ''}`).join('')}<span class="muted">${esc(x.unit ?? '')}</span></div>`; break; }
      case 'file': input = `<div class="row">${v ? `<a href="${esc(v)}" target="_blank">Current file</a>` : '<span class="muted small">No file yet</span>'}<input type="file" accept="application/pdf" data-file="${esc(x.key)}"></div>`; break;
      default: input = `<input data-k="spec.${esc(x.key)}" value="${esc(v)}" placeholder="${esc(x.placeholder ?? '')}">`;
    }
    return `<label class="f">${esc(x.label)}${x.unit && x.type !== 'number' && x.type !== 'dimensions' ? ` (${esc(x.unit)})` : ''}${req}${help}${input}${promote}</label>`;
  }

  function variantLabel(v) {
    return attrsNow().map(a => v.attributes[a.attributeTypeId]).filter(Boolean).join(' · ') || 'Single option';
  }

  function step4() {
    const attrs = attrsNow();
    const chosen = Object.fromEntries(attrs.map(a => [a.attributeTypeId, [...new Set(f.variants.map(v => v.attributes[a.attributeTypeId]).filter(Boolean))]]));
    const typeValues = id => attrTypes.find(t => t.id === id)?.values.map(x => x.value) ?? [];
    return `
      <p class="explain">Tap the choices customers can pick. Every combination becomes an option with its own price, stock, packed weight and SKU.</p>
      ${attrs.map(a => {
        const pool = [...new Set([...a.presetValues, ...(a.promoted ? [] : typeValues(a.attributeTypeId)), ...chosen[a.attributeTypeId]])];
        return `<div class="card" data-attr="${esc(a.attributeTypeId)}"><h3>${esc(a.label)} ${a.required ? '<span class="badge b-red">required</span>' : '<span class="badge b-grey">optional</span>'}</h3>
          <div class="chips">${pool.map(x => `<button type="button" class="chip" aria-pressed="${chosen[a.attributeTypeId].includes(x)}" data-val="${esc(x)}">${esc(x)}</button>`).join('')}
          ${a.allowCustomValues ? '<button type="button" class="chip add" data-custom>+ Add your own</button>' : ''}</div></div>`;
      }).join('')}
      <div class="row" style="margin-bottom:10px"><button class="btn btn-outline" type="button" id="gen">Update option rows</button>
        <span class="muted small">Bulk fill:</span><input class="i" id="bulk-v" placeholder="value" style="width:110px">
        <button class="btn btn-sm btn-ghost" type="button" data-bulk="price">Same price (৳)</button><button class="btn btn-sm btn-ghost" type="button" data-bulk="stock">Same stock</button>
        <button class="btn btn-sm btn-ghost" type="button" data-bulk="packed">Same packed weight (g)</button><button class="btn btn-sm btn-ghost" type="button" data-bulk="step">+৳ per size step</button></div>
      <div class="table-wrap vt"><table id="vt"><thead><tr><th>Option</th><th>Price ৳</th><th>Original ৳</th>${d.canSeeCost ? '<th>Cost ৳</th>' : ''}<th>Stock</th><th>Packed weight for delivery (g)</th><th>Net qty</th><th>Photo</th><th>SKU (blank = automatic)</th><th>GTIN / EAN <span class="help">optional</span></th><th>Shelf</th><th>On</th><th></th></tr></thead><tbody>
        ${f.variants.map((v, i) => `<tr data-i="${i}"><td class="opt">${esc(variantLabel(v))}</td>
          <td><input data-v="price" inputmode="decimal" value="${esc(fromPaisa(v.pricePaisa))}"></td><td><input data-v="compare" inputmode="decimal" value="${esc(fromPaisa(v.compareAtPricePaisa))}"></td>
          ${d.canSeeCost ? `<td><input data-v="cost" inputmode="decimal" value="${esc(fromPaisa(v.costPaisa))}" title="Cost price: only Owner and Accountant see this"></td>` : ''}
          <td><input data-v="stock" type="number" min="${v.reserved ?? 0}" value="${v.stock ?? 0}" title="${v.reserved ? `${v.reserved} held for confirmed orders` : ''}">${v.reserved ? `<br><span class="small muted">${v.reserved} held</span>` : ''}</td><td><input data-v="packed" type="number" min="0" value="${v.packedWeightGrams || ''}" placeholder="e.g. 650"></td>
          <td><input data-v="net" value="${v.netValue ? `${v.netValue}${v.netUnit === 'pcs' ? ' pcs' : v.netUnit}` : ''}" placeholder="${d.template.requiresNetQuantity ? 'e.g. 500g' : 'optional'}"></td>
          <td><select data-v="image"><option value="">Main photo</option>${images().map((m, n) => `<option value="${m.id}" ${v.imageIds?.includes(m.id) ? 'selected' : ''}>Photo ${n + 1}</option>`).join('')}</select></td>
          <td><input class="sku" data-v="sku" value="${esc(v.sku ?? '')}" placeholder="auto"></td><td><input data-v="gtin" inputmode="numeric" maxlength="14" value="${esc(v.gtin ?? '')}" placeholder="from the pack"></td><td><input data-v="shelf" value="${esc(v.shelfLocation ?? '')}" placeholder="A-03" style="width:70px"></td><td><input type="checkbox" data-v="active" ${v.isActive !== false ? 'checked' : ''}></td>
          <td><button class="btn btn-sm btn-ghost" type="button" data-tiers="${i}" title="Wholesale prices">${(v.wholesaleTiers ?? []).length ? `${v.wholesaleTiers.length} tier(s)` : 'Wholesale'}</button></td></tr>`).join('') || `<tr><td colspan="${d.canSeeCost ? 13 : 12}" class="empty">Choose values above, then “Update option rows”.</td></tr>`}
      </tbody></table></div>
      <p class="small muted">Net quantity fills itself from values like “500g”, “1L” or “100 pcs”, and shows customers a price per kg, litre or piece. Every option gets a Code 128 barcode of its SKU.
        ${f.variants.some(v => v.id) ? `<a href="/api/admin/print/labels?variants=${f.variants.filter(v => v.id).map(v => v.id).join(',')}" target="_blank">Print labels for these options</a>` : ''}</p>
      ${d.template.requiresSizeChart ? sizeChartEditor() : ''}`;
  }

  function sizeChartEditor() {
    const sizeAttr = attrsNow().find(a => /size/.test(a.attributeTypeId));
    const sizes = sizeAttr ? [...new Set(f.variants.map(v => v.attributes[sizeAttr.attributeTypeId]).filter(Boolean))] : [];
    const cols = d.template.sizeChartColumns.length ? d.template.sizeChartColumns : ['Measurement'];
    return `<div class="card"><h3>Size chart <span class="badge b-red">required</span></h3><p class="small muted">One row per size you sell.</p>
      <div class="table-wrap"><table id="sizechart"><thead><tr><th>Size</th>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>
      ${sizes.map(s => { const row = f.sizeChart?.rows?.find(r => r.size === s); return `<tr data-size="${esc(s)}"><td><b>${esc(s)}</b></td>${cols.map((_, i) => `<td><input class="i" value="${esc(row?.values?.[i] ?? '')}"></td>`).join('')}</tr>`; }).join('') || `<tr><td colspan="${cols.length + 1}" class="muted">Add sizes in the options first.</td></tr>`}
      </tbody></table></div></div>`;
  }

  function regenerate() {
    const attrs = attrsNow();
    const sel = attrs.map(a => ({ id: a.attributeTypeId, values: [...so.body.querySelectorAll(`[data-attr="${CSS.escape(a.attributeTypeId)}"] .chip[aria-pressed="true"]`)].map(c => c.dataset.val) }));
    const missing = attrs.filter(a => a.required && !sel.find(s => s.id === a.attributeTypeId).values.length);
    if (missing.length) { toast(`Pick at least one ${missing[0].label.toLowerCase()}.`, true); return; }
    const combos = sel.filter(s => s.values.length).reduce((acc, s) => acc.flatMap(c => s.values.map(x => ({ ...c, [s.id]: x }))), [{}]);
    const old = new Map(f.variants.map(v => [keyOf(v.attributes), v]));
    const first = f.variants[0];
    f.variants = combos.map(attributes => old.get(keyOf(attributes)) ?? {
      attributes, pricePaisa: first?.pricePaisa ?? 0, compareAtPricePaisa: null, costPaisa: first?.costPaisa ?? null, gtin: null, shelfLocation: first?.shelfLocation ?? null, stock: 0, packedWeightGrams: first?.packedWeightGrams ?? 0,
      netValue: parseNet(Object.values(attributes).find(parseNet))?.value ?? null, netUnit: parseNet(Object.values(attributes).find(parseNet))?.unit ?? null, sku: '', imageIds: [], wholesaleTiers: [], isActive: true,
    });
    render();
  }

  function tiersEditor(i) {
    const v = f.variants[i];
    const t = slideOver(`Wholesale prices · ${variantLabel(v)}`);
    const rows = [...(v.wholesaleTiers ?? []), { minQty: '', pricePaisa: null }, { minQty: '', pricePaisa: null }].slice(0, 5);
    t.body.innerHTML = `<p class="muted">Applied automatically in the cart. Example: 5+ packs at ৳600, 20+ at ৳560.</p>${rows.map(r => `<div class="grid-2"><label class="f">From quantity<input type="number" min="2" class="mq" value="${esc(r.minQty)}"></label><label class="f">Price each (৳)<input class="mp" inputmode="decimal" value="${esc(fromPaisa(r.pricePaisa))}"></label></div>`).join('')}`;
    t.foot.innerHTML = '<span></span><button class="btn btn-primary" id="ok">Done</button>';
    t.foot.querySelector('#ok').onclick = () => {
      const q = [...t.body.querySelectorAll('.mq')].map(x => Number(x.value));
      const pz = [...t.body.querySelectorAll('.mp')].map(x => toPaisa(x.value));
      v.wholesaleTiers = q.map((minQty, n) => ({ minQty, pricePaisa: pz[n] })).filter(x => x.minQty > 1 && x.pricePaisa > 0);
      t.close(); render();
    };
  }

  function step5() {
    return `
      <div class="drop" id="drop" tabindex="0" role="button" aria-label="Upload photos"><b>Drop photos here or tap to choose</b><br><span class="small muted">Use your own photos or ones your supplier allows you to use. Photos are compressed on this device before upload.</span><input type="file" id="files" accept="image/*" multiple hidden></div>
      <div class="media-grid" style="margin-top:12px">${images().map((m, n) => `<div class="media-item"><img src="${esc(m.url)}" alt="${esc(m.alt ?? '')}"><div class="row"><span class="small">${n === 0 ? '<b>Main</b>' : `#${n + 1}`}</span><span>${n > 0 ? `<button class="btn btn-sm btn-ghost" data-up="${m.id}" title="Move earlier">↑</button>` : ''}<button class="btn btn-sm btn-ghost" data-del="${m.id}" title="Delete">✕</button></span></div></div>`).join('')}</div>
      <div class="card" style="margin-top:14px"><label class="f">“How it works” video (YouTube link)<input data-k="videoUrl" value="${esc(f.videoUrl)}" placeholder="https://youtu.be/…"></label>
        <label class="f">User manual / guide (PDF)<input type="file" accept="application/pdf" id="manual"></label>${d.media.filter(m => m.kind === 'manual').map(m => `<p class="small"><a href="${esc(m.url)}" target="_blank">Current manual</a> <button class="btn btn-sm btn-ghost" data-del="${m.id}">Remove</button></p>`).join('')}</div>
      <div class="card"><h3>Claim badges</h3><p class="small muted">Badges like “Organic” only switch on with a supporting document or supplier declaration attached. No health or medical claims.</p>
        ${d.claims.map(c => `<p>${badge('active')} ${esc(c.claim)} <button class="btn btn-sm btn-ghost" data-unclaim="${esc(c.claim)}">Remove</button></p>`).join('')}
        <div class="row"><select class="i" id="claim" style="max-width:200px">${d.claimBadges.map(b => `<option>${esc(b)}</option>`).join('')}</select><input type="file" id="claimdoc" accept="application/pdf,image/*"><button class="btn btn-outline btn-sm" type="button" id="claimgo">Add badge</button></div></div>`;
  }

  async function upload(file, kind) {
    const c = kind === 'image' ? await compressImage(file) : { file, width: null, height: null };
    const fd = new FormData();
    appendImage(fd, c); fd.append('productId', String(id)); fd.append('kind', kind); fd.append('alt', f.name);
    return api('/media', 'POST', fd);
  }

  async function reload() {
    d = await api(`/products/${id}`);
  }

  function preview() {
    const img = images()[0]?.url ?? '/img/placeholders/none.svg';
    const v = [...f.variants].filter(x => x.isActive !== false).sort((a, b) => a.pricePaisa - b.pricePaisa)[0];
    const spec = d.template.cardKeySpecs.map(k => k === 'net_weight' ? (v?.netValue ? `${v.netValue}${v.netUnit === 'pcs' ? ' pcs' : v.netUnit}` : '') : k.startsWith('variant.') ? v?.attributes[k.slice(8)] : f.specs[k]).filter(Boolean).join(' · ');
    return `<div class="preview-card"><img src="${esc(img)}" alt=""><div class="b"><b>${esc(f.name)}</b><p class="small muted">${esc(spec)}</p><strong class="p">${v ? taka(v.pricePaisa) : '—'}</strong> ${v?.compareAtPricePaisa > v?.pricePaisa ? `<s class="muted">${taka(v.compareAtPricePaisa)}</s>` : ''}
      <div class="row" style="margin-top:8px"><span class="btn btn-sm btn-outline">Add to Cart</span><span class="btn btn-sm btn-primary">Order Now</span></div></div></div>`;
  }

  function body() {
    switch (step) {
      case 0: return `<label class="f">Category<select data-k="categoryId" ${pr.status !== 'draft' ? 'disabled' : ''}>${categoryOptions(cats, f.categoryId)}</select>${pr.status !== 'draft' ? '<span class="help">Live products keep their category’s template. Unpublish first to move it to another kind of category.</span>' : ''}</label>
        <p class="explain">${esc(d.template.name)}: ${esc(d.template.explanation)}</p>`;
      case 1: return `<label class="f">Product name <span class="req">*</span><input data-k="name" value="${esc(f.name)}"></label>
        <label class="f">Short description <span class="req">*</span><span class="help">One line. Shows on product cards.</span><input data-k="shortDescription" value="${esc(f.shortDescription)}" maxlength="300"></label>
        <label class="f">Full description<textarea data-k="description" rows="6">${esc(f.description)}</textarea></label>
        <div class="grid-2"><label class="f">Brand${d.template.requiresBrand ? ' <span class="req">*</span>' : ''}<input data-k="brand" value="${esc(f.brand)}" placeholder="${f.isOriginal ? 'Abs Vai' : ''}"></label>
        <label class="f">Product code <span class="help">Used in SKUs, e.g. PTGR.</span><input data-k="code" value="${esc(f.code)}" maxlength="8"></label></div>
        <label class="check"><input type="checkbox" data-k="isOriginal" ${f.isOriginal ? 'checked' : ''}> Abs Vai Original (shows the “Made by Abs Vai” seal)</label>
        <label class="check"><input type="checkbox" data-k="showOnHome" ${f.showOnHome ? 'checked' : ''}> Show on the homepage (“Featured” rail)</label>
        <label class="f" style="margin-top:12px">Benefit chips <span class="help">Up to 4, one per line, e.g. “Strong build”, “Free poly sheet”. Real facts only.</span><textarea id="chips" rows="4">${esc(f.benefitChips.join('\n'))}</textarea></label>`;
      case 2: return `<p class="explain">${esc(d.template.explanation)}</p><div class="grid-2">${fieldsNow().map(field).join('')}</div>
        ${f.promotedSpecKeys.length ? `<p class="notice">Customers choose: ${f.promotedSpecKeys.map(k => `<b>${esc(d.template.specFields.find(x => x.key === k)?.label ?? k)}</b> <button class="btn btn-sm btn-ghost" type="button" data-unpromote="${esc(k)}">undo</button>`).join(' ')}. Set its values in step 4.</p>` : ''}`;
      case 3: return step4();
      case 4: return step5();
      case 5: return `<div class="card" id="seasons"><h3>Seasons</h3><p class="small muted">Leave all unticked if it sells all year. Ticked products only sell while one of these seasons is live (unless pre-order is on); their page stays live with “Notify me”.</p>
          ${seasons.map(s => `<label class="check" style="margin-right:14px"><input type="checkbox" value="${s.id}" ${f.seasonIds.includes(s.id) ? 'checked' : ''}> ${esc(s.name)} <span class="small muted">${s.starts_on ? `${date(s.starts_on)} – ${date(s.ends_on)}` : 'dates not set'}</span></label>`).join('<br>')}</div>
        <div class="card"><h3>Fulfilment</h3>${d.template.allowedFulfilment.map(m => `<label class="check" style="margin-right:16px"><input type="radio" name="ful" data-k="fulfilmentMode" value="${m}" ${f.fulfilmentMode === m ? 'checked' : ''}> ${FULFIL[m]}</label>`).join('')}
          <div id="pre" ${f.fulfilmentMode === 'pre_order' ? '' : 'hidden'} class="grid-3" style="margin-top:12px"><label class="f">Expected dispatch date<input type="date" data-k="preorderDispatchDate" value="${esc(f.preorderDispatchDate)}"></label>
            <label class="f">Advance<select data-k="preorderAdvanceType"><option value="delivery_charge" ${f.preorderAdvanceType === 'delivery_charge' ? 'selected' : ''}>The delivery charge</option><option value="fixed" ${f.preorderAdvanceType === 'fixed' ? 'selected' : ''}>A fixed amount per item</option></select></label>
            <label class="f">Fixed advance (৳)<input data-k="preorderAdvancePaisa" inputmode="decimal" value="${esc(fromPaisa(f.preorderAdvancePaisa))}"></label></div>
          <div id="mto" ${f.fulfilmentMode === 'made_to_order' ? '' : 'hidden'} style="margin-top:12px"><label class="f">Days to make it<input type="number" min="1" data-k="madeToOrderLeadDays" value="${esc(f.madeToOrderLeadDays ?? '')}"></label></div></div>`;
      case 6: return `<label class="check"><input type="checkbox" data-k="freeDelivery" ${f.freeDelivery ? 'checked' : ''}> Free delivery on this product (shows a badge)</label>
        <label class="f" style="margin-top:12px">Shipping profile <span class="help">Pre-set from the template (${esc(PROFILES[d.template.defaultShippingProfile])}). Change it if this product is different, e.g. a small sealer is not bulky.</span><select data-k="shippingProfile">${Object.entries(PROFILES).map(([k, l]) => `<option value="${k}" ${f.shippingProfile === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="f">Large-item delivery<select data-k="bulkyDeliveryMode"><option value="zone_fixed" ${f.bulkyDeliveryMode === 'zone_fixed' ? 'selected' : ''}>Fixed bulky charge for the zone</option><option value="confirm_by_phone" ${f.bulkyDeliveryMode === 'confirm_by_phone' ? 'selected' : ''}>Charge confirmed by phone (order is held)</option></select><span class="help">Only used when the profile is Heavy / bulky.</span></label>`;
      case 7: return `<label class="f">Web address<div class="unit-wrap"><span style="border-radius:9px 0 0 9px;border-left:1px solid var(--husk);border-right:0">absvai.com/p/</span><input data-k="slug" value="${esc(f.slug)}" style="border-radius:0 9px 9px 0"></div></label>
        <label class="f">Page title <span class="help">Leave blank to use the product name.</span><input data-k="metaTitle" value="${esc(f.metaTitle)}" placeholder="${esc(f.name)}" maxlength="120"></label>
        <label class="f">Search description<textarea data-k="metaDescription" rows="2" placeholder="${esc(f.shortDescription)}" maxlength="300">${esc(f.metaDescription)}</textarea></label>
        <label class="f">Other names customers search for <span class="help">Comma separated, e.g. “nolen gur, patali, jaggery”.</span><input data-k="searchKeywords" value="${esc(f.searchKeywords)}"></label>
        <div class="card"><p class="small muted">Google preview</p><p style="color:#1a0dab;font-size:1.05rem;margin:0">${esc(f.metaTitle || f.name)} · Abs Vai</p><p class="small" style="color:#006621;margin:0">absvai.com/p/${esc(f.slug)}</p><p class="small">${esc(f.metaDescription || f.shortDescription)}</p></div>`;
      case 8: return `<div class="split"><div><div class="card"><h3>Publish checklist</h3><p class="small muted">Drafts can be saved at any time. Publish turns on when every line is ticked.</p>
          ${(() => { const todo = d.checklist.items.filter(i => !i.ok); const passed = d.checklist.items.length - todo.length;
            return todo.length ? `<p><b>${todo.length} thing(s) left before you can publish:</b></p><ul class="checklist">${todo.map(i => `<li><span class="no">✕</span><span>${esc(i.message)}</span></li>`).join('')}</ul><p class="small muted"><span class="ok">✓</span> ${passed} other checks passed.</p>`
              : `<p class="notice ok"><b>✓ Ready to publish.</b> All ${passed} checks passed.</p>`; })()}</div>
          <div class="card"><label class="f">Schedule for later (Bangladesh time) <span class="help">e.g. the first day of a season.</span><input type="datetime-local" id="when"></label></div></div>
          <div><h3>How the card will look</h3>${preview()}<p class="small muted" style="margin-top:8px"><a href="/p/${esc(f.slug)}" target="_blank">Open the product page</a>${d.product.status === 'published' ? '' : ' (only works once published)'}</p></div></div>`;
      default: return '';
    }
  }

  function render() {
    renderSteps();
    so.body.innerHTML = body();
    so.head.querySelector('h2').innerHTML = `${esc(f.name)} ${badge(d.product.status)}`;
    const live = d.product.status !== 'draft';
    so.foot.innerHTML = `<div class="row">${step > 0 ? '<button class="btn btn-outline" id="back">Back</button>' : ''}${step < STEPS.length - 1 ? '<button class="btn btn-outline" id="next">Next</button>' : ''}</div>
      <div class="row">${write ? `${live ? '<button class="btn btn-ghost" id="unpub">Unpublish</button>' : ''}<button class="btn btn-outline" id="save">${live ? 'Save changes' : 'Save draft'}</button>${step === 8 ? `<button class="btn btn-ghost" id="sched">Schedule</button><button class="btn btn-primary" id="pub" ${d.checklist.ready ? '' : 'disabled'}>Publish</button>` : ''}<button class="btn btn-ghost" id="trash" title="Move to trash">Delete</button>` : ''}</div>`;
    so.foot.querySelector('#back')?.addEventListener('click', () => { collect(); step--; render(); });
    so.foot.querySelector('#next')?.addEventListener('click', () => { collect(); step++; render(); });
    if (write) {
      busy(so.foot.querySelector('#save'), async () => { await save(); toast('Saved.'); render(); });
      const pub = so.foot.querySelector('#pub');
      if (pub) busy(pub, async () => { await save(); if (!d.checklist.ready) { render(); throw new Error(d.checklist.items.find(i => !i.ok).message); } await api(`/products/${id}/publish`, 'POST', {}); await reload(); toast('Published. It is live in the store.'); render(); });
      const sched = so.foot.querySelector('#sched');
      if (sched) busy(sched, async () => { const w = so.body.querySelector('#when').value; if (!w) throw new Error('Pick the date and time first.'); await save(); await api(`/products/${id}/publish`, 'POST', { publishAt: new Date(`${w}:00+06:00`).toISOString() }); await reload(); toast(`Scheduled for ${w.replace('T', ' ')}.`); render(); });
      const unpub = so.foot.querySelector('#unpub');
      if (unpub) busy(unpub, async () => { if (!(await confirmBox('Take this product off the store? Its page will stop working.'))) return; await api(`/products/${id}/unpublish`, 'POST', {}); await reload(); render(); });
      busy(so.foot.querySelector('#trash'), async () => { if (!(await confirmBox('Move this product to the trash? You can restore it later.'))) return; await api(`/products/${id}`, 'DELETE'); so.close(); });
    }
    wire();
  }

  async function save() {
    collect();
    const payload = { ...f, variants: f.variants.map(v => ({ ...v, id: v.id ?? null })) };
    // Lock the form while saving: the step re-renders from the saved data, which would wipe anything typed meanwhile.
    so.body.inert = true; stepsBar.inert = true;
    try {
      d = await api(`/products/${id}`, 'PUT', payload);
    } catch (e) {
      if (e.data?.details?.checklist) { d.checklist = e.data.details.checklist; }
      throw e;
    } finally {
      so.body.inert = false; stepsBar.inert = false;
    }
    f.variants = d.variants.filter(x => x.isActive).map(x => ({ ...x }));
    f.slug = d.product.slug; f.code = d.product.code;
    dirty = false;
  }

  function wire() {
    const b = so.body;
    b.querySelector('[data-k="categoryId"]')?.addEventListener('change', async e => {
      f.categoryId = Number(e.target.value);
      toast('Saving the new category…');
      try { await save(); toast('Category changed. The form now follows its template.'); } catch (err) { toast(err.message, true); }
      render();
    });
    b.querySelectorAll('[data-promote]').forEach(c => c.addEventListener('change', () => { collect(); if (c.checked) f.promotedSpecKeys = [...new Set([...f.promotedSpecKeys, c.dataset.promote])]; render(); toast('Now an option. Add its values in step 4.'); }));
    b.querySelectorAll('[data-unpromote]').forEach(c => c.addEventListener('click', () => { collect(); f.promotedSpecKeys = f.promotedSpecKeys.filter(k => k !== c.dataset.unpromote); f.variants.forEach(v => { delete v.attributes[c.dataset.unpromote]; }); render(); }));
    b.querySelectorAll('[data-file]').forEach(inp => inp.addEventListener('change', async () => {
      try { const r = await upload(inp.files[0], 'spec_file'); f.specs[inp.dataset.file] = r.url; toast('File uploaded.'); } catch (e) { toast(e.message, true); }
    }));
    b.querySelectorAll('.chip[data-val]').forEach(c => c.addEventListener('click', () => c.setAttribute('aria-pressed', String(c.getAttribute('aria-pressed') !== 'true'))));
    b.querySelectorAll('[data-custom]').forEach(c => c.addEventListener('click', () => {
      const val = prompt('New value, e.g. “3kg family pack”')?.trim();
      if (!val) return;
      const n = document.createElement('button');
      n.type = 'button'; n.className = 'chip'; n.dataset.val = val; n.textContent = val; n.setAttribute('aria-pressed', 'true');
      n.addEventListener('click', () => n.setAttribute('aria-pressed', String(n.getAttribute('aria-pressed') !== 'true')));
      c.before(n);
    }));
    b.querySelector('#gen')?.addEventListener('click', () => { collect(); regenerate(); });
    b.querySelectorAll('[data-tiers]').forEach(x => x.addEventListener('click', () => { collect(); tiersEditor(Number(x.dataset.tiers)); }));
    b.querySelectorAll('[data-bulk]').forEach(x => x.addEventListener('click', () => {
      collect();
      const raw = b.querySelector('#bulk-v').value;
      const kind = x.dataset.bulk;
      f.variants.forEach((v, i) => {
        if (kind === 'price') v.pricePaisa = toPaisa(raw) ?? v.pricePaisa;
        if (kind === 'stock') v.stock = Number(raw) || 0;
        if (kind === 'packed') v.packedWeightGrams = Number(raw) || 0;
        if (kind === 'step') v.pricePaisa = (f.variants[0].pricePaisa ?? 0) + i * (toPaisa(raw) ?? 0);
      });
      render();
    }));
    const ful = b.querySelectorAll('[data-k="fulfilmentMode"]');
    ful.forEach(r => r.addEventListener('change', () => { b.querySelector('#pre').hidden = r.value !== 'pre_order'; b.querySelector('#mto').hidden = r.value !== 'made_to_order'; }));
    const drop = b.querySelector('#drop');
    if (drop) {
      const files = b.querySelector('#files');
      const send = async list => {
        collect();
        for (const file of list) { try { await upload(file, 'image'); } catch (e) { toast(e.message, true); } }
        await reload(); toast('Photos uploaded.'); render();
      };
      drop.addEventListener('click', () => files.click());
      drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') files.click(); });
      files.addEventListener('change', () => send([...files.files]));
      drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over-drop'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('over-drop'));
      drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over-drop'); send([...e.dataTransfer.files]); });
      b.querySelectorAll('[data-del]').forEach(x => busy(x, async () => { if (!(await confirmBox('Delete this file?'))) return; collect(); await api(`/media/${x.dataset.del}`, 'DELETE'); await reload(); render(); }));
      b.querySelectorAll('[data-up]').forEach(x => x.addEventListener('click', async () => {
        const ids = images().map(m => m.id);
        const i = ids.indexOf(Number(x.dataset.up));
        [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
        collect(); await api(`/products/${id}/media-order`, 'PUT', { ids }); await reload(); render();
      }));
      b.querySelector('#manual')?.addEventListener('change', async e => { try { collect(); await upload(e.target.files[0], 'manual'); await reload(); render(); toast('Manual uploaded.'); } catch (err) { toast(err.message, true); } });
      const cg = b.querySelector('#claimgo');
      if (cg) busy(cg, async () => {
        const doc = b.querySelector('#claimdoc').files[0];
        if (!doc) throw new Error('Attach the supporting document first.');
        collect();
        const m = await upload(doc, 'claim_doc');
        await api(`/products/${id}/claims`, 'POST', { claim: b.querySelector('#claim').value, documentMediaId: m.id });
        await reload(); render(); toast('Badge added.');
      });
      b.querySelectorAll('[data-unclaim]').forEach(x => busy(x, async () => { await api(`/products/${id}/claims/${encodeURIComponent(x.dataset.unclaim)}`, 'DELETE'); await reload(); render(); }));
    }
  }

  so.panel.addEventListener('input', () => { dirty = true; });
  render();
}
