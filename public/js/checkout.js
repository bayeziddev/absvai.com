// বাংলা quick-order checkout: name, phone, free-form address and fixed delivery choice.
import { api, cart, esc, small, taka } from './app.js';

const pd = JSON.parse(document.getElementById('page-data').textContent);
const form = document.getElementById('checkout-form');
const $ = s => form.querySelector(s);
const errorBox = $('[data-co-error]');
const deliveryChoices = [...form.querySelectorAll('input[name="deliveryChoice"]')];
const params = new URLSearchParams(location.search);
const buyNow = Number(params.get('buy'));
const onLanding = Array.isArray(pd.lines);
let lines = onLanding ? pd.lines : buyNow ? [{ variantId: buyNow, qty: Math.max(1, Math.min(99, Number(params.get('qty')) || 1)) }] : cart.lines();

document.addEventListener('absvai:lines', e => { lines = e.detail; refreshQuote(); captureSoon(); });
const deliveryChoice = () => form.querySelector('input[name=deliveryChoice]:checked')?.value ?? 'inside';
deliveryChoices.forEach(r => r.addEventListener('change', () => {
  form.querySelectorAll('.delivery-choice').forEach(x => x.classList.toggle('is-picked', x.querySelector('input')?.checked));
  refreshQuote(); captureSoon();
}));

form.querySelectorAll('.delivery-choice').forEach(card => card.addEventListener('click', e => {
  const radio = card.querySelector('input[name=deliveryChoice]');
  if (radio && !radio.checked) { radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); }
}));
form.querySelector('.delivery-choice input:checked')?.closest('.delivery-choice')?.classList.add('is-picked');

let couponCode = (form.couponCode?.value || params.get('coupon') || '').trim().toUpperCase();
if (form.couponCode) form.couponCode.value = couponCode;
const couponMsg = $('[data-coupon-msg]');
function applyCoupon() { couponCode = form.couponCode.value.trim().toUpperCase(); form.couponCode.value = couponCode; refreshQuote(); }
$('[data-coupon-apply]')?.addEventListener('click', applyCoupon);
form.couponCode?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); applyCoupon(); } });

let lastQuote = null;
let session = null;
let sessionWaiters = [];
async function startSession(turnstileToken) {
  try { session = await api('/api/checkout/session', { turnstileToken: turnstileToken || '' }); }
  catch (err) { errorBox.textContent = err.message; }
  sessionWaiters.splice(0).forEach(fn => fn(session));
}
function checkoutToken() {
  if (session && Date.parse(session.expiresAt) - Date.now() > 60_000) return Promise.resolve(session.token);
  return new Promise(resolve => {
    sessionWaiters.push(s => resolve(s?.token ?? null));
    if (session) { session = null; window.turnstile?.reset?.(); if (!pd.turnstile) startSession(''); }
  });
}
window.absvaiTurnstile = token => startSession(token);
const payment = () => form.querySelector('input[name=paymentMethod]:checked')?.value ?? 'cod';
form.querySelectorAll('input[name=paymentMethod]').forEach(r => r.addEventListener('change', refreshQuote));

async function refreshQuote() {
  if (!lines.length) return;
  try {
    lastQuote = await api('/api/checkout/quote', { lines, deliveryChoice: deliveryChoice(), paymentMethod: payment(), phone: form.phone.value, couponCode });
  } catch (e) { errorBox.textContent = e.message; return; }
  renderSummary(lastQuote);
}
function renderSummary(q) {
  $('[data-co-lines]').innerHTML = q.lines.map(l => `<div class="co-line"><img src="${esc(small(l.image))}" alt=""><div>${esc(l.name)}<small>${esc(l.variantLabel)}${l.variantLabel ? ' · ' : ''}${l.qty} × ${taka(l.unitPaisa)}</small>${l.problem ? `<small class="problem">${esc(l.problem)}</small>` : ''}</div><strong>${taka(l.lineTotalPaisa)}</strong></div>`).join('');
  $('[data-subtotal]').textContent = taka(q.subtotalPaisa);
  const off = q.discountPaisa > 0;
  $('[data-discount-row]').hidden = !off; $('[data-discount]').hidden = !off;
  if (off) $('[data-discount]').textContent = `−${taka(q.discountPaisa)}`;
  if (couponMsg) { couponMsg.className = `coupon-msg ${q.coupon ? 'ok' : q.couponError ? 'error' : ''}`; couponMsg.textContent = q.coupon ? `✓ ${q.coupon.code}: ${q.coupon.label}` : q.couponError ?? ''; }
  const d = q.delivery;
  deliveryChoices.forEach(r => r.closest('.delivery-choice')?.classList.toggle('is-picked', r.checked));
  $('[data-delivery]').textContent = !d ? '—' : d.status === 'to_confirm' ? 'ফোনে নিশ্চিত করা হবে' : d.chargePaisa === 0 ? 'ফ্রি' : taka(d.chargePaisa);
  const cod = d?.codFeePaisa > 0;
  $('[data-cod-row]').hidden = !cod; $('[data-cod-fee]').hidden = !cod;
  if (cod) $('[data-cod-fee]').textContent = taka(d.codFeePaisa);
  $('[data-total]').textContent = q.totalPaisa === null ? (d ? `${taka(q.subtotalPaisa)} + ডেলিভারি` : '—') : taka(q.totalPaisa);
  $('[data-explain]').innerHTML = (d?.explanation ?? []).map(t => `<li>${esc(t)}</li>`).join('');
  $('[data-eta]').textContent = d ? `ডেলিভারি: সাধারণত ${d.etaText}` : '';
  const adv = $('[data-advance]'); adv.hidden = !q.advance.required;
  if (q.advance.required) {
    const mobilePayment = form.querySelector('input[name=paymentMethod][value=manual_mobile]');
    if (mobilePayment) mobilePayment.checked = true;
    $('[data-advance-title]').textContent = q.advance.amountPaisa ? `এই অর্ডারে ${taka(q.advance.amountPaisa)} অগ্রিম লাগবে` : 'এই অর্ডারে অগ্রিম লাগবে';
    $('[data-advance-reasons]').innerHTML = q.advance.reasons.map(r => `<li>${esc(r)}</li>`).join('');
  }
  errorBox.textContent = q.problems.join(' ');
  placeBtn.disabled = q.problems.length > 0 || !q.lines.length;
  placeBtn.textContent = q.hasPreOrder ? 'প্রি-অর্ডার করুন' : pd.placeLabel || 'অর্ডার কনফার্ম করুন';
}

