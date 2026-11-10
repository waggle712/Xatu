import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { IMAGE_VARIANTS as SIZES } from '@xatu/shared';
import sharp from 'sharp';
import { env } from '../../config/env.js';
import type { ImageVariants, MediaStorage } from './storage.js';

const root = resolve(env.MEDIA_LOCAL_DIR);
const secret =
  env.MEDIA_SIGNING_SECRET ??
  createHmac('sha256', env.JWT_SECRET).update('media-local').digest('hex');

/** Resolves a key inside the media folder; refuses anything that would escape it. */
export function localPath(key: string): string {
  const full = resolve(root, normalize(key));
  if (!full.startsWith(root + sep)) throw new Error('Invalid media key');
  return full;
}

export interface LocalUploadClaims {
  key: string;
  contentType: string;
  byteSize: number;
  exp: number;
}

export function signUploadToken(claims: LocalUploadClaims): string {
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyUploadToken(token: string): LocalUploadClaims | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString()) as LocalUploadClaims;
  return claims.exp * 1000 > Date.now() ? claims : null;
}

/** Development and tests: files in MEDIA_LOCAL_DIR, uploads through a signed API route. */
export class LocalStorage implements MediaStorage {
  async createUploadUrl(input: {
    key: string;
    contentType: string;
    byteSize: number;
    expiresInSeconds: number;
  }) {
    const token = signUploadToken({
      key: input.key,
      contentType: input.contentType,
      byteSize: input.byteSize,
      exp: Math.floor(Date.now() / 1000) + input.expiresInSeconds,
    });
    return {
      url: `${env.PUBLIC_API_URL}/media/local/upload/${token}`,
      headers: { 'Content-Type': input.contentType },
    };
  }

  async read(key: string): Promise<Buffer | null> {
    try {
      return await readFile(localPath(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async write(key: string, body: Buffer): Promise<void> {
    const path = localPath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async delete(key: string): Promise<void> {
    await rm(localPath(key), { force: true });
  }
}

/** Development and tests: writes the three sizes next to the original with sharp. */
export class LocalImageVariants implements ImageVariants {
  urls(storageKey: string) {
    const url = (name: string) =>
      `${env.PUBLIC_API_URL}/media/local/file/${variantKey(storageKey, name)}`;
    return { thumb: url('thumb'), card: url('card'), full: url('full') };
  }

  async register(storageKey: string, original: Buffer): Promise<void> {
    for (const [name, width] of Object.entries(SIZES)) {
      const out = await sharp(original)
        .resize({ width, withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      const path = localPath(variantKey(storageKey, name));
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, out);
    }
  }
}

function variantKey(storageKey: string, name: string): string {
  return join('variants', name, storageKey).split(sep).join('/');
}
