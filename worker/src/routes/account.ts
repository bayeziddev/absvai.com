/**
 * Customer accounts (/api/account). Sign up with name, mobile number, email and a password and you are in, no code. Sign
 * in with the email or the mobile number and the password. Forgot the password: a 6-digit code goes to the email
 * (Resend) and a new password is chosen with it. The messages are in Bangla because customers read them.
 */
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { storeName } from '../lib/brand';
import { hashPassword, verifyPassword } from '../lib/auth';
import { hmac, signingKey, timingSafeEqual } from '../lib/crypto';
import { accountCode } from '../lib/email-templates';
import { bad, HttpError, rateLimit, readJson, str } from '../lib/http';
import { localPhone, normalizeBdPhone } from '../lib/phone';
import {
  accountByEmail, accountById, accountByPhone, codeFor, countWrongCode, createAccount, deleteCode, linkCustomer, saveCode, setPassword, touchLogin, updateAccount,
  type AccountRow,
} from '../repo/accounts';
import { sendNow, shopInfo, validEmail } from '../services/email';
import { clearAccountCookie, limiterKeys, setAccountCookie, settingsOf, signedInAccountId, verifyTurnstile } from './context';

export const account = new Hono<AppEnv>();

const CODE_MINUTES = 10;
const MAX_TRIES = 5;
const MIN_PASSWORD = 6;
const NO_STORE = { 'Cache-Control': 'private, no-store' };
const WRONG_LOGIN = 'ইমেইল/মোবাইল নম্বর অথবা পাসওয়ার্ড মেলেনি। আবার দেখে লিখুন, অথবা “পাসওয়ার্ড ভুলে গেছেন?” চাপুন।';

const normEmail = (v: unknown) => str(v, 120).trim().toLowerCase();
const bnDigits = (s: string) => s.replace(/[০-৯]/g, d => String('০১২৩৪৫৬৭৮৯'.indexOf(d)));
const codeHash = (env: AppEnv['Bindings'], email: string, code: string) => hmac(signingKey(env), `account:${email}:${code}`);
function passwordOf(v: unknown): string {
  const pw = str(v, 200);
  if (pw.length < MIN_PASSWORD) throw bad('পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের দিন।');
  return pw;
}
/** What the account page and the checkout get: never the id or the password hash. */
export const publicAccount = (a: AccountRow) => ({
  name: a.name, email: a.email, phone: a.phone ? localPhone(a.phone) : '', addressLine: a.address_line ?? '', zoneId: a.zone_id, offers: Boolean(a.offers),
});

account.post('/signup', async c => {
  const keys = limiterKeys(c, 'account-signup');
  if (!(await rateLimit(c.env.KV, keys.ip, 10, 3600))) throw new HttpError(429, 'এই সংযোগ থেকে অনেকগুলো অ্যাকাউন্ট খোলা হয়েছে। এক ঘণ্টা পরে আবার চেষ্টা করুন।');
  const b = await readJson(c);
  const name = str(b.name, 120).trim();
  if (name.length < 2) throw bad('আপনার নাম লিখুন।');
  const phone = normalizeBdPhone(bnDigits(str(b.phone, 20)));
  if (!phone) throw bad('সঠিক মোবাইল নম্বর লিখুন, যেমন 01712345678।');
  const email = normEmail(b.email);
  if (!validEmail(email)) throw bad('সঠিক ইমেইল লিখুন, যেমন rahim@gmail.com');
  const password = passwordOf(b.password);
  if (!(await verifyTurnstile(c, str(b.turnstileToken, 2048)))) throw new HttpError(403, '“আমি মানুষ” যাচাইটি শেষ হয়নি। পেজটি রিলোড করে আবার চেষ্টা করুন।');
  if (await accountByPhone(c.env.DB, phone)) throw new HttpError(409, 'এই মোবাইল নম্বরে আগেই অ্যাকাউন্ট আছে। “সাইন ইন” চাপুন, অথবা পাসওয়ার্ড ভুলে গেলে রিসেট করুন।');
  const a = await createAccount(c.env.DB, { email, name, phone, passwordHash: await hashPassword(password), offers: b.offers !== false });
  if (!a) throw new HttpError(409, 'এই ইমেইলে আগেই অ্যাকাউন্ট আছে। “সাইন ইন” চাপুন, অথবা পাসওয়ার্ড ভুলে গেলে রিসেট করুন।');
  await setAccountCookie(c, a.id);
  return c.json({ ok: true, account: publicAccount(a) }, 201, NO_STORE);
});

