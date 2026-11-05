// Account page: open an account or sign in with a 6-digit code sent to the email (no password), then the orders,
// offers and details. All messages are in Bangla; the server's own messages already are.
import { toast } from './app.js';

const page = document.querySelector('[data-account-page]');

async function send(path, method, body) {
  let r;
  try {
    r = await fetch(path, { method, headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new Error('ইন্টারনেট সংযোগ পাওয়া যাচ্ছে না। সংযোগ দেখে আবার চেষ্টা করুন।');
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।');
  return data;
}
const bnDigits = s => String(s).replace(/[০-৯]/g, d => String('০১২৩৪৫৬৭৮৯'.indexOf(d)));

// ── Signed out: email → code → in ──
const form = page?.querySelector('[data-acct-form]');
const codeForm = page?.querySelector('[data-code-form]');
if (form && codeForm) {
  let mode = 'signin';
  let email = '';
  let turnstileToken = '';
  window.vmAccountTurnstile = t => { turnstileToken = t; };
  const err = form.querySelector('[data-acct-error]');
  const codeErr = codeForm.querySelector('[data-code-error]');
  const sendBtn = form.querySelector('[data-acct-send]');

  function setMode(m) {
    mode = m;
    page.querySelectorAll('[data-acct-tab]').forEach(t => t.setAttribute('aria-selected', String(t.dataset.acctTab === m)));
    form.querySelectorAll('[data-signup-only]').forEach(el => { el.hidden = m !== 'signup'; });
    err.textContent = '';
  }
  page.querySelectorAll('[data-acct-tab]').forEach(t => t.addEventListener('click', () => setMode(t.dataset.acctTab)));
  if (new URLSearchParams(location.search).get('signup') === '1') setMode('signup');

  async function requestCode() {
    const body = { email: form.email.value.trim(), mode, turnstileToken, offers: form.offers?.checked !== false };
    if (mode === 'signup') Object.assign(body, { name: form.name.value.trim(), phone: bnDigits(form.phone.value.trim()) });
    const r = await send('/api/account/code', 'POST', body);
    email = r.email;
    turnstileToken = '';
    window.turnstile?.reset?.();
    form.hidden = true;
    codeForm.hidden = false;
    page.querySelector('[data-acct-tabs], .acct-tabs')?.setAttribute('hidden', '');
    codeForm.querySelector('[data-code-sent]').innerHTML = `<b>${email.replace(/[<>&"]/g, '')}</b>-এ একটি ৬ সংখ্যার কোড পাঠানো হয়েছে। ইমেইল খুলে কোডটি নিচে লিখুন।`
      + (r.devCode ? `<br><small>(পরীক্ষার জন্য কোড: ${r.devCode})</small>` : '');
    codeForm.code.value = '';
    codeForm.code.focus();
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    err.textContent = '';
    if (mode === 'signup' && form.name.value.trim().length < 2) { err.textContent = 'আপনার নাম লিখুন।'; form.name.focus(); return; }
    if (mode === 'signup' && !/^(\+?88)?01[3-9]\d{8}$/.test(bnDigits(form.phone.value).replace(/[\s-]/g, ''))) { err.textContent = 'সঠিক মোবাইল নম্বর লিখুন, যেমন 01712345678।'; form.phone.focus(); return; }
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(form.email.value.trim())) { err.textContent = 'সঠিক ইমেইল লিখুন, যেমন rahim@gmail.com'; form.email.focus(); return; }
    sendBtn.disabled = true;
    sendBtn.textContent = 'কোড পাঠানো হচ্ছে…';
    try { await requestCode(); } catch (x) { err.textContent = x.message; } finally { sendBtn.disabled = false; sendBtn.textContent = 'ইমেইলে কোড পাঠান'; }
  });

  codeForm.addEventListener('submit', async e => {
    e.preventDefault();
    codeErr.textContent = '';
    const code = bnDigits(codeForm.code.value).replace(/\D/g, '');
    if (code.length !== 6) { codeErr.textContent = 'ইমেইলে আসা ৬ সংখ্যার কোডটি লিখুন।'; codeForm.code.focus(); return; }
    const go = codeForm.querySelector('[data-code-go]');
    go.disabled = true;
    try {
      await send('/api/account/verify', 'POST', { email, code });
      const next = page.dataset.next;
      location.href = next || '/account';
    } catch (x) { codeErr.textContent = x.message; go.disabled = false; }
  });
  // The code arrives as 6 digits: submit as soon as they are all there.
  codeForm.code.addEventListener('input', () => { if (bnDigits(codeForm.code.value).replace(/\D/g, '').length === 6) codeForm.requestSubmit(); });
  codeForm.querySelector('[data-code-again]').addEventListener('click', async () => {
    codeErr.textContent = '';
    try { await requestCode(); toast('নতুন কোড পাঠানো হয়েছে।'); } catch (x) { codeErr.textContent = x.message; }
  });
  codeForm.querySelector('[data-code-back]').addEventListener('click', () => {
    codeForm.hidden = true;
    form.hidden = false;
    page.querySelector('.acct-tabs')?.removeAttribute('hidden');
    form.email.focus();
  });
}

// ── Signed in: details, offers, sign out ──
const profile = page?.querySelector('[data-profile]');
profile?.addEventListener('submit', async e => {
  e.preventDefault();
  const msg = profile.querySelector('[data-profile-msg]');
  msg.className = 'form-msg';
  msg.textContent = 'সেভ হচ্ছে…';
  try {
    await send('/api/account/me', 'PUT', { name: profile.name.value, phone: bnDigits(profile.phone.value), addressLine: profile.addressLine.value, offers: profile.offers.checked });
    msg.className = 'form-msg ok';
    msg.textContent = '✓ সেভ হয়েছে।';
  } catch (x) { msg.className = 'form-msg error'; msg.textContent = x.message; }
});
page?.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(b.dataset.copy); toast(`কোড ${b.dataset.copy} কপি হয়েছে। চেকআউটে লিখে দিন।`); } catch { toast(`কোড: ${b.dataset.copy}`); }
}));
page?.querySelector('[data-logout]')?.addEventListener('click', async () => {
  await send('/api/account/logout', 'POST', {}).catch(() => {});
  location.href = '/account';
});
