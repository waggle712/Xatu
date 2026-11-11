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

/** The two Razorpay calls payments needs. Tests replace it with a fake; nothing leaves the machine. */
export interface RazorpayClient {
  createOrder(input: {
    amountPaise: number;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<RazorpayOrder>;
  fetchOrderPayments(orderId: string): Promise<RazorpayPayment[]>;
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

  async fetchOrderPayments(orderId: string) {
    const res = await this.call<{ items: RazorpayPayment[] }>(
      'GET',
      `/v1/orders/${encodeURIComponent(orderId)}/payments`,
    );
    return res.items;
  }
}
