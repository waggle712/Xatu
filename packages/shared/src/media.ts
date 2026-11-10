import { z } from 'zod';

/** Largest photo a phone may upload (after it compresses the image). */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageContentType = (typeof ALLOWED_IMAGE_TYPES)[number];

export const mediaPurposeSchema = z.enum(['shop_cover', 'product_photo']);
export type MediaPurpose = z.infer<typeof mediaPurposeSchema>;

export const mediaStatusSchema = z.enum(['pending', 'processing', 'ready', 'rejected']);
export type MediaStatus = z.infer<typeof mediaStatusSchema>;

const TRANSITIONS: Record<MediaStatus, MediaStatus[]> = {
  pending: ['processing', 'rejected'],
  processing: ['ready', 'rejected'],
  ready: [],
  rejected: [],
};

export function canTransitionMedia(from: MediaStatus, to: MediaStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** POST /media/uploads */
export const createUploadSchema = z.strictObject({
  purpose: mediaPurposeSchema,
  contentType: z.enum(ALLOWED_IMAGE_TYPES),
  byteSize: z.number().int().positive().max(MAX_IMAGE_BYTES),
  /** Shot with the in-app camera (for the "Captured on Xatu" badge). */
  capturedInApp: z.boolean().optional(),
});
export type CreateUploadRequest = z.infer<typeof createUploadSchema>;

/** Where the phone PUTs the file. Short-lived and single-object. */
export const uploadTicketSchema = z.object({
  mediaId: z.string().uuid(),
  uploadUrl: z.string().url(),
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.string(),
});
export type UploadTicket = z.infer<typeof uploadTicketSchema>;

export const IMAGE_VARIANTS = { thumb: 320, card: 800, full: 1600 } as const;
export type ImageVariant = keyof typeof IMAGE_VARIANTS;

/** A ready image as clients receive it. URLs are built from the storage key at read time. */
export const imageSchema = z.object({
  id: z.string().uuid(),
  width: z.number().int(),
  height: z.number().int(),
  blurhash: z.string(),
  urls: z.object({ thumb: z.string(), card: z.string(), full: z.string() }),
});
export type Image = z.infer<typeof imageSchema>;

export const mediaAssetSchema = z.object({
  id: z.string().uuid(),
  purpose: mediaPurposeSchema,
  status: mediaStatusSchema,
  rejectReason: z.string().nullable(),
  image: imageSchema.nullable(),
});
export type MediaAsset = z.infer<typeof mediaAssetSchema>;

/** Smallest variant whose width covers the displayed width on this screen density. */
export function pickVariant(displayWidth: number, pixelRatio: number): ImageVariant {
  const needed = displayWidth * pixelRatio;
  if (needed <= IMAGE_VARIANTS.thumb) return 'thumb';
  if (needed <= IMAGE_VARIANTS.card) return 'card';
  return 'full';
}

/** Detects the real type from the first bytes. Never trust the client's content type or file name. */
export function sniffImageType(bytes: Uint8Array): ImageContentType | null {
  const b = (i: number) => bytes[i] ?? -1;
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'image/jpeg';
  if (
    b(0) === 0x89 &&
    b(1) === 0x50 &&
    b(2) === 0x4e &&
    b(3) === 0x47 &&
    b(4) === 0x0d &&
    b(5) === 0x0a &&
    b(6) === 0x1a &&
    b(7) === 0x0a
  ) {
    return 'image/png';
  }
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}
