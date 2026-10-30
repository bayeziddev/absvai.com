import { api, badge, busy, can, confirmBox, esc, slideOver, toast } from '../app.js';

// ───────────── Categories (three levels, drag and drop) ─────────────

const MAX_DEPTH = 3;

export async function categories(v) {
  const [cats, templates, seasons] = await Promise.all([api('/categories'), api('/templates'), api('/season-options')]);
  const write = can('catalog:write');
  const tName = id => templates.find(t => t.id === id)?.name ?? id ?? '?';
  // Working copy of the arrangement; saved in one request.
  let tree = cats.map(c => ({ id: c.id, parentId: c.parent_id ?? null, sortOrder: c.sort_order }));
  const kids = pid => tree.filter(n => n.parentId === pid).sort((x, y) => x.sortOrder - y.sortOrder);
  const height = id => { const k = kids(id); return k.length ? 1 + Math.max(...k.map(n => height(n.id))) : 0; };
  const depth = id => { let d = 1; let n = tree.find(x => x.id === id); while (n?.parentId) { d++; n = tree.find(x => x.id === n.parentId); } return d; };
  const isInside = (id, maybeAncestor) => { let n = tree.find(x => x.id === id); while (n?.parentId) { if (n.parentId === maybeAncestor) return true; n = tree.find(x => x.id === n.parentId); } return false; };
  const row = n => {
    const c = cats.find(x => x.id === n.id);
    return `<li><div class="tree-row" data-id="${c.id}" ${write ? 'draggable="true"' : ''}>${write ? '<span class="grip" title="Drag to move" aria-hidden="true">⠿</span>' : ''}
      <span class="name">${esc(c.name)} <span class="small muted">/c/${esc(c.slug)} · ${esc(c.code)}</span></span>
      <span class="small">${c.inherits_template ? `<span class="muted">inherits</span> ${esc(tName(c.effective_template_id))}` : esc(tName(c.template_id))}</span>
      <span class="small">${c.season_visibility === 'always' ? '' : `Only in ${c.season_ids.map(id => esc(seasons.find(s => s.id === id)?.name ?? '?')).join(', ')}`}</span>
      <span class="small muted">${c.product_count} product(s)</span>${c.is_active ? '' : badge('off')}
      ${write ? `<span class="row" style="gap:2px"><button class="btn btn-sm btn-ghost" data-up="${c.id}" aria-label="Move ${esc(c.name)} up">↑</button><button class="btn btn-sm btn-ghost" data-down="${c.id}" aria-label="Move ${esc(c.name)} down">↓</button><button class="btn btn-sm btn-ghost" data-out="${c.id}" aria-label="Move ${esc(c.name)} one level up" ${n.parentId ? '' : 'disabled'}>←</button></span>` : ''}
      <button class="btn btn-sm btn-outline" data-edit="${c.id}">Edit</button></div>
      ${kids(n.id).length ? `<ul class="tree">${kids(n.id).map(row).join('')}</ul>` : ''}</li>`;
  };
  let dirty = false;
  const draw = () => {
    v.innerHTML = `
      <div class="page-head"><div><h1>Categories</h1><p>Up to three levels: Category → Subcategory → Child category. Drag a row onto another to put it inside, or above/below to reorder. A subcategory can use its parent’s template. Seasonal categories hide from the menu outside their season.</p></div>
        <div class="row">${write ? `<button class="btn btn-outline" id="save-order" ${dirty ? '' : 'disabled'}>Save arrangement</button><button class="btn btn-primary" id="new">+ Add category</button>` : ''}</div></div>
      ${dirty ? '<p class="notice">You have moved categories. Press <b>Save arrangement</b> to publish the new menu.</p>' : ''}
      <ul class="tree">${kids(null).map(row).join('') || '<li class="muted">No categories yet.</li>'}</ul>`;
    bind();
  };
  const renumber = pid => kids(pid).forEach((n, i) => { n.sortOrder = i; });
  const move = (id, parentId, beforeId) => {
    const n = tree.find(x => x.id === id);
    if (parentId === id || (parentId && isInside(parentId, id))) return toast('A category cannot go inside itself.', true);
    if ((parentId ? depth(parentId) : 0) + 1 + height(id) > MAX_DEPTH) return toast('Categories go three levels deep at most.', true);
    const c = cats.find(x => x.id === id);
    if (!parentId && c.inherits_template) return toast(`“${c.name}” uses its parent’s template. Give it its own template before making it top level.`, true);
    const old = n.parentId;
    n.parentId = parentId;
    const siblings = kids(parentId).filter(x => x.id !== id);
    const at = beforeId ? siblings.findIndex(x => x.id === beforeId) : siblings.length;
    siblings.splice(at < 0 ? siblings.length : at, 0, n);
    siblings.forEach((x, i) => { x.sortOrder = i; });
    renumber(old);
    dirty = true;
    draw();
  };
  const bind = () => {
    const edit = c => editCategory(c, cats, templates, seasons, () => categories(v));
    v.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => edit(cats.find(c => c.id === Number(b.dataset.edit)))));
    v.querySelector('#new')?.addEventListener('click', () => edit(null));
    if (!write) return;
    v.querySelectorAll('[data-up],[data-down]').forEach(b => b.addEventListener('click', () => {
      const id = Number(b.dataset.up ?? b.dataset.down);
      const n = tree.find(x => x.id === id);
      const sib = kids(n.parentId);
      const i = sib.findIndex(x => x.id === id);
      const j = b.dataset.up ? i - 1 : i + 1;
      if (j < 0 || j >= sib.length) return;
      [sib[i].sortOrder, sib[j].sortOrder] = [sib[j].sortOrder, sib[i].sortOrder];
      dirty = true; draw();
    }));
    v.querySelectorAll('[data-out]').forEach(b => b.addEventListener('click', () => {
      const n = tree.find(x => x.id === Number(b.dataset.out));
      const parent = tree.find(x => x.id === n.parentId);
      if (parent) move(n.id, parent.parentId, kids(parent.parentId)[kids(parent.parentId).findIndex(x => x.id === parent.id) + 1]?.id ?? null);
    }));
    let dragId = null;
    v.querySelectorAll('.tree-row[draggable]').forEach(el => {
      const clear = () => el.classList.remove('drop-before', 'drop-inside', 'drop-after');
      const zone = e => { const r = el.getBoundingClientRect(); const y = (e.clientY - r.top) / r.height; return y < 0.3 ? 'before' : y > 0.7 ? 'after' : 'inside'; };
      el.addEventListener('dragstart', e => { dragId = Number(el.dataset.id); el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragId)); });
      el.addEventListener('dragend', () => { el.classList.remove('dragging'); dragId = null; });
      el.addEventListener('dragover', e => { if (!dragId || dragId === Number(el.dataset.id)) return; e.preventDefault(); clear(); el.classList.add(`drop-${zone(e)}`); });
      el.addEventListener('dragleave', clear);
      el.addEventListener('drop', e => {
        e.preventDefault(); clear();
        const target = tree.find(x => x.id === Number(el.dataset.id));
        if (!dragId || dragId === target.id) return;
        const z = zone(e);
        if (z === 'inside') return move(dragId, target.id, null);
        const sib = kids(target.parentId).filter(x => x.id !== dragId);
        const i = sib.findIndex(x => x.id === target.id);
        move(dragId, target.parentId, z === 'before' ? target.id : sib[i + 1]?.id ?? null);
      });
    });
    const save = v.querySelector('#save-order');
    if (save) busy(save, async () => {
      const r = await api('/categories-order', 'PUT', { items: tree.map(n => ({ id: n.id, parentId: n.parentId, sortOrder: n.sortOrder })) });
      toast(`Saved. ${r.moved} categor${r.moved === 1 ? 'y' : 'ies'} moved; the menu refreshes everywhere.`);
      categories(v);
    });
  };
  // Start from contiguous positions so ↑/↓ always swap two different values.
  [...new Set(tree.map(n => n.parentId))].forEach(renumber);
  draw();
}

