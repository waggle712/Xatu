import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { IMAGE_VARIANTS as SIZES } from '@xatu/shared';
import { env } from '../../config/env.js';
import type { ImageVariants, MediaStorage } from './storage.js';

/** Cloudflare R2 through its S3-compatible API. The bucket stays private. */
export class R2Storage implements MediaStorage {
  private readonly s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
  });

  async createUploadUrl(input: {
    key: string;
    contentType: string;
    byteSize: number;
    expiresInSeconds: number;
  }) {
    const command = new PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.byteSize,
    });
    const url = await getSignedUrl(this.s3, command, {
      expiresIn: input.expiresInSeconds,
      signableHeaders: new Set(['content-type', 'content-length']),
    });
    return { url, headers: { 'Content-Type': input.contentType } };
  }

  async read(key: string): Promise<Buffer | null> {
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
      return res.Body ? Buffer.from(await res.Body.transformToByteArray()) : null;
    } catch (err) {
      if (err instanceof NoSuchKey) return null;
      throw err;
    }
  }

  async write(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: env.R2_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
  }
}

/**
 * Cloudflare Image Transformations on the zone in front of the bucket: thumb, card and full
 * are URL variants of one stored image (each size is billed once a month, however often viewed).
 */
export class CloudflareImageVariants implements ImageVariants {
  private readonly base = env.MEDIA_PUBLIC_BASE_URL.replace(/\/$/, '');

  urls(storageKey: string) {
    const url = (width: number) =>
      `${this.base}/cdn-cgi/image/width=${width},fit=scale-down,quality=80,format=auto/${storageKey}`;
    return { thumb: url(SIZES.thumb), card: url(SIZES.card), full: url(SIZES.full) };
  }

  /** Requests each variant once so Cloudflare creates and caches it; a failure is retried by the job. */
  async register(storageKey: string): Promise<void> {
    for (const url of Object.values(this.urls(storageKey))) {
      const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`Variant ${url} returned ${res.status}`);
      await res.arrayBuffer();
    }
  }
}
