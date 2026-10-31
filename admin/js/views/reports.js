// Reports: sales for any dates (Bangladesh days): the totals, sales per day, and what sold, where, from which channel,
// landing page, coupon and courier. Every table downloads as a CSV for Excel. Cost and profit show only to the owner
// and the accountant.
import { api, esc, qs, taka } from '../app.js';
import { compactTaka, lineChart } from './charts.js';

const SOURCE = { web: 'Website', landing: 'Landing page', facebook_comment: 'Facebook comment', messenger: 'Messenger', whatsapp: 'WhatsApp', phone_call: 'Phone call', instagram: 'Instagram', walk_in: 'In the shop', other: 'Other' };
const COURIER = { steadfast: 'Steadfast', pathao: 'Pathao', redx: 'RedX', carrybee: 'Carrybee', own_delivery: 'Own delivery' };
const bdToday = () => new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10);
const shift = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');

function presets() {
  const t = bdToday();
  const m = t.slice(0, 8);
  const lastMonthEnd = shift(`${m}01`, -1);
  return [['Today', t, t], ['Yesterday', shift(t, -1), shift(t, -1)], ['Last 7 days', shift(t, -6), t], ['Last 30 days', shift(t, -29), t], ['This month', `${m}01`, t], ['Last month', `${lastMonthEnd.slice(0, 8)}01`, lastMonthEnd]];
}

