// One-page checkout: mobile number, name, the delivery area (each shows what delivery costs for this cart, and the total
// follows by itself), the address in the customer's own words, and payment. The server re-validates everything on submit
// and reads the district out of the address for the shop's map. "Order on WhatsApp" sends the same order as a message.
// Customers read the checkout in Bangla and may type in Bangla or English.
import { api as apiEn, cart, esc, small, taka } from './app.js';

// ── Bangla: the server's messages are in English (the admin uses the same rules), so the ones a customer can meet at
// checkout are put into Bangla here. A message not listed shows as the server sent it. ──
const T = '(৳[\\d,.]+)';
const STOCK = [[/^Out of stock$/, 'স্টকে নেই'], [/^Only (\d+) left$/, 'মাত্র $1টি আছে'], [/^Back in season from (.+)$/, '$1 থেকে আবার পাওয়া যাবে']];
const BN = [
  // Delivery charge
  [new RegExp(`^Free delivery: your order is over ${T}\\.$`), 'ফ্রি ডেলিভারি: আপনার অর্ডার $1-এর বেশি।'],
  [/^Free delivery on these items\.$/, 'এই পণ্যগুলোর ডেলিভারি ফ্রি।'],
  [new RegExp(`^(.+): ${T} up to ([\\d.]+)kg, \\+${T} per extra kg \\(([\\d.]+)kg packed\\)\\.$`), '$1: $3 কেজি পর্যন্ত $2, এর পরে প্রতি কেজিতে +$4 (প্যাকেটসহ ওজন $5 কেজি)।'],
  [new RegExp(`^(.+): ${T} up to ([\\d.]+)kg\\.$`), '$1: $3 কেজি পর্যন্ত $2।'],
  [new RegExp(`^(.+): ${T}, whatever the weight\\.$`), '$1: $2, ওজন যতই হোক।'],
  [/^Large item: we will call you to confirm the delivery charge before dispatch\.$/, 'বড় পণ্য: পাঠানোর আগে আমরা ফোন করে ডেলিভারি চার্জ জানিয়ে দেব।'],
  [new RegExp(`^Large item delivery: ${T} each\\.$`), 'বড় পণ্যের ডেলিভারি চার্জ: প্রতিটি $1।'],
  [/^Free delivery on the large item\.$/, 'বড় পণ্যের ডেলিভারি ফ্রি।'],
  [/^The free-delivery threshold does not cover large items\.$/, 'ফ্রি ডেলিভারির সুবিধা বড় পণ্যে প্রযোজ্য নয়।'],
  [new RegExp(`^Add ${T} more for free delivery\\.$`), 'আর $1-এর পণ্য নিলেই ডেলিভারি ফ্রি।'],
  [new RegExp(`^Cash on Delivery fee: ${T} \\(charged by the courier\\)\\.$`), 'ক্যাশ অন ডেলিভারি চার্জ: $1 (কুরিয়ার নেয়)।'],
  // Advance
  [new RegExp(`^Pre-order advance for (.+): ${T}( × \\d+)?\\.$`), '$1 প্রি-অর্ডারের অ্যাডভান্স: $2$3।'],
  [/^Pre-orders need the delivery charge paid in advance to book your slot \((.+)\)\.$/, 'প্রি-অর্ডার বুক করতে ডেলিভারি চার্জ আগে দিতে হয় ($1)।'],
  [/^Large items need the delivery charge paid in advance\.$/, 'বড় পণ্যের ডেলিভারি চার্জ আগে দিতে হয়।'],
  [new RegExp(`^Orders over ${T} from new customers need the delivery charge paid in advance\\.$`), 'নতুন গ্রাহকের $1-এর বেশি অর্ডারে ডেলিভারি চার্জ আগে দিতে হয়।'],
  [/^We will tell you the exact advance when we call to confirm the delivery charge\.$/, 'ডেলিভারি চার্জ কনফার্ম করতে ফোন করার সময় অ্যাডভান্সের সঠিক পরিমাণ জানিয়ে দেব।'],
  // Coupon
  [/^Type the coupon code\.$/, 'কুপন কোড লিখুন।'],
  [/^“(.+)” is not a valid coupon\.$/, '“$1” সঠিক কুপন নয়।'],
  [/^This coupon starts on (.+)\.$/, 'এই কুপন $1 থেকে চালু হবে।'],
  [/^This coupon has expired\.$/, 'এই কুপনের মেয়াদ শেষ।'],
  [/^This coupon has been used up\.$/, 'এই কুপন আর ব্যবহার করা যাবে না।'],
  [new RegExp(`^This coupon needs an order of at least ${T}\\.$`), 'এই কুপন ব্যবহার করতে কমপক্ষে $1-এর অর্ডার লাগবে।'],
  [/^You have already used this coupon\.$/, 'আপনি এই কুপন আগেই ব্যবহার করেছেন।'],
  [/^This coupon can be used (\d+) times per customer\.$/, 'একজন গ্রাহক এই কুপন $1 বার ব্যবহার করতে পারেন।'],
  [/^(\d+)% off$/, '$1% ছাড়'],
  [new RegExp(`^${T} off$`), '$1 ছাড়'],
  [/^Free delivery$/, 'ফ্রি ডেলিভারি'],
  [/^Delivery becomes free once you choose your area\.$/, 'এলাকা বেছে নিলেই ডেলিভারি ফ্রি হয়ে যাবে।'],
  // Cart and order
  [/^An item in your cart is no longer available and was removed\.$/, 'কার্টের একটি পণ্য আর পাওয়া যাচ্ছে না, তাই সরিয়ে দেওয়া হয়েছে।'],
  [/^Enter a Bangladeshi mobile number like 01712345678\.$/, 'সঠিক মোবাইল নম্বর লিখুন, যেমন 01712345678।'],
  [/^Enter your name\.$/, 'আপনার নাম লিখুন।'],
  [/^Enter your house, road or village so the courier can find you\.$/, 'কুরিয়ার যেন খুঁজে পায়, তাই বাসা/বাড়ি, রোড বা গ্রামের নাম লিখুন।'],
  [/^Your cart is empty\.$/, 'আপনার কার্ট খালি।'],
  [/^Check your email address, or leave it empty\.$/, 'ইমেইলটি ঠিক আছে কিনা দেখুন, অথবা খালি রাখুন।'],
  [/^Choose your delivery area\.$/, 'ডেলিভারি এলাকা বেছে নিন।'],
  [/^We could not work out delivery to this area\. Please call us\.$/, 'এই এলাকার ডেলিভারি চার্জ বের করা যায়নি। দয়া করে আমাদের ফোন করুন।'],
  [new RegExp(`^This order needs an advance of ${T}\\. Choose bKash / Nagad / Rocket and enter the transaction ID\\.$`), 'এই অর্ডারে $1 অ্যাডভান্স লাগবে। বিকাশ / নগদ / রকেট বেছে নিয়ে ট্রানজেকশন আইডি দিন।'],
  [/^Enter the transaction ID from your bKash \/ Nagad \/ Rocket payment\.$/, 'বিকাশ / নগদ / রকেটে টাকা পাঠানোর ট্রানজেকশন আইডি দিন।'],
  [/^Your checkout session expired\. Reload the page( and try again)?\.$/, 'চেকআউটের সময় শেষ হয়ে গেছে। পেজটি রিলোড করে আবার চেষ্টা করুন।'],
  [/^Please complete the "I am human" check\.$/, '“আমি মানুষ” যাচাইটি শেষ করুন।'],
  [/^Too many requests\. Please wait a minute\.$/, 'অনেকবার চেষ্টা হয়েছে। এক মিনিট পরে আবার চেষ্টা করুন।'],
  [/^Too many requests from this connection\. Please wait a little and try again, or call us\.$/, 'এই সংযোগ থেকে অনেকবার চেষ্টা হয়েছে। একটু পরে আবার চেষ্টা করুন, অথবা আমাদের ফোন করুন।'],
  [/^Too many orders from this device\. Please wait a few minutes or call us\.$/, 'এই ডিভাইস থেকে অনেক অর্ডার হয়েছে। কয়েক মিনিট পরে চেষ্টা করুন, অথবা আমাদের ফোন করুন।'],
  [/^We couldn't place this order\. Please call us( at (.+))?\.$/, 'অর্ডারটি নেওয়া যায়নি। দয়া করে আমাদের ফোন করুন $2।'],
  [/^Please check your details and try again\.$/, 'তথ্যগুলো দেখে আবার চেষ্টা করুন।'],
  [/^Something went wrong\. Please try again\.$/, 'কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।'],
  [/^(Failed to fetch|NetworkError.*|Load failed|network error)$/i, 'ইন্টারনেট সংযোগ পাওয়া যাচ্ছে না। সংযোগ দেখে আবার চেষ্টা করুন।'],
];
const stockBn = t => { for (const [re, out] of STOCK) if (re.test(t)) return t.replace(re, out); return t; };
/** One server message in Bangla ("Name (option): Out of stock." and "… Remove the coupon …" are put together). */
function bn(text) {
  const t = String(text ?? '').trim();
  if (!t) return '';
  const coupon = t.match(/^(.+) Remove the coupon to order without it\.$/);
  if (coupon) return `${bn(coupon[1])} কুপন ছাড়া অর্ডার করতে কুপনটি মুছে দিন।`;
  for (const [re, out] of BN) if (re.test(t)) return t.replace(re, out).replace(/\s+।$/, '।');
  const line = t.match(/^(.+): (.+)\.$/);
  if (line && stockBn(line[2]) !== line[2]) return `${line[1]}: ${stockBn(line[2])}।`;
  return stockBn(t);
}
const bnNum = t => String(t).replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[d]);
/** "1–2 days" → "১–২ দিন" (the shop may also write the time in Bangla already). */
const bnDays = t => String(t ?? '').replace(/\bdays?\b/gi, 'দিন').replace(/\bhours?\b/gi, 'ঘণ্টা').replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[d]);

