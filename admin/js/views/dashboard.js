import { api, badge, can, date, esc, taka } from '../app.js';

function chart(rows) {
  // 14 fixed day slots ending today (Bangladesh date), so one busy day doesn't fill the whole chart.
  const byDay = new Map(rows.map(r => [r.day, r]));
  const today = new Date(Date.now() + 6 * 3600000);
  const days = Array.from({ length: 14 }, (_, i) => new Date(today.getTime() - (13 - i) * 86400000).toISOString().slice(0, 10));
  const max = Math.max(...rows.map(r => Number(r.revenue) || 0), 1);
  const total = rows.reduce((s, r) => s + Number(r.revenue || 0), 0);
  const w = 100 / 14;
  return `<svg class="chart" viewBox="0 0 100 60" preserveAspectRatio="none" role="img" aria-label="Revenue per day, last 14 days">
    ${days.map((day, i) => { const r = byDay.get(day); const h = r ? Math.max(1, (Number(r.revenue) / max) * 50) : 0.6; return `<rect x="${i * w + w * 0.18}" y="${55 - h}" width="${w * 0.64}" height="${h}" rx="0.8" fill="${r ? '#B3261E' : '#E9DCC6'}"><title>${esc(day)}: ${r ? `${taka(r.revenue)} (${r.orders} orders)` : 'no sales'}</title></rect>`; }).join('')}
    <line x1="0" y1="55" x2="100" y2="55" stroke="#E9DCC6" stroke-width=".5"/></svg>
    <p class="small muted">${esc(days[0])} → ${esc(days[13])} · ${taka(total)} in total · best day ${rows.length ? taka(max) : '—'}</p>`;
}

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
    <div class="split">
      <div>
        <div class="card"><h2>Needs your attention today</h2>
          <ul class="attention">${d.attention.map(a => `<li><a href="${a.href}"><span class="dot ${a.level}"></span>${esc(a.text)}</a></li>`).join('') || '<li class="muted">Nothing urgent. Nice.</li>'}</ul></div>
        <div class="card"><h2>Sales, last 14 days</h2>${chart(d.chart)}</div>
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
}
