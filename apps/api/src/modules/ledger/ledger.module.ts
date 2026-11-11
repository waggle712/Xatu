import { Module, type OnModuleInit } from '@nestjs/common';
import { OutboxRelay } from '../../outbox/outbox.relay.js';
import { OrdersModule } from '../orders/orders.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { FinanceService } from './finance.service.js';
import { LedgerJobs } from './ledger.jobs.js';
import { LedgerService } from './ledger.service.js';
import { ReconciliationService } from './reconciliation.service.js';
import { SettlementsService } from './settlements.service.js';

/**
 * Ledger: the append-only double-entry ledger, dated finance rates, seller settlements and the
 * nightly reconciliation with Razorpay. Owns ledger_*, finance_rates, settlement_* and
 * reconciliation_* tables. Learns about money from the outbox (payment.verified, order.placed,
 * payment.refunded) and reads orders and payments only through their services.
 */
@Module({
  imports: [OrdersModule, PaymentsModule, ProfilesModule],
  providers: [LedgerService, SettlementsService, FinanceService, ReconciliationService, LedgerJobs],
  exports: [LedgerService, FinanceService],
})
export class LedgerModule implements OnModuleInit {
  constructor(
    private readonly relay: OutboxRelay,
    private readonly ledger: LedgerService,
  ) {}

  onModuleInit(): void {
    this.relay.on('payment.verified', (m) =>
      this.ledger
        .onPaymentVerified(m.payload as { paymentId: string; amountPaise: number })
        .then(() => undefined),
    );
    this.relay.on('order.placed', (m) =>
      this.ledger.onOrderPlaced(m.aggregateId).then(() => undefined),
    );
    this.relay.on('payment.refunded', (m) =>
      this.ledger
        .onPaymentRefunded(m.payload as { refundId: string; amountPaise: number })
        .then(() => undefined),
    );
  }
}
