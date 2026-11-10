import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { type Job, Queue, UnrecoverableError, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { bullConnection, QUEUES } from '../../queue/queue.js';
import { processImage } from './image-processor.js';
import type { MediaJob } from './media.service.js';
import { IMAGE_VARIANTS, type ImageVariants, MEDIA_STORAGE, type MediaStorage } from './storage.js';

/**
 * Processes uploads: verify → strip EXIF/GPS → blurhash → store clean copy → register variants.
 * Temporary failures are retried with exponential backoff (5 attempts); after the last one the
 * job goes to the dead-letter queue, the asset is rejected and an alert is raised.
 */
@Injectable()
export class MediaWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MediaWorker.name);
  private worker?: Worker<MediaJob>;
  private deadLetter?: Queue;
  private connection?: Redis;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
    @Inject(IMAGE_VARIANTS) private readonly variants: ImageVariants,
  ) {}

  onModuleInit(): void {
    if (!env.RUN_WORKERS) return;
    this.connection = bullConnection();
    this.deadLetter = new Queue(QUEUES.mediaDeadLetter, { connection: this.connection });
    this.worker = new Worker<MediaJob>(QUEUES.media, (job) => this.process(job), {
      connection: bullConnection(),
      concurrency: 4,
    });
    this.worker.on('failed', (job, err) => void this.onFailed(job, err));
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.deadLetter?.close();
    await this.connection?.quit().catch(() => undefined);
  }

  /** Exposed for tests. */
  async process(job: Pick<Job<MediaJob>, 'data'>): Promise<void> {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id: job.data.mediaId } });
    if (!asset || asset.status === 'ready' || asset.status === 'rejected') return; // duplicate or late job: nothing to do

    await this.prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { status: 'processing', attempts: { increment: 1 } },
    });

    const upload = await this.storage.read(asset.uploadKey);
    if (!upload) {
      // The phone said it finished but the object is not there (yet). Retry, then dead-letter.
      throw new Error(`Upload ${asset.uploadKey} not found`);
    }

    const result = await processImage(upload, asset.declaredType);
    if (!result.ok) {
      await this.reject(asset.id, asset.uploadKey, result.reason);
      throw new UnrecoverableError(`Rejected: ${result.reason}`);
    }

    const ext = result.contentType === 'image/png' ? 'png' : 'jpg';
    const storageKey = `media/${asset.id}.${ext}`;
    await this.storage.write(storageKey, result.body, result.contentType);
    await this.variants.register(storageKey, result.body);

    await this.prisma.$transaction(async (tx) => {
      await tx.mediaAsset.update({
        where: { id: asset.id },
        data: {
          status: 'ready',
          storageKey,
          contentType: result.contentType,
          byteSize: result.body.length,
          width: result.width,
          height: result.height,
          blurhash: result.blurhash,
          readyAt: new Date(),
        },
      });
      await tx.outboxEvent.create({
        data: {
          topic: 'media.ready',
          aggregateId: asset.id,
          payload: { mediaId: asset.id, purpose: asset.purpose },
        },
      });
    });
    await this.storage.delete(asset.uploadKey).catch(() => undefined);
  }

  private async reject(mediaId: string, uploadKey: string, reason: string): Promise<void> {
    await this.prisma.mediaAsset.update({
      where: { id: mediaId },
      data: { status: 'rejected', rejectReason: reason },
    });
    await this.storage.delete(uploadKey).catch(() => undefined);
  }

  private async onFailed(job: Job<MediaJob> | undefined, err: Error): Promise<void> {
    if (!job || err instanceof UnrecoverableError || err.name === 'UnrecoverableError') return;
    if (job.attemptsMade < (job.opts.attempts ?? 1)) return; // BullMQ will retry with backoff
    this.logger.error(
      `Media ${job.data.mediaId} failed after ${job.attemptsMade} attempts: ${err.message}`,
    );
    Sentry.captureMessage(`Media processing dead-lettered: ${job.data.mediaId}`, {
      level: 'error',
      extra: { error: err.message },
    });
    await this.deadLetter?.add('dead', {
      ...job.data,
      error: err.message,
      failedAt: new Date().toISOString(),
    });
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id: job.data.mediaId } });
    if (asset && asset.status !== 'ready')
      await this.reject(asset.id, asset.uploadKey, 'processing_failed');
  }
}
