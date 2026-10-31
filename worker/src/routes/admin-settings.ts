/** Admin: dynamic settings (store, branding, delivery, payments, SMS, tracking, fraud) and Security (block list, blocked attempts). */
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { TAG } from '../lib/cache-tags';
import { maskSecret } from '../lib/crypto';
import { bad, HttpError, mediaBucket, notFound, posInt, readJson, str } from '../lib/http';
import { maskPhone, normalizeBdPhone } from '../lib/phone';
import { contrastWarnings, parseBrandColors, SETTING_BY_KEY, SETTINGS, SITEWIDE_KEYS, validateSetting } from '../lib/settings-schema';
import { attemptById, listAttempts, listBlocks, removeBlock, reviewAttempt } from '../repo/fraud';
import { getSecret, loadSettings, saveSecret, saveSettings, secretStatus } from '../repo/settings';
import { blockValue } from '../services/fraud';
import { canEmailCustomers, emailConnected, flushEmails, queueOffers, queueTest } from '../services/email';
import { emailCounts, offersAudience, recentEmails } from '../repo/email';
import { audit, need, refresh } from './admin-helpers';

export const adminSettings = new Hono<AppEnv>();

adminSettings.get('/settings', need('settings:read'), async c => {
  const [s, secrets] = await Promise.all([loadSettings(c.env.DB), secretStatus(c.env.DB)]);
  const canSecrets = c.var.session.role === 'super_admin';
  const values: Record<string, unknown> = {};
  for (const def of SETTINGS) {
    if (def.kind === 'secret') {
      const set = secrets[def.key];
      // Secrets are never sent back in full: only whether one is saved and its last four characters.
      values[def.key] = set ? { set: true, masked: canSecrets ? maskSecret((await getSecret(c.env, def.key)) ?? '') : '••••', updatedAt: set.updatedAt } : { set: false };
    } else values[def.key] = s[def.key] ?? '';
  }
  return c.json({
    values, canEditSecrets: canSecrets,
    fields: SETTINGS.map(d => ({ key: d.key, group: d.group, label: d.label, kind: d.kind, help: d.help ?? null })),
    contrastWarnings: contrastWarnings(parseBrandColors(JSON.parse(s.brand_colors || '{}'))),
  });
});

adminSettings.put('/settings', need('settings:write'), async c => {
  const b = await readJson(c);
  const before = await loadSettings(c.env.DB);
  const plain: Record<string, string> = {};
  const changedSecrets: string[] = [];
  for (const [k, raw] of Object.entries(b)) {
    const def = SETTING_BY_KEY.get(k);
    if (!def) continue;
    if (def.kind === 'secret') {
      if (c.var.session.role !== 'super_admin') throw bad('Only the Super Admin can change payment, SMS, courier and tracking credentials.');
      // Empty means "keep"; { clear: true } removes it.
      if (raw && typeof raw === 'object' && (raw as { clear?: boolean }).clear) { await saveSecret(c.env, k, null); changedSecrets.push(k); continue; }
      const v = str(raw, 2000);
      if (!v) continue;
      await saveSecret(c.env, k, v);
      changedSecrets.push(k);
      continue;
    }
    const value = typeof raw === 'object' && raw !== null ? JSON.stringify(raw) : str(raw, 4000);
    // An empty number box that was never set keeps the built-in default instead of blocking the whole save.
    if (def.kind === 'int' && value === '' && !before[k]) continue;
    const err = validateSetting(def, value);
    if (err) throw bad(err);
    if (k === 'brand_colors') plain[k] = JSON.stringify(parseBrandColors(JSON.parse(value || '{}')));
    else plain[k] = value;
  }
  await saveSettings(c.env.DB, plain);
  const changed = Object.keys(plain).filter(k => (before[k] ?? '') !== plain[k]);
  // Audit with before/after values; secrets are redacted.
  await audit(c, 'settings.update', 'settings', null, {
    changed: Object.fromEntries(changed.map(k => [k, { before: before[k] ?? '', after: plain[k] }])),
    secrets: changedSecrets.map(k => ({ key: k, value: '[redacted]' })),
  });
  if (changed.some(k => SITEWIDE_KEYS.has(k))) await refresh(c, [TAG.site]);
  return c.json({ ok: true, changed, contrastWarnings: contrastWarnings(parseBrandColors(JSON.parse((plain.brand_colors ?? before.brand_colors) || '{}'))) });
});

