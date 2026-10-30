import { api, badge, busy, can, confirmBox, esc, fromPaisa, qs, slideOver, taka, toast, toPaisa } from '../app.js';

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
      await api(z ? `/zones/${z.id}` : '/zones', z ? 'PUT' : 'POST', { name: g('n').value, baseChargePaisa: toPaisa(g('b').value), baseWeightGrams: Number(g('w').value), extraPerKgPaisa: toPaisa(g('x').value), bulkyChargePaisa: toPaisa(g('k').value), etaText: g('e').value, isDefault: g('def').checked, sortOrder: z?.sort_order ?? d.zones.length });
      so.close(); zones(v);
    });
    if (z) busy(so.foot.querySelector('#del'), async () => { if (await confirmBox(`Delete ${z.name}?`)) { await api(`/zones/${z.id}`, 'DELETE'); so.close(); zones(v); } });
  };
  v.querySelectorAll('tr[data-id]').forEach(r => r.addEventListener('click', () => open(d.zones.find(z => z.id === Number(r.dataset.id)))));
  v.querySelector('#new')?.addEventListener('click', () => open(null));
}

// ───────────── Postcodes & geo ─────────────

export async function geo(v) {
  const p = qs();
  const status = p.get('status') ?? 'unmatched';
  const district = p.get('district') ?? '';
  const [summary, rows, zd] = await Promise.all([api('/geo/summary'), api(`/geo/postcodes?status=${status}&district=${district}&q=${encodeURIComponent(p.get('q') ?? '')}`), api('/zones')]);
  const count = s => summary.find(x => x.match_status === s)?.n ?? 0;
  const write = can('geo:write');
  v.innerHTML = `
    <div class="page-head"><div><h1>Postcodes & Geo</h1><p>Postcodes come from the Bangladesh-geocode postcode list and were linked to areas by name during import. Fix the ones that could not be linked so checkout can fill the area too.</p></div>${write ? '<button class="btn btn-primary" id="add">+ Add postcode</button>' : ''}</div>
    <nav class="tabs">${['unmatched', 'fuzzy', 'manual', 'alias', 'exact'].map(s => `<a href="#/geo?status=${s}" aria-current="${s === status}">${s} (${count(s)})</a>`).join('')}</nav>
    <p class="small muted">${{ unmatched: 'District is known but the area is not. Checkout still fills Division + District and asks the customer to pick the area.', fuzzy: 'Linked by spelling similarity. Glance through and fix any that look wrong.', manual: 'Fixed by your team.', alias: 'District “Sadar” spelled differently.', exact: 'Same name in both lists.' }[status]}</p>
    <form class="filters" id="f"><input type="hidden" name="status" value="${esc(status)}"><select class="i" name="district"><option value="">All districts</option>${zd.districts.map(x => `<option value="${x.id}" ${String(x.id) === district ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select><input class="i" name="q" value="${esc(p.get('q') ?? '')}" placeholder="Postcode or name"><button class="btn btn-outline">Filter</button></form>
    ${write && district ? `<div class="card row" id="bulk"><b>Bulk assign</b> ticked rows to <select class="i" id="bu" style="max-width:260px"></select><button class="btn btn-primary btn-sm" id="bgo">Assign</button></div>` : write ? '<p class="small muted">Pick a district to bulk-assign several postcodes at once.</p>' : ''}
    <div class="table-wrap"><table><thead><tr>${write && district ? '<th></th>' : ''}<th>Postcode</th><th>Post office</th><th>Source thana</th><th>District</th><th>Area</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map(r => `<tr>${write && district ? `<td><input type="checkbox" data-pick="${r.id}"></td>` : ''}<td><b>${esc(r.postcode)}</b></td><td>${esc(r.post_office)}</td><td>${esc(r.source_upazila_name ?? '')}</td><td>${esc(r.district_name)}</td><td>${esc(r.upazila_name ?? '—')}<br><span class="small muted">${esc(r.match_note ?? '')}</span></td><td>${badge(r.match_status)}</td>
      <td>${write ? `<button class="btn btn-sm btn-outline" data-fix="${r.id}" data-district="${r.district_id}">Fix</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">Nothing here.</td></tr>'}
    </tbody></table></div>`;
  v.querySelector('#f').addEventListener('submit', e => { e.preventDefault(); location.hash = `#/geo?${new URLSearchParams(new FormData(e.target))}`; });
  if (write && district) {
    const ups = await api(`/geo/districts/${district}/upazilas`);
    v.querySelector('#bu').innerHTML = ups.map(u => `<option value="${u.id}">${esc(u.name)}${u.kind === 'city_corporation' ? ' (city)' : ''}</option>`).join('');
    busy(v.querySelector('#bgo'), async () => {
      const ids = [...v.querySelectorAll('[data-pick]:checked')].map(c => Number(c.dataset.pick));
      if (!ids.length) throw new Error('Tick the postcodes first.');
      const r = await api('/geo/postcodes/bulk-assign', 'POST', { ids, upazilaId: Number(v.querySelector('#bu').value) });
      toast(`${r.updated} postcode(s) linked.`); geo(v);
    });
  }
  v.querySelectorAll('[data-fix]').forEach(b => b.addEventListener('click', async () => {
    const ups = await api(`/geo/districts/${b.dataset.district}/upazilas`);
    const row = rows.find(r => r.id === Number(b.dataset.fix));
    const so = slideOver(`Postcode ${row.postcode} · ${row.post_office}`);
    so.body.innerHTML = `<p class="muted">Source thana: <b>${esc(row.source_upazila_name ?? '')}</b>, district ${esc(row.district_name)}.</p>
      <label class="f">Area (upazila / city corporation)<select id="u"><option value="">Not linked</option>${ups.map(u => `<option value="${u.id}" ${u.id === row.upazila_id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>
      <label class="f">Post office name<input id="po" value="${esc(row.post_office)}"></label>`;
    so.foot.innerHTML = '<span></span><button class="btn btn-primary" id="s">Save</button>';
    busy(so.foot.querySelector('#s'), async () => { await api(`/geo/postcodes/${row.id}`, 'PUT', { upazilaId: Number(so.body.querySelector('#u').value) || null, postOffice: so.body.querySelector('#po').value }); so.close(); toast('Saved. Checkout uses it right away.'); geo(v); });
  }));
  v.querySelector('#add')?.addEventListener('click', () => {
    const so = slideOver('Add a missing postcode');
    so.body.innerHTML = `<label class="f">Postcode<input id="pc" maxlength="4" inputmode="numeric"></label><label class="f">Post office<input id="po"></label>
      <label class="f">District<select id="d"><option value="">Choose…</option>${zd.districts.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label><label class="f">Area<select id="u" disabled></select></label>`;
    const ds = so.body.querySelector('#d');
    ds.addEventListener('change', async () => { const ups = await api(`/geo/districts/${ds.value}/upazilas`); const u = so.body.querySelector('#u'); u.innerHTML = `<option value="">Not sure</option>${ups.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}`; u.disabled = false; });
    so.foot.innerHTML = '<span></span><button class="btn btn-primary" id="s">Add</button>';
    busy(so.foot.querySelector('#s'), async () => { await api('/geo/postcodes', 'POST', { postcode: so.body.querySelector('#pc').value, postOffice: so.body.querySelector('#po').value, districtId: Number(ds.value), upazilaId: Number(so.body.querySelector('#u').value) || null }); so.close(); geo(v); });
  });
}

// ───────────── Courier area mapping ─────────────

export async function couriers(v) {
  const p = qs();
  const courier = p.get('courier') ?? 'steadfast';
  const district = p.get('district') ?? '';
  const zd = await api('/zones');
  const rows = district ? await api(`/courier-areas?courier=${courier}&district=${district}`) : [];
  const write = can('geo:write');
  v.innerHTML = `<div class="page-head"><div><h1>Courier Area Mapping</h1><p>Couriers use their own city / zone / area IDs (Pathao, for example, needs all three). Map our areas to theirs here. Never assume the IDs match.</p></div></div>
    <form class="filters" id="f"><select class="i" name="courier">${['steadfast', 'pathao', 'redx'].map(c => `<option ${c === courier ? 'selected' : ''}>${c}</option>`).join('')}</select><select class="i" name="district"><option value="">Choose a district…</option>${zd.districts.map(x => `<option value="${x.id}" ${String(x.id) === district ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select><button class="btn btn-outline">Show areas</button></form>
    ${district ? `<div class="table-wrap"><table><thead><tr><th>Our area</th><th>Courier city ID</th><th>Zone ID</th><th>Area ID</th><th>Label</th><th></th></tr></thead><tbody>
      ${rows.map(r => `<tr data-u="${r.upazila_id}"><td><b>${esc(r.name)}</b></td><td><input class="i" data-c="cityId" value="${esc(r.courier_city_id ?? '')}"></td><td><input class="i" data-c="zoneId" value="${esc(r.courier_zone_id ?? '')}"></td><td><input class="i" data-c="areaId" value="${esc(r.courier_area_id ?? '')}"></td><td><input class="i" data-c="label" value="${esc(r.label ?? '')}"></td><td>${write ? '<button class="btn btn-sm btn-outline" data-save>Save</button>' : ''}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">Choose a courier and district.</p>'}
    <p class="small muted">Courier API booking and tracking sync arrive in Phase 2; this table is what they will use.</p>`;
  v.querySelector('#f').addEventListener('submit', e => { e.preventDefault(); location.hash = `#/couriers?${new URLSearchParams(new FormData(e.target))}`; });
  v.querySelectorAll('[data-save]').forEach(b => busy(b, async () => {
    const tr = b.closest('tr');
    const val = k => tr.querySelector(`[data-c=${k}]`).value;
    await api('/courier-areas', 'PUT', { courier, upazilaId: Number(tr.dataset.u), cityId: val('cityId'), zoneId: val('zoneId'), areaId: val('areaId'), label: val('label') });
    toast('Saved.');
  }));
}
