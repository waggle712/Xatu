import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { env } from '../../config/env.js';
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

  /** One pass. Safe to run alongside the scheduled one. */
  async pollOnce(): Promise<void> {
    await this.webhooks.processPending();
    await this.orders.expireDue();
    if (!env.RAZORPAY_KEY_ID) return;
    const due = await this.payments.pendingToCheck(new Date(Date.now() - WEBHOOK_GRACE_MS));
    for (const payment of due) {
      try {
        const outcome = await this.payments.checkWithProvider(payment);
        if (outcome === 'not_captured') await this.payments.expireIfOrderClosed(payment);
      } catch (err) {
        this.logger.warn(`Checking payment ${payment.id} with Razorpay failed: ${String(err)}`);
      }
    }
  }
}
