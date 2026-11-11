import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { env } from '../../config/env.js';
import { bullConnection, QUEUES } from '../../queue/queue.js';
import { OrdersService } from './orders.service.js';

/**
 * Every minute: unpaid orders past their hold time become `expired` and their holds end.
 * Checkout never depends on this job: holds past `expires_at` already don't count as held.
 */
@Injectable()
export class OrdersExpiry implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrdersExpiry.name);
  private queue?: Queue;
  private worker?: Worker;
  private connection?: Redis;

  constructor(private readonly orders: OrdersService) {}

  async onModuleInit(): Promise<void> {
    if (!env.RUN_WORKERS) return;
    this.connection = bullConnection();
    this.queue = new Queue(QUEUES.ordersExpiry, { connection: this.connection });
    await this.queue.upsertJobScheduler(
      'expire-unpaid-orders',
      { every: 60_000 },
      { name: 'expire' },
    );
    this.worker = new Worker(QUEUES.ordersExpiry, () => this.expireDue(), {
      connection: bullConnection(),
    });
    this.worker.on('failed', (_job, err) => {
      this.logger.error(`Order expiry failed: ${err.message}`);
      Sentry.captureException(err);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await this.connection?.quit().catch(() => undefined);
  }

  /** Exposed for tests and the job. Returns how many orders expired. */
  async expireDue(): Promise<number> {
    const n = await this.orders.expireDue();
    if (n > 0) this.logger.log(`Expired ${n} unpaid order(s)`);
    return n;
  }
}
