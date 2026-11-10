import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { ANALYTICS_CLIENT, type AnalyticsClient } from '../src/analytics/analytics.service.js';
import { RATE_LIMIT_KEY_PREFIX } from '../src/common/rate-limit.js';
import { env } from '../src/config/env.js';
import {
  FirebaseVerifier,
  InvalidFirebaseTokenError,
  type VerifiedPhoneIdentity,
} from '../src/modules/identity/firebase-verifier.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

/** Accepts tokens shaped "ok|<uid>|<phone>"; anything else is invalid. */
class FakeFirebaseVerifier extends FirebaseVerifier {
  async verify(idToken: string): Promise<VerifiedPhoneIdentity> {
    const [kind, uid, phone] = idToken.split('|');
    if (kind !== 'ok' || !uid || !phone) throw new InvalidFirebaseTokenError('bad token');
    return { firebaseUid: uid, phone };
  }
}

// Runs against Testcontainers (see test/global-setup.ts).
describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const redis = new Redis(env.REDIS_URL);
  const run = Date.now().toString().slice(-6);
  // +91 and 10 digits: 7, six from the run, then a 3-digit index (unique per test).
  const phone = (n: number) => `+917${run}${String(n).padStart(3, '0')}`;
  const uid = (n: number) => `test-${run}-${n}`;
  const token = (n: number) => `ok|${uid(n)}|${phone(n)}`;

  const clearRateLimits = async () => {
    const keys = await redis.keys(`${RATE_LIMIT_KEY_PREFIX}*`);
    if (keys.length) await redis.del(...keys);
  };

  const analyticsEvents: {
    distinctId: string;
    event: string;
    properties: Record<string, unknown>;
  }[] = [];
  const recordingAnalytics: AnalyticsClient = {
    capture: (input) => void analyticsEvents.push(input),
    shutdown: async () => undefined,
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FirebaseVerifier)
      .useClass(FakeFirebaseVerifier)
      .overrideProvider(ANALYTICS_CLIENT)
      .useValue(recordingAnalytics)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(clearRateLimits);

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { firebaseUid: { startsWith: `test-${run}` } },
    });
    const ids = users.map((u) => u.id);
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await clearRateLimits();
    await redis.quit();
    await app.close();
  });

  const signIn = (n: number) =>
    request(app.getHttpServer())
      .post('/auth/session')
      .send({ firebaseIdToken: token(n), language: 'en' });

  it('creates a new user on first sign-in and returns tokens', async () => {
    const res = await signIn(1).expect(200);
    expect(res.body.isNewUser).toBe(true);
    expect(res.body.user).toMatchObject({
      phone: phone(1),
      language: 'en',
      roles: ['buyer'],
      isSeller: false,
    });
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));

    const outbox = await prisma.outboxEvent.count({
      where: { topic: 'identity.user_signed_up', aggregateId: res.body.user.id },
    });
    expect(outbox).toBe(1);
  });

  it('sends buyer_signed_up once, keyed by user id, with no phone number', async () => {
    const first = await signIn(10).expect(200);
    await signIn(10).expect(200);
    const mine = analyticsEvents.filter((e) => e.distinctId === first.body.user.id);
    expect(mine).toEqual([
      { distinctId: first.body.user.id, event: 'buyer_signed_up', properties: { language: 'en' } },
    ]);
    expect(JSON.stringify(mine)).not.toContain(phone(10).slice(3));
  });

  it('returns the same user on the next sign-in', async () => {
    const first = await signIn(2).expect(200);
    const second = await signIn(2).expect(200);
    expect(second.body.isNewUser).toBe(false);
    expect(second.body.user.id).toBe(first.body.user.id);
    expect(await prisma.user.count({ where: { phone: phone(2) } })).toBe(1);
  });

  it('stores refresh tokens hashed, never in plain text', async () => {
    const res = await signIn(3).expect(200);
    const sessions = await prisma.session.findMany({ where: { userId: res.body.user.id } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.refreshTokenHash).not.toBe(res.body.refreshToken);
  });

  it('rejects an invalid Firebase token', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/session')
      .send({ firebaseIdToken: 'forged' })
      .expect(401);
    expect(res.body.error.code).toBe('invalid_firebase_token');
  });

  it('rejects a malformed body with the validation error format', async () => {
    const res = await request(app.getHttpServer()).post('/auth/session').send({}).expect(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(res.body.error.details[0].path).toBe('firebaseIdToken');
  });

  it('GET /me needs a valid access token', async () => {
    await request(app.getHttpServer()).get('/me').expect(401);
    await request(app.getHttpServer()).get('/me').set('Authorization', 'Bearer nope').expect(401);

    const session = await signIn(4).expect(200);
    const me = await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer ${session.body.accessToken}`)
      .expect(200);
    expect(me.body).toMatchObject({ id: session.body.user.id, phone: phone(4) });
  });

  it('blocks suspended users even with a valid access token', async () => {
    const session = await signIn(5).expect(200);
    await prisma.user.update({
      where: { id: session.body.user.id },
      data: { status: 'suspended' },
    });
    const res = await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer ${session.body.accessToken}`)
      .expect(403);
    expect(res.body.error.code).toBe('account_suspended');
    await signIn(5).expect(403);
  });

  it('rotates refresh tokens, and reuse of an old one revokes every session', async () => {
    const session = await signIn(6).expect(200);
    const old = session.body.refreshToken;

    const rotated = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: old })
      .expect(200);
    expect(rotated.body.refreshToken).not.toBe(old);

    // Someone replays the old token: refused, and the new one stops working too.
    const replay = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: old })
      .expect(401);
    expect(replay.body.error.code).toBe('invalid_refresh_token');
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: rotated.body.refreshToken })
      .expect(401);

    const active = await prisma.session.count({
      where: { userId: session.body.user.id, revokedAt: null },
    });
    expect(active).toBe(0);
  });

  it('logout revokes the session and is idempotent', async () => {
    const session = await signIn(7).expect(200);
    const body = { refreshToken: session.body.refreshToken };
    await request(app.getHttpServer()).post('/auth/logout').send(body).expect(204);
    await request(app.getHttpServer()).post('/auth/logout').send(body).expect(204);
    await request(app.getHttpServer()).post('/auth/refresh').send(body).expect(401);
  });

  it.runIf(env.AUTH_DEV_BYPASS)(
    'never links a real Firebase account by phone while the development login is on',
    async () => {
      await prisma.user.create({ data: { firebaseUid: `test-${run}-real`, phone: phone(9) } });
      const res = await signIn(9).expect(401);
      expect(res.body.error.code).toBe('invalid_firebase_token');
      const user = await prisma.user.findUniqueOrThrow({ where: { phone: phone(9) } });
      expect(user.firebaseUid).toBe(`test-${run}-real`);
    },
  );

  it('rate-limits sign-in attempts per IP', async () => {
    for (let i = 0; i < 10; i++) {
      await request(app.getHttpServer())
        .post('/auth/session')
        .send({ firebaseIdToken: 'forged' })
        .expect(401);
    }
    const res = await request(app.getHttpServer())
      .post('/auth/session')
      .send({ firebaseIdToken: token(8) })
      .expect(429);
    expect(res.body.error.code).toBe('rate_limited');
    expect(res.headers['retry-after']).toBe('60');
  });
});
