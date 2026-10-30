// Small SVG charts for the overview, drawn at the card's real width so text and 2 px lines stay crisp. One measure per
// chart (never two y-axes), one hue per chart, neutral ink for every label, a hover tooltip on every chart and a
// "Show as table" view for screen readers and exact numbers.
import { esc } from '../app.js';

const C = { mark: '#B3261E', soft: 'rgba(179, 38, 30, 0.10)', grid: '#EFE6D8', axis: '#8A7A6E', ink: '#2A1F1A' };

/** 1-2-5 rounding so the top gridline is a friendly number. */
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}
export const compactTaka = paisa => { const t = paisa / 100; return t >= 100000 ? `৳${(t / 100000).toFixed(t >= 1e6 ? 0 : 1)}L` : t >= 1000 ? `৳${(t / 1000).toFixed(t >= 10000 ? 0 : 1)}k` : `৳${Math.round(t)}`; };
const shortDay = iso => new Date(`${iso}T00:00:00+06:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Dhaka' });

/** The last `n` Bangladesh dates, oldest first, with zeros for days without orders. */
export function fillDays(rows, n = 30) {
  const by = new Map(rows.map(r => [r.day, r]));
  const today = Date.now() + 6 * 3600000;
  return Array.from({ length: n }, (_, i) => {
    const day = new Date(today - (n - 1 - i) * 86400000).toISOString().slice(0, 10);
    const r = by.get(day);
    return { day, orders: Number(r?.orders ?? 0), revenue: Number(r?.revenue ?? 0) };
  });
}

function tip(el) {
  let t = el.querySelector('.ch-tip');
  if (!t) { t = document.createElement('div'); t.className = 'ch-tip'; t.hidden = true; el.append(t); }
  return {
    show(html, x, y) {
      t.innerHTML = html; t.hidden = false;
      const w = t.offsetWidth;
      t.style.left = `${Math.min(Math.max(0, x - w / 2), el.clientWidth - w)}px`;
      t.style.top = `${Math.max(0, y - t.offsetHeight - 10)}px`;
    },
    hide() { t.hidden = true; },
  };
}

function yAxis(max, h, pad, w, fmt) {
  return [0, 0.25, 0.5, 0.75, 1].map(f => {
    const y = pad.t + (h - pad.t - pad.b) * (1 - f);
    return `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y}" y2="${y}" stroke="${C.grid}" stroke-width="1"/>
      <text x="${pad.l - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="${C.axis}">${esc(fmt(max * f))}</text>`;
  }).join('');
}

/** Area/line over days (single series, so the title names it and there is no legend). */
export function lineChart(el, points, { value, fmt, tipFmt }) {
  const w = Math.max(280, el.clientWidth);
  const h = 220;
  const pad = { t: 14, r: 12, b: 26, l: 52 };
  const max = niceMax(Math.max(...points.map(value), 0));
  const x = i => pad.l + (w - pad.l - pad.r) * (points.length === 1 ? 0.5 : i / (points.length - 1));
  const y = v => pad.t + (h - pad.t - pad.b) * (1 - v / max);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(value(p)).toFixed(1)}`).join('');
  const area = `${line}L${x(points.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
  const ticks = [0, Math.floor((points.length - 1) / 2), points.length - 1];
  el.innerHTML = `<svg width="${w}" height="${h}" role="img" aria-label="${esc(el.dataset.label ?? '')}">
    ${yAxis(max, h, pad, w, fmt)}
    <path d="${area}" fill="${C.soft}"/>
    <path d="${line}" fill="none" stroke="${C.mark}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${ticks.map(i => `<text x="${x(i)}" y="${h - 6}" text-anchor="${i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}" font-size="11" fill="${C.axis}">${esc(shortDay(points[i].day))}</text>`).join('')}
    <line class="ch-cross" x1="0" x2="0" y1="${pad.t}" y2="${h - pad.b}" stroke="${C.axis}" stroke-width="1" stroke-dasharray="3 3" visibility="hidden"/>
    <circle class="ch-dot" r="5" fill="${C.mark}" stroke="#fff" stroke-width="2" visibility="hidden"/>
    <rect x="${pad.l}" y="0" width="${w - pad.l - pad.r}" height="${h}" fill="transparent" class="ch-hit"/></svg>`;
  const svg = el.querySelector('svg');
  const t = tip(el);
  const cross = svg.querySelector('.ch-cross');
  const dot = svg.querySelector('.ch-dot');
  const move = e => {
    const r = svg.getBoundingClientRect();
    const px = (e.touches?.[0]?.clientX ?? e.clientX) - r.left;
    const i = Math.round(((px - pad.l) / (w - pad.l - pad.r)) * (points.length - 1));
    const p = points[Math.min(points.length - 1, Math.max(0, i))];
    const k = points.indexOf(p);
    cross.setAttribute('x1', x(k)); cross.setAttribute('x2', x(k)); cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', x(k)); dot.setAttribute('cy', y(value(p))); dot.setAttribute('visibility', 'visible');
    t.show(`<b>${esc(shortDay(p.day))}</b><br>${tipFmt(p)}`, x(k), y(value(p)));
  };
  const leave = () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); t.hide(); };
  const hit = svg.querySelector('.ch-hit');
  hit.addEventListener('mousemove', move); hit.addEventListener('touchstart', move, { passive: true }); hit.addEventListener('mouseleave', leave);
}