function csv(name, head, rows) {
  const cell = x => { const s = String(x ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const blob = new Blob([`﻿${[head, ...rows].map(r => r.map(cell).join(',')).join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** A table section with its CSV button. `rows` are arrays of display cells; `raw` the same as plain values for the CSV. */
const WIDE = new Set(['products', 'landing']);
function table(id, title, head, rows, raw, note = '') {
  return `<div class="card rp-card${WIDE.has(id) ? ' rp-wide' : ''}"><div class="rp-head"><h2>${title}</h2>${rows.length ? `<button class="btn btn-sm btn-outline" data-csv="${id}">Download CSV</button>` : ''}</div>${note ? `<p class="small muted">${note}</p>` : ''}
    ${rows.length ? `<div class="table-wrap"><table><thead><tr>${head.map((h, i) => `<th${i ? ' class="right"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td${i ? ' class="right"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="muted small">Nothing in these dates.</p>'}</div>`;
}

export async function reports(v) {
  const p = qs();
  const all = presets();
  const from = p.get('from') || all[3][1];
  const to = p.get('to') || all[3][2];
  v.innerHTML = `<div class="page-head"><div><h1>Reports</h1><p>Sales for any dates, in Bangladesh time. Test orders are left out; “sales” means orders that were not cancelled.</p></div></div>
    <div class="card rp-range"><div class="row">${all.map(([l, a, b]) => `<a class="btn btn-sm ${a === from && b === to ? 'btn-primary' : 'btn-outline'}" href="#/reports?from=${a}&to=${b}">${l}</a>`).join('')}</div>
      <form class="row" id="custom"><label class="f">From<input type="date" name="from" value="${from}" max="${bdToday()}"></label><label class="f">To<input type="date" name="to" value="${to}" max="${bdToday()}"></label><button class="btn btn-outline">Show</button></form></div>
    <div id="rp"><p class="muted">Loading…</p></div>`;
  v.querySelector('#custom').addEventListener('submit', e => { e.preventDefault(); const f = new FormData(e.target); location.hash = `#/reports?from=${f.get('from')}&to=${f.get('to')}`; });
  let d;
  try { d = await api(`/reports/sales?from=${from}&to=${to}`); } catch (err) { v.querySelector('#rp').innerHTML = `<p class="notice err">${esc(err.message)}</p>`; return; }
  const t = d.totals;
  const n = k => Number(t[k] ?? 0);
  const finished = n('delivered') + n('partial') + n('returned');
  const profit = d.withCost ? d.products.reduce((a, r) => a + Number(r.sales_paisa) - Number(r.cost_paisa ?? 0), 0) : null;
  const missingCost = d.withCost && d.products.some(r => Number(r.missing_cost) > 0);
  const days = [];
  for (let day = from; day <= to && days.length < 400; day = shift(day, 1)) {
    const r = d.byDay.find(x => x.day === day);
    days.push({ day, orders: Number(r?.orders ?? 0), revenue: Number(r?.sales_paisa ?? 0), delivered: Number(r?.delivered ?? 0), returned: Number(r?.returned ?? 0) });
  }
  const sets = {
    days: { name: 'sales-by-day', head: ['Day', 'Orders', 'Sales (BDT)', 'Delivered', 'Returned'], raw: days.map(x => [x.day, x.orders, x.revenue / 100, x.delivered, x.returned]) },
    products: { name: 'products', head: ['Product', 'Qty', 'Orders', 'Sales (BDT)', ...(d.withCost ? ['Cost (BDT)', 'Profit (BDT)'] : [])], raw: d.products.map(r => [r.name, r.qty, r.orders, r.sales_paisa / 100, ...(d.withCost ? [Number(r.cost_paisa ?? 0) / 100, (r.sales_paisa - (r.cost_paisa ?? 0)) / 100] : [])]) },
    categories: { name: 'categories', head: ['Category', 'Qty', 'Orders', 'Sales (BDT)'], raw: d.categories.map(r => [r.name, r.qty, r.orders, r.sales_paisa / 100]) },
    districts: { name: 'districts', head: ['District', 'Orders', 'Sales (BDT)', 'Delivered', 'Returned'], raw: d.districts.map(r => [r.name, r.orders, r.sales_paisa / 100, r.delivered, r.returned]) },
    sources: { name: 'channels', head: ['Channel', 'Orders', 'Sales (BDT)', 'Delivered'], raw: d.sources.map(r => [SOURCE[r.name] ?? r.name, r.orders, r.sales_paisa / 100, r.delivered]) },
    landing: { name: 'landing-pages', head: ['Landing page', 'Visits (all time)', 'Orders', 'Sales (BDT)', 'Delivered'], raw: d.landingPages.map(r => [r.name, r.views, r.orders, r.sales_paisa / 100, r.delivered]) },
    coupons: { name: 'coupons', head: ['Coupon', 'Orders', 'Discount (BDT)', 'Sales (BDT)'], raw: d.coupons.map(r => [r.name, r.orders, r.discount_paisa / 100, r.sales_paisa / 100]) },
    couriers: { name: 'couriers', head: ['Courier', 'Parcels', 'On the way', 'Delivered', 'Returned', 'Delivery rate'], raw: d.couriers.map(r => [COURIER[r.name] ?? r.name, r.orders, r.on_the_way, r.delivered, r.returned, pct(r.delivered, Number(r.delivered) + Number(r.returned))]) },
    staff: { name: 'staff-orders', head: ['Entered by', 'Orders', 'Sales (BDT)', 'Delivered'], raw: d.staff.map(r => [r.name, r.orders, r.sales_paisa / 100, r.delivered]) },
  };
  const kpi = (label, value, sub = '') => `<div class="kpi"><span>${label}</span><b>${value}</b>${sub ? `<small class="muted">${sub}</small>` : ''}</div>`;
  v.querySelector('#rp').innerHTML = `<div class="kpis rp-kpis">
      ${kpi('Sales', taka(n('sales_paisa')), `${n('kept')} order(s) · ${n('customers')} customer(s)`)}
      ${kpi('Average order', n('kept') ? taka(Math.round(n('sales_paisa') / n('kept'))) : '—')}
      ${kpi('Delivered money', taka(n('delivered_paisa')), `${n('delivered') + n('partial')} delivered`)}
      ${kpi('Delivery rate', pct(n('delivered') + n('partial'), finished), `${n('returned')} returned`)}
      ${kpi('Still open', String(n('open') + n('in_courier')), `${n('in_courier')} with the courier`)}
      ${kpi('Cancelled', String(n('cancelled')), pct(n('cancelled'), n('orders')))}
      ${kpi('Discounts given', taka(n('discount_paisa')))}
      ${kpi('Delivery charges', taka(n('delivery_paisa')))}
      ${profit !== null ? kpi('Product profit', taka(profit), missingCost ? 'some options have no cost price' : 'sales − cost of products') : ''}
    </div>
    <div class="card ch-card"><div class="ch-head"><h2>Sales per day</h2><b class="ch-total">${taka(n('sales_paisa'))}</b></div><div class="ch" id="rp-chart" data-label="Sales per day"></div></div>
    <div class="rp-grid">
      ${table('days', 'By day', sets.days.head, days.filter(x => x.orders).reverse().map(x => [esc(x.day), x.orders, taka(x.revenue), x.delivered, x.returned]), sets.days.raw)}
      ${table('products', 'Best-selling products', sets.products.head, d.products.map(r => [esc(r.name), r.qty, r.orders, taka(r.sales_paisa), ...(d.withCost ? [taka(r.cost_paisa ?? 0), taka(r.sales_paisa - (r.cost_paisa ?? 0))] : [])]), sets.products.raw, d.withCost ? 'Cost uses each option’s current average cost price.' : '')}
      ${table('categories', 'By category', sets.categories.head, d.categories.map(r => [esc(r.name), r.qty, r.orders, taka(r.sales_paisa)]), sets.categories.raw)}
      ${table('districts', 'By district', sets.districts.head, d.districts.map(r => [esc(r.name ?? '—'), r.orders, taka(r.sales_paisa), r.delivered, r.returned]), sets.districts.raw)}
      ${table('sources', 'Where orders came from', sets.sources.head, d.sources.map(r => [esc(SOURCE[r.name] ?? r.name), r.orders, taka(r.sales_paisa), r.delivered]), sets.sources.raw)}
      ${table('landing', 'Landing pages', sets.landing.head, d.landingPages.map(r => [`<a href="#/landing/${r.id}">${esc(r.name)}</a>`, r.views, r.orders, taka(r.sales_paisa), r.delivered]), sets.landing.raw, 'Visits are counted since the page was made.')}
      ${table('coupons', 'Coupons', sets.coupons.head, d.coupons.map(r => [`<b>${esc(r.name)}</b>`, r.orders, taka(r.discount_paisa), taka(r.sales_paisa)]), sets.coupons.raw)}
      ${table('couriers', 'Couriers', sets.couriers.head, d.couriers.map(r => [esc(COURIER[r.name] ?? r.name), r.orders, r.on_the_way, r.delivered, r.returned, pct(r.delivered, Number(r.delivered) + Number(r.returned))]), sets.couriers.raw, 'Orders handed to a courier in these dates.')}
      ${table('staff', 'Orders entered by the team', sets.staff.head, d.staff.map(r => [esc(r.name), r.orders, taka(r.sales_paisa), r.delivered]), sets.staff.raw, 'Manual orders (phone, Facebook, WhatsApp).')}
    </div>`;
  lineChart(v.querySelector('#rp-chart'), days, { value: x => x.revenue, fmt: compactTaka, tipFmt: x => `${taka(x.revenue)} · ${x.orders} order(s)` });
  v.querySelectorAll('[data-csv]').forEach(b => b.addEventListener('click', () => { const s = sets[b.dataset.csv]; csv(`${s.name}-${from}-to-${to}.csv`, s.head, s.raw); }));
}
