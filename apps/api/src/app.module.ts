import { Module } from '@nestjs/common';
import { SentryModule } from '@sentry/nestjs/setup';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { HealthModule } from './health/health.module.js';
import { OutboxModule } from './outbox/outbox.module.js';
import { domainModules } from './modules/index.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';

@Module({
  imports: [
    SentryModule.forRoot(),
    PrismaModule,
    RedisModule,
    AnalyticsModule,
    HealthModule,
    OutboxModule,
    ...domainModules,
  ],
})
export class AppModule {}
