/**
 * Email through Resend (https://resend.com). The API key is the RESEND_API_KEY Worker secret (from the GitHub secret
 * of the same name at deploy). Emails are queued in email_log during the request and sent right after it (and by
 * the cron), so checkout never waits for email.
 *
 * Who gets what (each can be switched off in Admin → Emails):
 * - the owner (notify_email): every new order, cancelled / returned / delivered orders, a morning summary, inquiries;
 * - the customer, if they gave an email at checkout: the receipt, the invoice at confirmation, "on the way", "delivered";
 * - customers who ticked "email me offers": the offers the owner sends.
 * Until the shop's own domain is verified in Resend, Resend only delivers to the account's own address, so emails to
 * customers are skipped (and say why) while the sender is still the Resend test address.
 */
import type { Env } from '../env';
import { hmac, signingKey, timingSafeEqual } from '../lib/crypto';
import * as T from '../lib/email-templates';
import { dailyNumbers, markEmail, queueEmail, queuedEmails, trimEmailBodies } from '../repo/email';
import { orderById, orderItems } from '../repo/orders';
import { loadSettings } from '../repo/settings';
import { courierLabel } from './orders';

const RESEND_URL = 'https://api.resend.com/emails';
export const DEFAULT_FROM = 'Abs Vai <onboarding@resend.dev>';
const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i;

export const emailConnected = (env: Env) => Boolean(env.RESEND_API_KEY);
export const validEmail = (s: string) => s.length <= 120 && EMAIL_RE.test(s);
/** Resend's test sender (onboarding@resend.dev) can only deliver to the Resend account's own email address. */
export const canEmailCustomers = (settings: Record<string, string>) => !/@resend\.dev>?\s*$/i.test((settings.email_from || DEFAULT_FROM).trim());
const on = (settings: Record<string, string>, key: string) => settings[key] !== '0';

export function shopInfo(env: Env, s: Record<string, string>): T.ShopInfo {
  return { store: s.store_name || 'Abs Vai', siteUrl: env.SITE_URL, phone: s.support_phone, whatsapp: s.whatsapp_number, company: s.company_name || undefined, address: s.company_address || undefined };
}

const PAYMENT: Record<string, string> = { cod: 'Cash on Delivery', manual_mobile: 'bKash / Nagad / Rocket' };
const SOURCE: Record<string, string> = { web: 'the website', landing: 'a landing page', facebook_comment: 'a Facebook comment', messenger: 'Messenger', whatsapp: 'WhatsApp', phone_call: 'a phone call', instagram: 'Instagram', walk_in: 'the shop', other: 'another channel' };

async function orderView(env: Env, orderId: number): Promise<T.OrderView | null> {
  const o = await orderById(env.DB, orderId);
  if (!o) return null;
  const items = await orderItems(env.DB, orderId);
  const str = (k: string) => (o[k] == null ? null : String(o[k]));
  return {
    orderNo: String(o.order_no), invoiceNo: str('invoice_no'), name: String(o.customer_name), phone: `0${String(o.phone).slice(3)}`, email: str('customer_email'),
    address: [o.address_line, o.landmark, o.union_name, o.upazila_name, o.district_name].filter(Boolean).join(', '), note: str('customer_note'),
    items: items.map(i => ({ name: String(i.name), variantLabel: String(i.variant_label ?? ''), qty: Number(i.qty), linePaisa: Number(i.line_total_paisa) })),
    subtotalPaisa: Number(o.subtotal_paisa), deliveryPaisa: Number(o.delivery_charge_paisa ?? 0), codFeePaisa: Number(o.cod_fee_paisa ?? 0), discountPaisa: Number(o.discount_paisa ?? 0), totalPaisa: Number(o.total_paisa),
    payment: PAYMENT[String(o.payment_method)] ?? String(o.payment_method), eta: str('eta_text'), courier: o.courier ? courierLabel(String(o.courier)) : null, trackingId: str('tracking_id'),
    holdReason: str('hold_reason'), source: SOURCE[String(o.source)] ?? String(o.source), createdAt: String(o.created_at),
    trackUrl: `${env.SITE_URL}/order/${encodeURIComponent(String(o.order_no))}?t=${encodeURIComponent(String(o.access_token))}`,
    adminUrl: `${env.SITE_URL}/admin/#/orders/${orderId}`,
  };
}

