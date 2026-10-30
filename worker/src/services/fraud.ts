/**
 * Baseline fraud and bot protection (Section 11, Phase 1): phone/device/IP block list, the time-interval and velocity
 * holds, OTP caps counted in D1, and the Blocked Attempts log. Signals hold an order for review; nothing auto-cancels.
 */
import type { Env } from '../env';
import { saltedHash } from '../lib/crypto';
import { HttpError } from '../lib/http';
import { maskPhone } from '../lib/phone';
import { writeAudit } from '../repo/admins';
import { activeBlocks, addBlock, logAttempt, logOtp, otpCounts, type Attempt, type BlockType } from '../repo/fraud';
import { settingInt } from '../repo/settings';

export interface Identity { deviceHash: string | null; ipHash: string | null }

export async function identity(env: Env, deviceId: string | null, ip: string): Promise<Identity> {
  return {
    deviceHash: deviceId && /^[a-f0-9]{32}$/.test(deviceId) ? await saltedHash(env, 'device', deviceId) : null,
    ipHash: ip ? await saltedHash(env, 'ip', ip) : null,
  };
}

export const phoneHash = (env: Env, phone: string) => saltedHash(env, 'phone', phone);

export async function recordAttempt(env: Env, a: Attempt): Promise<void> {
  await logAttempt(env.DB, a);
}

/**
 * Checks the block list for a phone, device and IP. A block is recorded in Blocked Attempts and returned so the
 * caller can choose the message: customers get a generic one, staff see the reason.
 */
export async function findBlock(env: Env, a: { phone: string | null; id: Identity; route: string; now?: Date }): Promise<{ type: BlockType; reason: string; id: number } | null> {
  const ph = a.phone ? await phoneHash(env, a.phone) : null;
  const blocks = await activeBlocks(env.DB, [{ type: 'phone', hash: ph }, { type: 'device', hash: a.id.deviceHash }, { type: 'ip', hash: a.id.ipHash }], (a.now ?? new Date()).toISOString());
  if (!blocks.length) return null;
  const order: BlockType[] = ['phone', 'device', 'ip'];
  const b = [...blocks].sort((x, y) => order.indexOf(x.type as BlockType) - order.indexOf(y.type as BlockType))[0];
  const type = b.type as BlockType;
  await logAttempt(env.DB, {
    layer: type, action: type === 'ip' ? 'rate_limited' : 'blocked', route: a.route, reason: `On the block list: ${String(b.reason)}`,
    phoneHint: a.phone ? maskPhone(a.phone) : null, phoneHash: ph, deviceHash: a.id.deviceHash, ipHash: a.id.ipHash, blockId: Number(b.id),
  });
  return { type, reason: String(b.reason), id: Number(b.id) };
}

/** Customer-facing refusal: the same wording whatever the reason, so the block list can't be probed. */
export function blockedError(type: BlockType, supportPhone: string): HttpError {
  if (type === 'ip') return new HttpError(429, 'Too many requests from this connection. Please wait a little and try again, or call us.');
  return new HttpError(403, `We couldn't place this order. Please call us${supportPhone ? ` at ${supportPhone}` : ''}.`);
}

export async function blockValue(env: Env, b: { type: BlockType; value: string; hint: string | null; reason: string; expiresAt: string | null; adminId: string; alreadyHashed?: boolean }): Promise<number> {
  const hash = b.alreadyHashed ? b.value : await saltedHash(env, b.type, b.value);
  return addBlock(env.DB, { type: b.type, hash, hint: b.hint, reason: b.reason, expiresAt: b.expiresAt, createdBy: b.adminId });
}

export type OtpDecision = { ok: true } | { ok: false; status: 'capped_phone' | 'capped_device' | 'capped_global'; message: string };

/** OTP caps (Section 11.2): 3 per phone per hour, 5 per device per day, and a store-wide daily cap that alerts the owner. */
export async function otpAllowed(env: Env, settings: Record<string, string>, a: { phone: string; id: Identity; orderId: number | null; route: string; now?: Date }): Promise<OtpDecision> {
  const now = a.now ?? new Date();
  const bdMidnight = new Date(Date.parse(`${new Date(now.getTime() + 6 * 3_600_000).toISOString().slice(0, 10)}T00:00:00+06:00`)).toISOString();
  const counts = await otpCounts(env.DB, {
    phone: a.phone, deviceHash: a.id.deviceHash, hourAgoIso: new Date(now.getTime() - 3_600_000).toISOString(),
    dayAgoIso: new Date(now.getTime() - 86_400_000).toISOString(), bdDayStartIso: bdMidnight,
  });
  let status: 'capped_phone' | 'capped_device' | 'capped_global' | null = null;
  if (counts.phoneHour >= settingInt(settings, 'otp_max_per_phone_hour', 3)) status = 'capped_phone';
  else if (a.id.deviceHash && counts.deviceDay >= settingInt(settings, 'otp_max_per_device_day', 5)) status = 'capped_device';
  else if (counts.globalToday >= settingInt(settings, 'otp_daily_cap', 500)) status = 'capped_global';
  if (!status) return { ok: true };
  await logOtp(env.DB, { phone: a.phone, deviceHash: a.id.deviceHash, ipHash: a.id.ipHash, orderId: a.orderId, status });
  const reason = { capped_phone: 'SMS code limit for this phone this hour', capped_device: 'SMS code limit for this device today', capped_global: 'Store-wide daily SMS code limit reached' }[status];
  await logAttempt(env.DB, { layer: 'otp', action: 'blocked', route: a.route, reason, phoneHint: maskPhone(a.phone), deviceHash: a.id.deviceHash, ipHash: a.id.ipHash, orderId: a.orderId });
  if (status === 'capped_global') {
    // Alert the owner once per day: it shows in the dashboard's "Needs your attention" and the audit log.
    const key = `alert:otp_cap:${bdMidnight.slice(0, 10)}`;
    if (!(await env.KV.get(key))) {
      await env.KV.put(key, '1', { expirationTtl: 2 * 86_400 });
      await writeAudit(env.DB, { adminId: null, action: 'alert.otp_daily_cap', entity: 'settings', entityId: 'otp_daily_cap', detail: JSON.stringify({ sentToday: counts.globalToday }), ip: '' });
    }
  }
  return { ok: false, status, message: 'You have asked for the code too many times. We will call you to confirm instead.' };
}

export async function otpSent(env: Env, a: { phone: string; id: Identity; orderId: number | null }): Promise<void> {
  await logOtp(env.DB, { phone: a.phone, deviceHash: a.id.deviceHash, ipHash: a.id.ipHash, orderId: a.orderId, status: 'sent' });
}

/** Minutes between two ISO timestamps, rounded down. */
export function minutesBetween(fromIso: string, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - Date.parse(fromIso)) / 60_000));
}
