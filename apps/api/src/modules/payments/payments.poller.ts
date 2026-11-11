import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { env } from '../../config/env.js';
import type { Payment } from '../../generated/prisma/client.js';
import { OutboxRelay } from '../../outbox/outbox.relay.js';
import { bullConnection, QUEUES } from '../../queue/queue.js';
import { OrdersService } from '../orders/orders.service.js';
import { PaymentsService } from './payments.service.js';
import { WebhookProcessor } from './webhook.processor.js';

/** Give the webhook this long before asking Razorpay ourselves. */
const WEBHOOK_GRACE_MS = 2 * 60_000;

/**
 * Every minute, for missing or late webhooks: re-runs stored-but-unprocessed webhooks, expires
 * unpaid orders, then asks Razorpay about every payment still pending after the grace period.
 * A captured one is verified (server-side fetch); one whose order no longer waits, with nothing
 * captured on the final check, expires. A capture that comes even later still verifies it.
 */
@Injectable()
export class PaymentsPoller implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentsPoller.name);
  private queue?: Queue;
  private worker?: Worker;
  private connection?: Redis;

  constructor(
    private readonly payments: PaymentsService,
    private readonly orders: OrdersService,
    private readonly webhooks: WebhookProcessor,
    private readonly relay: OutboxRelay,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!env.RUN_WORKERS) return;
    this.connection = bullConnection();
    this.queue = new Queue(QUEUES.paymentsPoller, { connection: this.connection });
    await this.queue.upsertJobScheduler('poll-payments', { every: 60_000 }, { name: 'poll' });
    this.worker = new Worker(QUEUES.paymentsPoller, () => this.pollOnce(), {
      connection: bullConnection(),
    });
    this.worker.on('failed', (_job, err) => Sentry.captureException(err));
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await this.connection?.quit().catch(() => undefined);
  }

  /**
   * One pass, in this order so an on-time payment is never lost to expiry: re-run lost webhooks;
   * ask Razorpay about pending payments past the grace period AND those whose order is due to
   * expire; only then expire unpaid orders; then close payments of orders that no longer wait.
   * Finally re-check recently expired payments (a capture can still come within Razorpay's
   * auto-capture window, 72 hours). Safe to run alongside the scheduled one.
   */
  async pollOnce(): Promise<void> {
    await this.webhooks.processPending();
    const checked: Payment[] = [];
    if (env.RAZORPAY_KEY_ID) {
      const dueOrders = await this.orders.dueForExpiry();
      const due = await this.payments.pendingToCheck(
        new Date(Date.now() - WEBHOOK_GRACE_MS),
        dueOrders,
      );
      for (const payment of due) {
        try {
          if ((await this.payments.checkWithProvider(payment)) === 'not_captured')
            checked.push(payment);
        } catch (err) {
          this.logger.warn(`Checking payment ${payment.id} with Razorpay failed: ${String(err)}`);
        }
      }
    }
    // Deliver any payment.verified just written, so a paid order is placed before expiry runs.
    await this.relay.drain();
    await this.orders.expireDue();
    for (const payment of checked) await this.payments.expireIfOrderClosed(payment);
    if (env.RAZORPAY_KEY_ID) {
      for (const payment of await this.payments.expiredToRecheck()) {
        await this.payments
          .checkWithProvider(payment)
          .catch((err) =>
            this.logger.warn(`Re-checking expired payment ${payment.id} failed: ${String(err)}`),
          );
      }
    }
  }
}