function editCategory(c, cats, templates, seasons, done) {
  const so = slideOver(c ? `Category · ${c.name}` : 'New category');
  const active = templates.filter(t => t.status === 'active' || t.id === c?.template_id);
  // A parent must leave room below it: depth(parent) + 1 + height(this) ≤ 3.
  const height = id => { const k = cats.filter(x => x.parent_id === id); return k.length ? 1 + Math.max(...k.map(x => height(x.id))) : 0; };
  const inside = (id, anc) => { let n = cats.find(x => x.id === id); while (n?.parent_id) { if (n.parent_id === anc) return true; n = cats.find(x => x.id === n.parent_id); } return false; };
  const parents = cats.filter(x => x.id !== c?.id && !(c && inside(x.id, c.id)) && x.depth + 1 + (c ? height(c.id) : 0) <= MAX_DEPTH);
  const label = x => { const p = cats.find(y => y.id === x.parent_id); const g = p && cats.find(y => y.id === p.parent_id); return [g, p, x].filter(Boolean).map(y => y.name).join(' › '); };
  // Kinds of products, in plain words, so the owner picks "Clothing" rather than a template id.
  const kind = t => `${esc(t.name)}${t.explanation ? ` — ${esc(t.explanation)}` : ''}`;
  so.body.innerHTML = `<form id="f" class="qp">
    <section class="qp-card"><h3><span class="qp-n">1</span> Name and picture</h3>
      <label class="f">Category name <span class="req">*</span><input name="name" value="${esc(c?.name ?? '')}" required placeholder="e.g. Winter Shawls"></label>
      <input type="hidden" name="iconUrl" value="${esc(c?.icon_url ?? '')}">
      <div class="qp-photos" id="cat-pic">${c?.icon_url ? `<figure><img src="${esc(c.icon_url)}" alt=""><figcaption>Picture</figcaption></figure>` : ''}
        <label class="qp-add"><input type="file" id="cat-file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden><span>${c?.icon_url ? 'Change picture' : '+ Add picture'}</span><small>Shown in the menu and category tiles</small></label></div></section>
    <section class="qp-card"><h3><span class="qp-n">2</span> Where it goes</h3>
      <label class="f">Inside another category?<select name="parentId"><option value="">No, it is a main category</option>${parents.map(x => `<option value="${x.id}" ${x.id === c?.parent_id ? 'selected' : ''}>Inside ${esc(label(x))}</option>`).join('')}</select></label>
      <label class="f">What kind of products? <span class="help">Decides what the “Add product” form asks for (sizes, weights, warranty…).</span><select name="templateId"><option value="">Same as the main category</option>${active.map(t => `<option value="${esc(t.id)}" ${t.id === c?.template_id ? 'selected' : ''}>${kind(t)}</option>`).join('')}</select></label>
      <label class="f">When should it show in the menu?<select name="seasonVisibility"><option value="always">All year</option><option value="seasons" ${c?.season_visibility === 'seasons' ? 'selected' : ''}>Only during a season…</option></select></label>
      <div id="sv" ${c?.season_visibility === 'seasons' ? '' : 'hidden'}>${seasons.map(s => `<label class="check" style="margin-right:12px"><input type="checkbox" name="season" value="${s.id}" ${c?.season_ids?.includes(s.id) ? 'checked' : ''}> ${esc(s.name)}</label>`).join('')}</div>
      <label class="check" style="margin-top:8px"><input type="checkbox" name="isActive" ${c?.is_active !== 0 ? 'checked' : ''}> Show this category in the store</label></section>
    <details class="qp-more"><summary>More options (web address, code, description, search engines)</summary>
      <div class="grid-2"><label class="f">Web address<input name="slug" value="${esc(c?.slug ?? '')}" placeholder="made from the name"></label>
        <label class="f">Short code <span class="help">Starts every SKU. Leave empty to make one automatically.</span><input name="code" value="${esc(c?.code ?? '')}" maxlength="5" placeholder="auto"></label></div>
      <label class="f">Description<textarea name="description" rows="2">${esc(c?.description ?? '')}</textarea></label>
      <div class="grid-2"><label class="f">Search engine title<input name="metaTitle" value="${esc(c?.meta_title ?? '')}"></label><label class="f">Search engine description<input name="metaDescription" value="${esc(c?.meta_description ?? '')}"></label></div></details></form>`;
  const form = so.body.querySelector('#f');
  const syncKind = () => { if (!c && !form.parentId.value && !form.templateId.value) form.templateId.value = active[0]?.id ?? ''; if (!c && form.parentId.value) form.templateId.value = ''; };
  form.parentId.addEventListener('change', syncKind);
  syncKind();
  so.body.querySelector('#cat-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await api('/category-image', 'POST', fd);
      form.iconUrl.value = r.url;
      so.body.querySelector('#cat-pic .qp-add span').textContent = 'Change picture';
      so.body.querySelector('#cat-pic figure')?.remove();
      so.body.querySelector('#cat-pic').insertAdjacentHTML('afterbegin', `<figure><img src="${esc(r.url)}" alt=""><figcaption>Picture</figcaption></figure>`);
      toast('Picture added. Press Save to keep it.');
    } catch (err) { toast(err.message, true); }
  });
  form.seasonVisibility.addEventListener('change', () => { so.body.querySelector('#sv').hidden = form.seasonVisibility.value !== 'seasons'; });
  so.foot.innerHTML = `${c && can('catalog:write') ? '<button class="btn btn-ghost" id="del">Delete</button>' : '<span></span>'}${can('catalog:write') ? '<button class="btn btn-primary" id="save">Save</button>' : ''}`;
  if (!can('catalog:write')) return;
  busy(so.foot.querySelector('#save'), async () => {
    const body = { name: form.name.value, slug: form.slug.value, code: form.code.value, parentId: Number(form.parentId.value) || null, templateId: form.templateId.value || null, seasonVisibility: form.seasonVisibility.value,
      seasonIds: [...form.querySelectorAll('[name=season]:checked')].map(x => Number(x.value)), iconUrl: form.iconUrl.value, description: form.description.value, sortOrder: c?.sort_order,
      isActive: form.isActive.checked, metaTitle: form.metaTitle.value, metaDescription: form.metaDescription.value };
    await api(c ? `/categories/${c.id}` : '/categories', c ? 'PUT' : 'POST', body);
    toast('Saved.'); so.close(); done();
  });
  if (c) busy(so.foot.querySelector('#del'), async () => { if (await confirmBox(`Delete “${c.name}”?`)) { await api(`/categories/${c.id}`, 'DELETE'); so.close(); done(); } });
}

