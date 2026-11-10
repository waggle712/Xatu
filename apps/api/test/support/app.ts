import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { ANALYTICS_CLIENT, type AnalyticsClient } from '../../src/analytics/analytics.service.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { RATE_LIMIT_KEY_PREFIX } from '../../src/common/rate-limit.js';
import { REDIS } from '../../src/redis/redis.module.js';
import {
  FirebaseVerifier,
  InvalidFirebaseTokenError,
  type VerifiedPhoneIdentity,
} from '../../src/modules/identity/firebase-verifier.js';

/** Accepts tokens shaped "ok|<uid>|<phone>". */
export class FakeFirebaseVerifier extends FirebaseVerifier {
  async verify(idToken: string): Promise<VerifiedPhoneIdentity> {
    const [kind, uid, phone] = idToken.split('|');
    if (kind !== 'ok' || !uid || !phone) throw new InvalidFirebaseTokenError('bad token');
    return { firebaseUid: uid, phone };
  }
}

export interface RecordedEvent {
  distinctId: string;
  event: string;
  properties: Record<string, unknown>;
}

/** Boots the real app against the Testcontainers database, with Firebase and analytics faked. */
export async function createTestApp(): Promise<{ app: INestApplication; events: RecordedEvent[] }> {
  const events: RecordedEvent[] = [];
  const analytics: AnalyticsClient = {
    capture: (e) => void events.push(e),
    shutdown: async () => undefined,
  };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(FirebaseVerifier)
    .useClass(FakeFirebaseVerifier)
    .overrideProvider(ANALYTICS_CLIENT)
    .useValue(analytics)
    .compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return { app, events };
}

/** Clears rate-limit counters, since every test request comes from the same IP. */
export async function clearRateLimits(app: INestApplication): Promise<void> {
  const redis = app.get<Redis>(REDIS);
  const keys = await redis.keys(`${RATE_LIMIT_KEY_PREFIX}*`);
  if (keys.length) await redis.del(...keys);
}

let counter = 0;

/** Signs a brand-new user in and returns their access token and id. */
export async function signInNewUser(
  app: INestApplication,
): Promise<{ token: string; userId: string }> {
  counter += 1;
  const n = `${Date.now() % 1_000_000}`.padStart(6, '0') + String(counter % 1000).padStart(3, '0');
  const res = await request(app.getHttpServer())
    .post('/auth/session')
    .send({ firebaseIdToken: `ok|test-user-${n}|+917${n}`, language: 'en' })
    .expect(200);
  return { token: res.body.accessToken as string, userId: res.body.user.id as string };
}
