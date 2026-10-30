/**
 * The eight-stage order pipeline (Section 9.1). Every transition goes through canTransition(); anything else is
 * rejected and logged. Stock rules live with the stages:
 *   New → Confirmed      reserves stock (fails if not enough is on hand)
 *   Confirmed/Packed → Cancelled   releases the reservation
 *   Packed → In Courier  takes the stock out of the warehouse
 *   Returned / Partial Delivered   stock comes back only when the warehouse scans the parcel as received
 */
export type OrderStatus = 'new' | 'confirmed' | 'packed' | 'in_courier' | 'delivered' | 'partial_delivered' | 'cancelled' | 'returned';
export type Actor = 'staff' | 'customer' | 'courier' | 'system';

export const STAGES: OrderStatus[] = ['new', 'confirmed', 'packed', 'in_courier', 'delivered', 'partial_delivered', 'cancelled', 'returned'];

export const STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'New',
  confirmed: 'Confirmed',
  packed: 'Packed',
  in_courier: 'In Courier',
  delivered: 'Delivered',
  partial_delivered: 'Partial Delivered',
  cancelled: 'Cancelled',
  returned: 'Returned',
};

export const STAGE_MEANING: Record<OrderStatus, string> = {
  new: 'Placed, not yet confirmed.',
  confirmed: 'Verified by SMS code or a logged call. Stock reserved.',
  packed: 'Ready to ship, invoice and label printed.',
  in_courier: 'Handed to the courier.',
  delivered: 'Delivered and cash collected.',
  partial_delivered: 'The customer kept some items; the rest come back.',
  cancelled: 'Cancelled before handover to the courier.',
  returned: 'Came back. Stock returns when the warehouse scans it.',
};

export const SUB_STATUSES: Partial<Record<OrderStatus, Record<string, string>>> = {
  new: { call_attempted: 'Call attempted', call_back: 'Call back later' },
  in_courier: { picked_up: 'Picked up', in_transit: 'In transit', out_for_delivery: 'Out for delivery', on_hold: 'On hold', awaiting_approval: 'Awaiting courier approval' },
  returned: { in_transit_back: 'On the way back', received: 'Received at warehouse' },
  partial_delivered: { in_transit_back: 'Returned items on the way back', received: 'Returned items received' },
};

export const RETURN_REASONS: Record<string, string> = {
  refused: 'Refused at delivery',
  unreachable: 'Customer unreachable',
  wrong_address: 'Wrong address',
  damaged: 'Damaged',
  other: 'Other',
};

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  new: ['confirmed', 'cancelled'],
  confirmed: ['packed', 'cancelled'],
  packed: ['in_courier', 'cancelled'],
  in_courier: ['delivered', 'partial_delivered', 'returned'],
  delivered: ['returned'],
  partial_delivered: [],
  cancelled: [],
  returned: [],
};

export function isOrderStatus(s: unknown): s is OrderStatus {
  return typeof s === 'string' && (STAGES as string[]).includes(s);
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function nextStatuses(from: OrderStatus): OrderStatus[] {
  return TRANSITIONS[from] ?? [];
}

/** Stages whose reservation must be released on cancel. */
export const RESERVED_STAGES: OrderStatus[] = ['confirmed', 'packed'];
/** Terminal stages where the parcel physically comes back to the warehouse. */
export const RETURNING_STAGES: OrderStatus[] = ['returned', 'partial_delivered'];
/** Orders still being worked on (used by the time-interval fraud rule and the dashboard). */
export const OPEN_STAGES: OrderStatus[] = ['new', 'confirmed', 'packed', 'in_courier'];

export interface ConfirmGuardInput {
  paymentMethod: string;
  otpVerifiedAt: string | null;
  hasConfirmedCall: boolean;
  advanceRequired: boolean;
  advanceStatus: string;
  deliveryChargeStatus: 'final' | 'to_confirm';
  holdReason?: string | null;
}

/** A COD order cannot be confirmed without OTP or a logged confirmation call; advances must be paid; holds released. */
export function confirmBlockers(i: ConfirmGuardInput): string[] {
  const blockers: string[] = [];
  if (i.holdReason) blockers.push(`This order is on hold: ${i.holdReason} Review it and release the hold first.`);
  if (i.paymentMethod === 'cod' && !i.otpVerifiedAt && !i.hasConfirmedCall) {
    blockers.push('Verify the customer: they enter the SMS code, or you log a confirmation call with outcome "Confirmed".');
  }
  if (i.advanceRequired && i.advanceStatus !== 'paid') blockers.push('The advance payment has not been verified yet.');
  if (i.deliveryChargeStatus === 'to_confirm') blockers.push('Set the delivery charge for the large item first.');
  return blockers;
}

/** Partial delivery: validates which items come back. At least one item kept and at least one returned. */
export function validatePartialReturn(items: Array<{ id: number; qty: number }>, returned: Record<string, number>): string | null {
  let kept = 0;
  let back = 0;
  for (const it of items) {
    const r = Number(returned[String(it.id)] ?? 0);
    if (!Number.isInteger(r) || r < 0 || r > it.qty) return 'Returned quantities must be between 0 and the quantity ordered.';
    back += r;
    kept += it.qty - r;
  }
  if (back === 0) return 'Choose the items that are coming back.';
  if (kept === 0) return 'Nothing was kept: mark the order Returned instead.';
  return null;
}
