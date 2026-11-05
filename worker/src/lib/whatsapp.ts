/**
 * WhatsApp messages for the customer, written in Bangla. The admin opens WhatsApp with one of these already typed
 * (wa.me/<number>?text=…), checks it, changes anything and sends it from the shop's own phone. Nothing is sent by
 * itself: the shop always reads the message first.
 *
 * The usual flow: "অর্ডার যাচাই" (we got your order, please check it and reply "হ্যাঁ") before confirming, then
 * "অর্ডার কনফার্ম", "পাঠানো হয়েছে" with the courier's tracking ID, and "ডেলিভারি সম্পন্ন".
 */
import { formatTaka } from './money';
import { courierLabel } from './tracking';

const BN = '০১২৩৪৫৬৭৮৯';
/** Bangla digits for prices, quantities and days. Order numbers, tracking IDs and phone numbers stay in English digits so they can be copied. */
export const bnNum = (s: string | number) => String(s).replace(/\d/g, d => BN[Number(d)]);
export const bnTaka = (paisa: number) => bnNum(formatTaka(paisa));

export type WaKind = 'verify' | 'advance' | 'no_answer' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';

export const WA_LABELS: Record<WaKind, string> = {
  verify: 'অর্ডার যাচাই',
  advance: 'অগ্রিম পেমেন্ট',
  no_answer: 'ফোনে পাইনি',
  confirmed: 'অর্ডার কনফার্ম',
  shipped: 'পাঠানো হয়েছে',
  delivered: 'ডেলিভারি সম্পন্ন',
  cancelled: 'অর্ডার বাতিল',
};

export interface WaOrder {
  orderNo: string;
  status: string;
  name: string;
  /** Local form, 01XXXXXXXXX. */
  phone: string;
  address: string;
  areaName: string | null;
  etaText: string | null;
  items: Array<{ name: string; variantLabel: string | null; qty: number; lineTotalPaisa: number }>;
  subtotalPaisa: number;
  deliveryChargePaisa: number | null;
  deliveryStatus: string;
  discountPaisa: number;
  codFeePaisa: number;
  totalPaisa: number;
  paymentMethod: string;
  advance: { required: boolean; amountPaisa: number | null; status: string };
  courier: string | null;
  trackingId: string | null;
  note: string | null;
}

export interface WaShop {
  store: string;
  /** https://vandarmart.com */
  site: string;
  supportPhone: string | null;
  wallets: Array<{ wallet: string; number: string; type?: string }>;
  /** The customer's own order page (with its access key), where the invoice downloads. */
  orderUrl: string;
}

export interface WaDraft { kind: WaKind; label: string; text: string; suggested: boolean }

/** The greeting uses the first name: "আসসালামু আলাইকুম Rahim". */
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name.trim();

/** What the customer still pays the delivery man: the total less any advance already received. */
export function cashToCollect(o: WaOrder): number {
  const paid = o.advance.status === 'paid' ? o.advance.amountPaisa ?? 0 : 0;
  return Math.max(0, o.totalPaisa - paid);
}

const deliveryText = (o: WaOrder) =>
  o.deliveryStatus === 'to_confirm' || o.deliveryChargePaisa === null ? 'ফোনে জানানো হবে' : o.deliveryChargePaisa === 0 ? 'ফ্রি 🎉' : bnTaka(o.deliveryChargePaisa);

const paymentText = (o: WaOrder) => (o.paymentMethod === 'cod' ? 'ক্যাশ অন ডেলিভারি (পণ্য হাতে পেয়ে টাকা দিন)' : 'বিকাশ / নগদ / রকেট');

