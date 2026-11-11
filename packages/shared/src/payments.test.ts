import { describe, expect, it } from 'vitest';
import {
  canTransitionPayment,
  isPaymentOpen,
  PAYMENT_STATUSES,
  type PaymentStatus,
} from './payments.ts';
import { canTransitionOrder } from './orders.ts';

describe('payment state machine (separate from the order one)', () => {
  it('follows the happy path', () => {
    const path: PaymentStatus[] = [
      'initiated',
      'pending',
      'verified',
      'settlement_eligible',
      'settled',
    ];
    for (let i = 1; i < path.length; i++) {
      expect(canTransitionPayment(path[i - 1]!, path[i]!), path[i]).toBe(true);
    }
  });

  it('only provider evidence verifies: a pending or expired payment can become verified', () => {
    expect(canTransitionPayment('pending', 'verified')).toBe(true);
    // Captured after we gave up (late bank): money is real, so it must still be recorded.
    expect(canTransitionPayment('expired', 'verified')).toBe(true);
    expect(canTransitionPayment('failed', 'verified')).toBe(true);
    expect(canTransitionPayment('initiated', 'verified')).toBe(false);
  });

  it('a verified payment never fails or expires; it can only move on or be refunded', () => {
    expect(canTransitionPayment('verified', 'failed')).toBe(false);
    expect(canTransitionPayment('verified', 'expired')).toBe(false);
    expect(canTransitionPayment('verified', 'pending')).toBe(false);
    expect(canTransitionPayment('verified', 'refund_pending')).toBe(true);
    expect(canTransitionPayment('verified', 'disputed')).toBe(true);
    expect(canTransitionPayment('refund_pending', 'refunded')).toBe(true);
  });

  it('nothing comes back from refunded or reversed', () => {
    for (const to of PAYMENT_STATUSES) {
      expect(canTransitionPayment('refunded', to)).toBe(false);
      expect(canTransitionPayment('reversed', to)).toBe(false);
    }
  });

  it('knows which payments are still open for an order', () => {
    expect(isPaymentOpen('initiated')).toBe(true);
    expect(isPaymentOpen('pending')).toBe(true);
    expect(isPaymentOpen('verified')).toBe(true);
    expect(isPaymentOpen('expired')).toBe(false);
    expect(isPaymentOpen('failed')).toBe(false);
  });

  it('a late payment can place an expired order (system only)', () => {
    expect(canTransitionOrder('expired', 'placed', 'system')).toBe(true);
    expect(canTransitionOrder('expired', 'placed', 'buyer')).toBe(false);
  });
});
