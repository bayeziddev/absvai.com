/**
 * Courier booking and tracking for Steadfast and Pathao (more couriers can be added the same way).
 *
 * - Book: staff press "Book with Steadfast / Pathao" on a packed order (or many at once). The courier returns its
 *   consignment and tracking ids; the order moves to In Courier and the customer gets the tracking SMS/email.
 * - Track: each courier calls our webhook when a parcel's status changes, and the cron asks the courier about parcels
 *   it has not heard of for a few hours. Delivered and returned parcels move the order by themselves; other statuses
 *   (picked up, in transit, on hold…) show on the order's timeline.
 *
 * Credentials are saved encrypted in Admin → Couriers. The request and response shapes below follow each courier's
 * merchant API as published with its merchant panel; the courier's own error message is shown to staff when a call
 * fails, and "Test connection" checks the keys before the first booking.
 */
import type { Env } from '../env';
import { hmac, signingKey, timingSafeEqual } from '../lib/crypto';
import { bad, HttpError } from '../lib/http';
import { courierAreaFor, courierProgress, orderByConsignment, ordersToSync, setConsignment, touchCourierUpdate } from '../repo/couriers';
import { orderById, orderByNo, orderItems } from '../repo/orders';
import { getSecret, loadSettings } from '../repo/settings';
import { changeStatus, courierLabel } from './orders';

export const API_COURIERS = ['steadfast', 'pathao'] as const;
export type ApiCourier = (typeof API_COURIERS)[number];
export const isApiCourier = (c: string): c is ApiCourier => (API_COURIERS as readonly string[]).includes(c);

export const STEADFAST_DEFAULT_URL = 'https://portal.packzy.com/api/v1';
export const PATHAO_DEFAULT_URL = 'https://api-hermes.pathao.com';

type Json = Record<string, unknown>;

async function call(url: string, init: RequestInit, who: string): Promise<Json> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw new HttpError(502, `Could not reach ${who}. Try again in a minute. (${e instanceof Error ? e.message : e})`);
  }
  const body = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok || (typeof body.status === 'number' && body.status >= 400)) {
    const errors = body.errors && typeof body.errors === 'object' ? Object.values(body.errors as Json).flat().join(' ') : '';
    throw new HttpError(res.status === 401 || res.status === 403 ? 400 : 502, `${who} said: ${String(body.message ?? body.error ?? `error ${res.status}`)}${errors ? ` ${errors}` : ''}`.slice(0, 400));
  }
  return body;
}

// ───────────── Steadfast ─────────────

async function steadfastAuth(env: Env, s: Record<string, string>) {
  const [key, secret] = await Promise.all([getSecret(env, 'steadfast_api_key'), getSecret(env, 'steadfast_secret_key')]);
  if (!key || !secret) throw bad('Add the Steadfast API key and secret key in Couriers first.');
  return { base: (s.steadfast_base_url || STEADFAST_DEFAULT_URL).replace(/\/+$/, ''), headers: { 'Api-Key': key, 'Secret-Key': secret, 'Content-Type': 'application/json', Accept: 'application/json' } };
}

// ───────────── Pathao ─────────────

