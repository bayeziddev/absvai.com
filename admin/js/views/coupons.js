// Coupons: codes customers type at checkout (or that a landing page applies for them). Percent off, taka off or free
// delivery, with a minimum order, dates and limits. Each coupon shows how many orders and how much money it brought.
import { api, badge, busy, can, confirmBox, date, esc, fromPaisa, slideOver, taka, toast, toPaisa } from '../app.js';

const KIND = { percent: 'Percent off', fixed: 'Taka off', free_delivery: 'Free delivery' };
const bdDay = iso => (iso ? new Date(Date.parse(iso) + 6 * 3600_000).toISOString().slice(0, 10) : '');

function what(c) {
  const v = c.kind === 'percent' ? `${c.value}% off${c.max_discount_paisa ? ` (up to ${taka(c.max_discount_paisa)})` : ''}` : c.kind === 'fixed' ? `${taka(c.value)} off` : 'Free delivery';
  return `${v}${c.min_subtotal_paisa ? ` · orders from ${taka(c.min_subtotal_paisa)}` : ''}`;
}
function state(c) {
  const now = new Date().toISOString();
  if (!c.is_active) return ['off', 'Off'];
  if (c.ends_at && now > c.ends_at) return ['past', 'Ended'];
  if (c.starts_at && now < c.starts_at) return ['upcoming', 'Starts later'];
  if (c.usage_limit !== null && c.used_count >= c.usage_limit) return ['past', 'Used up'];
  return ['active', 'Working'];
}

export async function coupons(v) {
  const list = await api('/coupons');
  const write = can('catalog:write');
  v.innerHTML = `<div class="page-head"><div><h1>Coupons</h1><p>Customers type the code at checkout and see the discount before ordering. A landing page can apply a coupon for everyone who orders there.</p></div>${write ? '<button class="btn btn-primary" id="new">+ New coupon</button>' : ''}</div>
    ${list.length ? `<div class="table-wrap"><table><thead><tr><th>Code</th><th>Gives</th><th>Dates</th><th class="right">Used</th><th class="right">Orders</th><th class="right">Discount given</th><th class="right">Sales</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map(c => { const [b, label] = state(c); return `<tr><td><b class="mono">${esc(c.code)}</b>${c.note ? `<br><span class="small muted">${esc(c.note)}</span>` : ''}</td><td>${esc(what(c))}</td>
        <td class="small">${c.starts_at || c.ends_at ? `${c.starts_at ? date(bdDay(c.starts_at)) : 'Now'} → ${c.ends_at ? date(bdDay(c.ends_at)) : 'no end'}` : 'Always'}</td>
        <td class="right">${c.used_count}${c.usage_limit ? ` / ${c.usage_limit}` : ''}</td><td class="right">${c.orders}</td><td class="right">${taka(c.discount_paisa)}</td><td class="right">${taka(c.revenue_paisa)}</td>
        <td>${badge(b)} ${esc(label)}</td>
        <td class="row">${write ? `<button class="btn btn-sm btn-outline" data-edit="${c.id}">Edit</button><button class="btn btn-sm btn-ghost" data-toggle="${c.id}">${c.is_active ? 'Switch off' : 'Switch on'}</button><button class="btn btn-sm btn-ghost" data-del="${c.id}">Delete</button>` : ''}</td></tr>`; }).join('')}
      </tbody></table></div>` : `<div class="card empty-state"><h2>No coupon yet</h2><p>For example <b>WINTER20</b> for 20% off in winter, <b>EID100</b> for ৳100 off orders from ৳1,000, or <b>FREEDEL</b> for free delivery.</p>${write ? '<button class="btn btn-primary" id="new2">+ New coupon</button>' : ''}</div>`}`;
  const open = c => editCoupon(c, () => coupons(v));
  v.querySelector('#new')?.addEventListener('click', () => open(null));
  v.querySelector('#new2')?.addEventListener('click', () => open(null));
  v.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => open(list.find(c => c.id === Number(b.dataset.edit)))));
  v.querySelectorAll('[data-toggle]').forEach(b => busy(b, async () => { const c = list.find(x => x.id === Number(b.dataset.toggle)); await api(`/coupons/${c.id}/active`, 'POST', { active: !c.is_active }); toast(c.is_active ? 'Switched off.' : 'Switched on.'); coupons(v); }));
  v.querySelectorAll('[data-del]').forEach(b => busy(b, async () => {
    if (!(await confirmBox('Delete this coupon?'))) return;
    const r = await api(`/coupons/${b.dataset.del}`, 'DELETE');
    toast(r.message ?? 'Deleted.'); coupons(v);
  }));
}

