import { MAX_IMAGE_BYTES, sniffImageType } from '@xatu/shared';
import { encode } from 'blurhash';
import sharp, { type Metadata, type OutputInfo } from 'sharp';

export type ProcessResult =
  | {
      ok: true;
      body: Buffer;
      contentType: 'image/jpeg' | 'image/png';
      width: number;
      height: number;
      blurhash: string;
    }
  | { ok: false; reason: RejectReason };

export type RejectReason =
  'too_large' | 'not_an_image' | 'type_mismatch' | 'too_small' | 'too_many_pixels' | 'unreadable';

/** Smallest side a photo may have, so listings never look blurry. */
const MIN_SIDE = 200;
/** Decompression-bomb guard (about 40 megapixels). */
const MAX_PIXELS = 40_000_000;

/**
 * Validates and cleans an uploaded image:
 * - checks the real type from its bytes and that it matches what the phone declared
 * - applies the EXIF rotation, then re-encodes WITHOUT any metadata (removes GPS, device, owner)
 * - computes a blurhash placeholder
 * Rejections are final (the job is not retried); thrown errors are temporary and retried.
 */
export async function processImage(input: Buffer, declaredType: string): Promise<ProcessResult> {
  if (input.length > MAX_IMAGE_BYTES) return { ok: false, reason: 'too_large' };
  const sniffed = sniffImageType(input);
  if (!sniffed) return { ok: false, reason: 'not_an_image' };
  if (sniffed !== declaredType) return { ok: false, reason: 'type_mismatch' };

  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: MAX_PIXELS }).metadata();
  } catch (err) {
    return {
      ok: false,
      reason: /pixel limit/i.test(String(err)) ? 'too_many_pixels' : 'unreadable',
    };
  }
  if (!meta.width || !meta.height) return { ok: false, reason: 'unreadable' };
  if (meta.width * meta.height > MAX_PIXELS) return { ok: false, reason: 'too_many_pixels' };

  // .rotate() bakes in the EXIF orientation; sharp drops all metadata on output unless asked to keep it.
  const base = sharp(input, { limitInputPixels: MAX_PIXELS }).rotate();
  const keepAlpha = sniffed === 'image/png' && meta.hasAlpha === true;
  let body: Buffer;
  let info: OutputInfo;
  try {
    ({ data: body, info } = keepAlpha
      ? await base.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
      : await base
          .flatten({ background: '#ffffff' })
          .jpeg({ quality: 85, mozjpeg: true })
          .toBuffer({ resolveWithObject: true }));
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  if (Math.min(info.width, info.height) < MIN_SIDE) return { ok: false, reason: 'too_small' };

  const { data: pixels, info: small } = await sharp(body)
    .resize(32, 32, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const blurhash = encode(new Uint8ClampedArray(pixels), small.width, small.height, 4, 3);

  return {
    ok: true,
    body,
    contentType: keepAlpha ? 'image/png' : 'image/jpeg',
    width: info.width,
    height: info.height,
    blurhash,
  };
}
