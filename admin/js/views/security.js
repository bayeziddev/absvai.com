// Security (Section 11): the block list and every blocked, held or rate-limited attempt, so false positives are visible and reversible.
import { api, badge, busy, can, confirmBox, date, esc, qs, slideOver, toast } from '../app.js';

const LAYERS = { phone: 'Blocked phone', device: 'Blocked device', ip: 'Blocked connection', velocity: 'Too many orders', interval: 'Repeat order too soon', otp: 'SMS code limit', bot: 'Bot check failed', honeypot: 'Bot form field', token: 'Checkout token missing' };

export async function security(v) {
  const tab = qs().get('tab') ?? 'attempts';
  const write = can('security:write');
  v.innerHTML = `
    <div class="page-head"><div><h1>Security</h1><p>Blocks stop online orders only; staff can still enter a manual order after talking to the customer. Connection (IP) blocks always expire, because many customers share mobile-network IPs.</p></div>
      ${write ? '<button class="btn btn-primary" id="add">+ Block a phone number</button>' : ''}</div>
    <nav class="tabs"><a href="#/security?tab=attempts" aria-current="${tab === 'attempts'}">Blocked attempts</a><a href="#/security?tab=blocks" aria-current="${tab === 'blocks'}">Block list</a><a href="#/security?tab=expired" aria-current="${tab === 'expired'}">Including expired</a></nav>
    <div id="body"><p class="muted">Loading…</p></div>`;
  const body = v.querySelector('#body');
  if (write) v.querySelector('#add').addEventListener('click', () => addBlock(() => security(v)));
  if (tab === 'attempts') return attempts(body, write);
  const rows = await api(`/security/blocks${tab === 'expired' ? '?all=1' : ''}`);
  const now = new Date().toISOString();
  body.innerHTML = `<div class="table-wrap"><table><thead><tr><th>What</th><th>Reason</th><th>Expires</th><th>Added</th><th></th></tr></thead><tbody>
    ${rows.map(b => `<tr><td>${badge(b.type)} ${esc(b.value_hint ?? '')}</td><td>${esc(b.reason)}</td><td>${b.expires_at ? `${date(b.expires_at)}${b.expires_at < now ? ' <span class="badge b-grey">expired</span>' : ''}` : '<span class="badge b-red">never</span>'}</td>
      <td class="small">${date(b.created_at)}<br><span class="muted">${esc(b.created_by_name ?? 'System')}</span></td>
      <td>${write ? `<button class="btn btn-sm btn-outline" data-unblock="${b.id}">Unblock</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nobody is blocked.</td></tr>'}
    </tbody></table></div>`;
  body.querySelectorAll('[data-unblock]').forEach(b => b.addEventListener('click', async () => {
    const note = prompt('Why are you unblocking? (kept in the audit log)');
    if (note === null) return;
    try { await api(`/security/blocks/${b.dataset.unblock}?note=${encodeURIComponent(note)}`, 'DELETE'); toast('Unblocked.'); security(v); } catch (err) { toast(err.message, true); }
  }));
}

async function attempts(body, write, before = null) {
  const rows = await api(`/security/attempts${before ? `?before=${before}` : ''}`);
  const html = rows.map(a => `<tr data-id="${a.id}">
      <td class="small nowrap">${date(a.created_at)}</td>
      <td>${esc(LAYERS[a.layer] ?? a.layer)}<br>${badge(a.action)}</td>
      <td class="small">${esc(a.reason)}${a.order_no ? `<br>Order <a href="#/orders/${a.order_id}">${esc(a.order_no)}</a>` : ''}</td>
      <td class="small">${esc(a.phone_hint ?? '')}${a.device_hash ? `<br><span class="muted">device ${esc(a.device_hash.slice(0, 6))}…</span>` : ''}${a.ip_hash ? `<br><span class="muted">connection ${esc(a.ip_hash.slice(0, 6))}…</span>` : ''}</td>
      <td class="small">${a.reviewed_at ? `<span class="badge b-green">reviewed</span> ${esc(a.reviewed_by_name ?? '')}<br>${esc(a.review_note ?? '')}` : write ? `<button class="btn btn-sm btn-outline" data-review="${a.id}" data-block="${a.active_block_id ?? ''}">Review</button>` : '<span class="muted">Not reviewed</span>'}</td></tr>`).join('');
  if (!before) {
    body.innerHTML = `<p class="small muted">Newest first. A real customer caught by a rule? Press <b>Review</b>, add a note and unblock in one step.</p>
      <div class="table-wrap"><table><thead><tr><th>When</th><th>Rule</th><th>Detail</th><th>Who</th><th></th></tr></thead><tbody id="att">${html || '<tr><td colspan="5" class="empty">No blocked attempts. </td></tr>'}</tbody></table></div>
      <p class="center"><button class="btn btn-outline" id="more" ${rows.length === 100 ? '' : 'hidden'}>Load older</button></p>`;
  } else {
    body.querySelector('#att').insertAdjacentHTML('beforeend', html);
    body.querySelector('#more').hidden = rows.length < 100;
  }
  const last = rows[rows.length - 1];
  const more = body.querySelector('#more');
  more.onclick = () => attempts(body, write, last?.id);
  body.querySelectorAll('[data-review]:not([data-bound])').forEach(b => {
    b.dataset.bound = '1';
    b.addEventListener('click', () => review(Number(b.dataset.review), Boolean(b.dataset.block), () => attempts(body, write)));
  });
}

function review(id, hasBlock, done) {
  const so = slideOver('Review attempt');
  so.body.innerHTML = `<label class="f">Note <span class="help">e.g. “Real customer, called to confirm”. Required.</span><input id="note"></label>
    ${hasBlock ? '<label class="check"><input type="checkbox" id="unblock" checked> Remove the block that stopped this attempt</label>' : ''}
    <details style="margin-top:12px"><summary class="small">Or block the device / connection behind it…</summary>
      <div class="grid-2" style="margin-top:8px"><label class="f">What<select id="bt"><option value="device">This device</option><option value="ip">This connection (IP)</option></select></label>
      <label class="f">For (hours)<input id="hours" inputmode="numeric" value="24"></label></div>
      <button class="btn btn-sm btn-outline" id="blk">Block</button></details>`;
  so.foot.innerHTML = '<span></span><button class="btn btn-primary" id="ok">Mark reviewed</button>';
  busy(so.foot.querySelector('#ok'), async () => {
    const r = await api(`/security/attempts/${id}/review`, 'POST', { note: so.body.querySelector('#note').value, unblock: so.body.querySelector('#unblock')?.checked ?? false });
    toast(r.unblocked ? 'Reviewed and unblocked.' : 'Reviewed.');
    so.close(); done();
  });
  busy(so.body.querySelector('#blk'), async () => {
    if (!(await confirmBox('Block it? Orders from it will be stopped until the block expires or is removed.'))) return;
    await api(`/security/attempts/${id}/block`, 'POST', { type: so.body.querySelector('#bt').value, hours: Number(so.body.querySelector('#hours').value) || 24, reason: so.body.querySelector('#note').value });
    toast('Blocked.');
    so.close(); done();
  });
}

function addBlock(done) {
  const so = slideOver('Block a phone number');
  so.body.innerHTML = `<label class="f">Mobile number<input id="ph" inputmode="numeric" placeholder="01XXXXXXXXX"></label>
    <label class="f">Reason <span class="help">e.g. “Refused 3 parcels”. Shown to staff, never to the customer.</span><input id="rs"></label>
    <label class="f">For how many days? <span class="help">Empty = until someone removes it.</span><input id="days" inputmode="numeric"></label>`;
  so.foot.innerHTML = '<span></span><button class="btn btn-primary" id="ok">Block</button>';
  busy(so.foot.querySelector('#ok'), async () => {
    const g = s => so.body.querySelector(s).value;
    await api('/security/blocks', 'POST', { phone: g('#ph'), reason: g('#rs'), days: Number(g('#days')) || null });
    toast('Blocked.');
    so.close(); done();
  });
}
