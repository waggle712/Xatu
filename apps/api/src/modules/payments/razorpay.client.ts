import { Injectable } from '@nestjs/common';
import { env } from '../../config/env.js';

export const RAZORPAY_CLIENT = Symbol('RAZORPAY_CLIENT');

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: 'INR';
  receipt: string;
  status: string;
  notes: Record<string, string>;
}

export interface RazorpayPayment {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  /** Only `captured` means the money is ours to keep. `authorized` is not enough. */
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';
  created_at: number;
}

export interface RazorpayRefund {
  id: string;
  payment_id: string;
  amount: number;
  currency: string;
  /** Our refund_requests id: Razorpay refuses a second refund with the same receipt. */
  receipt: string | null;
  status: 'pending' | 'processed' | 'failed';
}

/** One row of Razorpay's settlement recon report. `fee` includes `tax` (GST on the fee). */
export interface RazorpayReconItem {
  entity_id: string;
  type: 'payment' | 'refund' | 'transfer' | 'adjustment';
  amount: number;
  fee: number;
  tax: number;
  settled: boolean;
  settlement_id: string | null;
  order_id: string | null;
}

/** The Razorpay calls payments and the ledger need. Tests replace it with a fake; nothing leaves the machine. */
export interface RazorpayClient {
  createOrder(input: {
    amountPaise: number;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<RazorpayOrder>;
  fetchOrderPayments(orderId: string): Promise<RazorpayPayment[]>;
  createRefund(input: {
    paymentId: string;
    amountPaise: number;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<RazorpayRefund>;
  fetchPaymentRefunds(paymentId: string): Promise<RazorpayRefund[]>;
  /** Everything settled for one day (all pages). */
  fetchSettlementRecon(day: Date): Promise<RazorpayReconItem[]>;
}

/** Razorpay REST API with basic auth (test keys only; live keys are refused at startup). */
@Injectable()
export class HttpRazorpayClient implements RazorpayClient {
  private auth(): string {
    return `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64')}`;
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${env.RAZORPAY_API_URL}${path}`, {
      method,
      headers: { Authorization: this.auth(), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Razorpay ${method} ${path} → ${res.status}`);
    return (await res.json()) as T;
  }

  createOrder(input: { amountPaise: number; receipt: string; notes: Record<string, string> }) {
    // Capture is automatic (Dashboard default; see docs/deploy.md). We verify only on `captured`.
    return this.call<RazorpayOrder>('POST', '/v1/orders', {
      amount: input.amountPaise,
      currency: 'INR',
      receipt: input.receipt,
      notes: input.notes,
    });
  }

  createRefund(input: {
    paymentId: string;
    amountPaise: number;
    receipt: string;
    notes: Record<string, string>;
  }) {
    return this.call<RazorpayRefund>(
      'POST',
      `/v1/payments/${encodeURIComponent(input.paymentId)}/refund`,
      {
        amount: input.amountPaise,
        speed: 'normal',
        receipt: input.receipt,
        notes: input.notes,
      },
    );
  }

  async fetchPaymentRefunds(paymentId: string) {
    const res = await this.call<{ items: RazorpayRefund[] }>(
      'GET',
      `/v1/payments/${encodeURIComponent(paymentId)}/refunds`,
    );
    return res.items;
  }

  async fetchSettlementRecon(day: Date) {
    // The report is per calendar day in India.
    const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' })
      .format(day)
      .split('-');
    const items: RazorpayReconItem[] = [];
    for (let skip = 0; ; skip += 1000) {
      const page = await this.call<{ items: RazorpayReconItem[] }>(
        'GET',
        `/v1/settlements/recon/combined?year=${y}&month=${m}&day=${d}&count=1000&skip=${skip}`,
      );
      items.push(...page.items);
      if (page.items.length < 1000) return items;
    }
  }

  async fetchOrderPayments(orderId: string) {
    const res = await this.call<{ items: RazorpayPayment[] }>(
      'GET',
      `/v1/orders/${encodeURIComponent(orderId)}/payments`,
    );
    return res.items;
  }
}
