/**
 * Order pipeline: Pending → Confirmation Attempted → Confirmed → Packed → Shipped → Delivered,
 * with Cancelled, Refused at Delivery and Returned as distinct outcomes.
 */
export type OrderStatus = 'pending' | 'confirmation_attempted' | 'confirmed' | 'packed' | 'shipped' | 'delivered' | 'cancelled' | 'refused_at_delivery' | 'returned';

export const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Pending',
  confirmation_attempted: 'Confirmation attempted',
  confirmed: 'Confirmed',
  packed: 'Packed',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refused_at_delivery: 'Refused at delivery',
  returned: 'Returned',
};

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['confirmation_attempted', 'confirmed', 'cancelled'],
  confirmation_attempted: ['confirmation_attempted', 'confirmed', 'cancelled'],
  confirmed: ['packed', 'cancelled'],
  packed: ['shipped', 'cancelled'],
  shipped: ['delivered', 'refused_at_delivery', 'returned'],
  delivered: ['returned'],
  refused_at_delivery: ['returned'],
  cancelled: [],
  returned: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function nextStatuses(from: OrderStatus): OrderStatus[] {
  return TRANSITIONS[from] ?? [];
}

export interface ConfirmGuardInput {
  paymentMethod: string;
  otpVerifiedAt: string | null;
  hasConfirmedCall: boolean;
  advanceRequired: boolean;
  advanceStatus: string;
  deliveryChargeStatus: 'final' | 'to_confirm';
}

/** A COD order cannot be confirmed without OTP or a logged confirmation call; advances must be paid first. */
export function confirmBlockers(i: ConfirmGuardInput): string[] {
  const blockers: string[] = [];
  if (i.paymentMethod === 'cod' && !i.otpVerifiedAt && !i.hasConfirmedCall) {
    blockers.push('Verify the customer: they enter the SMS code, or you log a confirmation call with outcome "Confirmed".');
  }
  if (i.advanceRequired && i.advanceStatus !== 'paid') blockers.push('The advance payment has not been verified yet.');
  if (i.deliveryChargeStatus === 'to_confirm') blockers.push('Set the delivery charge for the large item first.');
  return blockers;
}
