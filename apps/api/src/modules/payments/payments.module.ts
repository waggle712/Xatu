import { Module, type OnModuleInit } from '@nestjs/common';
import { IdempotencyInterceptor } from '../../common/idempotency.js';
import { RateLimitGuard } from '../../common/rate-limit.js';
import { OutboxRelay } from '../../outbox/outbox.relay.js';
import { IdentityModule } from '../identity/identity.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsPoller } from './payments.poller.js';
import { PaymentsService } from './payments.service.js';
import { HttpRazorpayClient, RAZORPAY_CLIENT } from './razorpay.client.js';
import { WebhookProcessor } from './webhook.processor.js';

/**
 * Payments (Razorpay, test mode only): its own state machine, separate from orders. Owns
 * payments and payment_webhook_events. Talks to orders through OrdersService and the outbox
 * (`payment.verified` out, `order.refund_needed` in).
 */
@Module({
  imports: [IdentityModule, OrdersModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    WebhookProcessor,
    PaymentsPoller,
    RateLimitGuard,
    IdempotencyInterceptor,
    { provide: RAZORPAY_CLIENT, useClass: HttpRazorpayClient },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule implements OnModuleInit {
  constructor(
    private readonly relay: OutboxRelay,
    private readonly payments: PaymentsService,
  ) {}

  onModuleInit(): void {
    this.relay.on('order.refund_needed', (m) =>
      this.payments.onRefundNeeded(
        m.payload as { orderId: string; paymentId: string; reason: string },
      ),
    );
  }
}