account.post('/login', async c => {
  const keys = limiterKeys(c, 'account-login');
  if (!(await rateLimit(c.env.KV, keys.ip, 30, 600))) throw new HttpError(429, 'অনেকবার চেষ্টা হয়েছে। কয়েক মিনিট পরে আবার চেষ্টা করুন।');
  const b = await readJson(c);
  const login = bnDigits(str(b.login, 120).trim());
  const password = str(b.password, 200);
  if (!login || !password) throw bad('ইমেইল বা মোবাইল নম্বর আর পাসওয়ার্ড লিখুন।');
  const phone = login.includes('@') ? null : normalizeBdPhone(login);
  const a = phone ? await accountByPhone(c.env.DB, phone) : validEmail(login.toLowerCase()) ? await accountByEmail(c.env.DB, login.toLowerCase()) : null;
  // Wrong tries per account are limited too, so nobody can guess a password from many connections.
  if (a && !(await rateLimit(c.env.KV, `account-login:${a.id}`, 10, 900))) throw new HttpError(429, 'অনেকবার ভুল পাসওয়ার্ড দেওয়া হয়েছে। ১৫ মিনিট পরে চেষ্টা করুন, অথবা “পাসওয়ার্ড ভুলে গেছেন?” চাপুন।');
  if (!a?.password_hash || !(await verifyPassword(password, a.password_hash))) throw bad(WRONG_LOGIN);
  await touchLogin(c.env.DB, a.id);
  await setAccountCookie(c, a.id);
  return c.json({ ok: true, account: publicAccount(a) }, 200, NO_STORE);
});

/** Forgot password: a 6-digit code to the account's email. Answers the same whether or not the email has an account. */
account.post('/reset-code', async c => {
  const keys = limiterKeys(c, 'account-code');
  if (!(await rateLimit(c.env.KV, keys.ip, 10, 3600))) throw new HttpError(429, 'অনেকবার কোড চাওয়া হয়েছে। এক ঘণ্টা পরে আবার চেষ্টা করুন।');
  const b = await readJson(c);
  const email = normEmail(b.email);
  if (!validEmail(email)) throw bad('অ্যাকাউন্টের ইমেইলটি লিখুন, যেমন rahim@gmail.com');
  if (!(await verifyTurnstile(c, str(b.turnstileToken, 2048)))) throw new HttpError(403, '“আমি মানুষ” যাচাইটি শেষ হয়নি। পেজটি রিলোড করে আবার চেষ্টা করুন।');
  if (!(await rateLimit(c.env.KV, `account-code:${email}`, 3, 600))) throw new HttpError(429, 'এই ইমেইলে কিছুক্ষণ আগেই কোড পাঠানো হয়েছে। ইমেইল দেখুন, অথবা ১০ মিনিট পরে আবার চান।');
  const a = await accountByEmail(c.env.DB, email);
  if (!a) return c.json({ ok: true, email }, 200, NO_STORE);
  const settings = await settingsOf(c);
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
  await saveCode(c.env.DB, { email, codeHash: await codeHash(c.env, email, code), name: null, phone: null, offers: Boolean(a.offers), expiresAt: new Date(Date.now() + CODE_MINUTES * 60_000).toISOString() });
  // Local development without Resend: the code comes back in the answer so the page can be tried out.
  if (!c.env.RESEND_API_KEY && c.env.ENVIRONMENT === 'development') return c.json({ ok: true, email, devCode: code }, 200, NO_STORE);
  const sent = await sendNow(c.env, settings, 'account_code', email, accountCode(shopInfo(c.env, settings), code, a.name, false));
  if (!sent.ok) {
    await deleteCode(c.env.DB, email);
    throw new HttpError(503, `এই মুহূর্তে ইমেইলে কোড পাঠানো যাচ্ছে না। পাসওয়ার্ড বদলাতে ${storeName(settings)}-কে WhatsApp বা ফোন করুন, অথবা একটু পরে আবার চেষ্টা করুন।`);
  }
  return c.json({ ok: true, email }, 200, NO_STORE);
});