/** The checkout API, with its messages (shared with the English admin) put into Bangla for the customer. */
async function api(path, body) {
  try { return await apiEn(path, body); } catch (err) { err.message = bn(err.message); throw err; }
}

const pd = JSON.parse(document.getElementById('page-data').textContent);
const form = document.getElementById('checkout-form');
const $ = s => form.querySelector(s);
const placeBtn = $('[data-place]');
const errorBox = $('[data-co-error]');

const params = new URLSearchParams(location.search);
const buyNow = Number(params.get('buy'));
// A landing page gives its own lines (its option and quantity picker sends 'absvai:lines' when they change).
const onLanding = Array.isArray(pd.lines);
let lines = onLanding ? pd.lines : buyNow ? [{ variantId: buyNow, qty: Math.max(1, Math.min(99, Number(params.get('qty')) || 1)) }] : cart.lines();
document.addEventListener('absvai:lines', e => { lines = e.detail; refreshQuote(); captureSoon(); });

// ── Coupon: applied in the quote, so the summary shows the real total before the order is placed ──
let couponCode = (form.couponCode?.value || params.get('coupon') || '').trim().toUpperCase();
if (form.couponCode) form.couponCode.value = couponCode;
const couponMsg = $('[data-coupon-msg]');
function applyCoupon() { couponCode = form.couponCode.value.trim().toUpperCase(); form.couponCode.value = couponCode; refreshQuote(); }
$('[data-coupon-apply]')?.addEventListener('click', applyCoupon);
form.couponCode?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); applyCoupon(); } });