/** Vertical bars over days: rounded tops, square base on the axis, 2 px gaps. */
export function barChart(el, points, { value, fmt, tipFmt }) {
  const w = Math.max(280, el.clientWidth);
  const h = 220;
  const pad = { t: 14, r: 12, b: 26, l: 40 };
  const max = niceMax(Math.max(...points.map(value), 0));
  const slot = (w - pad.l - pad.r) / points.length;
  const bw = Math.max(2, slot - 2);
  const base = h - pad.b;
  const ticks = [0, Math.floor((points.length - 1) / 2), points.length - 1];
  el.innerHTML = `<svg width="${w}" height="${h}" role="img" aria-label="${esc(el.dataset.label ?? '')}">
    ${yAxis(max, h, pad, w, fmt)}
    ${points.map((p, i) => {
      const bh = value(p) ? Math.max(2, (base - pad.t) * value(p) / max) : 0;
      const x0 = pad.l + i * slot + 1;
      const r = Math.min(4, bw / 2, bh);
      // Rounded at the data end only; anchored square on the baseline.
      const d = bh ? `M${x0},${base}V${base - bh + r}Q${x0},${base - bh} ${x0 + r},${base - bh}H${x0 + bw - r}Q${x0 + bw},${base - bh} ${x0 + bw},${base - bh + r}V${base}Z` : '';
      return `<g data-i="${i}"><rect x="${pad.l + i * slot}" y="${pad.t}" width="${slot}" height="${base - pad.t}" fill="transparent"/>${d ? `<path d="${d}" fill="${C.mark}"/>` : ''}</g>`;
    }).join('')}
    ${ticks.map(i => `<text x="${pad.l + i * slot + slot / 2}" y="${h - 6}" text-anchor="${i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}" font-size="11" fill="${C.axis}">${esc(shortDay(points[i].day))}</text>`).join('')}</svg>`;
  const t = tip(el);
  el.querySelectorAll('g[data-i]').forEach(g => {
    const i = Number(g.dataset.i);
    const p = points[i];
    g.addEventListener('mouseenter', () => t.show(`<b>${esc(shortDay(p.day))}</b><br>${tipFmt(p)}`, pad.l + i * slot + slot / 2, base - (base - pad.t) * value(p) / max));
    g.addEventListener('mouseleave', () => t.hide());
  });
}

/** Ranked horizontal bars (one hue; the label carries identity). */
export function hBars(el, items, { fmt, sub }) {
  const max = Math.max(...items.map(i => i.value), 1);
  el.innerHTML = items.length ? `<ul class="ch-hbars">${items.map((it, i) => `<li data-i="${i}">
      <div class="ch-hbar-label"><span>${esc(it.label)}</span><b>${esc(fmt(it.value))}</b></div>
      <div class="ch-hbar-track"><div class="ch-hbar" style="width:${Math.max(2, (it.value / max) * 100).toFixed(1)}%"></div></div>
      ${sub ? `<div class="ch-hbar-sub">${esc(sub(it))}</div>` : ''}</li>`).join('')}</ul>` : '<p class="muted small">No orders in the last 30 days yet.</p>';
}

/** Funnel: each step's bar is its share of the first step, with the step-to-step rate beside it. */
export function funnel(el, steps) {
  if (!steps[0]?.value) { el.innerHTML = '<p class="muted small">No website checkouts in the last 30 days yet. As customers start checkout on the website, each step fills in here.</p>'; return; }
  const top = Math.max(steps[0].value, 1);
  el.innerHTML = `<ol class="ch-funnel">${steps.map((s, i) => {
    const prev = i ? steps[i - 1].value : null;
    const rate = prev ? Math.round((s.value / prev) * 100) : null;
    return `<li><div class="ch-funnel-head"><span>${esc(s.label)}</span><b>${s.value.toLocaleString('en-US')}</b></div>
      <div class="ch-funnel-track"><div class="ch-funnel-bar" style="width:${Math.max(s.value ? 2 : 0, (s.value / top) * 100).toFixed(1)}%"></div></div>
      ${i ? `<div class="ch-funnel-rate">${prev ? `${rate}% of the step before` : '—'}</div>` : ''}</li>`;
  }).join('')}</ol>`;
}

/** Accessible table version of a chart. */
export const tableView = (head, rows) => `<details class="ch-table"><summary>Show as table</summary><div class="table-wrap"><table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
