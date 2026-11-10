import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  type CreateUploadRequest,
  type Image,
  type MediaAsset,
  type MediaPurpose,
  type UploadTicket,
} from '@xatu/shared';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { AppError } from '../../common/errors.js';
import type { MediaAsset as MediaAssetRow } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { bullConnection, QUEUES } from '../../queue/queue.js';
import { IMAGE_VARIANTS, type ImageVariants, MEDIA_STORAGE, type MediaStorage } from './storage.js';

const UPLOAD_TICKET_SECONDS = 15 * 60;

export interface MediaJob {
  mediaId: string;
}

/** Upload tickets, status and ownership for media. Processing happens in MediaWorker. */
@Injectable()
export class MediaService implements OnModuleDestroy {
  private readonly connection: Redis = bullConnection();
  readonly queue = new Queue<MediaJob>(QUEUES.media, {
    connection: this.connection,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: 1_000,
      removeOnFail: false,
    },
  });

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
    @Inject(IMAGE_VARIANTS) private readonly variants: ImageVariants,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    await this.connection.quit().catch(() => undefined);
  }

  /** Step 1: create a pending asset and a short-lived, single-object upload URL. */
  async createUpload(userId: string, input: CreateUploadRequest): Promise<UploadTicket> {
    const id = randomUUID();
    const uploadKey = `uploads/${userId}/${id}`;
    const asset = await this.prisma.mediaAsset.create({
      data: {
        ownerId: userId,
        purpose: input.purpose,
        uploadKey,
        declaredType: input.contentType,
        declaredBytes: input.byteSize,
        capturedInApp: input.capturedInApp ?? false,
      },
    });
    const { url, headers } = await this.storage.createUploadUrl({
      key: uploadKey,
      contentType: input.contentType,
      byteSize: input.byteSize,
      expiresInSeconds: UPLOAD_TICKET_SECONDS,
    });
    return {
      mediaId: asset.id,
      uploadUrl: url,
      method: 'PUT',
      headers,
      expiresAt: new Date(Date.now() + UPLOAD_TICKET_SECONDS * 1000).toISOString(),
    };
  }

  /** Step 2: the phone says the upload finished; queue processing. Safe to call more than once. */
  async complete(userId: string, mediaId: string): Promise<MediaAsset> {
    const asset = await this.loadOwned(userId, mediaId);
    if (asset.status === 'pending') {
      // jobId = media id, so a repeated call never queues the same image twice.
      await this.queue.add('process', { mediaId: asset.id }, { jobId: asset.id });
    }
    return this.toView(asset);
  }

  async get(userId: string, mediaId: string): Promise<MediaAsset> {
    return this.toView(await this.loadOwned(userId, mediaId));
  }

  /** For other modules: a ready image of the right purpose that this user owns. */
  async requireReady(
    userId: string,
    mediaId: string,
    purpose: MediaPurpose,
  ): Promise<MediaAssetRow> {
    const asset = await this.loadOwned(userId, mediaId);
    if (asset.purpose !== purpose) {
      throw new AppError(
        'media_wrong_purpose',
        'This photo was uploaded for something else.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (asset.status !== 'ready') {
      throw new AppError(
        'media_not_ready',
        'The photo is still being processed.',
        HttpStatus.CONFLICT,
      );
    }
    return asset;
  }

  /** requireReady for several photos at once (all must pass). */
  async requireReadyMany(
    userId: string,
    mediaIds: string[],
    purpose: MediaPurpose,
  ): Promise<MediaAssetRow[]> {
    const assets: MediaAssetRow[] = [];
    for (const id of mediaIds) assets.push(await this.requireReady(userId, id, purpose));
    return assets;
  }

  /** Ready images by id, for other modules that store media ids (product photos). */
  async imagesFor(mediaIds: string[]): Promise<Map<string, Image>> {
    if (mediaIds.length === 0) return new Map();
    const rows = await this.prisma.mediaAsset.findMany({ where: { id: { in: mediaIds } } });
    const images = new Map<string, Image>();
    for (const row of rows) {
      const image = this.toImage(row);
      if (image) images.set(row.id, image);
    }
    return images;
  }

  /** Public image view built from the storage key (never stored URLs). */
  toImage(
    asset: Pick<
      MediaAssetRow,
      'id' | 'status' | 'storageKey' | 'width' | 'height' | 'blurhash'
    > | null,
  ): Image | null {
    if (
      !asset ||
      asset.status !== 'ready' ||
      !asset.storageKey ||
      !asset.width ||
      !asset.height ||
      !asset.blurhash
    )
      return null;
    return {
      id: asset.id,
      width: asset.width,
      height: asset.height,
      blurhash: asset.blurhash,
      urls: this.variants.urls(asset.storageKey),
    };
  }

  private toView(asset: MediaAssetRow): MediaAsset {
    return {
      id: asset.id,
      purpose: asset.purpose,
      status: asset.status,
      rejectReason: asset.rejectReason,
      image: this.toImage(asset),
    };
  }

  private async loadOwned(userId: string, mediaId: string): Promise<MediaAssetRow> {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id: mediaId } });
    if (!asset) throw new AppError('media_not_found', 'Photo not found.', HttpStatus.NOT_FOUND);
    if (asset.ownerId !== userId)
      throw new AppError('forbidden', 'You can only use your own photos.', HttpStatus.FORBIDDEN);
    return asset;
  }
}
