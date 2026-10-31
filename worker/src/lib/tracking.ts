/**
 * What customers read on the tracking page (/track): one plain line per step, in English and Bangla. The rows live in
 * the order_tracking table (migration 0006); the repo layer writes one whenever an order moves, the courier sends news
 * or the shop writes a message for the customer.
 */
import { asciiDigits } from './phone';

export const COURIERS: Record<string, string> = { steadfast: 'Steadfast', pathao: 'Pathao', redx: 'RedX', carrybee: 'Carrybee', own_delivery: 'Own delivery' };
export const courierLabel = (c: string) => COURIERS[c] ?? c;

export interface TrackLine { step: string; title: string; titleBn: string; detail: string | null; courier?: string | null; trackingCode?: string | null; source: 'shop' | 'courier' | 'customer' | 'system' }

const STEPS: Record<string, [string, string]> = {
  new: ['Order placed', 'অর্ডার করা হয়েছে'],
  confirmed: ['Order confirmed', 'অর্ডার নিশ্চিত হয়েছে'],
  packed: ['Packed and ready to ship', 'প্যাক করা হয়েছে, পাঠানোর জন্য প্রস্তুত'],
  in_courier: ['Handed to the courier', 'কুরিয়ারে দেওয়া হয়েছে'],
  delivered: ['Delivered', 'ডেলিভারি হয়েছে'],
  partial_delivered: ['Partly delivered', 'আংশিক ডেলিভারি হয়েছে'],
  cancelled: ['Order cancelled', 'অর্ডার বাতিল হয়েছে'],
  returned: ['Returned to the shop', 'দোকানে ফেরত এসেছে'],
  shop_note: ['Message from the shop', 'দোকানের বার্তা'],
};

/** Courier sub-statuses (services/couriers.ts courierOutcome) in the customer's words. */
const COURIER_NEWS: Record<string, [string, string]> = {
  picked_up: ['Picked up by the courier', 'কুরিয়ার পার্সেল নিয়ে গেছে'],
  in_transit: ['On the way to your area', 'আপনার এলাকার পথে'],
  out_for_delivery: ['Out for delivery', 'ডেলিভারির জন্য বের হয়েছে'],
  on_hold: ['Delivery on hold: the courier will call you', 'ডেলিভারি আটকে আছে: কুরিয়ার আপনাকে কল করবে'],
  awaiting_approval: ['The courier is confirming the delivery', 'কুরিয়ার ডেলিভারি নিশ্চিত করছে'],
};

/** Who moved the order (state-machine Actor) as the customer sees it: staff work is "the shop". */
export const sourceFor = (actor: 'staff' | 'customer' | 'courier' | 'system'): TrackLine['source'] => (actor === 'staff' ? 'shop' : actor);

export const stageLine = (to: string, source: TrackLine['source'], courier?: string | null, trackingCode?: string | null): TrackLine => {
  const [title, titleBn] = STEPS[to] ?? ['Update', 'আপডেট'];
  const withCourier = to === 'in_courier' && courier;
  return {
    step: to, title, titleBn, source,
    detail: withCourier ? `${courierLabel(courier)}${trackingCode ? ` · tracking ${trackingCode}` : ''}` : null,
    courier: withCourier ? courier : null, trackingCode: withCourier ? trackingCode ?? null : null,
  };
};

export const courierLine = (courier: string | null, subStatus: string | null, courierWords: string | null): TrackLine => {
  const [title, titleBn] = (subStatus && COURIER_NEWS[subStatus]) || ['Courier update', 'কুরিয়ারের আপডেট'];
  const who = courier ? courierLabel(courier) : '';
  const words = courierWords?.trim() ? courierWords.trim().slice(0, 200) : '';
  return { step: 'courier_update', title, titleBn, detail: [who, words].filter(Boolean).join(': ') || null, courier, source: courier ? 'courier' : 'shop' };
};

export const shopNoteLine = (text: string): TrackLine => ({ step: 'shop_note', title: STEPS.shop_note[0], titleBn: STEPS.shop_note[1], detail: text, source: 'shop' });

/** The five stages the progress bar shows, and how far an order has come along them. */
export const TRACK_STAGES = [['new', 'Placed', 'অর্ডার'], ['confirmed', 'Confirmed', 'নিশ্চিত'], ['packed', 'Packed', 'প্যাক'], ['in_courier', 'With courier', 'কুরিয়ারে'], ['delivered', 'Delivered', 'ডেলিভারি']] as const;
export function stageIndex(status: string): number {
  if (status === 'partial_delivered') return 4;
  return TRACK_STAGES.findIndex(s => s[0] === status);
}

export const PAYMENT_LABELS: Record<string, string> = { cod: 'Cash on Delivery', manual_mobile: 'Mobile wallet (bKash / Nagad / Rocket)', bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket', card: 'Card' };

/** "Rafiq Hasan" → "Rafiq H.": enough for the customer to recognise their order, not enough to identify a stranger's. */
export function maskName(name: string | null | undefined): string {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  return [parts[0], ...parts.slice(1).map(p => `${[...p][0]}.`)].join(' ');
}


/**
 * What the customer typed in the one tracking box, made into the codes we keep: "av 261030 1" → AV-261030-0001,
 * "261030-0001" → both AV- and PRE- forms (and as typed, for a courier consignment number), and anything else (invoice number, courier tracking code) as typed.
 */
export function orderCodeCandidates(input: string): string[] {
  const s = asciiDigits(String(input)).trim().toUpperCase().replace(/[\s_.]+/g, '').replace(/[–—]/g, '-');
  if (!s || s.length > 40 || !/^[A-Z0-9-]+$/.test(s)) return [];
  const m = s.match(/^(AV|PRE)?-?(\d{6})-?(\d{1,5})$/);
  if (m) {
    const tail = m[3].padStart(4, '0');
    return m[1] ? [`${m[1]}-${m[2]}-${tail}`] : [`AV-${m[2]}-${tail}`, `PRE-${m[2]}-${tail}`, s];
  }
  return [s];
}
