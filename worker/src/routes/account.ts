/**
 * Customer accounts (/api/account): open an account or sign in with a 6-digit code sent to the email (Resend), no
 * password. The page /account and the checkout use these; the messages are in Bangla because customers read them.
 * An email nobody has an account for gets a code all the same (and the account on the right code), so the form never
 * tells a stranger which emails have accounts.
 */
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { storeName } from '../lib/brand';
import { hmac, signingKey, timingSafeEqual } from '../lib/crypto';
import { accountCode } from '../lib/email-templates';
import { bad, HttpError, rateLimit, readJson, str } from '../lib/http';
import { localPhone, normalizeBdPhone } from '../lib/phone';
import { accountByEmail, accountById, codeFor, countWrongCode, deleteCode, linkCustomer, saveCode, signedIn, updateAccount, type AccountRow } from '../repo/accounts';
import { sendNow, shopInfo, validEmail } from '../services/email';
import { clearAccountCookie, limiterKeys, setAccountCookie, settingsOf, signedInAccountId, verifyTurnstile } from './context';

export const account = new Hono<AppEnv>();

const CODE_MINUTES = 10;
const MAX_TRIES = 5;
const NO_STORE = { 'Cache-Control': 'private, no-store' };

const normEmail = (v: unknown) => str(v, 120).trim().toLowerCase();
const codeHash = (env: AppEnv['Bindings'], email: string, code: string) => hmac(signingKey(env), `account:${email}:${code}`);
/** What the account page and the checkout get: never the id. */
export const publicAccount = (a: AccountRow) => ({
  name: a.name, email: a.email, phone: a.phone ? localPhone(a.phone) : '', addressLine: a.address_line ?? '', zoneId: a.zone_id, offers: Boolean(a.offers),
});

account.post('/code', async c => {
  const keys = limiterKeys(c, 'account-code');
  if (!(await rateLimit(c.env.KV, keys.ip, 10, 3600))) throw new HttpError(429, 'অনেকবার কোড চাওয়া হয়েছে। এক ঘণ্টা পরে আবার চেষ্টা করুন।');
  const b = await readJson(c);
  const email = normEmail(b.email);
  if (!validEmail(email)) throw bad('সঠিক ইমেইল লিখুন, যেমন rahim@gmail.com');
  if (!(await verifyTurnstile(c, str(b.turnstileToken, 2048)))) throw new HttpError(403, '“আমি মানুষ” যাচাইটি শেষ হয়নি। পেজটি রিলোড করে আবার চেষ্টা করুন।');
  if (!(await rateLimit(c.env.KV, `account-code:${email}`, 3, 600))) throw new HttpError(429, 'এই ইমেইলে কিছুক্ষণ আগেই কোড পাঠানো হয়েছে। ইমেইল দেখুন, অথবা ১০ মিনিট পরে আবার চান।');
  const existing = await accountByEmail(c.env.DB, email);
  const signUp = b.mode === 'signup' && !existing;
  let name: string | null = null;
  let phone: string | null = null;
  if (signUp) {
    name = str(b.name, 120).trim();
    if (name.length < 2) throw bad('আপনার নাম লিখুন।');
    phone = normalizeBdPhone(str(b.phone, 20));
    if (!phone) throw bad('সঠিক মোবাইল নম্বর লিখুন, যেমন 01712345678।');
  }
  const settings = await settingsOf(c);
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
  await saveCode(c.env.DB, { email, codeHash: await codeHash(c.env, email, code), name, phone, offers: b.offers !== false, expiresAt: new Date(Date.now() + CODE_MINUTES * 60_000).toISOString() });
  // Local development without Resend: the code comes back in the answer so the page can be tried out.
  if (!c.env.RESEND_API_KEY && c.env.ENVIRONMENT === 'development') return c.json({ ok: true, email, signUp, devCode: code }, 200, NO_STORE);
  const sent = await sendNow(c.env, settings, 'account_code', email, accountCode(shopInfo(c.env, settings), code, existing?.name ?? name, signUp));
  if (!sent.ok) {
    await deleteCode(c.env.DB, email);
    throw new HttpError(503, `এই মুহূর্তে ইমেইলে কোড পাঠানো যাচ্ছে না। একটু পরে আবার চেষ্টা করুন, অথবা অর্ডার করতে অ্যাকাউন্ট লাগবে না: সরাসরি অর্ডার করুন বা ${storeName(settings)}-কে WhatsApp করুন।`);
  }
  return c.json({ ok: true, email, signUp }, 200, NO_STORE);
});

account.post('/verify', async c => {
  const keys = limiterKeys(c, 'account-verify');
  if (!(await rateLimit(c.env.KV, keys.ip, 30, 600))) throw new HttpError(429, 'অনেকবার চেষ্টা হয়েছে। কয়েক মিনিট পরে আবার চেষ্টা করুন।');
  const b = await readJson(c);
  const email = normEmail(b.email);
  const code = str(b.code, 12).replace(/[০-৯]/g, d => String('০১২৩৪৫৬৭৮৯'.indexOf(d))).replace(/\D/g, '');
  const row = validEmail(email) ? await codeFor(c.env.DB, email) : null;
  if (!row || Date.parse(row.expires_at) < Date.now()) throw bad('কোডের মেয়াদ শেষ হয়ে গেছে। “নতুন কোড পাঠান” চাপুন।');
  if (row.attempts >= MAX_TRIES) { await deleteCode(c.env.DB, email); throw bad('অনেকবার ভুল কোড দেওয়া হয়েছে। “নতুন কোড পাঠান” চাপুন।'); }
  if (code.length !== 6 || !timingSafeEqual(await codeHash(c.env, email, code), row.code_hash)) {
    const tries = await countWrongCode(c.env.DB, email);
    throw bad(tries >= MAX_TRIES ? 'অনেকবার ভুল কোড দেওয়া হয়েছে। “নতুন কোড পাঠান” চাপুন।' : 'কোডটি মেলেনি। ইমেইলে পাঠানো ৬ সংখ্যার কোডটি আবার দেখে লিখুন।');
  }
  const a = await signedIn(c.env.DB, { email, name: row.name, phone: row.phone, offers: Boolean(row.offers) });
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
  const rawPhone = str(b.phone, 20).trim();
  const phone = rawPhone ? normalizeBdPhone(rawPhone) : null;
  if (rawPhone && !phone) throw bad('সঠিক মোবাইল নম্বর লিখুন, যেমন 01712345678।');
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
