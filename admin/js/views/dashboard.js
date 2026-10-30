import { api, badge, can, date, esc, taka } from '../app.js';
import { barChart, compactTaka, fillDays, funnel, hBars, lineChart, tableView } from './charts.js';

export async function dashboard(v) {
  const d = await api('/dashboard');
  const k = d.kpis;
  const s = d.seasons;
  v.innerHTML = `
    <div class="page-head"><div><h1>Overview</h1><p>Today in Bangladesh time.</p></div><div class="row">${can('orders:write') ? '<a class="btn btn-outline" href="#/manual">+ Manual order</a>' : ''}${can('catalog:write') ? '<a class="btn btn-primary" href="#/products?new=1">+ Add product</a>' : ''}</div></div>
    <div class="health">${d.health.map(h => `<span><span class="dot ${h.ok ? 'ok' : 'warn'}"></span>${esc(h.text)}</span>`).join('')}</div>
    <h2 class="section-title">Order pipeline</h2>
    <div class="stages">${d.stages.map(st => `<a class="stage ${st.value === 'new' && st.count ? 'alert' : ''}" href="#/orders?status=${st.value}" title="${esc(st.meaning)}"><span>${esc(st.label)}</span><b>${st.count}</b><small>${esc(st.scope)}</small></a>`).join('')}
      <a class="stage ${d.held ? 'alert' : ''}" href="#/orders?status=held" title="Possible duplicates or too many orders from one phone"><span>On hold</span><b>${d.held}</b><small>needs a look</small></a>
      <a class="stage ${d.awaitingReturnScan ? 'warn' : ''}" href="#/returns" title="Returned parcels not scanned in at the warehouse yet"><span>Returns to scan</span><b>${d.awaitingReturnScan}</b><small>stock back on scan</small></a>
      <a class="stage" href="#/incomplete" title="Checkouts with a phone number that were not finished"><span>Incomplete</span><b>${d.incomplete}</b><small>last 7 days</small></a></div>
    <div class="kpis">
      <div class="kpi"><span>Today’s orders</span><b>${k.todayOrders}</b></div>
      <div class="kpi"><span>Today’s revenue</span><b>${taka(k.todayRevenuePaisa)}</b></div>
      <div class="kpi"><span>Cash on Delivery with couriers</span><b>${taka(k.codWithCourierPaisa)}</b></div>
      <div class="kpi"><span>Low stock options</span><b>${k.lowStock}</b></div>
      ${k.stockValuePaisa !== undefined ? `<div class="kpi"><span>Stock value at cost</span><b>${taka(k.stockValuePaisa)}</b></div>` : ''}
    </div>
    ${chartsSection(d.charts)}
    <div class="split">
      <div>
        <div class="card"><h2>Needs your attention today</h2>
          <ul class="attention">${d.attention.map(a => `<li><a href="${a.href}"><span class="dot ${a.level}"></span>${esc(a.text)}</a></li>`).join('') || '<li class="muted">Nothing urgent. Nice.</li>'}</ul></div>
        <div class="card"><h2>Recent orders <a class="btn btn-sm btn-outline" href="#/orders">All orders</a></h2>
          <div class="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th>Risk</th></tr></thead><tbody>
          ${d.recentOrders.map(o => `<tr class="clickable" data-href="#/orders/${o.id}"><td><b>${esc(o.order_no)}</b><br><span class="small muted">${date(o.created_at)}</span></td><td>${esc(o.customer_name)}<br><span class="small muted">${esc(o.district_name)}</span></td><td>${taka(o.total_paisa)}</td><td>${badge(o.status)}</td><td>${badge(o.risk_level)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No orders yet.</td></tr>'}
          </tbody></table></div></div>
      </div>
      <div>
        <div class="card season-card"><h2>Seasons</h2>
          ${s.active.length ? s.active.map(a => `<p><b>${esc(a.name)}</b> is live · ${a.daysLeft} day(s) left (ends ${date(a.endsOn)})</p>`).join('') : '<p>No season is live right now.</p>'}
          ${s.next ? `<p class="muted">Next: <b>${esc(s.next.name)}</b> in ${s.next.daysUntil} day(s), ${date(s.next.startsOn)}</p>` : ''}
          ${s.undated.length ? `<p class="muted">Needs dates: ${s.undated.map(esc).join(', ')}</p>` : ''}
          <a class="btn btn-sm" style="background:#fff;color:#2A1F1A" href="#/seasons">Open season calendar</a></div>
        <div class="card"><h2>Low stock</h2>${d.lowStock.length ? `<ul class="attention">${d.lowStock.map(l => `<li><a href="#/products/${l.product_id}"><span class="dot ${l.stock === 0 ? 'alert' : 'warn'}"></span><span>${esc(l.name)}<br><span class="small muted">${esc(l.sku)} · ${l.stock} available</span></span></a></li>`).join('')}</ul>` : '<p class="muted">All options have stock.</p>'}</div>
        ${d.fuzzyPostcodes ? `<div class="card"><h2>Postcodes</h2><p class="small">${d.fuzzyPostcodes} postcode(s) were linked by spelling match during import. <a href="#/geo?status=fuzzy">Review them</a>.</p></div>` : ''}
      </div>
    </div>`;
  v.querySelectorAll('[data-href]').forEach(r => r.addEventListener('click', () => { location.hash = r.dataset.href; }));
  drawCharts(v, d.charts);
}

function chartsSection(ch) {
  const days = fillDays(ch.daily);
  const revenue = days.reduce((s, x) => s + x.revenue, 0);
  const orders = days.reduce((s, x) => s + x.orders, 0);
  const f = ch.funnel;
  return `<h2 class="section-title">Last 30 days</h2>
    <div class="ch-grid">
      <div class="card ch-card ch-wide"><div class="ch-head"><h2>Sales per day</h2><b class="ch-total">${taka(revenue)}</b></div><p class="ch-sub">Orders that were not cancelled or returned, by the day they were placed.</p>
        <div class="ch" id="ch-sales" data-label="Sales per day, last 30 days"></div>${tableView(['Day', 'Sales'], days.map(x => [x.day, taka(x.revenue)]))}</div>
      <div class="card ch-card"><div class="ch-head"><h2>Orders per day</h2><b class="ch-total">${orders}</b></div><p class="ch-sub">Every channel, test orders left out.</p>
        <div class="ch" id="ch-orders" data-label="Orders per day, last 30 days"></div>${tableView(['Day', 'Orders'], days.map(x => [x.day, String(x.orders)]))}</div>
      <div class="card ch-card"><div class="ch-head"><h2>From checkout to delivery</h2></div><p class="ch-sub">Website orders: how many customers reach each step.</p>
        <div id="ch-funnel"></div>${tableView(['Step', 'Customers'], [['Started checkout', f.started], ['Placed the order', f.placed], ['Confirmed', f.confirmed], ['Sent to courier', f.shipped], ['Delivered', f.delivered]].map(([a, b]) => [a, String(b)]))}</div>
      <div class="card ch-card"><div class="ch-head"><h2>Top delivery areas</h2></div><p class="ch-sub">Districts with the most orders, from delivery addresses.</p>
        <div id="ch-places"></div>${tableView(['District', 'Orders', 'Sales'], ch.places.map(x => [x.district, String(x.orders), taka(x.revenue)]))}</div>
      <div class="card ch-card"><div class="ch-head"><h2>Best customers</h2></div><p class="ch-sub">By money spent (cancelled and returned orders left out).</p>
        ${ch.customers.length ? `<ul class="ch-people">${ch.customers.map((x, i) => `<li><span class="ch-rank">${i + 1}</span><div><b>${esc(x.name)}</b><br><span class="small muted">${esc(x.district)} · ${esc(x.phone)}</span></div><div class="right"><b>${taka(x.spent)}</b><br><span class="small muted">${x.orders} order(s)</span></div></li>`).join('')}</ul>` : '<p class="muted small">No orders in the last 30 days yet.</p>'}</div>
      <div class="card ch-card"><div class="ch-head"><h2>Orders by channel</h2></div><p class="ch-sub">Where orders came from: website, Messenger, phone…</p>
        <div id="ch-channels"></div>${tableView(['Channel', 'Orders'], ch.channels.map(x => [x.label, String(x.orders)]))}</div>
    </div>`;
}

let resizeTimer;
function drawCharts(v, ch) {
  const days = fillDays(ch.daily);
  const draw = () => {
    const sales = v.querySelector('#ch-sales');
    if (!sales || !document.body.contains(sales)) { removeEventListener('resize', onResize); return; }
    lineChart(sales, days, { value: x => x.revenue, fmt: compactTaka, tipFmt: x => `${taka(x.revenue)} · ${x.orders} order(s)` });
    barChart(v.querySelector('#ch-orders'), days, { value: x => x.orders, fmt: n => String(Math.round(n)), tipFmt: x => `${x.orders} order(s)` });
  };
  const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(draw, 150); };
  draw();
  addEventListener('resize', onResize);
  const f = ch.funnel;
  funnel(v.querySelector('#ch-funnel'), [
    { label: 'Started checkout', value: f.started }, { label: 'Placed the order', value: f.placed }, { label: 'Confirmed', value: f.confirmed },
    { label: 'Sent to courier', value: f.shipped }, { label: 'Delivered', value: f.delivered },
  ]);
  hBars(v.querySelector('#ch-places'), ch.places.map(x => ({ label: x.district, value: Number(x.orders), revenue: Number(x.revenue) })), { fmt: n => `${n} order(s)`, sub: x => taka(x.revenue) });
  hBars(v.querySelector('#ch-channels'), ch.channels.map(x => ({ label: x.label, value: Number(x.orders) })), { fmt: n => `${n} order(s)` });
}