// ───────────── Barcodes & labels (Section 13.2) ─────────────

export async function labels(v) {
  const picked = new Map();
  v.innerHTML = `<div class="page-head"><div><h1>Barcodes & labels</h1><p>Every option has a Code 128 barcode of its SKU. Print shelf or product labels on A4 sticker sheets (3 × 8) or a 38 × 25 mm thermal roll.</p></div></div>
    <div class="split"><div class="card"><h2>1. Find options</h2><input class="i" id="q" placeholder="Name, SKU or scan" style="width:100%"><div id="res" class="search-results"></div></div>
      <div class="card"><h2>2. Print</h2><div class="table-wrap"><table><thead><tr><th>Option</th><th></th></tr></thead><tbody id="sel"><tr><td colspan="2" class="muted small">Nothing chosen yet.</td></tr></tbody></table></div>
        <div class="grid-2" style="margin-top:10px"><label class="f">Copies of each<input id="copies" type="number" min="1" max="100" value="1"></label><label class="f">Layout<select id="layout"><option value="a4">A4 sticker sheet (70 × 37 mm)</option><option value="thermal">Thermal roll (38 × 25 mm)</option></select></label></div>
        <button class="btn btn-primary" id="print" style="width:100%">Open labels to print</button></div></div>`;
  const $ = s => v.querySelector(s);
  const drawSel = () => { $('#sel').innerHTML = [...picked.values()].map(r => `<tr><td>${esc(r.name)} ${esc(r.label)}<br><span class="small muted">${esc(r.sku)}${r.gtin ? ` · ${esc(r.gtin)}` : ''}</span></td><td><button class="btn btn-sm btn-ghost" data-rm="${r.id}">Remove</button></td></tr>`).join('') || '<tr><td colspan="2" class="muted small">Nothing chosen yet.</td></tr>';
    $('#sel').querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { picked.delete(Number(b.dataset.rm)); drawSel(); })); };
  let t;
  $('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(async () => {
    const q = $('#q').value.trim();
    const rows = q.length < 2 ? [] : await api(`/variants/search?q=${encodeURIComponent(q)}`);
    $('#res').innerHTML = rows.map((r, i) => `<button type="button" class="result" data-i="${i}"><b>${esc(r.name)}</b> ${esc(r.label)}<br><span class="small muted">${esc(r.sku)}</span></button>`).join('');
    $('#res').querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', () => { const r = rows[Number(b.dataset.i)]; picked.set(r.id, r); drawSel(); }));
  }, 250); });
  $('#print').addEventListener('click', () => {
    if (!picked.size) return toast('Choose at least one option.', true);
    window.open(`/api/admin/print/labels?variants=${[...picked.keys()].join(',')}&copies=${Number($('#copies').value) || 1}&layout=${$('#layout').value}`, '_blank');
  });
}