let lastQuote = null;

// ── Checkout session (Section 8.1): after an invisible Turnstile check the server sets an HttpOnly session cookie and
// returns a short-lived signed token. Capture and placement both need it, so scripts can't flood the store. ──
let session = null; // { token, expiresAt }
let sessionWaiters = [];
async function startSession(turnstileToken) {
  try {
    session = await api('/api/checkout/session', { turnstileToken: turnstileToken || '' });
  } catch (err) {
    errorBox.textContent = err.message;
  }
  sessionWaiters.splice(0).forEach(fn => fn(session));
}
// The human check cannot start (it is blocked, or the page's address is not allowed for it): say so, never spin forever.
let checkFailed = false;
const CHECK_FAILED = 'নিরাপত্তা যাচাই চালু হয়নি। পেজটি রিলোড করুন, অথবা “WhatsApp-এ অর্ডার করুন” চেপে আমাদের অর্ডার পাঠান।';
function checkoutToken() {
  if (session && Date.parse(session.expiresAt) - Date.now() > 60_000) return Promise.resolve(session.token);
  if (checkFailed) return Promise.resolve(null);
  return new Promise(resolve => {
    const done = s => { clearTimeout(timer); resolve(s?.token ?? null); };
    const timer = setTimeout(() => { sessionWaiters = sessionWaiters.filter(f => f !== done); resolve(null); }, 15000);
    sessionWaiters.push(done);
    if (session) { session = null; window.turnstile?.reset?.(); if (!pd.turnstile) startSession(''); }
  });
}
// Turnstile calls this (data-callback) once the invisible check passes, and absvaiTurnstileError when it cannot run.
window.absvaiTurnstile = token => { checkFailed = false; startSession(token); };
window.absvaiTurnstileError = () => {
  checkFailed = true;
  errorBox.textContent = CHECK_FAILED;
  sessionWaiters.splice(0).forEach(fn => fn(null));
  return true;
};

