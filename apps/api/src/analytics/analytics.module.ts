import { Global, Module } from '@nestjs/common';
import { PostHog } from 'posthog-node';
import { env } from '../config/env.js';
import { ANALYTICS_CLIENT, type AnalyticsClient, AnalyticsService } from './analytics.service.js';

@Global()
@Module({
  providers: [
    {
      provide: ANALYTICS_CLIENT,
      useFactory: (): AnalyticsClient | null =>
        env.POSTHOG_API_KEY
          ? new PostHog(env.POSTHOG_API_KEY, {
              host: env.POSTHOG_HOST,
              flushAt: 20,
              flushInterval: 10_000,
            })
          : null,
    },
    AnalyticsService,
  ],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