/** The order itself, the same in every message that lists it. */
export function orderSummary(o: WaOrder): string {
  const lines = [
    `🧾 *অর্ডার নং:* ${o.orderNo}`,
    '',
    '🛍️ *পণ্য:*',
    ...o.items.map(i => `• ${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ''} × ${bnNum(i.qty)} = ${bnTaka(i.lineTotalPaisa)}`),
    '',
    `🚚 *ডেলিভারি চার্জ*${o.areaName ? ` (${o.areaName})` : ''}: ${deliveryText(o)}`,
  ];
  if (o.discountPaisa > 0) lines.push(`🎁 *ছাড়:* −${bnTaka(o.discountPaisa)}`);
  if (o.codFeePaisa > 0) lines.push(`💳 *ক্যাশ অন ডেলিভারি ফি:* ${bnTaka(o.codFeePaisa)}`);
  lines.push(`💰 *সর্বমোট: ${bnTaka(o.totalPaisa)}*`);
  if (o.advance.status === 'paid' && o.advance.amountPaisa) lines.push(`✅ অগ্রিম পেয়েছি: ${bnTaka(o.advance.amountPaisa)} · বাকি: ${bnTaka(cashToCollect(o))}`);
  lines.push(`💵 *পেমেন্ট:* ${paymentText(o)}`, '', `👤 *নাম:* ${o.name}`, `📞 *মোবাইল:* ${o.phone}`, `📍 *ঠিকানা:* ${o.address}`);
  if (o.note) lines.push(`📝 *নোট:* ${o.note}`);
  return lines.join('\n');
}

const sign = (s: WaShop) => `ধন্যবাদ,\n*${s.store}*`;

const TEXT: Record<WaKind, (o: WaOrder, s: WaShop) => string> = {
  verify: (o, s) => [
    `আসসালামু আলাইকুম ${firstName(o.name)} 🌿`,
    '',
    `*${s.store}*-এ অর্ডার করার জন্য অনেক ধন্যবাদ! আপনার অর্ডারটি আমরা পেয়েছি। পাঠানোর আগে একবার মিলিয়ে নিন:`,
    '',
    orderSummary(o),
    '',
    'সব ঠিক থাকলে *"হ্যাঁ"* লিখে রিপ্লাই দিন, আমরা অর্ডারটি কনফার্ম করে দ্রুত পাঠিয়ে দেব। কিছু বদলাতে চাইলে (পণ্য, পরিমাণ বা ঠিকানা) এখানেই জানান।',
    '',
    sign(s),
  ].join('\n'),

  advance: (o, s) => [
    `আসসালামু আলাইকুম ${firstName(o.name)},`,
    '',
    `আপনার অর্ডার *${o.orderNo}* কনফার্ম করতে *${bnTaka(o.advance.amountPaisa ?? o.deliveryChargePaisa ?? 0)}* অগ্রিম পাঠাতে হবে (সাধারণত শুধু ডেলিভারি চার্জ)।`,
    '',
    ...(s.wallets.length ? s.wallets.map(w => `📲 ${w.wallet}${w.type ? ` (${w.type})` : ''}: ${w.number}`) : ['📲 বিকাশ / নগদ / রকেট নম্বর আমরা এখানে দিয়ে দিচ্ছি।']),
    '',
    'টাকা পাঠিয়ে *ট্রানজেকশন আইডি (TrxID)* এখানে লিখে দিন। বাকি টাকা পণ্য হাতে পেয়ে দেবেন।',
    '',
    sign(s),
  ].join('\n'),

  no_answer: (o, s) => [
    `আসসালামু আলাইকুম ${firstName(o.name)},`,
    '',
    `আপনার অর্ডার *${o.orderNo}* (সর্বমোট ${bnTaka(o.totalPaisa)}) কনফার্ম করার জন্য আমরা আপনাকে ফোন করেছিলাম, কিন্তু পাইনি। 📞`,
    '',
    `অর্ডারটি কনফার্ম করতে এই মেসেজে *"হ্যাঁ"* লিখে রিপ্লাই দিন${s.supportPhone ? `, অথবা আমাদের কল করুন: ${s.supportPhone}` : ''}।`,
    '',
    sign(s),
  ].join('\n'),

  confirmed: (o, s) => [
    `আসসালামু আলাইকুম ${firstName(o.name)} ✅`,
    '',
    `আলহামদুলিল্লাহ! আপনার অর্ডার *${o.orderNo}* কনফার্ম হয়েছে।`,
    '',
    ...o.items.map(i => `• ${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ''} × ${bnNum(i.qty)}`),
    '',
    `💰 *সর্বমোট: ${bnTaka(o.totalPaisa)}*${o.paymentMethod === 'cod' ? ` · ডেলিভারির সময় দেবেন ${bnTaka(cashToCollect(o))}` : ''}`,
    `🚚 ${o.etaText ? `সাধারণত *${bnNum(o.etaText)}*-এর মধ্যে পৌঁছে যাবে ইনশাআল্লাহ।` : 'খুব শিগগির পাঠিয়ে দেব ইনশাআল্লাহ।'}`,
    `📍 ${o.address}`,
    '',
    `অর্ডারের বিস্তারিত ও রসিদ: ${s.orderUrl}`,
    '',
    `${s.store}-এর সাথে থাকার জন্য ধন্যবাদ 🌿`,
  ].join('\n'),

  shipped: (o, s) => {
    const own = o.courier === 'own_delivery';
    return [
      `আসসালামু আলাইকুম ${firstName(o.name)} 📦`,
      '',
      own ? `আপনার অর্ডার *${o.orderNo}* পাঠিয়ে দেওয়া হয়েছে। আমাদের নিজস্ব ডেলিভারিম্যান পৌঁছে দেবেন।` : `আপনার অর্ডার *${o.orderNo}* কুরিয়ারে দেওয়া হয়েছে।`,
      ...(own ? [] : [`🚚 *কুরিয়ার:* ${o.courier ? courierLabel(o.courier) : '—'}`, ...(o.trackingId ? [`🔎 *ট্র্যাকিং আইডি:* ${o.trackingId}`] : [])]),
      `💰 *ডেলিভারির সময় দিতে হবে: ${bnTaka(cashToCollect(o))}*`,
      '',
      'ডেলিভারিম্যান ফোন করলে দয়া করে রিসিভ করবেন। 🙏',
      `অর্ডার কোথায় আছে দেখুন: ${s.site}/track?q=${encodeURIComponent(o.orderNo)}`,
      '',
      sign(s),
    ].join('\n');
  },

  delivered: (o, s) => [
    `আসসালামু আলাইকুম ${firstName(o.name)} 🌿`,
    '',
    `আপনার অর্ডার *${o.orderNo}* পৌঁছে গেছে। *${s.store}*-এ কেনাকাটার জন্য অনেক ধন্যবাদ!`,
    '',
    'পণ্যটি কেমন লাগলো জানালে খুব খুশি হবো। কোনো সমস্যা হলে এখানেই জানান, আমরা দেখে দেব।',
    '',
    `আবার অর্ডার করতে: ${s.site}`,
  ].join('\n'),

  cancelled: (o, s) => [
    `আসসালামু আলাইকুম ${firstName(o.name)},`,
    '',
    `আপনার অর্ডার *${o.orderNo}* বাতিল করা হয়েছে।`,
    'ভুল হয়ে থাকলে বা আবার অর্ডার করতে চাইলে এখানে রিপ্লাই দিন, আমরা নতুন করে করে দেব।',
    '',
    sign(s),
  ].join('\n'),
};

