import { api, busy, can, confirmBox, esc, fromPaisa, slideOver, taka, toast, toPaisa } from '../app.js';

// ───────────── Delivery zones ─────────────

export async function zones(v) {
  const d = await api('/zones');
  const write = can('geo:write');
  v.innerHTML = `
    <div class="page-head"><div><h1>Delivery Zones</h1><p>Each district belongs to a zone; areas (upazila / city corporation) can override it. Districts not listed use the default zone. Packed weight drives the charge.</p></div>${write ? '<button class="btn btn-primary" id="new">+ New zone</button>' : ''}</div>
    <div class="table-wrap"><table><thead><tr><th>Zone</th><th class="right">Base charge</th><th class="right">Up to</th><th class="right">Per extra kg</th><th class="right">Large item</th><th>Delivery time</th><th class="right">Districts</th></tr></thead><tbody>
    ${d.zones.map(z => `<tr class="clickable" data-id="${z.id}"><td><b>${esc(z.name)}</b>${z.is_default ? ' <span class="badge b-dark">default</span>' : ''}</td><td class="right">${taka(z.base_charge_paisa)}</td><td class="right">${z.base_weight_grams / 1000}kg</td><td class="right">${taka(z.extra_per_kg_paisa)}</td><td class="right">${taka(z.bulky_charge_paisa)}</td><td>${esc(z.eta_text)}</td><td class="right">${z.district_count}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="split" style="margin-top:14px">
      <div class="card"><h2>District → zone</h2><div class="table-wrap" style="max-height:480px;overflow:auto"><table><thead><tr><th>District</th><th>Division</th><th>Zone</th></tr></thead><tbody>
        ${d.districts.map(x => `<tr><td>${esc(x.name)}</td><td class="small muted">${esc(x.division)}</td><td><select class="i" data-district="${x.id}" ${write ? '' : 'disabled'}><option value="">Default zone</option>${d.zones.map(z => `<option value="${z.id}" ${z.id === x.zone_id ? 'selected' : ''}>${esc(z.name)}</option>`).join('')}</select></td></tr>`).join('')}
      </tbody></table></div></div>
      <div class="card"><h2>Area overrides</h2><p class="small muted">e.g. Dhaka North / South City Corporation → Inside Dhaka City, while the rest of Dhaka district is Suburbs.</p>
        <ul class="attention">${d.overrides.map(o => `<li><span>${esc(o.name)}, ${esc(o.district)} → <b>${esc(d.zones.find(z => z.id === o.zone_id)?.name ?? '?')}</b></span>${write ? ` <button class="btn btn-sm btn-ghost" data-unover="${o.upazila_id}">Remove</button>` : ''}</li>`).join('') || '<li class="muted">None.</li>'}</ul>
        ${write ? `<div class="grid-2" style="margin-top:10px"><select class="i" id="od"><option value="">District…</option>${d.districts.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select><select class="i" id="ou" disabled><option>Area…</option></select>
          <select class="i" id="oz">${d.zones.map(z => `<option value="${z.id}">${esc(z.name)}</option>`).join('')}</select><button class="btn btn-outline" id="ogo">Add override</button></div>` : ''}</div>
    </div>`;
  v.querySelectorAll('[data-district]').forEach(s => s.addEventListener('change', async () => { await api('/zones/assign-district', 'PUT', { districtId: Number(s.dataset.district), zoneId: Number(s.value) || null }); toast('Saved.'); }));
  v.querySelectorAll('[data-unover]').forEach(b => busy(b, async () => { await api('/zones/assign-upazila', 'PUT', { upazilaId: Number(b.dataset.unover), zoneId: null }); zones(v); }));
  const od = v.querySelector('#od');
  od?.addEventListener('change', async () => { const ups = await api(`/geo/districts/${od.value}/upazilas`); const ou = v.querySelector('#ou'); ou.innerHTML = ups.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join(''); ou.disabled = false; });
  if (v.querySelector('#ogo')) busy(v.querySelector('#ogo'), async () => { await api('/zones/assign-upazila', 'PUT', { upazilaId: Number(v.querySelector('#ou').value), zoneId: Number(v.querySelector('#oz').value) }); zones(v); });
  const open = z => {
    const so = slideOver(z ? `Zone · ${z.name}` : 'New zone');
    so.body.innerHTML = `<label class="f">Name<input id="n" value="${esc(z?.name ?? '')}"></label><div class="grid-2">
      <label class="f">Base charge (৳)<input id="b" value="${esc(fromPaisa(z?.base_charge_paisa ?? 0))}"></label><label class="f">Base covers up to (g)<input id="w" type="number" value="${z?.base_weight_grams ?? 1000}"></label>
      <label class="f">Each extra kg (৳)<input id="x" value="${esc(fromPaisa(z?.extra_per_kg_paisa ?? 0))}"></label><label class="f">Large/bulky item, each (৳)<input id="k" value="${esc(fromPaisa(z?.bulky_charge_paisa ?? 0))}"></label>
      <label class="f">Delivery time shown<input id="e" value="${esc(z?.eta_text ?? '3–5 days')}"></label><label class="check"><input type="checkbox" id="def" ${z?.is_default ? 'checked' : ''}> Default zone</label></div>`;
    so.foot.innerHTML = `${z && write ? '<button class="btn btn-ghost" id="del">Delete</button>' : '<span></span>'}${write ? '<button class="btn btn-primary" id="s">Save</button>' : ''}`;
    if (!write) return;
    const g = id => so.body.querySelector(`#${id}`);
    busy(so.foot.querySelector('#s'), async () => {
      await api(z ? `/zones/${z.id}` : '/zones', z ? 'PUT' : 'POST', { name: g('n').value, baseChargePaisa: toPaisa(g('b').value), baseWeightGrams: Number(g('w').value), extraPerKgPaisa: toPaisa(g('x').value), bulkyChargePaisa: toPaisa(g('k').value), etaText: g('e').value, isDefault: g('def').checked, sortOrder: z?.sort_order ?? d.zones.length, defaultCourier: z?.default_courier ?? null });
      so.close(); zones(v);
    });
    if (z) busy(so.foot.querySelector('#del'), async () => { if (await confirmBox(`Delete ${z.name}?`)) { await api(`/zones/${z.id}`, 'DELETE'); so.close(); zones(v); } });
  };
  v.querySelectorAll('tr[data-id]').forEach(r => r.addEventListener('click', () => open(d.zones.find(z => z.id === Number(r.dataset.id)))));
  v.querySelector('#new')?.addEventListener('click', () => open(null));
}
