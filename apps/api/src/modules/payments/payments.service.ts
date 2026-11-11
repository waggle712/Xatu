import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  canTransitionPayment,
  type PaymentStatus,
  type PaymentView,
  type StartPayment,
} from '@xatu/shared';
import { AppError } from '../../common/errors.js';
import { paiseToBigInt, paiseToNumber } from '../../common/money.js';
import { env } from '../../config/env.js';
import { type Payment, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { RAZORPAY_CLIENT, type RazorpayClient, type RazorpayPayment } from './razorpay.client.js';

export type VerifyOutcome =
  'verified' | 'already_verified' | 'amount_mismatch' | 'unknown_order' | 'not_captured';

/**
 * Payments (separate state machine). A payment becomes `verified` ONLY here, from provider
 * evidence: a signature-checked webhook or a server-side fetch from Razorpay. The app's success
 * callback never verifies anything. On verification it writes `payment.verified` to the outbox;
 * orders reacts to that (places the order or asks for a refund).
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    @Inject(RAZORPAY_CLIENT) private readonly razorpay: RazorpayClient,
  ) {}

  /** Opens (or reuses) the one payment for an unpaid order and its Razorpay order. */
  async start(buyerId: string, orderId: string): Promise<StartPayment> {
    if (!env.RAZORPAY_KEY_ID) {
      throw new AppError(
        'payments_unavailable',
        'Online payment is not switched on yet.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const order = await this.orders.get(buyerId, orderId); // 404 for anyone else's order
    if (
      order.status !== 'awaiting_payment' ||
      !order.expiresAt ||
      new Date(order.expiresAt) <= new Date()
    ) {
      throw new AppError(
        'invalid_order_status',
        'This order can no longer be paid.',
        HttpStatus.CONFLICT,
      );
    }

    let payment = await this.openPayment(orderId);
    if (!payment) {
      try {
        payment = await this.prisma.payment.create({
          data: { orderId, status: 'initiated', amountPaise: paiseToBigInt(order.totalPaise) },
        });
      } catch (err) {
        // A parallel tap created it first (one open payment per order).
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'))
          throw err;
        payment = await this.openPayment(orderId);
        if (!payment) throw err;
      }
    }
    if (!payment.providerOrderId) {
      try {
        const rzp = await this.razorpay.createOrder({
          amountPaise: order.totalPaise,
          receipt: order.code,
          notes: { order_id: orderId, payment_id: payment.id },
        });
        if (rzp.amount !== order.totalPaise) throw new Error('Razorpay order amount differs');
        const { count } = await this.prisma.payment.updateMany({
          where: { id: payment.id, status: 'initiated', providerOrderId: null },
          data: { providerOrderId: rzp.id, status: 'pending' },
        });
        if (count === 0)
          payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
        else payment = { ...payment, providerOrderId: rzp.id, status: 'pending' };
      } catch (err) {
        this.logger.error(`Razorpay order for payment ${payment.id} failed: ${String(err)}`);
        // Free the order for a new attempt (the open-payment index would otherwise block it).
        await this.prisma.payment.updateMany({
          where: { id: payment.id, status: 'initiated' },
          data: { status: 'failed', failureReason: 'provider_order_failed' },
        });
        throw new AppError(
          'payments_unavailable',
          "Couldn't start the payment. Please try again.",
          HttpStatus.BAD_GATEWAY,
        );
      }
    }
    if (payment.status === 'verified') {
      throw new AppError('already_paid', 'This order is already paid.', HttpStatus.CONFLICT);
    }
    return {
      paymentId: payment.id,
      provider: 'razorpay',
      keyId: env.RAZORPAY_KEY_ID,
      providerOrderId: payment.providerOrderId!,
      amountPaise: paiseToNumber(payment.amountPaise),
      currency: 'INR',
      orderCode: order.code,
    };
  }

  /** The buyer's view of a payment. A pending one is checked with Razorpay at most every 10 s. */
  async view(buyerId: string, paymentId: string): Promise<PaymentView> {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw notFound();
    await this.orders.get(buyerId, payment.orderId).catch(() => {
      throw notFound();
    });
    const stale = !payment.lastCheckedAt || Date.now() - payment.lastCheckedAt.getTime() > 10_000;
    if (payment.status === 'pending' && payment.providerOrderId && stale && env.RAZORPAY_KEY_ID) {
      await this.checkWithProvider(payment).catch((err) =>
        this.logger.warn(`On-demand check failed: ${String(err)}`),
      );
    }
    const fresh = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    return {
      id: fresh.id,
      orderId: fresh.orderId,
      status: fresh.status,
      amountPaise: paiseToNumber(fresh.amountPaise),
    };
  }

  /** Server-side fetch from Razorpay (poller and on-demand). Verifies only a captured payment. */
  async checkWithProvider(payment: Payment): Promise<VerifyOutcome> {
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { lastCheckedAt: new Date() },
    });
    const attempts = await this.razorpay.fetchOrderPayments(payment.providerOrderId!);
    const captured = attempts.find((a) => a.status === 'captured');
    if (!captured) return 'not_captured';
    return this.verify(captured, 'fetch');
  }

  /**
   * THE place a payment becomes verified. `evidence` is a captured Razorpay payment from a
   * signature-checked webhook or a server-side fetch. Checks amount and currency against our
   * record. Safe to run any number of times, in any order.
   */
  async verify(
    evidence: Pick<RazorpayPayment, 'id' | 'order_id' | 'amount' | 'currency' | 'status'>,
    by: 'webhook' | 'fetch',
  ): Promise<VerifyOutcome> {
    if (evidence.status !== 'captured') return 'not_captured';
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Payment[]>`
        SELECT id, order_id AS "orderId", status, amount_paise AS "amountPaise", currency,
               provider_payment_id AS "providerPaymentId"
        FROM payments WHERE provider_order_id = ${evidence.order_id} FOR UPDATE`;
      const payment = rows[0];
      if (!payment) return 'unknown_order';
      if (BigInt(evidence.amount) !== BigInt(payment.amountPaise) || evidence.currency !== 'INR') {
        this.logger.error(
          `Amount mismatch on payment ${payment.id}: got ${evidence.amount} ${evidence.currency}`,
        );
        return 'amount_mismatch';
      }
      if (
        payment.status === 'verified' ||
        !canTransitionPayment(payment.status as PaymentStatus, 'verified')
      ) {
        return 'already_verified';
      }
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'verified',
          providerPaymentId: evidence.id,
          verifiedAt: new Date(),
          verifiedBy: by,
        },
      });
      await tx.outboxEvent.create({
        data: {
          topic: 'payment.verified',
          aggregateId: payment.id,
          // Enough for the ledger (prompt 16) to record it later.
          payload: {
            paymentId: payment.id,
            orderId: payment.orderId,
            amountPaise: paiseToNumber(BigInt(payment.amountPaise)),
            currency: 'INR',
            provider: 'razorpay',
            providerOrderId: evidence.order_id,
            providerPaymentId: evidence.id,
            verifiedBy: by,
          },
        },
      });
      return 'verified';
    });
  }

  /** Outbox `order.refund_needed`: a verified payment that can't be used is marked for refund. */
  async onRefundNeeded(input: {
    orderId: string;
    paymentId: string;
    reason: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.payment.updateMany({
        where: { id: input.paymentId, status: 'verified' },
        data: { status: 'refund_pending', failureReason: input.reason },
      });
      if (count === 1) {
        await tx.outboxEvent.create({
          data: { topic: 'payment.refund_pending', aggregateId: input.paymentId, payload: input },
        });
      }
    });
  }

  /** Open payments to look at with Razorpay (no webhook yet, or the order is over). */
  async pendingToCheck(
    olderThan: Date,
    dueOrderIds: string[] = [],
    limit = 200,
  ): Promise<Payment[]> {
    return this.prisma.payment.findMany({
      where: {
        status: 'pending',
        providerOrderId: { not: null },
        OR: [{ createdAt: { lte: olderThan } }, { orderId: { in: dueOrderIds } }],
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  /** Expired in the last 72 hours (Razorpay's auto-capture window), not checked for an hour. */
  async expiredToRecheck(limit = 50): Promise<Payment[]> {
    return this.prisma.payment.findMany({
      where: {
        status: 'expired',
        providerOrderId: { not: null },
        createdAt: { gte: new Date(Date.now() - 72 * 60 * 60_000) },
        OR: [
          { lastCheckedAt: null },
          { lastCheckedAt: { lte: new Date(Date.now() - 60 * 60_000) } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  /** The order's latest payment for its buyer (null if none); a pending one is checked first. */
  async forOrder(buyerId: string, orderId: string): Promise<PaymentView | null> {
    await this.orders.get(buyerId, orderId); // 404 for anyone else's order
    const latest = await this.prisma.payment.findFirst({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
    return latest ? this.view(buyerId, latest.id) : null;
  }

  /** Nothing was captured and the order no longer waits for payment: the payment expires. */
  async expireIfOrderClosed(payment: Payment): Promise<void> {
    const status = await this.orders.statusOf(payment.orderId);
    if (!status || status === 'awaiting_payment') return;
    await this.prisma.payment.updateMany({
      where: { id: payment.id, status: 'pending' },
      data: { status: 'expired' },
    });
  }

  // ── For the ledger (it never reads payment tables itself) ──

  /** Payments whose money was captured (verified, or later refunded / refund_pending). */
  async capturedPayments() {
    return this.prisma.payment.findMany({
      where: {
        status: {
          in: [
            'verified',
            'settlement_eligible',
            'settled',
            'refund_pending',
            'refunded',
            'disputed',
          ],
        },
      },
      select: {
        id: true,
        orderId: true,
        amountPaise: true,
        providerPaymentId: true,
        verifiedAt: true,
      },
    });
  }

  async byProviderPaymentId(providerPaymentId: string) {
    return this.prisma.payment.findUnique({
      where: { providerPaymentId },
      select: { id: true, orderId: true, amountPaise: true, status: true },
    });
  }

  /** Refunds Razorpay processed (completeness check and reconciliation). */
  async completedRefunds() {
    return this.prisma.refundRequest.findMany({
      where: { status: 'completed' },
      select: { id: true, paymentId: true, amountPaise: true, providerRefundId: true },
    });
  }

  private openPayment(orderId: string) {
    return this.prisma.payment.findFirst({
      where: { orderId, status: { in: ['initiated', 'pending', 'verified'] } },
    });
  }
}

function notFound(): AppError {
  return new AppError('payment_not_found', 'This payment is not available.', HttpStatus.NOT_FOUND);
}
