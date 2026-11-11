import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { env } from '../../config/env.js';
import { bullConnection, QUEUES } from '../../queue/queue.js';
import { ReconciliationService } from './reconciliation.service.js';
import { SettlementsService } from './settlements.service.js';

/** Nightly money jobs, on India time (the database is UTC). */
@Injectable()
export class LedgerJobs implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LedgerJobs.name);
  private queue?: Queue;
  private worker?: Worker;
  private connection?: Redis;

  constructor(
    private readonly settlements: SettlementsService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!env.RUN_WORKERS) return;
    this.connection = bullConnection();
    this.queue = new Queue(QUEUES.ledgerNightly, { connection: this.connection });
    await this.queue.upsertJobScheduler(
      'settlements',
      { pattern: '0 1 * * *', tz: 'Asia/Kolkata' },
      { name: 'settlements' },
    );
    await this.queue.upsertJobScheduler(
      'reconciliation',
      { pattern: '0 2 * * *', tz: 'Asia/Kolkata' },
      { name: 'reconciliation' },
    );
    this.worker = new Worker(
      QUEUES.ledgerNightly,
      async (job) => {
        if (job.name === 'settlements') return this.settlements.createBatches(new Date());
        // Yesterday's report (Razorpay settles about T+2; the T+3 check catches what's missing).
        if (job.name === 'reconciliation' && env.RAZORPAY_KEY_ID) {
          return this.reconciliation.reconcile(new Date(Date.now() - 86_400_000));
        }
        return undefined;
      },
      { connection: bullConnection() },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(`Nightly ${job?.name} failed: ${err.message}`);
      Sentry.captureException(err);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await this.connection?.quit().catch(() => undefined);
  }
}
