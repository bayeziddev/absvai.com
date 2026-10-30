// Order confirmation page: SMS code (OTP) and advance-payment transaction ID.
import { api } from './app.js';

const root = document.querySelector('[data-order]');
const orderNo = root.dataset.order;
const t = root.dataset.token;

const otp = document.querySelector('[data-otp]');
if (otp) {
  const msg = otp.querySelector('[data-msg]');
  otp.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const r = await api(`/api/orders/${encodeURIComponent(orderNo)}/otp/verify`, { t, code: otp.code.value });
      msg.className = 'form-msg ok'; msg.textContent = r.message;
      setTimeout(() => location.reload(), 900);
    } catch (err) { msg.className = 'form-msg error'; msg.textContent = err.message; }
  });
  otp.querySelector('[data-otp-resend]').addEventListener('click', async () => {
    try { const r = await api(`/api/orders/${encodeURIComponent(orderNo)}/otp/resend`, { t }); msg.className = 'form-msg ok'; msg.textContent = r.message; }
    catch (err) { msg.className = 'form-msg error'; msg.textContent = err.message; }
  });
}

const adv = document.querySelector('[data-advance-form]');
adv?.addEventListener('submit', async e => {
  e.preventDefault();
  const msg = adv.querySelector('[data-msg]');
  try {
    const r = await api(`/api/orders/${encodeURIComponent(orderNo)}/advance`, { t, trxId: adv.trxId.value.trim(), wallet: adv.wallet.value });
    msg.className = 'form-msg ok'; msg.textContent = r.message;
    setTimeout(() => location.reload(), 1200);
  } catch (err) { msg.className = 'form-msg error'; msg.textContent = err.message; }
});
