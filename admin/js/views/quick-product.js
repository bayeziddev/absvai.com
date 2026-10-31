// One-page product form for a non-technical owner: photos, category, name, a one-line description, the options customers
// choose with a price and stock each, the parcel weight, and only the details the category requires to publish. Everything
// else (SEO, seasons, wholesale, barcodes…) keeps its saved or default value and lives in the full editor.
import { api, busy, can, esc, fromPaisa, slideOver, toast, toPaisa } from '../app.js';
import { appendImage, compressImage, openProduct, productForm } from './products.js';

const parseNet = s => { const m = String(s ?? '').toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(kg|g|ml|l|pcs|m)\b/); return m ? { value: Number(m[1]), unit: m[2] } : null; };
const keyOf = a => Object.keys(a).sort().map(k => `${k}=${a[k]}`).join('|');

/** Categories in menu order with their (inherited) template, for the picker. */
function categoryOptions(cats, selected) {
  const kids = pid => cats.filter(c => (c.parent_id ?? null) === pid).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const walk = pid => kids(pid).flatMap(c => [c, ...walk(c.id)]);
  return walk(null).map(c => `<option value="${c.id}" data-template="${esc(c.effective_template_id ?? c.template_id)}" ${c.id === selected ? 'selected' : ''}>${'— '.repeat((c.depth ?? 1) - 1)}${esc(c.name)}</option>`).join('');
}

/**
 * @param {number|null} id  product to edit, or null for a new one
 * @param {{ cats?: any[], categoryId?: number, done?: () => void }} opts
 */