async function toOwner(env: Env, s: Record<string, string>, kind: string, mail: T.Mail, o: { orderId?: number; dedupeKey?: string } = {}) {
  const to = (s.notify_email || '').trim();
  if (!validEmail(to)) return;
  await queueEmail(env.DB, { kind, to, ...mail, orderId: o.orderId, dedupeKey: o.dedupeKey });
}

async function toCustomer(env: Env, s: Record<string, string>, kind: string, to: string, mail: T.Mail, o: { orderId?: number; dedupeKey?: string } = {}) {
  const ok = canEmailCustomers(s);
  await queueEmail(env.DB, { kind, to, ...mail, orderId: o.orderId, dedupeKey: o.dedupeKey, status: ok ? 'queued' : 'skipped', error: ok ? null : 'Verify your own domain in Resend (Admin → Emails) to email customers.' });
}

export type OrderEmailEvent = 'placed' | 'confirmed' | 'in_courier' | 'delivered' | 'partial_delivered' | 'cancelled' | 'returned';

/** Queues the emails an order event sends (never twice for the same order and event). Never throws. */
export async function orderEmails(env: Env, orderId: number, event: OrderEmailEvent, reason: string | null = null): Promise<void> {
  try {
    const s = await loadSettings(env.DB);
    const o = await orderView(env, orderId);
    if (!o) return;
    const shop = shopInfo(env, s);
    const key = (who: string) => `${event}:${who}:${orderId}`;
    if (event === 'placed' && on(s, 'email_owner_new_order')) await toOwner(env, s, 'owner_new_order', T.ownerNewOrder(shop, o), { orderId, dedupeKey: key('owner') });
    if (['cancelled', 'returned', 'delivered', 'partial_delivered'].includes(event) && on(s, 'email_owner_updates')) await toOwner(env, s, 'owner_update', T.ownerUpdate(shop, o, event, reason), { orderId, dedupeKey: key('owner') });
    if (!o.email || !on(s, 'email_customer_updates')) return;
    const mail = event === 'placed' ? T.customerReceipt(shop, o) : event === 'confirmed' ? T.customerInvoice(shop, o) : event === 'in_courier' ? T.customerShipped(shop, o) : event === 'delivered' ? T.customerDelivered(shop, o) : null;
    const kind = { placed: 'customer_receipt', confirmed: 'customer_invoice', in_courier: 'customer_shipped', delivered: 'customer_delivered' }[event as string];
    if (mail && kind) await toCustomer(env, s, kind, o.email, mail, { orderId, dedupeKey: key('customer') });
  } catch (e) {
    console.warn('order email not queued', e instanceof Error ? e.message : e);
  }
}

export async function inquiryEmail(env: Env, kind: string, fields: Array<[string, string]>): Promise<void> {
  try {
    const s = await loadSettings(env.DB);
    if (on(s, 'email_owner_updates')) await toOwner(env, s, 'owner_inquiry', T.ownerInquiry(shopInfo(env, s), kind, fields, `${env.SITE_URL}/admin/#/wholesale`));
  } catch { /* an inquiry is saved even if its email is not */ }
}

/** The owner's morning email about yesterday (Bangladesh time), from the 00:05 cron. */
export async function dailySummary(env: Env, attention: string[], now = new Date()): Promise<void> {
  const s = await loadSettings(env.DB);
  if (!on(s, 'email_owner_daily')) return;
  const day = new Date(now.getTime() + 6 * 3_600_000 - 86_400_000).toISOString().slice(0, 10);
  // The Bangladesh day (UTC+6) as UTC instants.
  const start = new Date(Date.parse(`${day}T00:00:00+06:00`)).toISOString();
  const end = new Date(Date.parse(`${day}T00:00:00+06:00`) + 86_400_000).toISOString();
  const n = await dailyNumbers(env.DB, start, end);
  await toOwner(env, s, 'owner_daily', T.ownerDaily(shopInfo(env, s), day, n, attention, `${env.SITE_URL}/admin/`), { dedupeKey: `daily:${day}` });
}