async function pathaoAuth(env: Env, s: Record<string, string>) {
  const base = (s.pathao_base_url || PATHAO_DEFAULT_URL).replace(/\/+$/, '');
  const cached = await env.KV.get(`pathao:token:${base}`);
  if (cached) return { base, headers: { Authorization: `Bearer ${cached}`, 'Content-Type': 'application/json', Accept: 'application/json' } };
  const [secret, password] = await Promise.all([getSecret(env, 'pathao_client_secret'), getSecret(env, 'pathao_password')]);
  if (!s.pathao_client_id || !secret || !s.pathao_username || !password) throw bad('Add the Pathao client ID, client secret, login email and password in Couriers first.');
  const r = await call(`${base}/aladdin/api/v1/issue-token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: s.pathao_client_id, client_secret: secret, grant_type: 'password', username: s.pathao_username, password }),
  }, 'Pathao');
  const token = String(r.access_token ?? '');
  if (!token) throw new HttpError(502, 'Pathao did not return a login token. Check the client ID, secret, email and password.');
  // Keep the token a little less long than Pathao says it lasts (and at most 30 days).
  const ttl = Math.max(60, Math.min(Number(r.expires_in ?? 3600) - 300, 30 * 86_400));
  await env.KV.put(`pathao:token:${base}`, token, { expirationTtl: ttl });
  return { base, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' } };
}

const list = (r: Json): Json[] => {
  const d = r.data as Json | Json[] | undefined;
  return Array.isArray(d) ? d : Array.isArray((d as Json | undefined)?.data) ? ((d as Json).data as Json[]) : [];
};

/** Pathao's own city / zone / area lists, for the area picker when an upazila is not mapped yet. */
export async function pathaoLookup(env: Env, what: 'cities' | 'zones' | 'areas' | 'stores', parent?: string): Promise<Array<{ id: string; name: string }>> {
  const s = await loadSettings(env.DB);
  const a = await pathaoAuth(env, s);
  const path = what === 'cities' ? '/aladdin/api/v1/city-list' : what === 'zones' ? `/aladdin/api/v1/cities/${encodeURIComponent(parent ?? '')}/zone-list` : what === 'areas' ? `/aladdin/api/v1/zones/${encodeURIComponent(parent ?? '')}/area-list` : '/aladdin/api/v1/stores';
  const rows = list(await call(`${a.base}${path}`, { headers: a.headers }, 'Pathao'));
  const key = { cities: ['city_id', 'city_name'], zones: ['zone_id', 'zone_name'], areas: ['area_id', 'area_name'], stores: ['store_id', 'store_name'] }[what];
  return rows.map(r => ({ id: String(r[key[0]]), name: String(r[key[1]] ?? r[key[0]]) })).filter(r => r.id && r.id !== 'undefined');
}

// ───────────── Booking ─────────────

/** What the courier collects from the customer: the total minus any advance already received. */
function codAmount(o: Json): number {
  const total = Number(o.total_paisa ?? 0);
  const advance = ['verified', 'received', 'paid'].includes(String(o.advance_status)) ? Number(o.advance_amount_paisa ?? 0) : 0;
  return Math.max(0, Math.ceil((total - advance) / 100));
}
const localPhone = (p: unknown) => `0${String(p).slice(3)}`;
const fullAddress = (o: Json) => [o.address_line, o.landmark, o.union_name, o.upazila_name, o.district_name].filter(Boolean).join(', ').slice(0, 250);

/**
 * Books one packed order with a courier, saves the consignment and tracking ids, and moves it to In Courier.
 * Safe to retry: an order already booked with that courier is not booked again.
 */
export async function bookOrder(env: Env, orderId: number, courier: ApiCourier, adminId: string | null): Promise<{ consignmentId: string; trackingId: string }> {
  const o = await orderById(env.DB, orderId);
  if (!o) throw new HttpError(404, 'Order not found.');
  if (o.consignment_id && o.courier === courier) return { consignmentId: String(o.consignment_id), trackingId: String(o.tracking_id ?? o.consignment_id) };
  if (o.status !== 'packed') throw bad(`Pack order ${o.order_no} first: only packed orders can be booked with the courier.`);
  const s = await loadSettings(env.DB);
  const items = await orderItems(env.DB, orderId);
  let consignmentId = '';
  let trackingId = '';
  if (courier === 'steadfast') {
    const a = await steadfastAuth(env, s);
    const r = await call(`${a.base}/create_order`, {
      method: 'POST', headers: a.headers,
      body: JSON.stringify({
        invoice: String(o.order_no), recipient_name: String(o.customer_name).slice(0, 100), recipient_phone: localPhone(o.phone),
        recipient_address: fullAddress(o), cod_amount: codAmount(o), note: [o.customer_note, `${items.length} item(s)`].filter(Boolean).join(' · ').slice(0, 200),
      }),
    }, 'Steadfast');
    const c = (r.consignment ?? {}) as Json;
    consignmentId = String(c.consignment_id ?? '');
    trackingId = String(c.tracking_code ?? consignmentId);
  } else {
    const area = await courierAreaFor(env.DB, 'pathao', Number(o.upazila_id));
    if (!area?.city || !area.zone) throw new HttpError(409, `Choose Pathao's city and zone for ${o.upazila_name}, ${o.district_name} first.`, { needsArea: { upazilaId: Number(o.upazila_id), name: `${o.upazila_name}, ${o.district_name}` } });
    const storeId = Number(s.pathao_store_id);
    if (!storeId) throw bad('Choose your Pathao pickup store in Couriers first.');
    const a = await pathaoAuth(env, s);
    const grams = items.reduce((t, i) => t + Number(i.packed_weight_grams ?? 0) * Number(i.qty), 0);
    const r = await call(`${a.base}/aladdin/api/v1/orders`, {
      method: 'POST', headers: a.headers,
      body: JSON.stringify({
        store_id: storeId, merchant_order_id: String(o.order_no), recipient_name: String(o.customer_name).slice(0, 100), recipient_phone: localPhone(o.phone),
        recipient_address: fullAddress(o), recipient_city: Number(area.city), recipient_zone: Number(area.zone), ...(area.area ? { recipient_area: Number(area.area) } : {}),
        delivery_type: 48, item_type: 2, special_instruction: String(o.customer_note ?? '').slice(0, 200), item_quantity: items.reduce((t, i) => t + Number(i.qty), 0),
        item_weight: Math.min(10, Math.max(0.5, Math.round(grams / 100) / 10)), amount_to_collect: codAmount(o),
        item_description: items.map(i => `${i.name}${i.variant_label ? ` (${i.variant_label})` : ''} x${i.qty}`).join(', ').slice(0, 250),
      }),
    }, 'Pathao');
    const d = (r.data ?? {}) as Json;
    consignmentId = String(d.consignment_id ?? '');
    trackingId = consignmentId;
  }
  if (!consignmentId) throw new HttpError(502, `${courierLabel(courier)} accepted the order but sent no consignment id. Check the courier panel before booking again.`);
  await setConsignment(env.DB, orderId, courier, consignmentId, trackingId);
  await changeStatus(env, orderId, 'in_courier', { actor: adminId ? 'staff' : 'system', adminId, courier, trackingId, note: `Booked with ${courierLabel(courier)}` });
  return { consignmentId, trackingId };
}