/** The code from the email and a new password: the password changes and the customer is signed in. */
account.post('/reset', async c => {
  const keys = limiterKeys(c, 'account-verify');
  if (!(await rateLimit(c.env.KV, keys.ip, 30, 600))) throw new HttpError(429, 'অনেকবার চেষ্টা হয়েছে। কয়েক মিনিট পরে আবার চেষ্টা করুন।');
  const b = await readJson(c);
  const email = normEmail(b.email);
  const code = bnDigits(str(b.code, 12)).replace(/\D/g, '');
  const row = validEmail(email) ? await codeFor(c.env.DB, email) : null;
  if (!row || Date.parse(row.expires_at) < Date.now()) throw bad('কোডের মেয়াদ শেষ হয়ে গেছে। “নতুন কোড পাঠান” চাপুন।');
  if (row.attempts >= MAX_TRIES) { await deleteCode(c.env.DB, email); throw bad('অনেকবার ভুল কোড দেওয়া হয়েছে। “নতুন কোড পাঠান” চাপুন।'); }
  if (code.length !== 6 || !timingSafeEqual(await codeHash(c.env, email, code), row.code_hash)) {
    const tries = await countWrongCode(c.env.DB, email);
    throw bad(tries >= MAX_TRIES ? 'অনেকবার ভুল কোড দেওয়া হয়েছে। “নতুন কোড পাঠান” চাপুন।' : 'কোডটি মেলেনি। ইমেইলে পাঠানো ৬ সংখ্যার কোডটি আবার দেখে লিখুন।');
  }
  const password = passwordOf(b.password);
  const a = await accountByEmail(c.env.DB, email);
  if (!a) throw bad('কোডের মেয়াদ শেষ হয়ে গেছে। “নতুন কোড পাঠান” চাপুন।');
  await setPassword(c.env.DB, a.id, email, await hashPassword(password));
  await setAccountCookie(c, a.id);
  return c.json({ ok: true, account: publicAccount(a) }, 200, NO_STORE);
});

account.get('/me', async c => {
  const id = await signedInAccountId(c);
  const a = id ? await accountById(c.env.DB, id) : null;
  if (id && !a) clearAccountCookie(c);
  return c.json({ account: a ? publicAccount(a) : null }, 200, NO_STORE);
});

account.put('/me', async c => {
  const id = await signedInAccountId(c);
  const a = id ? await accountById(c.env.DB, id) : null;
  if (!a) throw new HttpError(401, 'আবার সাইন ইন করুন।');
  const b = await readJson(c);
  const name = str(b.name, 120).trim();
  if (name.length < 2) throw bad('আপনার নাম লিখুন।');
  const rawPhone = bnDigits(str(b.phone, 20).trim());
  const phone = rawPhone ? normalizeBdPhone(rawPhone) : null;
  if (rawPhone && !phone) throw bad('সঠিক মোবাইল নম্বর লিখুন, যেমন 01712345678।');
  if (phone && phone !== a.phone) {
    const other = await accountByPhone(c.env.DB, phone);
    if (other && other.id !== a.id) throw new HttpError(409, 'এই মোবাইল নম্বরে অন্য একটি অ্যাকাউন্ট আছে।');
  }
  const addressLine = str(b.addressLine, 300).trim() || null;
  const offers = b.offers !== false;
  await updateAccount(c.env.DB, a.id, { name, phone, addressLine, offers });
  await linkCustomer(c.env.DB, { email: a.email, phone, name, offers: offers ? 1 : 0 });
  return c.json({ ok: true, account: publicAccount((await accountById(c.env.DB, a.id))!) }, 200, NO_STORE);
});

account.post('/logout', c => {
  clearAccountCookie(c);
  return c.json({ ok: true }, 200, NO_STORE);
});
