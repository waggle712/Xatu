import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  type AnalyticsEventName,
  type AnalyticsEventProps,
  parseAnalyticsEvent,
} from '@xatu/shared';

/** The part of the PostHog client we use; swapped for a fake in tests. */
export interface AnalyticsClient {
  capture(input: { distinctId: string; event: string; properties: Record<string, unknown> }): void;
  shutdown(): Promise<void>;
}

export const ANALYTICS_CLIENT = Symbol('ANALYTICS_CLIENT');

/**
 * Server-side pilot analytics. Fire-and-forget: a failure here is logged and never
 * changes the outcome of the request, order or payment that triggered it.
 */
@Injectable()
export class AnalyticsService implements OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(@Inject(ANALYTICS_CLIENT) private readonly client: AnalyticsClient | null) {}

  /** distinctId is always the Xatu user id (UUID), never a phone number. */
  capture<E extends AnalyticsEventName>(
    distinctId: string,
    event: E,
    props: AnalyticsEventProps<E>,
  ): void {
    if (!this.client) return;
    try {
      const properties = parseAnalyticsEvent(event, props);
      this.client.capture({ distinctId, event, properties });
    } catch (err) {
      this.logger.warn(
        `Analytics event ${event} dropped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.shutdown().catch(() => undefined);
  }
}