// ───────────── Product templates (data, not code) ─────────────

const TYPES = { text: 'Short text', longtext: 'Long text', number: 'Number', date: 'Date', select: 'List of choices', dimensions: 'Dimensions (H × W × D)', file: 'File (PDF)', boolean: 'Yes / No' };
const PANELS = { details: 'Details', food: 'Food details', specs: 'Specifications', in_box: 'In the box', warranty: 'Warranty', care: 'Care' };
const PROFILES = { standard: 'Standard parcel', fragile: 'Fragile', heavy_bulky: 'Heavy / bulky', perishable: 'Perishable food' };

export async function templates(v) {
  const list = await api('/templates');
  v.innerHTML = `
    <div class="page-head"><div><h1>Product Templates</h1><p>A template bundles the options customers choose, the details staff fill in, the shipping profile and how it can be fulfilled. Add a new one any time, e.g. “Fresh produce” for mango season.</p></div>${can('catalog:write') ? '<button class="btn btn-primary" id="new">+ New template</button>' : ''}</div>
    <div class="table-wrap"><table><thead><tr><th>Template</th><th>Explanation shown in the upload form</th><th class="right">Categories</th><th class="right">Products</th><th>Status</th><th></th></tr></thead><tbody>
    ${list.map(t => `<tr class="clickable" data-id="${esc(t.id)}"><td><b>${esc(t.name)}</b><br><span class="small muted">${esc(t.id)}</span></td><td class="small">${esc(t.explanation)}</td><td class="right">${t.category_count}</td><td class="right">${t.product_count}</td><td>${badge(t.status)}</td>
      <td><a class="btn btn-sm btn-outline" href="/api/admin/templates/${esc(t.id)}/csv">CSV</a></td></tr>`).join('')}
    </tbody></table></div>`;
  v.querySelectorAll('tr[data-id]').forEach(r => r.addEventListener('click', e => { if (!e.target.closest('a')) editTemplate(r.dataset.id, list, () => templates(v)); }));
  v.querySelector('#new')?.addEventListener('click', () => editTemplate(null, list, () => templates(v)));
}