/** Which messages fit the order's stage, and the one the shop most likely wants next (suggested). */
export function draftKinds(o: WaOrder): { kinds: WaKind[]; suggested: WaKind } {
  const advanceDue = o.advance.required && o.advance.status !== 'paid' && ['new', 'confirmed'].includes(o.status);
  switch (o.status) {
    case 'new': return { kinds: ['verify', ...(advanceDue ? ['advance' as const] : []), 'no_answer', 'confirmed'], suggested: advanceDue && o.advance.status === 'pending' ? 'advance' : 'verify' };
    case 'confirmed':
    case 'packed': return { kinds: ['confirmed', 'verify', ...(advanceDue ? ['advance' as const] : [])], suggested: 'confirmed' };
    case 'in_courier': return { kinds: ['shipped', 'confirmed'], suggested: 'shipped' };
    case 'delivered':
    case 'partial_delivered': return { kinds: ['delivered'], suggested: 'delivered' };
    case 'cancelled': return { kinds: ['cancelled'], suggested: 'cancelled' };
    default: return { kinds: ['verify'], suggested: 'verify' };
  }
}

export function whatsappDrafts(o: WaOrder, s: WaShop): WaDraft[] {
  const { kinds, suggested } = draftKinds(o);
  return kinds.map(kind => ({ kind, label: WA_LABELS[kind], text: TEXT[kind](o, s), suggested: kind === suggested }));
}

/** International form for wa.me: 01712345678 → 8801712345678. */
export const waNumber = (localPhone: string) => `88${localPhone.replace(/\D/g, '').replace(/^88/, '')}`;