function editCoupon(c, done) {
  const so = slideOver(c ? `Coupon ${c.code}` : 'New coupon');
  const kind = c?.kind ?? 'percent';
  const suggest = () => `${['SAVE', 'OFFER', 'EID', 'WINTER', 'DEAL'][Math.floor(Math.random() * 5)]}${Math.floor(10 + Math.random() * 90)}`;
  so.body.innerHTML = `<label class="f">Code <span class="help">What customers type. Letters and numbers.</span><span class="row"><input id="code" value="${esc(c?.code ?? '')}" maxlength="30" style="flex:1;text-transform:uppercase" placeholder="WINTER20"><button type="button" class="btn btn-sm btn-outline" id="gen">Make one</button></span></label>
    <div class="f"><b>The coupon gives</b><div class="row">${Object.entries(KIND).map(([k, l]) => `<label class="check"><input type="radio" name="kind" value="${k}" ${k === kind ? 'checked' : ''}> ${l}</label>`).join('')}</div></div>
    <div class="grid-2"><label class="f" data-for="percent fixed"><span data-value-label>${kind === 'fixed' ? 'Taka off (৳)' : 'Percent off (%)'}</span><input id="value" inputmode="decimal" value="${c ? (c.kind === 'fixed' ? fromPaisa(c.value) : c.value) : ''}"></label>
      <label class="f" data-for="percent">At most (৳) <span class="help">Optional cap for a percentage.</span><input id="max" inputmode="decimal" value="${esc(fromPaisa(c?.max_discount_paisa))}"></label></div>
    <label class="f">Minimum order (৳) <span class="help">Products only, before delivery. Leave empty for any order.</span><input id="min" inputmode="decimal" value="${c?.min_subtotal_paisa ? fromPaisa(c.min_subtotal_paisa) : ''}"></label>
    <div class="grid-2"><label class="f">Starts on <span class="help">Empty: from now.</span><input id="starts" type="date" value="${bdDay(c?.starts_at)}"></label><label class="f">Ends on <span class="help">Empty: no end.</span><input id="ends" type="date" value="${bdDay(c?.ends_at)}"></label></div>
    <div class="grid-2"><label class="f">Total uses <span class="help">Empty: no limit.</span><input id="limit" type="number" min="1" value="${c?.usage_limit ?? ''}"></label><label class="f">Uses per customer <span class="help">By mobile number. 1 = once each.</span><input id="per" type="number" min="1" value="${c?.per_phone_limit ?? ''}"></label></div>
    <label class="f">Note for the team (optional)<input id="note" maxlength="200" value="${esc(c?.note ?? '')}" placeholder="e.g. Facebook ad, November"></label>
    <label class="check"><input type="checkbox" id="active" ${c ? (c.is_active ? 'checked' : '') : 'checked'}> Working (customers can use it)</label>`;
  so.foot.innerHTML = '<span></span><button class="btn btn-primary" id="s">Save coupon</button>';
  const g = id => so.body.querySelector(`#${id}`);
  const sync = () => {
    const k = so.body.querySelector('input[name=kind]:checked').value;
    so.body.querySelectorAll('[data-for]').forEach(el => { el.hidden = !el.dataset.for.split(' ').includes(k); });
    so.body.querySelector('[data-value-label]').textContent = k === 'fixed' ? 'Taka off (৳)' : 'Percent off (%)';
  };
  so.body.querySelectorAll('input[name=kind]').forEach(r => r.addEventListener('change', sync)); sync();
  g('gen').addEventListener('click', () => { g('code').value = suggest(); });
  busy(so.foot.querySelector('#s'), async () => {
    const k = so.body.querySelector('input[name=kind]:checked').value;
    const num = s => (s.trim() === '' ? null : s.trim());
    const body = {
      code: g('code').value, kind: k, value: k === 'fixed' ? toPaisa(g('value').value || '0') : Number(g('value').value || 0),
      maxDiscountPaisa: num(g('max').value) === null ? null : toPaisa(g('max').value), minSubtotalPaisa: num(g('min').value) === null ? 0 : toPaisa(g('min').value),
      startsOn: g('starts').value, endsOn: g('ends').value, usageLimit: num(g('limit').value) === null ? null : Number(g('limit').value), perPhoneLimit: num(g('per').value) === null ? null : Number(g('per').value),
      note: g('note').value, isActive: g('active').checked,
    };
    await api(c ? `/coupons/${c.id}` : '/coupons', c ? 'PUT' : 'POST', body);
    toast('Coupon saved.'); so.close(); done();
  });
}
