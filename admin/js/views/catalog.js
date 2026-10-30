import { api, badge, busy, can, confirmBox, esc, slideOver, toast } from '../app.js';

// ───────────── Categories ─────────────

export async function categories(v) {
  const [cats, templates, seasons] = await Promise.all([api('/categories'), api('/templates'), api('/season-options')]);
  const roots = cats.filter(c => !c.parent_id);
  const ordered = roots.flatMap(r => [r, ...cats.filter(c => c.parent_id === r.id)]);
  v.innerHTML = `
    <div class="page-head"><div><h1>Categories</h1><p>Each category uses one product template. Seasonal categories hide from the menu outside their season.</p></div>${can('catalog:write') ? '<button class="btn btn-primary" id="new">+ Add category</button>' : ''}</div>
    <div class="table-wrap"><table><thead><tr><th>Category</th><th>Code</th><th>Template</th><th>Shows</th><th class="right">Products</th><th>Active</th></tr></thead><tbody>
    ${ordered.map(c => `<tr class="clickable" data-id="${c.id}"><td>${c.parent_id ? '<span class="muted">— </span>' : ''}<b>${esc(c.name)}</b><br><span class="small muted">/c/${esc(c.slug)}</span></td><td>${esc(c.code)}</td><td>${esc(c.template_name)}</td>
      <td>${c.season_visibility === 'always' ? 'Always' : `Only in ${c.season_ids.map(id => esc(seasons.find(s => s.id === id)?.name ?? '?')).join(', ')}`}</td><td class="right">${c.product_count}</td><td>${c.is_active ? badge('active') : badge('off')}</td></tr>`).join('')}
    </tbody></table></div>`;
  const open = c => editCategory(c, cats, templates, seasons, () => categories(v));
  v.querySelectorAll('tr[data-id]').forEach(r => r.addEventListener('click', () => open(cats.find(c => c.id === Number(r.dataset.id)))));
  v.querySelector('#new')?.addEventListener('click', () => open(null));
}

function editCategory(c, cats, templates, seasons, done) {
  const so = slideOver(c ? `Category · ${c.name}` : 'New category');
  const active = templates.filter(t => t.status === 'active' || t.id === c?.template_id);
  so.body.innerHTML = `<form id="f">
    <label class="f">Name<input name="name" value="${esc(c?.name ?? '')}" required></label>
    <div class="grid-2"><label class="f">Web address (slug)<input name="slug" value="${esc(c?.slug ?? '')}" placeholder="made from the name"></label>
      <label class="f">SKU code <span class="help">2–5 letters, starts every SKU, e.g. ORG.</span><input name="code" value="${esc(c?.code ?? '')}" maxlength="5" required></label></div>
    <label class="f">Parent category<select name="parentId"><option value="">None (top level)</option>${cats.filter(x => !x.parent_id && x.id !== c?.id).map(x => `<option value="${x.id}" ${x.id === c?.parent_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
    <label class="f">Product template <span class="help">Decides the options and details every product here needs.</span><select name="templateId">${active.map(t => `<option value="${esc(t.id)}" ${t.id === c?.template_id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
    <label class="f">Show in the menu<select name="seasonVisibility"><option value="always">Always</option><option value="seasons" ${c?.season_visibility === 'seasons' ? 'selected' : ''}>Only during these seasons…</option></select></label>
    <div id="sv" ${c?.season_visibility === 'seasons' ? '' : 'hidden'}>${seasons.map(s => `<label class="check" style="margin-right:12px"><input type="checkbox" name="season" value="${s.id}" ${c?.season_ids?.includes(s.id) ? 'checked' : ''}> ${esc(s.name)}</label>`).join('')}</div>
    <label class="f" style="margin-top:12px">Icon / image URL<input name="iconUrl" value="${esc(c?.icon_url ?? '')}" placeholder="/img/placeholders/gur.svg"></label>
    <label class="f">Description<textarea name="description" rows="2">${esc(c?.description ?? '')}</textarea></label>
    <div class="grid-2"><label class="f">Display order<input name="sortOrder" type="number" value="${c?.sort_order ?? 0}"></label><label class="check"><input type="checkbox" name="isActive" ${c?.is_active !== 0 ? 'checked' : ''}> Active</label></div>
    <div class="grid-2"><label class="f">SEO title<input name="metaTitle" value="${esc(c?.meta_title ?? '')}"></label><label class="f">SEO description<input name="metaDescription" value="${esc(c?.meta_description ?? '')}"></label></div></form>`;
  const form = so.body.querySelector('#f');
  form.seasonVisibility.addEventListener('change', () => { so.body.querySelector('#sv').hidden = form.seasonVisibility.value !== 'seasons'; });
  so.foot.innerHTML = `${c && can('catalog:write') ? '<button class="btn btn-ghost" id="del">Delete</button>' : '<span></span>'}${can('catalog:write') ? '<button class="btn btn-primary" id="save">Save</button>' : ''}`;
  if (!can('catalog:write')) return;
  busy(so.foot.querySelector('#save'), async () => {
    const body = { name: form.name.value, slug: form.slug.value, code: form.code.value, parentId: Number(form.parentId.value) || null, templateId: form.templateId.value, seasonVisibility: form.seasonVisibility.value,
      seasonIds: [...form.querySelectorAll('[name=season]:checked')].map(x => Number(x.value)), iconUrl: form.iconUrl.value, description: form.description.value, sortOrder: Number(form.sortOrder.value) || 0,
      isActive: form.isActive.checked, metaTitle: form.metaTitle.value, metaDescription: form.metaDescription.value };
    await api(c ? `/categories/${c.id}` : '/categories', c ? 'PUT' : 'POST', body);
    toast('Saved.'); so.close(); done();
  });
  if (c) busy(so.foot.querySelector('#del'), async () => { if (await confirmBox(`Delete “${c.name}”?`)) { await api(`/categories/${c.id}`, 'DELETE'); so.close(); done(); } });
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
