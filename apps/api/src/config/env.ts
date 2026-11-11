import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  /** Firebase project whose phone-auth ID tokens we accept. */
  FIREBASE_PROJECT_ID: z.string().min(1),
  /** HS256 secret for our own access tokens. At least 32 random characters. */
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  /** Set to 1 behind a load balancer so rate limits see the real client IP. */
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  /**
   * Local development only: accept "dev|<phone>|123456" instead of a Firebase token, so the
   * app can be run before a Firebase project exists. Refused when NODE_ENV=production.
   */
  /** Sentry error tracking. Leave empty to disable (local development). */
  SENTRY_DSN: z.union([z.string().url(), z.literal('')]).default(''),
  /** e.g. development, staging, production. Shown on every Sentry event. */
  SENTRY_ENVIRONMENT: z.string().default('development'),
  /** PostHog project API key. Leave empty to disable analytics. */
  POSTHOG_API_KEY: z.string().default(''),
  POSTHOG_HOST: z.string().url().default('https://eu.i.posthog.com'),
  /** Public base URL of this API (used for local media URLs). */
  PUBLIC_API_URL: z.string().url().default('http://localhost:3000'),
  /** Run background workers (BullMQ) in this process. The API container sets false; the worker sets true. */
  RUN_WORKERS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** local = files on disk (development, tests); r2 = Cloudflare R2 + image transformations. */
  MEDIA_STORAGE: z.enum(['local', 'r2']).default('local'),
  MEDIA_LOCAL_DIR: z.string().default('.media'),
  /** Signs local upload tickets. Defaults to a value derived from JWT_SECRET. */
  MEDIA_SIGNING_SECRET: z.string().min(32).optional(),
  R2_ACCOUNT_ID: z.string().default(''),
  R2_ACCESS_KEY_ID: z.string().default(''),
  R2_SECRET_ACCESS_KEY: z.string().default(''),
  R2_BUCKET: z.string().default(''),
  /** Cloudflare zone in front of the bucket with Image Transformations on, e.g. https://img.example.in */
  MEDIA_PUBLIC_BASE_URL: z.string().default(''),
  /**
   * Public web address for share links and their preview pages, e.g. https://example.in (no
   * trailing slash). Empty = share links use PUBLIC_API_URL (local development).
   */
  PUBLIC_WEB_URL: z.union([z.string().url(), z.literal('')]).default(''),
  /** Apple Developer Team ID for iOS universal links. Empty = no apple-app-site-association. */
  APPLE_TEAM_ID: z
    .string()
    .regex(/^([A-Z0-9]{10})?$/, 'APPLE_TEAM_ID is 10 capital letters or digits')
    .default(''),
  /**
   * SHA-256 fingerprints of the Android signing certificates (Play app signing key, plus the
   * upload key if wanted), comma separated, for Android App Links. Empty = no assetlinks.json.
   */
  ANDROID_CERT_SHA256: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((f) => f.trim().toUpperCase())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().regex(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/, 'Bad SHA-256 fingerprint'))),
  /** App Store page for the preview page's download button. Empty = no App Store button. */
  APP_STORE_URL: z.union([z.string().url(), z.literal('')]).default(''),
  AUTH_DEV_BYPASS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof envSchema>;

/** Reads and validates environment variables once; fails fast with a clear message. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${problems}`);
  }
  const d = parsed.data;
  if (d.MEDIA_STORAGE === 'r2') {
    const missing = (
      [
        'R2_ACCOUNT_ID',
        'R2_ACCESS_KEY_ID',
        'R2_SECRET_ACCESS_KEY',
        'R2_BUCKET',
        'MEDIA_PUBLIC_BASE_URL',
      ] as const
    ).filter((k) => !d[k]);
    if (missing.length)
      throw new Error(`Invalid environment: MEDIA_STORAGE=r2 needs ${missing.join(', ')}`);
  }
  if (d.MEDIA_STORAGE === 'local' && d.NODE_ENV === 'production') {
    throw new Error('Invalid environment: MEDIA_STORAGE=local is for development only');
  }
  if (parsed.data.AUTH_DEV_BYPASS && parsed.data.NODE_ENV === 'production') {
    throw new Error('Invalid environment: AUTH_DEV_BYPASS must never be enabled in production');
  }
  return parsed.data;
}

export const env = loadEnv();