/** One-tap unsubscribe links in offer emails: signed with the Worker's signing key, so they can't be guessed. */
export async function unsubscribeToken(env: Env, customerId: number): Promise<string> {
  return (await hmac(signingKey(env), `unsubscribe:${customerId}`)).slice(0, 32);
}
export async function checkUnsubscribe(env: Env, customerId: number, token: string): Promise<boolean> {
  return timingSafeEqual(await unsubscribeToken(env, customerId), token);
}

export async function queueOffers(env: Env, audience: Array<{ id: number; email: string }>, m: { subject: string; message: string; ctaText: string; ctaHref: string }): Promise<number> {
  const s = await loadSettings(env.DB);
  const shop = shopInfo(env, s);
  const batch = Date.now().toString(36);
  for (const c of audience) {
    const url = `${env.SITE_URL}/email/unsubscribe?c=${c.id}&t=${await unsubscribeToken(env, c.id)}`;
    await toCustomer(env, s, 'marketing', c.email, T.offerMail(shop, m, url), { dedupeKey: `offer:${batch}:${c.id}` });
  }
  // The owner gets a copy, so they see exactly what customers received.
  await toOwner(env, s, 'marketing', T.offerMail(shop, { ...m, subject: `[Copy] ${m.subject}` }, `${env.SITE_URL}/email/unsubscribe`), { dedupeKey: `offer:${batch}:owner` });
  return audience.length;
}

export async function queueTest(env: Env): Promise<boolean> {
  const s = await loadSettings(env.DB);
  if (!validEmail((s.notify_email || '').trim())) return false;
  await toOwner(env, s, 'test', T.testMail(shopInfo(env, s)));
  return true;
}

/**
 * Sends queued emails through Resend, a few per second (Resend's default rate limit), each with an idempotency key so
 * a retry never sends twice. A rate limit or a Resend outage leaves the rest queued for the next run.
 */
export async function flushEmails(env: Env, limit = 20): Promise<{ sent: number; failed: number }> {
  const out = { sent: 0, failed: 0 };
  const queue = await queuedEmails(env.DB, limit);
  if (!queue.length) return out;
  if (!env.RESEND_API_KEY) {
    for (const e of queue) await markEmail(env.DB, e.id, { status: 'skipped', error: 'Email is not connected yet: add the RESEND_API_KEY secret in GitHub and deploy.' });
    return out;
  }
  const s = await loadSettings(env.DB);
  const from = (s.email_from || DEFAULT_FROM).trim();
  const replyTo = (s.email_reply_to || '').trim();
  for (const [i, e] of queue.entries()) {
    if (i) await new Promise(r => setTimeout(r, 550));
    let res: Response;
    try {
      res = await fetch(RESEND_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json', 'idempotency-key': `absvai-email-${e.id}` },
        body: JSON.stringify({ from, to: [e.to_email], subject: e.subject, html: e.html, text: e.text, ...(validEmail(replyTo) ? { reply_to: replyTo } : {}), tags: [{ name: 'kind', value: e.kind }] }),
      });
    } catch (err) {
      await markEmail(env.DB, e.id, { status: e.attempts >= 4 ? 'failed' : 'queued', error: `Could not reach Resend: ${err instanceof Error ? err.message : err}` });
      break;
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (res.ok) { await markEmail(env.DB, e.id, { status: 'sent', providerId: body.id ?? null }); out.sent++; continue; }
    const error = `Resend ${res.status}: ${body.message ?? body.name ?? 'error'}`.slice(0, 500);
    if (res.status === 429 || res.status >= 500) { await markEmail(env.DB, e.id, { status: e.attempts >= 4 ? 'failed' : 'queued', error }); break; }
    await markEmail(env.DB, e.id, { status: 'failed', error });
    out.failed++;
  }
  return out;
}

/** Old email bodies are dropped after 60 days (the log line stays). */
export const trimOldEmails = (env: Env, now = new Date()) => trimEmailBodies(env.DB, new Date(now.getTime() - 60 * 86_400_000).toISOString());

