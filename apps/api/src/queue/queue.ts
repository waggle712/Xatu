import { Redis } from 'ioredis';
import { env } from '../config/env.js';

/** BullMQ needs its own Redis connections with retries disabled per request. */
export function bullConnection(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });
}

export const QUEUES = {
  media: 'media',
  mediaDeadLetter: 'media-dead-letter',
} as const;
