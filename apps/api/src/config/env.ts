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
  if (parsed.data.AUTH_DEV_BYPASS && parsed.data.NODE_ENV === 'production') {
    throw new Error('Invalid environment: AUTH_DEV_BYPASS must never be enabled in production');
  }
  return parsed.data;
}

export const env = loadEnv();
