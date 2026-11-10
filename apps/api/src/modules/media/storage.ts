/**
 * Object storage for media. Cloudflare R2 in staging/production, a local folder in
 * development and tests. The rest of the app only sees this interface.
 */
export interface MediaStorage {
  /** A short-lived URL the phone PUTs the file to. The signature pins the type and exact size. */
  createUploadUrl(input: {
    key: string;
    contentType: string;
    byteSize: number;
    expiresInSeconds: number;
  }): Promise<{ url: string; headers: Record<string, string> }>;
  /** Returns null if the object does not exist. */
  read(key: string): Promise<Buffer | null>;
  write(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Builds variant URLs from a storage key at read time and prepares variants when an image is ready. */
export interface ImageVariants {
  urls(storageKey: string): { thumb: string; card: string; full: string };
  /** Makes sure each variant can be served (Cloudflare: warms the transform; local: generates files). */
  register(storageKey: string, original: Buffer): Promise<void>;
}

export const MEDIA_STORAGE = Symbol('MEDIA_STORAGE');
export const IMAGE_VARIANTS = Symbol('IMAGE_VARIANTS');
