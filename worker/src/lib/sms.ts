/**
 * SMS/WhatsApp notices in English (GSM-7: 160 characters per segment instead of 70 for Unicode).
 * Sending goes through services/sms.ts (sms_outbox); without a provider, messages are logged so staff can see them.
 */

export function toGsm7(text: string): string {
  return text.replace(/৳/g, 'Tk').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/·/g, '-').replace(/…/g, '...').replace(/[^\x20-\x7E\n]/g, '');
}

export function segments(text: string): number {
  return text.length <= 160 ? 1 : Math.ceil(text.length / 153);
}

/** SMS texts without the shop name: sendSms puts the shop's current name in front ("Vandar Mart: …"). */
export const SMS = {
  orderReceived: (orderNo: string, total: string) => `We got your order ${orderNo} (${total}). We will call or text you to confirm. Thank you!`,
  otp: (code: string, orderNo: string) => `Your code for order ${orderNo} is ${code}. It expires in 15 minutes. Do not share it.`,
  confirmed: (orderNo: string, invoiceNo: string) => `Order ${orderNo} is confirmed. Invoice ${invoiceNo}. We will text you when it ships.`,
  shipped: (orderNo: string, courier: string, tracking: string) => `Order ${orderNo} has shipped with ${courier}. Tracking: ${tracking}`,
  ownDelivery: (orderNo: string) => `Order ${orderNo} is on its way with our own delivery team. We will call before we arrive.`,
  delivered: (orderNo: string) => `Order ${orderNo} was delivered. Thank you for shopping with us!`,
  backInSeason: (product: string, url: string) => `${product} is back in season! Order now: ${url}`,
};