// ── Delivery area: a choice, never a lookup ──
const area = () => Number(form.querySelector('input[name=zoneId]:checked')?.value) || null;
const areaName = id => form.querySelector(`input[name=zoneId][value="${id}"]`)?.closest('label').querySelector('strong').textContent ?? '';
form.querySelectorAll('input[name=zoneId]').forEach(r => r.addEventListener('change', areaChanged));

// ── Quote, advance and summary ──
let quoteTimer;
let captureTimer;
function areaChanged() {
  clearTimeout(quoteTimer);
  quoteTimer = setTimeout(refreshQuote, 60);
  captureSoon();
}

const payment = () => form.querySelector('input[name=paymentMethod]:checked')?.value ?? 'cod';
form.querySelectorAll('input[name=paymentMethod]').forEach(r => r.addEventListener('change', refreshQuote));

async function refreshQuote() {
  if (!lines.length) return;
  try {
    lastQuote = await api('/api/checkout/quote', { lines, zoneId: area(), withAreas: true, paymentMethod: payment(), phone: form.phone.value, couponCode });
  } catch (e) { errorBox.textContent = e.message; return; }
  renderSummary(lastQuote);
}

function renderSummary(q) {
  $('[data-co-lines]').innerHTML = q.lines.map(l => `
    <div class="co-line"><img src="${esc(small(l.image))}" alt=""><div>${esc(l.name)}<small>${esc(l.variantLabel)}${l.variantLabel ? ' · ' : ''}${l.qty} × ${taka(l.unitPaisa)}</small>${l.problem ? `<small class="problem">${esc(bn(l.problem))}</small>` : ''}</div><strong>${taka(l.lineTotalPaisa)}</strong></div>`).join('');
  $('[data-subtotal]').textContent = taka(q.subtotalPaisa);
  const off = q.discountPaisa > 0;
  $('[data-discount-row]').hidden = !off; $('[data-discount]').hidden = !off;
  if (off) $('[data-discount]').textContent = `−${taka(q.discountPaisa)}`;
  if (couponMsg) {
    couponMsg.className = `coupon-msg ${q.coupon ? 'ok' : q.couponError ? 'error' : ''}`;
    couponMsg.textContent = q.coupon ? `✓ ${q.coupon.code}: ${bn(q.coupon.label)}${q.coupon.discountPaisa ? ` (−${taka(q.coupon.discountPaisa)})` : ''}${q.coupon.note ? `। ${bn(q.coupon.note)}` : ''}` : bn(q.couponError ?? '');
  }
  const d = q.delivery;
  const charge = a => (a.status === 'to_confirm' ? 'ফোনে জানাব' : a.chargePaisa === 0 ? 'ফ্রি' : bnNum(taka(a.chargePaisa)));
  for (const a of q.areas ?? []) { const el = form.querySelector(`[data-area-charge="${a.id}"]`); if (el) el.textContent = charge(a); }
  $('[data-delivery]').textContent = !d ? 'এলাকা বেছে নিন' : d.status === 'to_confirm' ? 'ফোনে জানানো হবে' : d.chargePaisa === 0 ? 'ফ্রি' : taka(d.chargePaisa);
  const box = $('[data-co-delivery]');
  box.hidden = !d;
  if (d) {
    box.className = `co-delivery${d.chargePaisa === 0 ? ' free' : ''}`;
    box.innerHTML = d.status === 'to_confirm' ? `🚚 <b>ডেলিভারি (${esc(d.zoneName)})</b>: চার্জ আমরা ফোনে জানিয়ে দেব।`
      : `${d.chargePaisa === 0 ? '🎁' : '🚚'} <b>ডেলিভারি চার্জ (${esc(d.zoneName)}): ${d.chargePaisa === 0 ? 'ফ্রি' : taka(d.chargePaisa)}</b>${q.totalPaisa !== null ? ` · সর্বমোট <b>${taka(q.totalPaisa)}</b>` : ''}<span>পৌঁছাতে সাধারণত ${esc(bnDays(d.etaText))} লাগে</span>`;
  }
  const cod = d?.codFeePaisa > 0;
  $('[data-cod-row]').hidden = !cod; $('[data-cod-fee]').hidden = !cod;
  if (cod) $('[data-cod-fee]').textContent = taka(d.codFeePaisa);
  $('[data-total]').textContent = q.totalPaisa === null ? (d ? `${taka(q.subtotalPaisa)} + ডেলিভারি চার্জ` : '—') : taka(q.totalPaisa);
  $('[data-explain]').innerHTML = (d?.explanation ?? (q.subtotalPaisa && pd.freeThresholdPaisa ? [`${taka(pd.freeThresholdPaisa)}-এর বেশি অর্ডারে ডেলিভারি ফ্রি (বড় পণ্য ছাড়া)।`] : [])).map(t => `<li>${esc(bn(t))}</li>`).join('');
  $('[data-eta]').textContent = d ? `ডেলিভারির সময় (${d.zoneName}): সাধারণত ${bnDays(d.etaText)}` : '';

  const adv = $('[data-advance]');
  adv.hidden = !q.advance.required;
  if (q.advance.required) {
    $('[data-advance-title]').textContent = q.advance.amountPaisa ? `এই অর্ডারে ${taka(q.advance.amountPaisa)} অ্যাডভান্স লাগবে` : 'এই অর্ডারে অ্যাডভান্স লাগবে';
    $('[data-advance-reasons]').innerHTML = q.advance.reasons.map(r => `<li>${esc(bn(r))}</li>`).join('');
    const mobile = form.querySelector('input[value=manual_mobile]');
    if (q.advance.amountPaisa && mobile && !mobile.closest('[hidden]') && payment() !== 'manual_mobile') { mobile.checked = true; refreshQuote(); }
  }
  errorBox.textContent = q.problems.map(bn).join(' ');
  placeBtn.disabled = q.problems.length > 0 || !q.lines.length;
  placeBtn.textContent = q.hasPreOrder ? 'প্রি-অর্ডার কনফার্ম করুন' : pd.placeLabel || 'অর্ডার কনফার্ম করুন';
}

