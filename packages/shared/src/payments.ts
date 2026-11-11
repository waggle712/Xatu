import { z } from 'zod';

/** Payment lifecycle (CLAUDE.md). Separate from the order lifecycle. */
export const PAYMENT_STATUSES = [
  'initiated',
  'pending',
  'verified',
  'settlement_eligible',
  'settled',
  'failed',
  'expired',
  'refund_pending',
  'refunded',
  'disputed',
  'reversed',
] as const;
export const paymentStatusSchema = z.enum(PAYMENT_STATUSES);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

/**
 * Allowed moves. `verified` is reached ONLY from provider evidence (a signature-checked webhook
 * or a server-side fetch), never from the app. A capture that arrives after we marked the payment
 * failed or expired is still real money, so those can still become verified (then refunded if the
 * order can't be fulfilled).
 */
const T: Partial<Record<PaymentStatus, PaymentStatus[]>> = {
  initiated: ['pending', 'failed', 'expired'],
  pending: ['verified', 'failed', 'expired'],
  failed: ['verified'],
  expired: ['verified'],
  verified: ['settlement_eligible', 'refund_pending', 'disputed'],
  settlement_eligible: ['settled', 'refund_pending', 'disputed'],
  settled: ['refund_pending', 'disputed', 'reversed'],
  disputed: ['refund_pending', 'reversed', 'settlement_eligible'],
  refund_pending: ['refunded'],
};

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return T[from]?.includes(to) ?? false;
}

/** A payment that still counts for its order (only one may be open at a time). */
export function isPaymentOpen(s: PaymentStatus): boolean {
  return s === 'initiated' || s === 'pending' || s === 'verified';
}

/** What the app gets to open Razorpay Checkout. Only the public key id; never the secret. */
export const startPaymentSchema = z.object({
  paymentId: z.string().uuid(),
  provider: z.literal('razorpay'),
  keyId: z.string(),
  providerOrderId: z.string(),
  amountPaise: z.number().int().positive(),
  currency: z.literal('INR'),
  orderCode: z.string(),
});
export type StartPayment = z.infer<typeof startPaymentSchema>;

export const paymentViewSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  status: paymentStatusSchema,
  amountPaise: z.number().int(),
});
export type PaymentView = z.infer<typeof paymentViewSchema>;
