// Couriers: connect Steadfast and Pathao (keys saved encrypted), test the connection, and copy the webhook addresses
// into each courier's panel so delivery news comes back by itself.
import { api, busy, can, esc, state, toast } from '../app.js';

const copyBtn = (value, label = 'Copy') => `<button type="button" class="btn btn-sm btn-outline" data-copy="${esc(value)}">${label}</button>`;
const secretInput = (key, label, set) => `<label class="f">${esc(label)} ${set ? '<span class="badge b-green">saved</span>' : ''}<input type="password" autocomplete="off" data-secret="${key}" placeholder="${set ? 'Saved. Leave empty to keep it' : 'Paste it here'}"></label>`;

export async function courier(v) {
  const d = await api('/couriers/setup');
  const owner = state.user.role === 'super_admin';
  const write = can('settings:write') && owner;
  const sf = d.steadfast;
  const pa = d.pathao;
  v.innerHTML = `<div class="page-head"><div><h1>Couriers</h1><p>Connect your courier accounts once. Then on a packed order press <b>Book with Steadfast</b> or <b>Book with Pathao</b>: the tracking ID comes back by itself, and delivered or returned parcels update the order by themselves.</p></div></div>
    ${owner ? '' : '<p class="notice">Only the Owner / Super Admin can change courier keys. You can test the connection.</p>'}

    <div class="card courier-card"><h2>Steadfast ${sf.connected ? '<span class="badge b-green">connected</span>' : '<span class="badge b-grey">not connected</span>'}</h2>
      <ol class="howto small"><li>Open your Steadfast merchant panel → <b>API</b> (or Settings → API).</li><li>Copy the <b>API Key</b> and <b>Secret Key</b> into the boxes below and press <b>Save</b>, then <b>Test connection</b>.</li><li>In the same panel, find <b>Webhook</b> and paste the <b>Callback URL</b> and the <b>Auth Token (Bearer)</b> shown below.</li></ol>
      <div class="grid-2">${secretInput('steadfast_api_key', 'API Key', sf.connected)}${secretInput('steadfast_secret_key', 'Secret Key', sf.connected)}</div>
      <label class="f">API address <span class="help">Only change it if Steadfast’s API page shows a different one.</span><input data-k="steadfast_base_url" value="${esc(sf.baseUrl)}" placeholder="${esc(sf.defaultUrl)}" ${write ? '' : 'disabled'}></label>
      <h3>Webhook (for delivery updates)</h3>
      <div class="copy-row"><span class="small muted">Callback URL</span><code>${esc(sf.webhookUrl)}</code>${copyBtn(sf.webhookUrl)}</div>
      <div class="copy-row"><span class="small muted">Auth Token (Bearer)</span><code>${esc(sf.webhookToken)}</code>${copyBtn(sf.webhookToken)}</div>
      <div class="row" style="margin-top:10px">${write ? '<button class="btn btn-primary" data-save="steadfast">Save</button>' : ''}<button class="btn btn-outline" data-test="steadfast">Test connection</button></div>
    </div>

    <div class="card courier-card"><h2>Pathao ${pa.connected ? '<span class="badge b-green">connected</span>' : '<span class="badge b-grey">not connected</span>'}</h2>
      <ol class="howto small"><li>Open the Pathao merchant panel → <b>Developers API</b> → <b>Merchant API Credentials</b>.</li><li>Copy the <b>Client ID</b> and <b>Client Secret</b>, and type the email and password you log in to Pathao with. Press <b>Save</b>, then <b>Test connection</b> and choose your pickup store.</li><li>In <b>Developers API → Webhook</b>, add the <b>Callback URL</b> below. If Pathao shows an <b>integration secret</b>, paste it in the box below and press Save.</li></ol>
      <div class="grid-2">
        <label class="f">Client ID<input data-k="pathao_client_id" value="${esc(pa.clientId)}" ${write ? '' : 'disabled'}></label>${secretInput('pathao_client_secret', 'Client Secret', pa.connected)}
        <label class="f">Login email<input data-k="pathao_username" type="email" value="${esc(pa.username)}" ${write ? '' : 'disabled'}></label>${secretInput('pathao_password', 'Login password', pa.connected)}
      </div>
      <label class="f">Pickup store <span class="help">Press Test connection to load your stores.</span><select data-k="pathao_store_id" id="pa-store" ${write ? '' : 'disabled'}>${pa.storeId ? `<option value="${esc(pa.storeId)}">Store ${esc(pa.storeId)}</option>` : '<option value="">Test the connection first</option>'}</select></label>
      <label class="f">API address <span class="help">Live: ${esc(pa.defaultUrl)}. For testing, Pathao’s sandbox address.</span><input data-k="pathao_base_url" value="${esc(pa.baseUrl)}" ${write ? '' : 'disabled'}></label>
      <h3>Webhook (for delivery updates)</h3>
      <div class="copy-row"><span class="small muted">Callback URL</span><code>${esc(pa.webhookUrl)}</code>${copyBtn(pa.webhookUrl)}</div>
      <label class="f">Integration secret from Pathao <span class="help">Only if Pathao’s webhook page shows one.</span><input data-k="pathao_webhook_integration_secret" value="${esc(pa.integrationSecret)}" ${write ? '' : 'disabled'}></label>
      <div class="row" style="margin-top:10px">${write ? '<button class="btn btn-primary" data-save="pathao">Save</button>' : ''}<button class="btn btn-outline" data-test="pathao">Test connection</button></div>
    </div>
    <p class="small muted">Other couriers and own delivery still work as before: choose the courier and type the tracking ID when moving an order to In Courier.</p>`;

  v.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast('Copied.'); } catch { toast('Select the text and copy it.', true); }
  }));
  v.querySelectorAll('[data-save]').forEach(b => busy(b, async () => {
    const card = b.closest('.courier-card');
    const body = {};
    card.querySelectorAll('[data-k]').forEach(i => { if (i.value.trim() || i.dataset.k !== 'pathao_store_id') body[i.dataset.k] = i.value.trim(); });
    card.querySelectorAll('[data-secret]').forEach(i => { if (i.value.trim()) body[i.dataset.secret] = i.value.trim(); });
    await api('/settings', 'PUT', body);
    toast('Saved. Now press Test connection.');
    courier(v);
  }));
  v.querySelectorAll('[data-test]').forEach(b => busy(b, async () => {
    const r = await api(`/couriers/${b.dataset.test}/test`, 'POST', {});
    toast(r.message);
    if (r.stores?.length) {
      const sel = v.querySelector('#pa-store');
      const now = sel.value;
      sel.innerHTML = r.stores.map(s => `<option value="${esc(s.id)}" ${s.id === now ? 'selected' : ''}>${esc(s.name)} (${esc(s.id)})</option>`).join('');
      if (!now && write) { await api('/settings', 'PUT', { pathao_store_id: sel.value }); toast(`${r.message} Pickup store set to ${sel.selectedOptions[0].text}.`); }
    }
  }));
}