/** Checks the saved keys: Steadfast's balance, or Pathao's login and pickup stores. */
export async function testCourier(env: Env, courier: ApiCourier): Promise<{ ok: true; message: string; stores?: Array<{ id: string; name: string }> }> {
  const s = await loadSettings(env.DB);
  if (courier === 'steadfast') {
    const a = await steadfastAuth(env, s);
    const r = await call(`${a.base}/get_balance`, { headers: a.headers }, 'Steadfast');
    return { ok: true, message: `Connected to Steadfast. Balance: ৳${Number(r.current_balance ?? 0).toLocaleString('en-US')}.` };
  }
  const stores = await pathaoLookup(env, 'stores');
  return { ok: true, message: `Connected to Pathao. ${stores.length} pickup store(s) found.`, stores };
}

// ───────────── Status updates (webhooks and the cron) ─────────────

export interface CourierOutcome { to?: 'delivered' | 'returned'; sub?: string | null }

/** What a courier status means for our order. Unknown statuses just go on the timeline. */
export function courierOutcome(raw: string): CourierOutcome {
  const s = raw.toLowerCase().replace(/[._-]+/g, ' ').trim();
  if (/approval pending/.test(s)) return { sub: 'awaiting_approval' };
  if (/partial/.test(s)) return { sub: 'awaiting_approval' };
  if (/pickup (cancel|fail)/.test(s)) return { sub: 'on_hold' };
  if (/deliver/.test(s) && /fail|attempt/.test(s)) return { sub: 'on_hold' };
  if (/out for delivery|assigned for delivery|on the way/.test(s)) return { sub: 'out_for_delivery' };
  if (/\bdelivered\b|^order delivered|^delivery$/.test(s)) return { to: 'delivered' };
  if (/return|cancel/.test(s)) return { to: 'returned' };
  if (/hold/.test(s)) return { sub: 'on_hold' };
  if (/picked|pickup/.test(s)) return { sub: 'picked_up' };
  if (/transit|hub|sorting|received at/.test(s)) return { sub: 'in_transit' };
  return { sub: null };
}