// ── Incomplete-order capture (Section 8.1): starts only once the phone number is valid. Blur on the phone field, a
// debounced update ~1 s after typing stops, and a final sendBeacon snapshot when the page is hidden. The server keeps
// one row per checkout session, so there is never a row per keystroke. ──
const validPhone = () => /^(\+?88)?01[3-9]\d{8}$/.test(form.phone.value.replace(/[\s-]/g, ''));
let utmCache = null;
function utm() {
  if (utmCache) return utmCache;
  try { utmCache = JSON.parse(sessionStorage.getItem('absvai.utm') || '{}'); } catch { utmCache = {}; }
  return utmCache;
}
function snapshot(token) {
  return {
    token, phone: form.phone.value, name: form.name.value, lines, zoneId: area(), addressLine: form.addressLine.value, utm: utm(),
  };
}
let lastSent = '';
let placed = false;
async function capture() {
  if (placed || !validPhone() || !lines.length) return;
  const token = await checkoutToken();
  if (!token) return;
  const body = JSON.stringify(snapshot(token));
  if (body === lastSent) return;
  lastSent = body;
  fetch('/api/checkout/capture', { method: 'POST', headers: { 'content-type': 'text/plain' }, body, credentials: 'same-origin', keepalive: true }).catch(() => {});
}
function captureSoon() { clearTimeout(captureTimer); captureTimer = setTimeout(capture, 1000); }
form.phone.addEventListener('blur', capture);
['phone', 'name', 'addressLine'].forEach(n => form[n].addEventListener('input', captureSoon));
function beacon() {
  if (placed || !validPhone() || !session || !navigator.sendBeacon) return;
  const body = JSON.stringify(snapshot(session.token));
  if (body !== lastSent && navigator.sendBeacon('/api/checkout/capture', new Blob([body], { type: 'text/plain' }))) lastSent = body;
}
addEventListener('pagehide', beacon);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') beacon(); });
form.phone.addEventListener('change', refreshQuote);

