import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { bullConnection, QUEUES } from '../queue/queue.js';
import { REDIS } from '../redis/redis.module.js';

export interface OutboxMessage {
  id: string;
  topic: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}
export type OutboxHandler = (message: OutboxMessage) => Promise<void>;

const BATCH = 100;
const ALERT_AFTER_ATTEMPTS = 5;
const LOCK_KEY = 'outbox:relay:lock';
const LOCK_MS = 60_000;

/**
 * Delivers outbox rows (written in the same transaction as each state change) to in-process
 * handlers by topic, in order, at least once. Handlers must be safe to run twice. A row is
 * marked published only after all its handlers succeed; a failing row is retried later and
 * never blocks the rows behind it. Rows for topics with no handler are simply marked published.
 * Notification-type handlers must never change order or payment state.
 */
@Injectable()
export class OutboxRelay implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelay.name);
  private readonly handlers = new Map<string, OutboxHandler[]>();
  private queue?: Queue;
  private worker?: Worker;
  private connection?: Redis;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Modules subscribe at startup (onModuleInit). */
  on(topic: string, handler: OutboxHandler): void {
    this.handlers.set(topic, [...(this.handlers.get(topic) ?? []), handler]);
  }

  async onModuleInit(): Promise<void> {
    if (!env.RUN_WORKERS) return;
    this.connection = bullConnection();
    this.queue = new Queue(QUEUES.outboxRelay, { connection: this.connection });
    await this.queue.upsertJobScheduler('relay-outbox', { every: 2_000 }, { name: 'drain' });
    this.worker = new Worker(QUEUES.outboxRelay, () => this.drain(), {
      connection: bullConnection(),
    });
    this.worker.on('failed', (_job, err) => Sentry.captureException(err));
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await this.connection?.quit().catch(() => undefined);
  }

  /** Delivers everything unpublished. One runner at a time (Redis lock); others wait their turn. */
  async drain(): Promise<number> {
    const token = `${process.pid}:${Math.random()}`;
    for (let waited = 0; ; waited += 100) {
      if ((await this.redis.set(LOCK_KEY, token, 'PX', LOCK_MS, 'NX')) === 'OK') break;
      if (waited > 30_000) return 0;
      await new Promise((r) => setTimeout(r, 100));
    }
    try {
      let delivered = 0;
      const failedIds: string[] = [];
      for (;;) {
        const rows = await this.prisma.outboxEvent.findMany({
          where: { publishedAt: null, ...(failedIds.length ? { id: { notIn: failedIds } } : {}) },
          orderBy: { createdAt: 'asc' },
          take: BATCH,
        });
        if (rows.length === 0) return delivered;
        for (const row of rows) {
          const message: OutboxMessage = {
            id: row.id,
            topic: row.topic,
            aggregateId: row.aggregateId,
            payload: (row.payload ?? {}) as Record<string, unknown>,
          };
          try {
            for (const handler of this.handlers.get(row.topic) ?? []) await handler(message);
            await this.prisma.outboxEvent.update({
              where: { id: row.id },
              data: { publishedAt: new Date() },
            });
            delivered += 1;
          } catch (err) {
            failedIds.push(row.id);
            const attempts = row.attempts + 1;
            await this.prisma.outboxEvent.update({ where: { id: row.id }, data: { attempts } });
            this.logger.error(
              `Outbox ${row.topic} ${row.id} failed (attempt ${attempts}): ${String(err)}`,
            );
            if (attempts >= ALERT_AFTER_ATTEMPTS)
              Sentry.captureException(err, { extra: { outboxId: row.id, topic: row.topic } });
          }
        }
      }
    } finally {
      // Release only our own lock.
      await this.redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        LOCK_KEY,
        token,
      );
    }
  }
}