export async function quickProduct(id, { cats, categoryId = null, done } = {}) {
  cats ??= await api('/categories');
  let d = id ? await api(`/products/${id}`) : null;
  let template = d?.template ?? null;
  const so = slideOver(id ? `Edit · ${d.product.name}` : 'Add a product', { wide: true, onClose: () => done?.() });
  const write = can('catalog:write');
  const live = d && d.product.status !== 'draft';
  // Form state.
  const st = {
    categoryId: d?.product.category_id ?? categoryId ?? null,
    name: d?.product.name ?? '', short: d?.product.short_description ?? '', brand: d?.product.brand ?? '',
    specs: { ...(d?.specs ?? {}) },
    chosen: {},            // attributeTypeId → [values]
    rows: new Map(),       // keyOf(attributes) → { id, attributes, pricePaisa, stock, netValue, netUnit, … }
    parcel: d?.variants.find(v => v.isActive)?.packedWeightGrams || '',
    photos: (d?.media ?? []).filter(m => m.kind === 'image'),
    newPhotos: [],         // { file, url }
    removed: [],
    sizeChart: d?.product.size_chart ?? null,
  };
  for (const v of d?.variants.filter(x => x.isActive) ?? []) {
    st.rows.set(keyOf(v.attributes), { ...v });
    for (const [k, x] of Object.entries(v.attributes)) (st.chosen[k] ??= []).includes(x) || st.chosen[k].push(x);
  }

  // A saved product keeps its own effective options and fields (it may have promoted a detail to a customer choice).
  const sameTemplate = () => d && template && template.id === d.template.id;
  const attrs = () => (sameTemplate() ? d.effectiveVariantAttributes : template?.variantAttributes) ?? [];
  const required = () => ((sameTemplate() ? d.effectiveSpecFields : template?.specFields) ?? []).filter(f => f.required && f.type !== 'file');
  const sizeAttr = () => attrs().find(a => /size/.test(a.attributeTypeId));

  async function loadTemplate() {
    const opt = so.body.querySelector('#q-cat')?.selectedOptions[0];
    const tid = opt?.dataset.template;
    template = tid ? await api(`/templates/${tid}`) : null;
  }

  function combos() {
    const sel = attrs().map(a => ({ id: a.attributeTypeId, values: st.chosen[a.attributeTypeId] ?? [] })).filter(s => s.values.length);
    return sel.reduce((acc, s) => acc.flatMap(c => s.values.map(x => ({ ...c, [s.id]: x }))), [{}]);
  }

  function syncRows() {
    const first = [...st.rows.values()][0];
    const next = new Map();
    for (const attributes of combos()) {
      const k = keyOf(attributes);
      const net = parseNet(Object.values(attributes).find(parseNet));
      next.set(k, st.rows.get(k) ?? { id: null, attributes, pricePaisa: first?.pricePaisa ?? 0, stock: 0, netValue: net?.value ?? null, netUnit: net?.unit ?? null, sku: '', isActive: true, imageIds: [], wholesaleTiers: [] });
    }
    st.rows = next;
  }

  function field(f) {
    const v = st.specs[f.key] ?? '';
    const help = f.helpText ? `<span class="help">${esc(f.helpText)}</span>` : '';
    let input;
    switch (f.type) {
      case 'date': input = `<input type="date" data-spec="${esc(f.key)}" value="${esc(v)}">`; break;
      case 'number': input = `<input type="number" step="any" data-spec="${esc(f.key)}" value="${esc(v)}" placeholder="${esc(f.unit ?? '')}">`; break;
      case 'select': input = `<select data-spec="${esc(f.key)}"><option value="">Choose…</option>${(f.options ?? []).map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`; break;
      case 'boolean': input = `<select data-spec="${esc(f.key)}"><option value="">Choose…</option><option value="1" ${v === '1' ? 'selected' : ''}>Yes</option><option value="0" ${v === '0' ? 'selected' : ''}>No</option></select>`; break;
      case 'longtext': input = `<textarea rows="2" data-spec="${esc(f.key)}">${esc(v)}</textarea>`; break;
      default: input = `<input data-spec="${esc(f.key)}" value="${esc(v)}" placeholder="${esc(f.placeholder ?? (f.type === 'dimensions' ? 'e.g. 40 × 30 × 20 cm' : ''))}">`;
    }
    return `<label class="f">${esc(f.label)}${f.unit && f.type === 'number' ? ` (${esc(f.unit)})` : ''} <span class="req">*</span>${help}${input}</label>`;
  }

  // Actions read the screen with collect() before changing state; render() only draws state.
  function render() {
    const t = template;
    const sizes = sizeAttr() ? [...new Set([...st.rows.values()].map(r => r.attributes[sizeAttr().attributeTypeId]).filter(Boolean))] : [];
    const cols = t?.sizeChartColumns?.length ? t.sizeChartColumns : ['Measurement'];
    const needNet = t?.requiresNetQuantity;
    so.body.innerHTML = `<div class="qp">
      <section class="qp-card"><h3><span class="qp-n">1</span> Photos <span class="req">*</span></h3>
        <div class="qp-photos">${st.photos.map((m, i) => `<figure><img src="${esc(m.url)}" alt=""><figcaption>${i === 0 ? 'Main' : ''}</figcaption>${write ? `<button type="button" class="qp-x" data-rm-photo="${m.id}" aria-label="Remove photo">×</button>` : ''}</figure>`).join('')}
          ${st.newPhotos.map((p, i) => `<figure><img src="${esc(p.url)}" alt=""><figcaption>${st.photos.length === 0 && i === 0 ? 'Main' : 'New'}</figcaption><button type="button" class="qp-x" data-rm-new="${i}" aria-label="Remove photo">×</button></figure>`).join('')}
          ${write ? '<label class="qp-add"><input type="file" id="q-files" accept="image/*" multiple hidden><span>+ Add photos</span><small>From your phone or computer</small></label>' : ''}</div></section>

      <section class="qp-card"><h3><span class="qp-n">2</span> What is it?</h3>
        <label class="f">Category <span class="req">*</span><select id="q-cat" ${live ? 'disabled' : ''}><option value="">Choose…</option>${categoryOptions(cats, st.categoryId)}</select>${live ? '<span class="help">To move a live product to another kind of category, unpublish it first.</span>' : ''}</label>
        ${t ? `<p class="small muted">${esc(t.explanation)}</p>` : ''}
        <label class="f">Product name <span class="req">*</span><input id="q-name" value="${esc(st.name)}" placeholder="e.g. Khejur Patali Gur"></label>
        <label class="f">One-line description <span class="req">*</span><span class="help">Shows under the name on the product card.</span><input id="q-short" value="${esc(st.short)}" maxlength="300" placeholder="e.g. Fresh winter date-palm jaggery from Jessore"></label>
        ${t?.requiresBrand ? `<label class="f">Brand <span class="req">*</span><input id="q-brand" value="${esc(st.brand)}"></label>` : ''}</section>

      ${t ? `<section class="qp-card"><h3><span class="qp-n">3</span> Sizes, prices and stock</h3>
        ${attrs().map(a => {
          const pool = [...new Set([...a.presetValues, ...(st.chosen[a.attributeTypeId] ?? [])])];
          const block = `<div class="qp-attr" data-attr="${esc(a.attributeTypeId)}"><b>${esc(a.label)}</b> ${a.required ? '<span class="req">*</span>' : '<span class="small muted">(optional)</span>'}
            <div class="chips">${pool.map(x => `<button type="button" class="chip" aria-pressed="${(st.chosen[a.attributeTypeId] ?? []).includes(x)}" data-val="${esc(x)}">${esc(x)}</button>`).join('')}
            ${a.allowCustomValues ? '<button type="button" class="chip add" data-custom>+ Other</button>' : ''}</div></div>`;
          // Required choices are open; when none is required (food: weight or volume), the first one is open too.
          const open = a.required || (st.chosen[a.attributeTypeId] ?? []).length || (!attrs().some(x => x.required) && a === attrs()[0]);
          return open ? block : `<details class="qp-more"><summary>Add ${esc(a.label.toLowerCase())} choices (optional)</summary>${block}</details>`;
        }).join('')}
        <div class="table-wrap"><table class="qp-rows"><thead><tr><th>Option</th><th>Price (৳) *</th><th>In stock *</th>${needNet ? '<th>Net quantity *</th>' : ''}</tr></thead><tbody>
          ${[...st.rows.entries()].map(([k, r]) => `<tr data-row="${esc(k)}"><td>${esc(Object.values(r.attributes).join(' · ') || 'Standard')}</td>
            <td><input data-r="price" inputmode="decimal" value="${esc(fromPaisa(r.pricePaisa) === '0' ? '' : fromPaisa(r.pricePaisa))}" placeholder="0"></td>
            <td><input data-r="stock" type="number" min="${r.reserved ?? 0}" value="${r.stock ?? 0}"></td>
            ${needNet ? `<td><input data-r="net" value="${r.netValue ? `${r.netValue}${r.netUnit === 'pcs' ? ' pcs' : r.netUnit}` : ''}" placeholder="e.g. 500g, 1L"></td>` : ''}</tr>`).join('')}
        </tbody></table></div>
        ${st.rows.size > 1 ? '<div class="row" style="margin-top:8px"><input class="i" id="q-same" inputmode="decimal" placeholder="৳" style="width:100px"><button type="button" class="btn btn-sm btn-outline" id="q-same-go">Same price for all</button></div>' : ''}
        <label class="f" style="margin-top:12px">Parcel weight with box (grams) <span class="req">*</span><span class="help">Used for the delivery charge. Weigh one packed parcel, e.g. 650 for a 500 g jar.</span><input id="q-parcel" type="number" min="1" value="${esc(st.parcel)}" placeholder="e.g. 650"></label>
      </section>` : ''}

      ${t && required().length ? `<section class="qp-card"><h3><span class="qp-n">4</span> Required details</h3><div class="grid-2">${required().map(field).join('')}</div></section>` : ''}

      ${t?.requiresSizeChart ? `<section class="qp-card"><h3><span class="qp-n">5</span> Size chart <span class="req">*</span></h3>
        <div class="table-wrap"><table id="q-chart"><thead><tr><th>Size</th>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>
        ${sizes.map(s => { const row = st.sizeChart?.rows?.find(r => r.size === s); return `<tr data-size="${esc(s)}"><td><b>${esc(s)}</b></td>${cols.map((_, i) => `<td><input value="${esc(row?.values?.[i] ?? '')}"></td>`).join('')}</tr>`; }).join('') || `<tr><td colspan="${cols.length + 1}" class="muted">Choose sizes above first.</td></tr>`}
        </tbody></table></div></section>` : ''}
      <p class="small muted">Need SEO, seasons, wholesale prices, barcodes or a video? ${id ? '<a href="#" id="q-full">Open the full editor</a>.' : 'Save first, then open the full editor.'}</p>
    </div>`;
    so.foot.innerHTML = write ? `<span class="small muted" id="q-status">${d ? `Status: <b>${esc(d.product.status)}</b>` : ''}</span><div class="row"><button class="btn btn-outline" id="q-save">Save draft</button><button class="btn btn-primary" id="q-pub">${live ? 'Save' : 'Save and publish'}</button></div>` : '';
    wire();
  }

  // Reads what is on screen into st (safe to call before the first render).
  function collect() {
    const b = so.body;
    const g = sel => b.querySelector(sel);
    if (g('#q-cat')) st.categoryId = Number(g('#q-cat').value) || null;
    if (g('#q-name')) st.name = g('#q-name').value.trim();
    if (g('#q-short')) st.short = g('#q-short').value.trim();
    if (g('#q-brand')) st.brand = g('#q-brand').value.trim();
    if (g('#q-parcel')) st.parcel = Number(g('#q-parcel').value) || '';
    b.querySelectorAll('[data-spec]').forEach(i => { st.specs[i.dataset.spec] = i.value.trim(); });
    b.querySelectorAll('tr[data-row]').forEach(tr => {
      const r = st.rows.get(tr.dataset.row);
      if (!r) return;
      r.pricePaisa = toPaisa(tr.querySelector('[data-r=price]').value) ?? 0;
      r.stock = Math.max(0, Number(tr.querySelector('[data-r=stock]').value) || 0);
      const net = tr.querySelector('[data-r=net]');
      if (net) { const n = parseNet(net.value); r.netValue = n?.value ?? null; r.netUnit = n?.unit ?? null; }
    });
    const chart = g('#q-chart');
    if (chart && template) {
      st.sizeChart = { columns: template.sizeChartColumns, rows: [...chart.querySelectorAll('tr[data-size]')].map(tr => ({ size: tr.dataset.size, values: [...tr.querySelectorAll('input')].map(i => i.value.trim()) })) };
    }
  }

  function wire() {
    const b = so.body;
    b.querySelector('#q-cat')?.addEventListener('change', async () => { collect(); await loadTemplate(); st.chosen = {}; st.rows = new Map(); syncRows(); render(); });
    b.querySelectorAll('.chip[data-val]').forEach(c => c.addEventListener('click', () => {
      collect();
      const a = c.closest('[data-attr]').dataset.attr;
      const list = (st.chosen[a] ??= []);
      const i = list.indexOf(c.dataset.val);
      if (i >= 0) list.splice(i, 1); else list.push(c.dataset.val);
      syncRows(); render();
    }));
    b.querySelectorAll('[data-custom]').forEach(c => c.addEventListener('click', () => {
      const val = prompt('Type the choice, e.g. “3kg family pack” or “XXL”')?.trim();
      if (!val) return;
      collect();
      const a = c.closest('[data-attr]').dataset.attr;
      (st.chosen[a] ??= []).includes(val) || st.chosen[a].push(val);
      syncRows(); render();
    }));
    b.querySelector('#q-same-go')?.addEventListener('click', () => {
      const p = toPaisa(b.querySelector('#q-same').value);
      if (!p) return toast('Type the price first.', true);
      collect();
      for (const r of st.rows.values()) r.pricePaisa = p;
      render();
    });
    b.querySelector('#q-files')?.addEventListener('change', e => {
      collect();
      for (const file of e.target.files) st.newPhotos.push({ file, url: URL.createObjectURL(file) });
      render();
    });
    b.querySelectorAll('[data-rm-new]').forEach(x => x.addEventListener('click', () => { collect(); st.newPhotos.splice(Number(x.dataset.rmNew), 1); render(); }));
    b.querySelectorAll('[data-rm-photo]').forEach(x => x.addEventListener('click', () => {
      collect();
      const pid = Number(x.dataset.rmPhoto);
      st.removed.push(pid);
      st.photos = st.photos.filter(m => m.id !== pid);
      render();
    }));
    b.querySelector('#q-full')?.addEventListener('click', e => { e.preventDefault(); so.close(); openProduct(id, done); });
    const save = so.foot.querySelector('#q-save');
    const pub = so.foot.querySelector('#q-pub');
    if (save) busy(save, () => submit(false));
    if (pub) busy(pub, () => submit(true));
  }

  async function submit(publish) {
    collect();
    if (!st.categoryId) throw new Error('Choose the category first.');
    if (!st.name) throw new Error('Type the product name.');
    if (!st.rows.size) throw new Error('Choose at least one option (for example a size or weight).');
    so.body.inert = true;
    try {
      if (!id) {
        id = (await api('/products', 'POST', { categoryId: st.categoryId, name: st.name })).id;
        d = await api(`/products/${id}`);
      }
      for (const m of st.removed.splice(0)) await api(`/media/${m}`, 'DELETE');
      for (const p of st.newPhotos.splice(0)) {
        const c = await compressImage(p.file);
        const fd = new FormData();
        appendImage(fd, c); fd.append('productId', String(id)); fd.append('kind', 'image'); fd.append('alt', st.name);
        await api('/media', 'POST', fd);
      }
      const base = productForm(d);
      const parcel = Number(st.parcel) || 0;
      const payload = {
        ...base, categoryId: st.categoryId, name: st.name, shortDescription: st.short, brand: template?.requiresBrand ? st.brand : base.brand,
        specs: { ...base.specs, ...Object.fromEntries(Object.entries(st.specs).filter(([, x]) => x !== '')) },
        sizeChart: st.sizeChart ?? base.sizeChart,
        variants: [...st.rows.values()].map(r => ({ ...r, id: r.id ?? null, packedWeightGrams: parcel || r.packedWeightGrams || 0, isActive: true })),
      };
      if (!base.slug || base.slug === 'untitled-product') payload.slug = '';
      d = await api(`/products/${id}`, 'PUT', payload);
      st.photos = (d.media ?? []).filter(m => m.kind === 'image');
      st.rows = new Map(d.variants.filter(v => v.isActive).map(v => [keyOf(v.attributes), { ...v }]));
      if (publish && d.product.status === 'draft') {
        if (!d.checklist.ready) {
          render();
          throw new Error(`Saved as a draft. Before it can go live: ${d.checklist.items.filter(i => !i.ok).map(i => i.message).join(' ')}`);
        }
        await api(`/products/${id}/publish`, 'POST', {});
        d = await api(`/products/${id}`);
        toast('Published. It is live in the store.');
      } else toast(publish ? 'Saved. The live page updates in a few seconds.' : 'Saved as a draft.');
      render();
    } finally {
      so.body.inert = false;
    }
  }

  if (st.categoryId) {
    so.body.innerHTML = `<select id="q-cat" hidden>${categoryOptions(cats, st.categoryId)}</select>`;
    if (!template) await loadTemplate();
  }
  syncRows();
  render();
  return so;
}
