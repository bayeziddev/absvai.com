/** Sends (queues) an English GSM-7 SMS. Without a provider the message is logged so staff can see it in Admin → SMS outbox. */
import type { Env } from '../env';
import { localPhone } from '../lib/phone';
import { toGsm7 } from '../lib/sms';
import { queueSms } from '../repo/sms';

/** True once an SMS gateway is connected (the SMS_PROVIDER and SMS_API_KEY secrets). */
export const smsConnected = (env: Env) => Boolean(env.SMS_PROVIDER && env.SMS_API_KEY);

/**
 * The SMS code on Cash on Delivery orders: only when the owner turns it on in Settings AND an SMS gateway is connected.
 * Until then customers are not asked for a code that could never arrive; the team calls them to confirm instead.
 */
export const otpActive = (env: Env, settings: Record<string, string>) => settings.otp_enabled === '1' && smsConnected(env);

export async function sendSms(env: Env, msg: { to: string; body: string; kind: string; orderId?: number | null }): Promise<void> {
  await queueSms(env.DB, {
    to: localPhone(msg.to), body: toGsm7(msg.body), kind: msg.kind,
    status: smsConnected(env) ? 'queued' : 'logged', orderId: msg.orderId ?? null,
  });
  // Phase 2: the SMS queue consumer delivers "queued" rows through the chosen Bangladeshi gateway, within quiet hours.
}
