// Emails: where shop alerts go, which emails are sent, a test button, offers to customers, and the log of every email.
import { api, badge, busy, can, date, esc, toast } from '../app.js';

const KIND = {
  owner_new_order: 'New order (to you)', owner_update: 'Order update (to you)', owner_daily: 'Morning summary (to you)', owner_inquiry: 'Inquiry (to you)',
  customer_receipt: 'Receipt (to customer)', customer_invoice: 'Invoice (to customer)', customer_shipped: 'On the way (to customer)', customer_delivered: 'Delivered (to customer)',
  marketing: 'Offer', test: 'Test',
};

export async function emails(v) {
  const d = await api('/emails');
  const write = can('settings:write');
  const val = d.values;
  const dis = write ? '' : 'disabled';
  const tick = (k, label) => `<label class="check"><input type="checkbox" data-k="${k}" ${val[k] !== '0' ? 'checked' : ''} ${dis}> ${esc(label)}</label>`;
  v.innerHTML = `<div class="page-head"><div><h1>Emails</h1><p>New orders and updates come to your inbox; customers who give an email get their receipt, invoice and delivery news.</p></div></div>
    <div class="card">
      <h2>Status</h2>
      <ul class="em-status">
        <li class="${d.connected ? 'ok' : 'bad'}">${d.connected ? 'Email is connected (Resend).' : 'Email is not connected yet. Add the <b>RESEND_API_KEY</b> secret in GitHub (Settings → Secrets and variables → Actions) and deploy.'}</li>
        <li class="${d.canEmailCustomers ? 'ok' : 'warn'}">${d.canEmailCustomers ? 'Your own sender address is set, so customers get emails too.' : 'Only <b>you</b> get emails for now. To email customers, verify your domain (e.g. absvai.com) in Resend → Domains, then change “Emails come from” below to an address on it, like <b>Abs Vai &lt;orders@absvai.com&gt;</b>.'}</li>
      </ul>
      <p class="small muted">Last 7 days: ${['sent', 'failed', 'skipped', 'queued'].map(k => `${d.counts[k] ?? 0} ${k}`).join(' · ')}</p>
    </div>
    <div class="card"><h2>Addresses</h2>
      <div class="grid-3">
        <label class="f">Send shop alerts to<input data-k="notify_email" type="email" value="${esc(val.notify_email)}" placeholder="absvai1020@gmail.com" ${dis}></label>
        <label class="f">Emails come from<input data-k="email_from" value="${esc(val.email_from)}" placeholder="Abs Vai <onboarding@resend.dev>" ${dis}></label>
        <label class="f">Customer replies go to<input data-k="email_reply_to" type="email" value="${esc(val.email_reply_to)}" placeholder="absvai1020@gmail.com" ${dis}></label>
      </div>
      <h3>Which emails</h3>
      ${tick('email_owner_new_order', 'Email me every new order')}
      ${tick('email_owner_updates', 'Email me when an order is cancelled, returned or delivered, and about wholesale inquiries')}
      ${tick('email_owner_daily', 'Email me a summary every morning (yesterday’s orders and what needs attention)')}
      ${tick('email_customer_updates', 'Email customers their receipt, invoice, “on the way” and “delivered” (only if they give an email at checkout)')}
      ${write ? '<div class="row" style="margin-top:12px"><button class="btn btn-primary" id="save">Save</button><button class="btn btn-outline" id="test">Send me a test email</button></div>' : ''}
    </div>
    <div class="card"><h2>Send an offer</h2>
      <p class="small muted">${d.offersCount} customer(s) asked for offers by email at checkout. Each email has an unsubscribe link, and you get a copy.</p>
      <label class="f">Subject<input id="of-subject" maxlength="120" placeholder="Winter offer: 10% off khejur gur" ${dis}></label>
      <label class="f">Message<textarea id="of-message" rows="5" maxlength="4000" placeholder="Fresh patali gur from Jashore is here…" ${dis}></textarea></label>
      <div class="grid-2"><label class="f">Button text (optional)<input id="of-cta" maxlength="40" placeholder="Shop now" ${dis}></label><label class="f">Button opens<input id="of-href" placeholder="/deals" ${dis}></label></div>
      ${write ? `<button class="btn btn-primary" id="offer" ${d.offersCount && d.canEmailCustomers ? '' : 'disabled'}>Send to ${d.offersCount} customer(s)</button>${d.canEmailCustomers ? '' : '<p class="small muted">Available once your domain is verified in Resend.</p>'}` : ''}
    </div>
    <div class="card"><h2>Recent emails</h2>
      <div class="table-wrap"><table><thead><tr><th>When</th><th>Email</th><th>To</th><th>Status</th></tr></thead><tbody>
      ${d.recent.map(e => `<tr><td class="small">${date(e.created_at)}</td><td><b>${esc(KIND[e.kind] ?? e.kind)}</b><br><span class="small muted">${esc(e.subject)}</span></td><td class="small">${esc(e.to_email)}</td><td>${badge(e.status)}${e.error ? `<br><span class="small muted">${esc(e.error)}</span>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No emails yet.</td></tr>'}
      </tbody></table></div></div>`;
  if (!write) return;
  const $ = s => v.querySelector(s);
  busy($('#save'), async () => {
    const body = {};
    v.querySelectorAll('[data-k]').forEach(i => { body[i.dataset.k] = i.type === 'checkbox' ? (i.checked ? '1' : '0') : i.value.trim(); });
    await api('/settings', 'PUT', body);
    toast('Saved.');
  });
  busy($('#test'), async () => {
    const r = await api('/emails/test', 'POST', {});
    if (r.status === 'sent') toast('Test email sent. Check your inbox (and the spam folder).');
    else toast(r.error ?? `The test email is ${r.status}.`, r.status === 'failed');
    emails(v);
  });
  busy($('#offer'), async () => {
    const r = await api('/emails/offers', 'POST', { subject: $('#of-subject').value, message: $('#of-message').value, ctaText: $('#of-cta').value, ctaHref: $('#of-href').value });
    toast(`Sending to ${r.queued} customer(s). It takes a few minutes.`);
    emails(v);
  });
}