// ── Submit ──
function invalid(field, message) {
  field.setAttribute('aria-invalid', 'true');
  field.focus();
  errorBox.textContent = message;
  return false;
}

function validate() {
  form.querySelectorAll('[aria-invalid]').forEach(f => f.removeAttribute('aria-invalid'));
  if (!/^(\+?88)?01[3-9]\d{8}$/.test(form.phone.value.replace(/[\s-]/g, ''))) return invalid(form.phone, 'সঠিক মোবাইল নম্বর লিখুন, যেমন 01712345678।');
  if (form.name.value.trim().length < 2) return invalid(form.name, 'আপনার নাম লিখুন।');
  if (!area()) { form.querySelector('[data-areas]').scrollIntoView({ block: 'center', behavior: 'smooth' }); errorBox.textContent = 'ডেলিভারি এলাকা বেছে নিন।'; return false; }
  if (form.addressLine.value.trim().length < 8) return invalid(form.addressLine, 'পুরো ঠিকানা লিখুন: বাসা/বাড়ি, রোড, এলাকা, থানা ও জেলা।');
  if (payment() === 'manual_mobile' && lastQuote?.advance.amountPaisa && !form.advanceTrxId?.value.trim()) return invalid(form.advanceTrxId, 'বিকাশ / নগদ / রকেটে টাকা পাঠানোর ট্রানজেকশন আইডি দিন।');
  return true;
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  if (!validate()) return;
  placeBtn.disabled = true;
  placeBtn.textContent = 'অর্ডার হচ্ছে…';
  errorBox.textContent = '';
  try {
    const token = await checkoutToken();
    if (!token) throw new Error(pd.turnstile ? CHECK_FAILED : 'চেকআউট চালু হয়নি। পেজটি রিলোড করে আবার চেষ্টা করুন।');
    const r = await api('/api/checkout/place', {
      phone: form.phone.value, name: form.name.value, zoneId: area(), addressLine: form.addressLine.value, note: form.note.value,
      paymentMethod: payment(), advanceTrxId: form.advanceTrxId?.value || null, advanceWallet: form.advanceWallet?.value || null,
      lines, token, utm: utm(), website: form.website?.value ?? '',
      couponCode: lastQuote?.coupon ? couponCode : null, landingPageId: pd.landingPageId ?? null,
    });
    placed = true;
    if (!buyNow && !onLanding) cart.clear();
    location.href = `/order/${encodeURIComponent(r.orderNo)}?t=${encodeURIComponent(r.accessToken)}`;
  } catch (err) {
    errorBox.textContent = err.message;
    placeBtn.disabled = false;
    placeBtn.textContent = pd.placeLabel || 'অর্ডার কনফার্ম করুন';
    if (err.status === 409) refreshQuote();
    if (err.status === 401) { session = null; window.turnstile?.reset?.(); if (!pd.turnstile) startSession(''); }
  }
});

