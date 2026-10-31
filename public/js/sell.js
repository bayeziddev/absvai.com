// Seller registration (/sell): sends the application; the owner approves it in Admin → Sellers.
import { api } from './app.js';

const form = document.querySelector('[data-sell]');
form?.addEventListener('submit', async e => {
  e.preventDefault();
  const msg = form.querySelector('[data-msg]');
  const button = form.querySelector('button[type=submit]');
  if (!form.agree.checked) { msg.className = 'form-msg error'; msg.textContent = 'Please tick the box to agree.'; return; }
  const body = Object.fromEntries(['shopName', 'ownerName', 'phone', 'email', 'password', 'district', 'businessType', 'payoutMethod', 'payoutNumber', 'address', 'sells', 'website'].map(k => [k, form[k].value.trim()]));
  button.disabled = true;
  try {
    const r = await api('/api/seller/register', body);
    form.innerHTML = `<h2>Application sent ✅</h2><p>${r.message}</p><p><a class="btn btn-outline" href="/seller/">Go to the seller portal</a></p>`;
  } catch (err) {
    msg.className = 'form-msg error';
    msg.textContent = err.message;
    button.disabled = false;
  }
});
