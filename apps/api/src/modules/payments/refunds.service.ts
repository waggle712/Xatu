import { Inject, Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { paiseToNumber } from '../../common/money.js';
import { Prisma, type RefundRequest } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RAZORPAY_CLIENT, type RazorpayClient, type RazorpayRefund } from './razorpay.client.js';

const MAX_ATTEMPTS = 10;

/**
 * Automatic refunds (decided 12 Nov 2026) for payments marked refund_pending: the buyer got
 * nothing, so the money goes back by itself through Razorpay (test mode). Never twice: the
 * refund_requests row is written first (one open per payment), its id is Razorpay's `receipt`
 * (Razorpay refuses a duplicate receipt), and before any retry the payment's existing refunds
 * are fetched and adopted. The payment becomes `refunded` (and the ledger posts it) only when
 * Razorpay reports the refund `processed`, by webhook or fetch.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(RAZORPAY_CLIENT) private readonly razorpay: RazorpayClient,
  ) {}

  /** Outbox `payment.refund_pending`. Safe to run twice. */
  async onRefundPending(input: { paymentId: string; reason: string }): Promise<void> {
    const payment = await this.prisma.payment.findUnique({ where: { id: input.paymentId } });
    if (!payment || payment.status !== 'refund_pending' || !payment.providerPaymentId) return;
    let refund = await this.openRefund(payment.id);
    if (!refund) {
      try {
        refund = await this.prisma.refundRequest.create({
          data: {
            orderId: payment.orderId,
            paymentId: payment.id,
            amountPaise: payment.amountPaise,
            reason: input.reason,
            status: 'requested',
            requestedById: null,
          },
        });
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'))
          throw err;
        refund = await this.openRefund(payment.id);
        if (!refund) throw err;
      }
    }
    await this.send(refund);
  }

  /** Sends (or adopts) the refund at Razorpay. */
  async send(refund: RefundRequest): Promise<void> {
    if (refund.status !== 'requested') return;
    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { id: refund.paymentId },
    });
    await this.prisma.refundRequest.update({
      where: { id: refund.id },
      data: { attempts: { increment: 1 } },
    });
    try {
      // Already made at Razorpay (an earlier call timed out after creating it)? Adopt it.
      const existing = (await this.razorpay.fetchPaymentRefunds(payment.providerPaymentId!)).find(
        (r) => r.receipt === refund.id,
      );
      const made =
        existing ??
        (await this.razorpay.createRefund({
          paymentId: payment.providerPaymentId!,
          amountPaise: paiseToNumber(refund.amountPaise),
          receipt: refund.id,
          notes: { order_id: refund.orderId, refund_request_id: refund.id },
        }));
      await this.prisma.refundRequest.updateMany({
        where: { id: refund.id, status: 'requested' },
        data: { status: 'processing', providerRefundId: made.id, failureReason: null },
      });
      if (made.status === 'processed') await this.onProviderRefund(made);
    } catch (err) {
      this.logger.error(`Refund ${refund.id} failed to send: ${String(err)}`);
      await this.prisma.refundRequest.update({
        where: { id: refund.id },
        data: { failureReason: String(err).slice(0, 300) },
      });
      if (refund.attempts + 1 >= MAX_ATTEMPTS)
        Sentry.captureException(err, { extra: { refundRequestId: refund.id } });
    }
  }

  /**
   * Razorpay's view of a refund (webhook refund.processed / refund.failed, or a fetch).
   * processed → refund completed, payment refunded, outbox `payment.refunded` (ledger posts it).
   * failed → kept for a person to look at (alert); the payment stays refund_pending.
   */
  async onProviderRefund(
    r: Pick<RazorpayRefund, 'id' | 'payment_id' | 'amount' | 'status' | 'receipt'>,
  ): Promise<string> {
    const refund = await this.prisma.refundRequest.findFirst({
      where: { OR: [{ providerRefundId: r.id }, ...(r.receipt ? [{ id: r.receipt }] : [])] },
    });
    if (!refund) return 'unknown_refund';
    if (r.status === 'failed') {
      await this.prisma.refundRequest.updateMany({
        where: { id: refund.id, status: { in: ['requested', 'processing'] } },
        data: { status: 'failed', failureReason: 'razorpay_refund_failed' },
      });
      Sentry.captureMessage(
        `Razorpay refund ${r.id} failed (refund request ${refund.id})`,
        'error',
      );
      return 'failed';
    }
    if (r.status !== 'processed') return 'pending';
    if (BigInt(r.amount) !== refund.amountPaise) {
      Sentry.captureMessage(
        `Refund ${r.id} amount ${r.amount} differs from ${refund.amountPaise}`,
        'error',
      );
      return 'amount_mismatch';
    }
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.refundRequest.updateMany({
        where: { id: refund.id, status: { in: ['requested', 'processing'] } },
        data: { status: 'completed', providerRefundId: r.id },
      });
      if (count === 0) return 'already';
      await tx.payment.updateMany({
        where: { id: refund.paymentId, status: 'refund_pending' },
        data: { status: 'refunded' },
      });
      await tx.outboxEvent.create({
        data: {
          topic: 'payment.refunded',
          aggregateId: refund.paymentId,
          payload: {
            refundId: refund.id,
            paymentId: refund.paymentId,
            orderId: refund.orderId,
            amountPaise: paiseToNumber(refund.amountPaise),
            providerRefundId: r.id,
          },
        },
      });
      return 'completed';
    });
  }

  /** Poller: retry unsent refunds, and ask Razorpay about refunds it hasn't confirmed yet. */
  async pollOnce(): Promise<void> {
    const stale = new Date(Date.now() - 10 * 60_000);
    const unsent = await this.prisma.refundRequest.findMany({
      where: { status: 'requested', requestedById: null, attempts: { lt: MAX_ATTEMPTS } },
      take: 50,
    });
    for (const r of unsent) await this.send(r);
    const waiting = await this.prisma.refundRequest.findMany({
      where: { status: 'processing', updatedAt: { lte: stale } },
      include: { payment: { select: { providerPaymentId: true } } },
      take: 50,
    });
    for (const r of waiting) {
      try {
        const found = (await this.razorpay.fetchPaymentRefunds(r.payment.providerPaymentId!)).find(
          (x) => x.id === r.providerRefundId,
        );
        if (found) await this.onProviderRefund(found);
        else
          await this.prisma.refundRequest.update({
            where: { id: r.id },
            data: { updatedAt: new Date() },
          });
      } catch (err) {
        this.logger.warn(`Checking refund ${r.id} failed: ${String(err)}`);
      }
    }
  }

  private openRefund(paymentId: string) {
    return this.prisma.refundRequest.findFirst({
      where: { paymentId, status: { in: ['requested', 'approved', 'processing'] } },
    });
  }
}