// ── Signed in: name, mobile, the last address and area fill in by themselves; the receipt goes to the account email ──
async function fillFromAccount() {
  const note = $('[data-co-account]');
  if (!/(^|;\s*)vm_in=1/.test(document.cookie)) {
    if (note && !onLanding && pd.accounts) { note.hidden = false; note.innerHTML = 'অ্যাকাউন্ট আছে? <a href="/account?next=/checkout' + encodeURIComponent(location.search) + '">সাইন ইন করুন</a>, আপনার তথ্য নিজে থেকেই বসে যাবে। অ্যাকাউন্ট ছাড়াও অর্ডার করা যায়।'; }
    return;
  }
  let a = null;
  try { a = (await (await fetch('/api/account/me', { credentials: 'same-origin' })).json()).account; } catch { /* order as a guest */ }
  if (!a) return;
  if (!form.name.value) form.name.value = a.name;
  if (!form.phone.value && a.phone) form.phone.value = a.phone;
  if (!form.addressLine.value && a.addressLine) form.addressLine.value = a.addressLine;
  const r = a.zoneId && form.querySelector(`input[name=zoneId][value="${a.zoneId}"]`);
  if (r && !area()) { r.checked = true; areaChanged(); }
  if (note) { note.hidden = false; note.className = 'co-account ok'; note.textContent = `✓ ${a.name} হিসেবে অর্ডার করছেন। রসিদ ও আপডেট যাবে ${a.email}-এ।`; }
  if (validPhone()) captureSoon();
}

// ── Boot: the prices and the delivery charges come from one quote; nothing else to load ──
async function boot() {
  if (!lines.length) {
    form.innerHTML = '<div class="empty"><h2>আপনার কার্ট খালি</h2><p>আগে পছন্দের পণ্য কার্টে যোগ করুন, তারপর এখানে আসুন।</p><a class="btn btn-primary" href="/shop">কেনাকাটা শুরু করুন</a></div>';
    return;
  }
  refreshQuote();
  fillFromAccount();
  // Without a Turnstile site key (local development) the session starts straight away.
  if (!pd.turnstile) startSession('');
}

// ── Order on WhatsApp: the same order as a ready-to-send message to the shop ──
$('[data-wa-order]')?.addEventListener('click', e => {
  const q = lastQuote;
  const d = q?.delivery;
  const text = [
    `আসসালামু আলাইকুম! আমি ${pd.store || 'আপনাদের শপ'} থেকে অর্ডার করতে চাই:`,
    ...(q?.lines ?? []).map(l => `• ${l.name}${l.variantLabel ? ` (${l.variantLabel})` : ''} × ${l.qty} = ${taka(l.lineTotalPaisa)}`),
    d ? `ডেলিভারি (${d.zoneName}): ${d.status === 'to_confirm' ? 'ফোনে জানাবেন' : d.chargePaisa === 0 ? 'ফ্রি' : taka(d.chargePaisa)}` : '',
    q?.discountPaisa ? `ছাড়: −${taka(q.discountPaisa)}` : '',
    q?.totalPaisa != null ? `সর্বমোট: ${taka(q.totalPaisa)}` : '',
    form.name.value.trim() && `নাম: ${form.name.value.trim()}`,
    form.phone.value.trim() && `মোবাইল: ${form.phone.value.trim()}`,
    form.addressLine.value.trim() && `ঠিকানা: ${form.addressLine.value.trim()}`,
  ].filter(Boolean).join('\n');
  e.currentTarget.href = `${e.currentTarget.href.split('?')[0]}?text=${encodeURIComponent(text)}`;
});

boot();