const BRAND_TYPES: Record<string, string> = { 'image/png': 'png', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/jpeg': 'jpg' };

/** Logo upload to R2; the URL is saved as brand_logo_url and every page refreshes. */
adminSettings.post('/brand-asset', need('settings:write'), async c => {
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw bad('Choose the logo file.');
  const ext = BRAND_TYPES[file.type];
  if (!ext) throw bad('Upload the logo as PNG, WebP, SVG or JPG.');
  if (file.size > 1024 * 1024) throw bad('The logo must be under 1 MB.');
  const media = mediaBucket(c.env);
  const key = `brand/logo-${crypto.randomUUID()}.${ext}`;
  await media.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=31536000, immutable' } });
  await saveSettings(c.env.DB, { brand_logo_url: `/media/${key}` });
  await audit(c, 'settings.logo', 'settings', 'brand_logo_url', { key });
  await refresh(c, [TAG.site]);
  return c.json({ ok: true, url: `/media/${key}` }, 201);
});

// ───────────── Emails (Resend) ─────────────

const EMAIL_KEYS = ['notify_email', 'email_from', 'email_reply_to', 'email_owner_new_order', 'email_owner_updates', 'email_owner_daily', 'email_customer_updates'];

adminSettings.get('/emails', need('settings:read'), async c => {
  const s = await loadSettings(c.env.DB);
  const [recent, counts, audience] = await Promise.all([recentEmails(c.env.DB, 60), emailCounts(c.env.DB, new Date(Date.now() - 7 * 86_400_000).toISOString()), offersAudience(c.env.DB)]);
  return c.json({
    connected: emailConnected(c.env), canEmailCustomers: canEmailCustomers(s), values: Object.fromEntries(EMAIL_KEYS.map(k => [k, s[k] ?? ''])),
    recent, counts, offersCount: audience.length,
  });
});

/** Sends a test email to the alerts address now and says whether Resend accepted it. */
adminSettings.post('/emails/test', need('settings:write'), async c => {
  if (!(await queueTest(c.env))) throw bad('Type the email address for shop alerts first, then save.');
  await flushEmails(c.env, 5);
  const [last] = await recentEmails(c.env.DB, 1);
  return c.json({ status: last?.status ?? 'queued', error: last?.error ?? null });
});

/** An offer email to every customer who ticked "email me offers" (a copy goes to the owner). */
adminSettings.post('/emails/offers', need('settings:write'), async c => {
  const b = await readJson(c);
  const subject = str(b.subject, 120);
  const message = str(b.message, 4000);
  const ctaText = str(b.ctaText, 40);
  const ctaHref = str(b.ctaHref, 300);
  if (subject.length < 3 || message.length < 10) throw bad('Write a subject and a message.');
  if (ctaText && !/^(\/[\w/?=&.-]*|https:\/\/\S+)$/.test(ctaHref)) throw bad('The button link should be a page of the shop (starting with /) or an https:// link.');
  if (!canEmailCustomers(await loadSettings(c.env.DB))) throw new HttpError(409, 'Customers can get emails once your own domain is verified in Resend. Until then only you receive emails.');
  const audience = await offersAudience(c.env.DB);
  if (!audience.length) throw bad('No customer has asked for offers by email yet.');
  const n = await queueOffers(c.env, audience, { subject, message, ctaText, ctaHref: ctaHref.startsWith('/') ? `${c.env.SITE_URL}${ctaHref}` : ctaHref });
  await audit(c, 'email.offers', 'settings', null, { subject, recipients: n });
  return c.json({ ok: true, queued: n });
});

// ───────────── Security: block list and blocked attempts ─────────────

adminSettings.get('/security/blocks', need('security:read'), async c => c.json(await listBlocks(c.env.DB, c.req.query('all') === '1', new Date().toISOString())));

/** Block a phone number (the common case). Device and IP blocks are made from an order or a blocked attempt. */
adminSettings.post('/security/blocks', need('security:write'), async c => {
  const b = await readJson(c);
  const phone = normalizeBdPhone(str(b.phone));
  if (!phone) throw bad('Enter the Bangladeshi mobile number to block.');
  const reason = str(b.reason, 200);
  if (!reason) throw bad('Write the reason, e.g. "Refused 3 parcels".');
  const days = posInt(b.days);
  const id = await blockValue(c.env, { type: 'phone', value: phone, hint: maskPhone(phone), reason, expiresAt: days ? new Date(Date.now() + days * 86_400_000).toISOString() : null, adminId: c.var.session.adminId });
  await audit(c, 'security.block', 'block_list', id, { type: 'phone', hint: maskPhone(phone), reason, days });
  return c.json({ ok: true, id }, 201);
});

adminSettings.delete('/security/blocks/:id', need('security:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const note = str(c.req.query('note'), 300);
  const removed = await removeBlock(c.env.DB, id);
  if (!removed) throw notFound();
  await audit(c, 'security.unblock', 'block_list', id, { type: removed.type, hint: removed.value_hint, note });
  return c.json({ ok: true });
});

adminSettings.get('/security/attempts', need('security:read'), async c => c.json(await listAttempts(c.env.DB, posInt(c.req.query('before')), 100)));

/** One tap with a note: unblocks the value behind the attempt (if any) and marks the attempt reviewed. */
adminSettings.post('/security/attempts/:id/review', need('security:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const b = await readJson(c);
  const note = str(b.note, 300);
  if (!note) throw bad('Add a short note, e.g. "Real customer, called to confirm".');
  const a = await attemptById(c.env.DB, id);
  if (!a) throw notFound();
  let unblocked = false;
  if (b.unblock && a.block_id) unblocked = Boolean(await removeBlock(c.env.DB, Number(a.block_id)));
  await reviewAttempt(c.env.DB, id, c.var.session.adminId, note);
  await audit(c, unblocked ? 'security.unblock' : 'security.review', 'blocked_attempt', id, { note, blockId: a.block_id });
  return c.json({ ok: true, unblocked });
});

/** Block the device or connection behind an attempt (e.g. a script hammering checkout). IP blocks always expire. */
adminSettings.post('/security/attempts/:id/block', need('security:write'), async c => {
  const id = posInt(c.req.param('id')) ?? 0;
  const b = await readJson(c);
  const a = await attemptById(c.env.DB, id);
  if (!a) throw notFound();
  const type = str(b.type) === 'device' ? 'device' : 'ip';
  const hash = (type === 'device' ? a.device_hash : a.ip_hash) as string | null;
  if (!hash) throw bad(`No ${type === 'device' ? 'device' : 'connection'} was recorded for this attempt.`);
  const reason = str(b.reason, 200) || String(a.reason);
  const hours = Math.min(Math.max(Number(b.hours) || 24, 1), 24 * 30);
  const blockId = await blockValue(c.env, { type, value: hash, hint: `${type === 'device' ? 'device' : 'connection'} ${hash.slice(0, 6)}…`, reason, expiresAt: type === 'ip' || b.hours ? new Date(Date.now() + hours * 3_600_000).toISOString() : null, adminId: c.var.session.adminId, alreadyHashed: true });
  await audit(c, 'security.block', 'block_list', blockId, { type, fromAttempt: id, hours });
  return c.json({ ok: true, id: blockId });
});

/** Manual "refresh the whole site" for after bulk changes made outside admin (e.g. SQL). */
adminSettings.post('/cache/purge-all', need('settings:write'), async c => {
  await refresh(c, [TAG.site]);
  await audit(c, 'cache.purge_all', 'settings', null);
  return c.json({ ok: true });
});

