/** Sends (queues) an English GSM-7 SMS. Without a provider the message is logged so staff can see it in Admin → SMS outbox. */
import type { Env } from '../env';
import { localPhone } from '../lib/phone';
import { toGsm7 } from '../lib/sms';
import { queueSms } from '../repo/sms';

export async function sendSms(env: Env, msg: { to: string; body: string; kind: string; orderId?: number | null }): Promise<void> {
  await queueSms(env.DB, {
    to: localPhone(msg.to), body: toGsm7(msg.body), kind: msg.kind,
    status: env.SMS_PROVIDER && env.SMS_API_KEY ? 'queued' : 'logged', orderId: msg.orderId ?? null,
  });
  // Phase 2: the SMS queue consumer delivers "queued" rows through the chosen Bangladeshi gateway, within quiet hours.
}
