import { readFileSync } from 'node:fs';
import { createHmac, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type {
  RazorpayClient,
  RazorpayOrder,
  RazorpayPayment,
} from '../../src/modules/payments/razorpay.client.js';

const id = (prefix: string) => `${prefix}_${randomBytes(7).toString('hex')}`;

/** Stands in for Razorpay in tests: nothing ever leaves the machine. */
export class FakeRazorpay implements RazorpayClient {
  orders = new Map<string, RazorpayOrder>();
  payments = new Map<string, RazorpayPayment[]>();
  createOrderCalls = 0;

  async createOrder(input: {
    amountPaise: number;
    receipt: string;
    notes: Record<string, string>;
  }) {
    this.createOrderCalls += 1;
    const order: RazorpayOrder = {
      id: id('order'),
      amount: input.amountPaise,
      currency: 'INR',
      receipt: input.receipt,
      status: 'created',
      notes: input.notes,
    };
    this.orders.set(order.id, order);
    return order;
  }

  async fetchOrderPayments(orderId: string) {
    return this.payments.get(orderId) ?? [];
  }

  /** The buyer pays in the Razorpay sheet: a payment attempt on the order. */
  attempt(orderId: string, status: RazorpayPayment['status'], amount?: number): RazorpayPayment {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`No fake order ${orderId}`);
    const payment: RazorpayPayment = {
      id: id('pay'),
      order_id: orderId,
      amount: amount ?? order.amount,
      currency: 'INR',
      status,
      created_at: Math.floor(Date.now() / 1000),
    };
    this.payments.set(orderId, [...(this.payments.get(orderId) ?? []), payment]);
    return payment;
  }
}

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'razorpay');

/** A webhook body built from a fixture, as the exact string Razorpay would send. */
export function webhookBody(
  event: 'payment.captured' | 'payment.failed' | 'order.paid',
  p: { orderId: string; paymentId: string; amount: number; xatuOrderId: string },
): string {
  return readFileSync(join(FIXTURES, `${event}.json`), 'utf8')
    .replaceAll('"__AMOUNT__"', String(p.amount))
    .replaceAll('"__CREATED_AT__"', String(Math.floor(Date.now() / 1000)))
    .replaceAll('__ORDER_ID__', p.orderId)
    .replaceAll('__PAYMENT_ID__', p.paymentId)
    .replaceAll('__XATU_ORDER_ID__', p.xatuOrderId);
}

export function sign(body: string, secret = 'fake-webhook-secret-for-tests'): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}