const placeBtn = $('[data-place]');
const validPhone = () => /^(\+?88)?01[3-9]\d{8}$/.test(form.phone.value.replace(/[\s-]/g, ''));
let utmCache = null;
function utm() { if (utmCache) return utmCache; try { utmCache = JSON.parse(sessionStorage.getItem('absvai.utm') || '{}'); } catch { utmCache = {}; } return utmCache; }
let captureTimer; let lastSent = ''; let placed = false;
function snapshot(token) { return { token, phone: form.phone.value, name: form.name.value, lines, deliveryChoice: deliveryChoice(), addressLine: form.addressLine.value, landmark: form.landmark.value, utm: utm() }; }
async function capture() { if (placed || !validPhone() || !lines.length) return; const token = await checkoutToken(); if (!token) return; const body = JSON.stringify(snapshot(token)); if (body === lastSent) return; lastSent = body; fetch('/api/checkout/capture', { method: 'POST', headers: { 'content-type': 'text/plain' }, body, credentials: 'same-origin', keepalive: true }).catch(() => {}); }
function captureSoon() { clearTimeout(captureTimer); captureTimer = setTimeout(capture, 1000); }
form.phone.addEventListener('blur', capture);
['phone', 'name', 'addressLine', 'landmark'].forEach(n => form[n].addEventListener('input', captureSoon));
deliveryChoices.forEach(r => r.addEventListener('change', captureSoon));
function beacon() { if (placed || !validPhone() || !session || !navigator.sendBeacon) return; const body = JSON.stringify(snapshot(session.token)); if (body !== lastSent && navigator.sendBeacon('/api/checkout/capture', new Blob([body], { type: 'text/plain' }))) lastSent = body; }
addEventListener('pagehide', beacon); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') beacon(); });
form.phone.addEventListener('change', refreshQuote);

function invalid(field, message) { field.setAttribute('aria-invalid', 'true'); field.focus(); errorBox.textContent = message; return false; }
function validate() {
  form.querySelectorAll('[aria-invalid]').forEach(f => f.removeAttribute('aria-invalid'));
  if (!validPhone()) return invalid(form.phone, 'সঠিক বাংলাদেশি মোবাইল নম্বর দিন।');
  if (form.name.value.trim().length < 2) return invalid(form.name, 'আপনার নাম লিখুন।');
  if (!deliveryChoice()) return invalid(deliveryChoices[0], 'ডেলিভারি এলাকা নির্বাচন করুন।');
  if (form.addressLine.value.trim().length < 5) return invalid(form.addressLine, 'সম্পূর্ণ ঠিকানা লিখুন।');
  if (payment() === 'manual_mobile' && lastQuote?.advance.amountPaisa && !form.advanceTrxId?.value.trim()) return invalid(form.advanceTrxId, 'ট্রানজেকশন আইডি লিখুন।');
  return true;
}
form.addEventListener('submit', async e => {
  e.preventDefault(); if (!validate()) return;
  placeBtn.disabled = true; placeBtn.textContent = 'অর্ডার পাঠানো হচ্ছে…'; errorBox.textContent = '';
  try {
    const token = await checkoutToken(); if (!token) throw new Error('সেশন শুরু করা যায়নি। পেজটি রিলোড করুন।');
    const r = await api('/api/checkout/place', { phone: form.phone.value, name: form.name.value, deliveryChoice: deliveryChoice(), addressLine: form.addressLine.value, landmark: form.landmark.value, note: form.note.value, email: form.email?.value.trim() ?? '', emailOffers: form.emailOffers?.checked ?? false, paymentMethod: payment(), advanceTrxId: form.advanceTrxId?.value || null, advanceWallet: form.advanceWallet?.value || null, lines, token, utm: utm(), website: form.website?.value ?? '', couponCode: lastQuote?.coupon ? couponCode : null, landingPageId: pd.landingPageId ?? null });
    placed = true; if (!buyNow && !onLanding) cart.clear(); location.href = `/order/${encodeURIComponent(r.orderNo)}?t=${encodeURIComponent(r.accessToken)}`;
  } catch (err) { errorBox.textContent = err.message; placeBtn.disabled = false; placeBtn.textContent = pd.placeLabel || 'অর্ডার কনফার্ম করুন'; if (err.status === 409) refreshQuote(); if (err.status === 401) { session = null; window.turnstile?.reset?.(); if (!pd.turnstile) startSession(''); } }
});

async function boot() { if (!lines.length) { form.innerHTML = '<div class="empty"><h2>আপনার কার্ট খালি</h2><p>আগে একটি পণ্য বেছে নিন।</p><a class="btn btn-primary" href="/shop">শপিং শুরু করুন</a></div>'; return; } refreshQuote(); if (!pd.turnstile) startSession(''); }
boot();
