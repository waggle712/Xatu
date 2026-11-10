import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ANALYTICS_CLIENT, type AnalyticsClient } from '../src/analytics/analytics.service.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { FirebaseVerifier } from '../src/modules/identity/firebase-verifier.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Runs against Testcontainers (see test/global-setup.ts).
describe('Analytics outage (e2e)', () => {
  let app: INestApplication;

  const brokenAnalytics: AnalyticsClient = {
    capture: () => {
      throw new Error('PostHog is down');
    },
    shutdown: async () => {
      throw new Error('PostHog is down');
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FirebaseVerifier)
      .useValue({
        verify: async () => ({ firebaseUid: 'test-analytics-outage', phone: '+917000000999' }),
      })
      .overrideProvider(ANALYTICS_CLIENT)
      .useValue(brokenAnalytics)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    const prisma = app.get(PrismaService);
    const user = await prisma.user.findUnique({ where: { firebaseUid: 'test-analytics-outage' } });
    if (user) {
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
    await app.close();
  });

  it('still signs a new user in when analytics throws', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/session')
      .send({ firebaseIdToken: 'anything' })
      .expect(200);
    expect(res.body.isNewUser).toBe(true);
  });
});