async function editTemplate(id, list, done) {
  const [t, types] = await Promise.all([id ? api(`/templates/${id}`) : Promise.resolve(null), api('/attribute-types')]);
  const meta = list.find(x => x.id === id);
  const tpl = t ?? { id: '', name: '', explanation: '', variantAttributes: [], specFields: [], defaultShippingProfile: 'standard', allowedFulfilment: ['in_stock'], requiresSizeChart: false, sizeChartColumns: [], requiresBrand: false, requiresNetQuantity: false, cardKeySpecs: [] };
  const so = slideOver(t ? `Template · ${t.name}` : 'New template', { wide: true });
  const attrRow = (a = {}) => `<tr><td><select class="i" data-a="id">${types.map(x => `<option value="${esc(x.id)}" ${x.id === a.attributeTypeId ? 'selected' : ''}>${esc(x.name)} (${esc(x.id)})</option>`).join('')}</select></td>
    <td><input class="i" data-a="presets" value="${esc((a.presetValues ?? []).join(', '))}" placeholder="e.g. 5kg, 10kg"></td><td><input type="checkbox" data-a="req" ${a.required ? 'checked' : ''}></td><td><input type="checkbox" data-a="custom" ${a.allowCustomValues !== false ? 'checked' : ''}></td><td><button type="button" class="btn btn-sm btn-ghost" data-rm>✕</button></td></tr>`;
  const fieldRow = (x = {}) => `<tr><td><input class="i" data-s="label" value="${esc(x.label ?? '')}" placeholder="e.g. Harvest date"></td><td><input class="i" data-s="key" value="${esc(x.key ?? '')}" placeholder="auto" style="min-width:110px"></td>
    <td><select class="i" data-s="type">${Object.entries(TYPES).map(([k, l]) => `<option value="${k}" ${k === (x.type ?? 'text') ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
    <td><input class="i" data-s="options" value="${esc((x.options ?? []).join(', '))}" placeholder="choices, for lists"></td><td><input class="i" data-s="unit" value="${esc(x.unit ?? '')}" style="width:60px"></td>
    <td><select class="i" data-s="panel">${Object.entries(PANELS).map(([k, l]) => `<option value="${k}" ${k === (x.panel ?? 'details') ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
    <td><input type="checkbox" data-s="required" ${x.required ? 'checked' : ''} title="Required to publish"></td><td><input type="checkbox" data-s="filterable" ${x.filterable ? 'checked' : ''} title="Listing filter"></td><td><input type="checkbox" data-s="variant" ${x.canBecomeVariant ? 'checked' : ''} title="Can become a customer choice"></td>
    <td><input class="i" data-s="help" value="${esc(x.helpText ?? '')}" placeholder="hint under the field"></td><td><button type="button" class="btn btn-sm btn-ghost" data-rm>✕</button></td></tr>`;
  so.body.innerHTML = `
    ${meta?.product_count ? `<p class="notice">${meta.product_count} product(s) use this template. Changes apply to them on their next save; required fields you add will block publishing until filled.</p>` : ''}
    <div class="grid-2"><label class="f">Name<input id="name" value="${esc(tpl.name)}" placeholder="Fresh produce"></label><label class="f">ID <span class="help">lowercase_with_underscores, cannot change later</span><input id="tid" value="${esc(tpl.id)}" ${t ? 'disabled' : ''} placeholder="fresh_produce"></label></div>
    <label class="f">One-line explanation for staff<input id="exp" value="${esc(tpl.explanation)}" placeholder="Fresh fruit needs weight, grade and the harvest date."></label>
    <div class="card"><h3>Customer chooses (options → each combination has its own price, stock and SKU)</h3>
      <div class="table-wrap"><table><thead><tr><th>Option type</th><th>Preset values</th><th>Required</th><th>Custom values</th><th></th></tr></thead><tbody id="attrs">${tpl.variantAttributes.map(attrRow).join('')}</tbody></table></div>
      <button type="button" class="btn btn-sm btn-outline" id="add-attr" style="margin-top:8px">+ Add option type</button> <a class="small" href="#/attributes">Manage option types</a></div>
    <div class="card"><h3>Staff fill in (details customers read)</h3>
      <div class="table-wrap"><table><thead><tr><th>Label</th><th>Key</th><th>Type</th><th>Choices</th><th>Unit</th><th>Panel</th><th>Req.</th><th>Filter</th><th>Option?</th><th>Help text</th><th></th></tr></thead><tbody id="fields">${tpl.specFields.map(fieldRow).join('')}</tbody></table></div>
      <button type="button" class="btn btn-sm btn-outline" id="add-field" style="margin-top:8px">+ Add field</button></div>
    <div class="card grid-2"><label class="f">Default shipping profile<select id="ship">${Object.entries(PROFILES).map(([k, l]) => `<option value="${k}" ${k === tpl.defaultShippingProfile ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <div><b>Fulfilment allowed</b><br>${[['in_stock', 'In stock'], ['pre_order', 'Pre-order'], ['made_to_order', 'Made to order']].map(([k, l]) => `<label class="check" style="margin-right:12px"><input type="checkbox" class="ful" value="${k}" ${tpl.allowedFulfilment.includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div>
      <label class="check"><input type="checkbox" id="net" ${tpl.requiresNetQuantity ? 'checked' : ''}> Needs net weight / quantity (shows ৳ per kg)</label>
      <label class="check"><input type="checkbox" id="brand" ${tpl.requiresBrand ? 'checked' : ''}> Brand required</label>
      <label class="check"><input type="checkbox" id="chart" ${tpl.requiresSizeChart ? 'checked' : ''}> Size chart required</label>
      <label class="f">Size chart columns<input id="cols" value="${esc(tpl.sizeChartColumns.join(', '))}" placeholder="Chest (inch), Length (inch)"></label>
      <label class="f">Card key-spec line <span class="help">Up to 3 keys: net_weight, variant.&lt;option&gt; or a field key.</span><input id="card" value="${esc(tpl.cardKeySpecs.join(', '))}" placeholder="net_weight, origin"></label></div>`;
  const b = so.body;
  const bindRm = () => b.querySelectorAll('[data-rm]').forEach(x => { x.onclick = () => x.closest('tr').remove(); });
  b.querySelector('#add-attr').onclick = () => { b.querySelector('#attrs').insertAdjacentHTML('beforeend', attrRow()); bindRm(); };
  b.querySelector('#add-field').onclick = () => { b.querySelector('#fields').insertAdjacentHTML('beforeend', fieldRow()); bindRm(); };
  bindRm();
  const list2 = s => s.split(',').map(x => x.trim()).filter(Boolean);
  so.foot.innerHTML = `${t && can('catalog:write') ? `<button class="btn btn-ghost" id="retire">${t.status === 'retired' ? 'Bring back' : meta?.product_count || meta?.category_count ? 'Retire' : 'Delete'}</button>` : '<span></span>'}${can('catalog:write') ? '<button class="btn btn-primary" id="save">Save template</button>' : ''}`;
  if (!can('catalog:write')) return;
  busy(so.foot.querySelector('#save'), async () => {
    const body = {
      id: t ? t.id : b.querySelector('#tid').value.trim(), name: b.querySelector('#name').value, explanation: b.querySelector('#exp').value, defaultShippingProfile: b.querySelector('#ship').value,
      allowedFulfilment: [...b.querySelectorAll('.ful:checked')].map(x => x.value), requiresNetQuantity: b.querySelector('#net').checked, requiresBrand: b.querySelector('#brand').checked,
      requiresSizeChart: b.querySelector('#chart').checked, sizeChartColumns: list2(b.querySelector('#cols').value), cardKeySpecs: list2(b.querySelector('#card').value),
      variantAttributes: [...b.querySelectorAll('#attrs tr')].map(tr => ({ attributeTypeId: tr.querySelector('[data-a=id]').value, presetValues: list2(tr.querySelector('[data-a=presets]').value), required: tr.querySelector('[data-a=req]').checked, allowCustomValues: tr.querySelector('[data-a=custom]').checked })),
      specFields: [...b.querySelectorAll('#fields tr')].map(tr => { const g = k => tr.querySelector(`[data-s=${k}]`); return { label: g('label').value, key: g('key').value, type: g('type').value, options: list2(g('options').value), unit: g('unit').value, panel: g('panel').value, required: g('required').checked, filterable: g('filterable').checked, canBecomeVariant: g('variant').checked, helpText: g('help').value }; }).filter(x => x.label),
    };
    await api(t ? `/templates/${t.id}` : '/templates', t ? 'PUT' : 'POST', body);
    toast('Template saved.'); so.close(); done();
  });
  const rt = so.foot.querySelector('#retire');
  if (rt) busy(rt, async () => {
    if (t.status === 'retired') await api(`/templates/${t.id}/retire`, 'POST', { restore: true });
    else if (meta?.product_count || meta?.category_count) await api(`/templates/${t.id}/retire`, 'POST', {});
    else if (await confirmBox('Delete this unused template?')) await api(`/templates/${t.id}`, 'DELETE');
    else return;
    so.close(); done();
  });
}

// ───────────── Attribute types ─────────────

export async function attributes(v) {
  const list = await api('/attribute-types');
  v.innerHTML = `<div class="page-head"><div><h1>Attribute Types</h1><p>The kinds of choices customers can make (Weight, Size, Color, Grade…). Templates pick from these.</p></div>${can('catalog:write') ? '<button class="btn btn-primary" id="new">+ New option type</button>' : ''}</div>
    <div class="table-wrap"><table><thead><tr><th>Name</th><th>ID</th><th>Style</th><th>Saved values</th></tr></thead><tbody>
    ${list.map(a => `<tr class="clickable" data-id="${esc(a.id)}"><td><b>${esc(a.name)}</b></td><td>${esc(a.id)}</td><td>${esc(a.input)}</td><td class="small">${a.values.map(x => x.hex ? `<span class="badge"><span style="width:10px;height:10px;border-radius:50%;background:${esc(x.hex)};display:inline-block;border:1px solid #0002"></span>${esc(x.value)}</span>` : esc(x.value)).join(', ')}</td></tr>`).join('')}</tbody></table></div>`;
  const open = a => {
    const so = slideOver(a ? `Option type · ${a.name}` : 'New option type');
    so.body.innerHTML = `<label class="f">Name<input id="n" value="${esc(a?.name ?? '')}" placeholder="Grade"></label><label class="f">ID<input id="id" value="${esc(a?.id ?? '')}" ${a ? 'disabled' : ''} placeholder="grade"></label>
      <label class="f">Style<select id="in"><option value="chips">Buttons</option><option value="swatch" ${a?.input === 'swatch' ? 'selected' : ''}>Colour swatches</option><option value="select" ${a?.input === 'select' ? 'selected' : ''}>Dropdown</option></select></label>
      <label class="f">Values <span class="help">One per line. For colours: Name #RRGGBB</span><textarea id="vals" rows="8">${esc((a?.values ?? []).map(x => (x.hex ? `${x.value} ${x.hex}` : x.value)).join('\n'))}</textarea></label>`;
    so.foot.innerHTML = '<span></span><button class="btn btn-primary" id="s">Save</button>';
    busy(so.foot.querySelector('#s'), async () => {
      const values = so.body.querySelector('#vals').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const m = l.match(/^(.*?)\s+(#[0-9a-fA-F]{6})$/); return m ? { value: m[1], hex: m[2] } : { value: l }; });
      const body = { id: so.body.querySelector('#id').value, name: so.body.querySelector('#n').value, input: so.body.querySelector('#in').value, values };
      await api(a ? `/attribute-types/${a.id}` : '/attribute-types', a ? 'PUT' : 'POST', body);
      so.close(); attributes(v);
    });
  };
  v.querySelectorAll('tr[data-id]').forEach(r => r.addEventListener('click', () => open(list.find(a => a.id === r.dataset.id))));
  v.querySelector('#new')?.addEventListener('click', () => open(null));
}

// ───────────── Search synonyms ─────────────

export async function synonyms(v) {
  const rows = await api('/synonyms');
  const groups = rows.reduce((m, r) => { (m[r.group_key] ??= []).push(r); return m; }, {});
  v.innerHTML = `<div class="page-head"><div><h1>Search synonyms</h1><p>Words in the same group find the same products: “phuchka” finds fuchka, “nolen gur” finds patali gur.</p></div></div>
    ${can('catalog:write') ? `<form class="filters card" id="add"><input class="i" name="groupKey" placeholder="Group, e.g. fuchka" list="groups"><datalist id="groups">${Object.keys(groups).map(g => `<option value="${esc(g)}">`).join('')}</datalist><input class="i" name="term" placeholder="New word customers type"><button class="btn btn-primary">Add</button></form>` : ''}
    ${Object.entries(groups).map(([g, terms]) => `<div class="card"><h3>${esc(g)}</h3><div class="chips">${terms.map(t => `<span class="chip">${esc(t.term)}${can('catalog:write') ? ` <button class="icon-btn" style="width:20px;height:20px" data-del="${t.id}" aria-label="Remove ${esc(t.term)}">✕</button>` : ''}</span>`).join('')}</div></div>`).join('')}`;
  v.querySelector('#add')?.addEventListener('submit', async e => { e.preventDefault(); try { await api('/synonyms', 'POST', Object.fromEntries(new FormData(e.target))); synonyms(v); } catch (err) { toast(err.message, true); } });
  v.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => { await api(`/synonyms/${b.dataset.del}`, 'DELETE'); synonyms(v); }));
}
