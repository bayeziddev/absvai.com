/**
 * SMS/WhatsApp notices in English (GSM-7: 160 characters per segment instead of 70 for Unicode).
 * Without a configured provider, messages are written to sms_outbox with status "logged" so staff can see them.
 */
import type { Env } from '../env';

export function toGsm7(text: string): string {
  return text.replace(/৳/g, 'Tk').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/·/g, '-').replace(/…/g, '...').replace(/[^\x20-\x7E\n]/g, '');
}

export function segments(text: string): number {
  return text.length <= 160 ? 1 : Math.ceil(text.length / 153);
}

export async function sendSms(env: Env, msg: { to: string; body: string; kind: string; orderId?: number | null }): Promise<void> {
  const body = toGsm7(msg.body);
  const status = env.SMS_PROVIDER && env.SMS_API_KEY ? 'queued' : 'logged';
  await env.DB.prepare('INSERT INTO sms_outbox (to_phone, body, kind, status, order_id) VALUES (?, ?, ?, ?, ?)')
    .bind(msg.to, body, msg.kind, status, msg.orderId ?? null).run();
  // Phase 2: a queue consumer delivers "queued" rows through the chosen Bangladeshi SMS gateway.
}

export const SMS = {
  orderReceived: (orderNo: string, total: string) => `Abs Vai: We got your order ${orderNo} (${total}). We will call or text you to confirm. Thank you!`,
  otp: (code: string, orderNo: string) => `Abs Vai: Your code for order ${orderNo} is ${code}. It expires in 15 minutes. Do not share it.`,
  confirmed: (orderNo: string, invoiceNo: string) => `Abs Vai: Order ${orderNo} is confirmed. Invoice ${invoiceNo}. We will text you when it ships.`,
  shipped: (orderNo: string, courier: string, tracking: string) => `Abs Vai: Order ${orderNo} has shipped with ${courier}. Tracking: ${tracking}`,
  delivered: (orderNo: string) => `Abs Vai: Order ${orderNo} was delivered. Thank you for shopping with us!`,
  backInSeason: (product: string, url: string) => `Abs Vai: ${product} is back in season! Order now: ${url}`,
};
