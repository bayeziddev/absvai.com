// Account page: sign in (email or mobile number and password), open an account (no code), or "forgot password" (a
// 6-digit code by email, then a new password); then the orders, offers and details. Messages are in Bangla; the
// server's own messages already are.
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
const goNext = () => { location.href = page.dataset.next || '/account'; };

// Turnstile (the invisible "I am human" check) for opening an account and for sending a reset code.
const tokens = { signup: '', reset: '' };
window.vmAccountTurnstile = t => { tokens.signup = t; };
window.vmResetTurnstile = t => { tokens.reset = t; };

const forms = page ? Object.fromEntries([...page.querySelectorAll('[data-acct-form]')].map(f => [f.dataset.acctForm, f])) : {};
if (forms.signin) {
  const tabs = page.querySelector('.acct-tabs');
  let resetEmail = '';
  function show(name) {
    Object.entries(forms).forEach(([k, f]) => { f.hidden = k !== name; });
    tabs.hidden = name === 'forgot' || name === 'reset';
    page.querySelectorAll('[data-acct-tab]').forEach(t => t.setAttribute('aria-selected', String(t.dataset.acctTab === name)));
    forms[name].querySelectorAll('[data-acct-error]').forEach(e => { e.textContent = ''; });
    forms[name].querySelector('input:not([type=checkbox])')?.focus();
  }
  page.querySelectorAll('[data-acct-tab]').forEach(t => t.addEventListener('click', () => show(t.dataset.acctTab)));
  if (new URLSearchParams(location.search).get('signup') === '1') show('signup');
  page.querySelectorAll('[data-show-password]').forEach(c => c.addEventListener('change', () => {
    c.closest('form').querySelectorAll('input[name=password]').forEach(i => { i.type = c.checked ? 'text' : 'password'; });
  }));
  page.querySelector('[data-forgot]').addEventListener('click', () => {
    const login = forms.signin.login.value.trim();
    if (login.includes('@')) forms.forgot.email.value = login;
    show('forgot');
  });
  page.querySelectorAll('[data-back-signin]').forEach(b => b.addEventListener('click', () => show('signin')));

  /** Runs a form's request with its button busy and its error line filled in on failure. */
  function handle(form, label, fn) {
    const btn = form.querySelector('button[type=submit]');
    const err = form.querySelector('[data-acct-error]');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      err.textContent = '';
      const was = btn.textContent;
      btn.disabled = true;
      btn.textContent = label;
      try { await fn(); } catch (x) { err.textContent = x.message; } finally { btn.disabled = false; btn.textContent = was; }
    });
  }

  handle(forms.signin, 'সাইন ইন হচ্ছে…', async () => {
    const f = forms.signin;
    if (!f.login.value.trim() || !f.password.value) throw new Error('ইমেইল বা মোবাইল নম্বর আর পাসওয়ার্ড লিখুন।');
    await send('/api/account/login', 'POST', { login: bnDigits(f.login.value.trim()), password: f.password.value });
    goNext();
  });

  handle(forms.signup, 'অ্যাকাউন্ট খোলা হচ্ছে…', async () => {
    const f = forms.signup;
    if (f.name.value.trim().length < 2) { f.name.focus(); throw new Error('আপনার নাম লিখুন।'); }
    if (!/^(\+?88)?01[3-9]\d{8}$/.test(bnDigits(f.phone.value).replace(/[\s-]/g, ''))) { f.phone.focus(); throw new Error('সঠিক মোবাইল নম্বর লিখুন, যেমন 01712345678।'); }
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(f.email.value.trim())) { f.email.focus(); throw new Error('সঠিক ইমেইল লিখুন, যেমন rahim@gmail.com'); }
    if (f.password.value.length < 6) { f.password.focus(); throw new Error('পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের দিন।'); }
    try {
      await send('/api/account/signup', 'POST', { name: f.name.value.trim(), phone: bnDigits(f.phone.value.trim()), email: f.email.value.trim(), password: f.password.value, offers: f.offers.checked, turnstileToken: tokens.signup });
    } finally { tokens.signup = ''; window.turnstile?.reset?.(f.querySelector('.cf-turnstile')); }
    goNext();
  });

  async function requestReset() {
    try {
      const r = await send('/api/account/reset-code', 'POST', { email: resetEmail, turnstileToken: tokens.reset });
      forms.reset.querySelector('[data-code-sent]').innerHTML = `<b>${resetEmail.replace(/[<>&"]/g, '')}</b>-এ অ্যাকাউন্ট থাকলে একটি ৬ সংখ্যার কোড পাঠানো হয়েছে। কোড আর নতুন পাসওয়ার্ড লিখুন। ইনবক্সে না পেলে Spam দেখুন।`
        + (r.devCode ? `<br><small>(পরীক্ষার জন্য কোড: ${r.devCode})</small>` : '');
    } finally { tokens.reset = ''; window.turnstile?.reset?.(forms.forgot.querySelector('.cf-turnstile')); }
  }
  handle(forms.forgot, 'কোড পাঠানো হচ্ছে…', async () => {
    resetEmail = forms.forgot.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(resetEmail)) throw new Error('অ্যাকাউন্টের ইমেইলটি লিখুন, যেমন rahim@gmail.com');
    await requestReset();
    show('reset');
  });
  handle(forms.reset, 'বদলানো হচ্ছে…', async () => {
    const f = forms.reset;
    const code = bnDigits(f.code.value).replace(/\D/g, '');
    if (code.length !== 6) { f.code.focus(); throw new Error('ইমেইলে আসা ৬ সংখ্যার কোডটি লিখুন।'); }
    if (f.password.value.length < 6) { f.password.focus(); throw new Error('নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের দিন।'); }
    await send('/api/account/reset', 'POST', { email: resetEmail, code, password: f.password.value });
    toast('পাসওয়ার্ড বদলানো হয়েছে।');
    goNext();
  });
  forms.reset.querySelector('[data-code-again]').addEventListener('click', async () => {
    const err = forms.reset.querySelector('[data-acct-error]');
    err.textContent = '';
    try { await requestReset(); toast('নতুন কোড পাঠানো হয়েছে।'); } catch (x) { err.textContent = x.message; }
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
