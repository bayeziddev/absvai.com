/**
 * Courier webhooks: the couriers call these when a parcel's status changes. Each address carries a secret token
 * (shown in Admin → Couriers), checked in constant time; Steadfast also sends it as "Authorization: Bearer …".
 * Unknown parcels and repeated news are acknowledged without changing anything, so the courier stops retrying.
 */
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../env';
import { clientIp, HttpError, rateLimit } from '../lib/http';
import { loadSettings } from '../repo/settings';
import { applyCourierStatus, checkWebhookToken, findCourierOrder } from '../services/couriers';

export const webhooks = new Hono<AppEnv>();

webhooks.use('*', async (c, next) => {
  if (!(await rateLimit(c.env.KV, `wh:${clientIp(c)}`, 600, 60))) throw new HttpError(429, 'Too many requests.');
  await next();
});

async function body(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  try { const b = await c.req.json(); return b && typeof b === 'object' ? (b as Record<string, unknown>) : {}; } catch { return {}; }
}

async function steadfast(c: Context<AppEnv>, token: string) {
  if (!(await checkWebhookToken(c.env, 'steadfast', token))) return c.json({ status: 'error', message: 'Unauthorized' }, 401);
  const b = await body(c);
  const order = await findCourierOrder(c.env, 'steadfast', b.consignment_id, b.invoice);
  const raw = String(b.status ?? b.delivery_status ?? b.tracking_message ?? '').trim();
  if (!order || !raw) return c.json({ status: 'success', message: order ? 'Nothing to update.' : 'Unknown parcel.' });
  const r = await applyCourierStatus(c.env, order, 'steadfast', raw);
  return c.json({ status: 'success', result: r });
}

webhooks.post('/steadfast', c => steadfast(c, (c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()));
webhooks.post('/steadfast/:token', c => steadfast(c, c.req.param('token')));

webhooks.post('/pathao/:token', async c => {
  if (!(await checkWebhookToken(c.env, 'pathao', c.req.param('token')))) return c.json({ status: 'error', message: 'Unauthorized' }, 401);
  // When the webhook is added in Pathao's panel, Pathao checks this header on our reply (the value is on their page).
  const handshake = (await loadSettings(c.env.DB)).pathao_webhook_integration_secret;
  if (handshake) c.header('X-Pathao-Merchant-Webhook-Integration-Secret', handshake);
  const b = await body(c);
  const raw = String(b.event ?? b.order_status ?? b.status ?? '').trim();
  if (/integration/i.test(raw) || (!b.consignment_id && !b.merchant_order_id)) return c.json({ status: 'success' }, 202);
  const order = await findCourierOrder(c.env, 'pathao', b.consignment_id, b.merchant_order_id);
  if (!order || !raw) return c.json({ status: 'success', message: order ? 'Nothing to update.' : 'Unknown parcel.' }, 202);
  const r = await applyCourierStatus(c.env, order, 'pathao', raw);
  return c.json({ status: 'success', result: r }, 202);
});
