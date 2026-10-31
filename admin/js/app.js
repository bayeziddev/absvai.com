// Abs Vai admin: a small hash-routed app. Every permission is enforced again on the server.
import { NAV, routes } from './routes.js';

export const state = { user: null, csrf: '' };
const app = document.getElementById('app');

// ── Helpers ──
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const taka = p => (p === null || p === undefined || p === '' ? '—' : `৳${(Number(p) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
export const toPaisa = v => { const n = Number(String(v).replace(/[৳,\s]/g, '')); return Number.isFinite(n) && String(v).trim() !== '' ? Math.round(n * 100) : null; };
export const fromPaisa = p => (p === null || p === undefined ? '' : String(Number(p) / 100));
export const date = iso => (iso ? new Date(iso.length === 10 ? `${iso}T00:00:00+06:00` : iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', ...(iso.length > 10 ? { hour: '2-digit', minute: '2-digit' } : {}), timeZone: 'Asia/Dhaka' }) : '—');
export const qs = () => new URLSearchParams(location.hash.split('?')[1] ?? '');

export async function api(path, method = 'GET', body) {
  const opts = { method, credentials: 'same-origin', headers: { 'x-csrf-token': state.csrf } };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(`/api/admin${path}`, opts);
  if (r.status === 401 && path !== '/me') { state.user = null; renderLogin('Please sign in again.'); throw new Error('Please sign in.'); }
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw Object.assign(new Error(data?.error ?? 'Something went wrong.'), { status: r.status, data });
  return data;
}

let toastTimer;
export function toast(msg, err = false) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = `toast${err ? ' err' : ''}`; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, err ? 6000 : 3000);
}

export function confirmBox(text) {
  const d = document.getElementById('confirm');
  document.getElementById('confirm-text').textContent = text;
  d.returnValue = '';
  d.showModal();
  return new Promise(resolve => d.addEventListener('close', () => resolve(d.returnValue === 'yes'), { once: true }));
}

/** Slide-over panel used for every form. Returns { body, foot, close }. */
export function slideOver(title, { wide = false, onClose } = {}) {
  const back = document.createElement('div');
  back.className = 'over-backdrop';
  const panel = document.createElement('section');
  panel.className = `over${wide ? ' wide' : ''}`;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.innerHTML = `<div class="over-head"><h2>${esc(title)}</h2><button class="icon-btn" type="button" data-x aria-label="Close">✕</button></div><div class="over-body"></div><div class="over-foot"></div>`;
  document.body.append(back, panel);
  const close = () => { back.remove(); panel.remove(); document.removeEventListener('keydown', key); onClose?.(); };
  const key = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key);
  back.addEventListener('click', close);
  panel.querySelector('[data-x]').addEventListener('click', close);
  return { panel, head: panel.querySelector('.over-head'), body: panel.querySelector('.over-body'), foot: panel.querySelector('.over-foot'), close };
}

/** Wires a submit button to an async action with busy state and error toast. */
export function busy(btn, fn) {
  btn.addEventListener('click', async e => {
    e.preventDefault();
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Working…';
    try { await fn(); } catch (err) { toast(err.message, true); } finally { btn.disabled = false; btn.textContent = label; }
  });
}

export const formData = form => Object.fromEntries(new FormData(form));
export const can = perm => {
  const r = state.user?.role;
  if (r === 'super_admin') return true;
  // Mirrors the server's role table (worker/src/lib/auth.ts). The server enforces it; this only hides buttons.
  const map = {
    manager: ['orders:write', 'orders:export', 'orders:discount', 'catalog:write', 'seasons:write', 'geo:write', 'settings:write', 'security:read', 'security:write', 'inventory:write', 'audit:read', 'reports:read'],
    order_processor: ['orders:write', 'security:read'],
    warehouse: ['orders:pack', 'inventory:write'],
    accountant: ['orders:export', 'cost:read', 'reports:read', 'audit:read'],
    viewer: ['reports:read'],
  };
  return (map[r] ?? []).includes(perm);
};

export function badge(status) {
  const colors = { new: 'b-yellow', in_courier: 'b-green', partial_delivered: 'b-red', blocked: 'b-red', held: 'b-red', not_interested: 'b-grey', unreachable: 'b-grey', spam: 'b-red', received: 'b-dark', rate_limited: 'b-yellow', silently_rejected: 'b-red', confirmed: 'b-green', packed: 'b-green', delivered: 'b-dark', cancelled: 'b-grey', returned: 'b-red', draft: 'b-grey', published: 'b-green', scheduled: 'b-yellow', archived: 'b-grey', low: 'b-green', medium: 'b-yellow', high: 'b-red', active: 'b-green', upcoming: 'b-yellow', past: 'b-grey', needs_dates: 'b-red', off: 'b-grey', exact: 'b-green', alias: 'b-green', fuzzy: 'b-yellow', unmatched: 'b-red', manual: 'b-dark', submitted: 'b-yellow', paid: 'b-green', not_required: 'b-grey', open: 'b-yellow', contacted: 'b-green', converted: 'b-dark', dismissed: 'b-grey', waiting: 'b-yellow', sent: 'b-green', retired: 'b-grey', won: 'b-green', lost: 'b-grey', queued: 'b-grey', failed: 'b-red', skipped: 'b-yellow' };
  return `<span class="badge ${colors[status] ?? ''}">${esc(String(status ?? '').replace(/_/g, ' '))}</span>`;
}

// ── Icons (simple strokes) ──
const ICONS = {
  image: 'M3 3h18v18H3zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21',
  mail: 'M4 4h16v16H4zM4 6l8 7 8-7',
  dash: 'M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z', orders: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0',
  box: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8', tag: 'M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z', layers: 'm12 2 10 5-10 5L2 7zM2 17l10 5 10-5M2 12l10 5 10-5',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2', users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  truck: 'M1 4h14v12H1zM15 9h4l3 3v4h-7zM5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z', pin: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2', search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4', file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
  chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z', chart: 'M3 3v18h18M7 15l4-4 3 3 5-6', shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
  menu: 'M3 6h18M3 12h18M3 18h18', scan: 'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M11 8v8M14 8v8M17 8v8',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4', plus: 'M12 5v14M5 12h14', barcode: 'M4 6v12M7 6v12M10 6v12M14 6v12M17 6v12M20 6v12',
};
export const icon = (n, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[n] ?? ICONS.help}"/></svg>`;

// ── Auth screens ──
async function renderLogin(message = '') {
  const { needsSetup } = await fetch('/api/admin/setup-status').then(r => r.json()).catch(() => ({ needsSetup: false }));
  app.innerHTML = needsSetup ? `
    <form class="login" id="auth">
      <p class="wordmark">Abs<span>Vai</span><small>Admin</small></p>
      <h1>First-time setup</h1>
      <p class="muted">Create the Super Admin account. You need the setup token from the deployment (the SETUP_TOKEN secret).</p>
      <label class="f">Setup token<input name="token" required autocomplete="off"></label>
      <label class="f">Your name<input name="name" required autocomplete="name"></label>
      <label class="f">Email<input name="email" type="email" required autocomplete="username"></label>
      <label class="f">Password <span class="help">At least 10 characters with a number.</span><input name="password" type="password" required minlength="10" autocomplete="new-password"></label>
      <p class="notice err" id="auth-err" hidden></p>
      <button class="btn btn-primary" style="width:100%">Create account</button>
    </form>` : `
    <form class="login" id="auth">
      <p class="wordmark">Abs<span>Vai</span><small>Admin</small></p>
      <h1>Sign in</h1>
      ${message ? `<p class="notice">${esc(message)}</p>` : ''}
      <label class="f">Email<input name="email" type="email" required autocomplete="username"></label>
      <label class="f">Password<input name="password" type="password" required autocomplete="current-password"></label>
      <p class="notice err" id="auth-err" hidden></p>
      <button class="btn btn-primary" style="width:100%">Sign in</button>
    </form>`;
  const form = document.getElementById('auth');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const err = document.getElementById('auth-err');
    try {
      const r = await fetch(`/api/admin/${needsSetup ? 'setup' : 'login'}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(formData(form)) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      state.user = j.user; state.csrf = j.csrf;
      if (!location.hash || location.hash === '#/') location.hash = '#/dashboard';
      renderShell();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
}

// ── Shell ──
// Simple mode (default) shows the everyday screens only; the full menu is one tap away and remembered per device.
const simpleMode = () => { try { return localStorage.getItem('absvai.admin.simple') !== '0'; } catch { return true; } };
function visibleNav() {
  const items = simpleMode() ? NAV.filter(i => i.group || i.simple) : NAV;
  // Drop group headings with nothing under them.
  return items.filter((it, i) => !it.group || (items[i + 1] && !items[i + 1].group));
}

function renderShell() {
  const collapsed = localStorage.getItem('absvai.admin.collapsed') === '1';
  app.innerHTML = `
    <div class="shell${collapsed ? ' collapsed' : ''}">
      <aside class="side" id="side">
        <div class="side-head"><a class="wordmark" href="#/dashboard">Abs<span>Vai</span><small>Admin</small></a><button class="icon-btn" id="collapse" aria-label="Collapse menu">«</button></div>
        <ul class="nav">${visibleNav().map(item => item.group ? `<li class="nav-group">${esc(item.group)}</li>` : `
          <li><a href="${item.soon ? '#/soon?m=' + encodeURIComponent(item.label) : '#/' + item.route}" data-route="${item.route ?? ''}" ${item.soon ? 'aria-disabled="true"' : ''} title="${esc(item.label)}">${icon(item.icon)}<span>${esc(item.label)}</span>${item.soon ? `<span class="soon">${esc(item.soon)}</span>` : ''}</a></li>`).join('')}</ul>
        <button class="nav-mode" id="nav-mode" type="button">${simpleMode() ? 'Show all tools' : 'Simple menu'}</button>
      </aside>
      <div class="main">
        <header class="topbar">
          <button class="icon-btn" id="menu" aria-label="Menu">${icon('menu')}</button>
          <form class="search" id="gsearch" role="search"><input name="q" placeholder="Find an order (number, phone, name) or product…" aria-label="Search"></form>
          <a class="btn btn-outline btn-sm" href="/" target="_blank" rel="noopener">View store</a>
          <button class="btn btn-ghost btn-sm" id="logout">Sign out</button>
        </header>
        <div class="content" id="view"></div>
      </div>
      <aside class="rightbar" id="rightbar"></aside>
    </div>
    <button class="ai-fab" id="ai-fab" type="button" aria-expanded="false" aria-controls="ai-panel">${icon('chat')}<span>Assistant</span></button>
    <section class="ai-panel" id="ai-panel" role="dialog" aria-label="Admin assistant" hidden></section>`;
  document.getElementById('collapse').onclick = () => { const s = document.querySelector('.shell'); s.classList.toggle('collapsed'); localStorage.setItem('absvai.admin.collapsed', s.classList.contains('collapsed') ? '1' : '0'); };
  document.getElementById('menu').onclick = () => document.getElementById('side').classList.toggle('open');
  document.getElementById('nav-mode').onclick = () => { try { localStorage.setItem('absvai.admin.simple', simpleMode() ? '0' : '1'); } catch { /* private mode */ } renderShell(); };
  document.getElementById('logout').onclick = async () => { await api('/logout', 'POST').catch(() => {}); state.user = null; renderLogin('Signed out.'); };
  document.getElementById('gsearch').addEventListener('submit', e => { e.preventDefault(); const q = e.target.q.value.trim(); location.hash = /^(AV|PRE|INV)-|^01\d/i.test(q) || /^\d+$/.test(q) ? `#/orders?q=${encodeURIComponent(q)}` : `#/products?q=${encodeURIComponent(q)}`; });
  // The admin assistant's code loads the first time someone opens it.
  document.getElementById('ai-fab').onclick = () => import('./views/assistant.js').then(m => m.toggleAssistant());
  renderRightbar();
  route();
}

async function renderRightbar() {
  const rb = document.getElementById('rightbar');
  if (!rb) return;
  rb.innerHTML = `
    <div class="card"><h3>${esc(state.user.name)}</h3><p class="muted small">${esc(state.user.email)}<br>${badge(state.user.role)}</p></div>
    <div class="card"><h3>Quick links</h3><p class="small"><a href="#/products?new=1">+ Add a product</a><br><a href="#/orders?status=new">Orders to confirm</a><br><a href="#/manual">+ Manual order</a><br><a href="#/incomplete">Incomplete orders</a><br><a href="#/seasons">Season calendar</a><br><a href="#/help">Help for staff</a></p></div>
    <div class="card" id="rb-notes"><h3>Notifications</h3><p class="muted small">Loading…</p></div>`;
  try {
    const d = await api('/dashboard');
    document.getElementById('rb-notes').innerHTML = `<h3>Notifications</h3><ul class="attention">${d.attention.slice(0, 6).map(a => `<li><a href="${a.href}"><span class="dot ${a.level}"></span><span class="small">${esc(a.text)}</span></a></li>`).join('') || '<li class="muted small">All clear.</li>'}</ul>`;
  } catch { /* viewer without dashboard */ }
}

export function view() { return document.getElementById('view'); }

async function route() {
  if (!state.user) return;
  const path = (location.hash.slice(2) || 'dashboard').split('?')[0];
  const name = path.split('/')[0];
  document.querySelectorAll('.nav a').forEach(a => a.setAttribute('aria-current', a.dataset.route === name ? 'page' : 'false'));
  document.getElementById('side')?.classList.remove('open');
  const handler = routes[name] ?? routes.dashboard;
  const v = view();
  v.innerHTML = '<p class="muted">Loading…</p>';
  try { await handler(v, path.split('/').slice(1)); } catch (e) { if (e.status !== 401) v.innerHTML = `<div class="notice err">${esc(e.message)}</div>`; }
}

addEventListener('hashchange', route);

(async () => {
  try {
    const me = await fetch('/api/admin/me', { credentials: 'same-origin' });
    if (!me.ok) throw new Error();
    const j = await me.json();
    state.user = j.user; state.csrf = j.csrf;
    renderShell();
  } catch { renderLogin(); }
})();
