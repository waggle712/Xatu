import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Queue, Worker } from 'bullmq';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Redis } from 'ioredis';
import { env } from '../../config/env.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { bullConnection, QUEUES } from '../../queue/queue.js';
import { PaymentsService } from './payments.service.js';
import type { RazorpayPayment } from './razorpay.client.js';

/** Constant-time check of Razorpay's HMAC-SHA256 over the exact bytes received. */
export function validSignature(
  raw: Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature || !secret) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(raw).digest('hex'), 'utf8');
  const given = Buffer.from(signature, 'utf8');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Razorpay webhooks: stored raw first (exact bytes, signature, unique event id among valid
 * events), then processed by a BullMQ job. Duplicate or out-of-order delivery is harmless:
 * processing is idempotent and only `captured` evidence verifies a payment. Valid events whose
 * job was lost are picked up again by `processPending` (every minute, from the poller).
 */
@Injectable()
export class WebhookProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookProcessor.name);
  private queue?: Queue;
  private worker?: Worker;
  private connection?: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
  ) {}

  onModuleInit(): void {
    this.connection = bullConnection();
    this.queue = new Queue(QUEUES.razorpayWebhooks, { connection: this.connection });
    if (!env.RUN_WORKERS) return;
    this.worker = new Worker(
      QUEUES.razorpayWebhooks,
      (job) => this.process(job.data.eventRowId as string),
      {
        connection: bullConnection(),
      },
    );
    this.worker.on('failed', (_job, err) => Sentry.captureException(err));
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await this.connection?.quit().catch(() => undefined);
  }

  /**
   * Called by the controller with the raw request. Returns 'stored' / 'duplicate' / 'invalid'.
   * Invalid-signature requests are kept for the record but never processed, and (partial unique
   * index on valid events) can't take a real event's id first.
   */
  async receive(raw: Buffer, signature: string | undefined, eventIdHeader: string | undefined) {
    const valid = validSignature(raw, signature, env.RAZORPAY_WEBHOOK_SECRET);
    const text = raw.toString('utf8');
    let payload: Prisma.InputJsonValue = {};
    let eventType = 'unknown';
    try {
      payload = JSON.parse(text) as Prisma.InputJsonValue;
      eventType = String((payload as { event?: string }).event ?? 'unknown').slice(0, 100);
    } catch {
      // Kept as raw text only.
    }
    // Razorpay's id header; if missing, a hash of the exact bytes still makes retries dedupe.
    const providerEventId =
      eventIdHeader?.slice(0, 100) || `sha256:${createHash('sha256').update(raw).digest('hex')}`;
    const data = {
      provider: 'razorpay',
      providerEventId,
      eventType,
      payload,
      rawBody: text.slice(0, 256_000),
      signature: signature?.slice(0, 200) ?? null,
      signatureValid: valid,
    };
    if (!valid) {
      await this.prisma.paymentWebhookEvent.create({ data }).catch(() => undefined);
      return 'invalid' as const;
    }
    try {
      const row = await this.prisma.paymentWebhookEvent.create({ data });
      await this.enqueue(row.id);
      return 'stored' as const;
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      // Seen before. If it never got processed, queue it again (jobId collapses duplicates).
      const existing = await this.prisma.paymentWebhookEvent.findFirst({
        where: { provider: 'razorpay', providerEventId, signatureValid: true },
      });
      if (existing && !existing.processedAt) await this.enqueue(existing.id);
      return 'duplicate' as const;
    }
  }

  private async enqueue(eventRowId: string): Promise<void> {
    await this.queue
      ?.add(
        'process',
        { eventRowId },
        {
          jobId: eventRowId,
          attempts: 8,
          backoff: { type: 'exponential', delay: 2_000 },
          removeOnComplete: 1000,
        },
      )
      .catch((err) =>
        this.logger.error(
          `Queueing webhook ${eventRowId} failed (picked up later): ${String(err)}`,
        ),
      );
  }

  /** Processes one stored event. Safe to call twice and alongside the queued job. */
  async process(eventRowId: string): Promise<void> {
    const event = await this.prisma.paymentWebhookEvent.findUnique({ where: { id: eventRowId } });
    if (!event || !event.signatureValid || event.processedAt) return;
    await this.prisma.paymentWebhookEvent.update({
      where: { id: event.id },
      data: { attempts: { increment: 1 } },
    });
    const entity = (event.payload as { payload?: { payment?: { entity?: RazorpayPayment } } })
      .payload?.payment?.entity;
    let outcome: string;
    if (!entity || !entity.order_id) {
      outcome = 'ignored';
    } else if (event.eventType === 'payment.captured' || event.eventType === 'order.paid') {
      // Only captured evidence verifies; payment.authorized / payment.failed never do.
      outcome = await this.payments.verify({ ...entity, amount: Number(entity.amount) }, 'webhook');
    } else {
      // A failed attempt doesn't fail the payment: the buyer may retry within the same order.
      outcome = 'noted';
    }
    await this.prisma.paymentWebhookEvent.updateMany({
      where: { id: event.id, processedAt: null },
      data: { processedAt: new Date(), outcome },
    });
  }

  /** Valid events not processed after a minute (lost job, crash): process them now. */
  async processPending(olderThanMs = 60_000): Promise<number> {
    const rows = await this.prisma.paymentWebhookEvent.findMany({
      where: {
        signatureValid: true,
        processedAt: null,
        ...(olderThanMs > 0 ? { createdAt: { lte: new Date(Date.now() - olderThanMs) } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    for (const row of rows) await this.process(row.id);
    return rows.length;
  }
}