/** Applies a courier status to an order; never moves an order backwards, and repeats of the same news do nothing. */
export async function applyCourierStatus(env: Env, order: Json, courier: string, raw: string): Promise<'moved' | 'noted' | 'ignored'> {
  const id = Number(order.id);
  const out = courierOutcome(raw);
  const label = `${courierLabel(courier)}: ${raw}`;
  if (order.status !== 'in_courier') { await touchCourierUpdate(env.DB, id); return 'ignored'; }
  if (out.to === 'delivered') { await changeStatus(env, id, 'delivered', { actor: 'courier', adminId: null, note: label }); return 'moved'; }
  if (out.to === 'returned') { await changeStatus(env, id, 'returned', { actor: 'courier', adminId: null, returnReason: 'other', note: `${label} (the parcel is coming back; scan it in when it arrives)` }); return 'moved'; }
  if (out.sub === order.sub_status && out.sub) { await touchCourierUpdate(env.DB, id); return 'ignored'; }
  await courierProgress(env.DB, id, out.sub ?? null, label);
  return 'noted';
}

/** The secret part of each courier's webhook address (derived from the Worker's signing key, never stored). */
export async function webhookToken(env: Env, courier: ApiCourier): Promise<string> {
  return (await hmac(signingKey(env), `courier-webhook:${courier}`)).slice(0, 40);
}
export async function checkWebhookToken(env: Env, courier: ApiCourier, given: string): Promise<boolean> {
  return Boolean(given) && timingSafeEqual(await webhookToken(env, courier), given);
}

export async function findCourierOrder(env: Env, courier: ApiCourier, consignmentId: unknown, orderNo: unknown): Promise<Json | null> {
  if (consignmentId != null && String(consignmentId)) {
    const o = await orderByConsignment(env.DB, courier, String(consignmentId));
    if (o) return o;
  }
  return orderNo ? orderByNo(env.DB, String(orderNo)) : null;
}

/** The cron's fallback: asks the courier about parcels it has not told us about for 3 hours. */
export async function syncCourierStatuses(env: Env, now = new Date()): Promise<number> {
  const due = await ordersToSync(env.DB, new Date(now.getTime() - 3 * 3_600_000).toISOString(), 15);
  if (!due.length) return 0;
  const s = await loadSettings(env.DB);
  let changed = 0;
  for (const d of due) {
    try {
      let raw = '';
      if (d.courier === 'steadfast') {
        const a = await steadfastAuth(env, s);
        raw = String((await call(`${a.base}/status_by_cid/${encodeURIComponent(d.consignment_id)}`, { headers: a.headers }, 'Steadfast')).delivery_status ?? '');
      } else {
        const a = await pathaoAuth(env, s);
        raw = String(((await call(`${a.base}/aladdin/api/v1/orders/${encodeURIComponent(d.consignment_id)}/info`, { headers: a.headers }, 'Pathao')).data as Json | undefined)?.order_status ?? '');
      }
      const order = await orderById(env.DB, d.id);
      if (raw && order && (await applyCourierStatus(env, order, d.courier, raw)) === 'moved') changed++;
      else await touchCourierUpdate(env.DB, d.id);
    } catch (e) {
      console.warn(`courier sync ${d.order_no}`, e instanceof Error ? e.message : e);
      await touchCourierUpdate(env.DB, d.id);
    }
  }
  return changed;
}
