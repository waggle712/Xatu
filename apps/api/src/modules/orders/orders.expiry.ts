import { Injectable, Logger } from '@nestjs/common';
import { OrdersService } from './orders.service.js';

/**
 * Unpaid orders past their hold time become `expired` and their holds end. No schedule of its
 * own: the payments poller runs this every minute AFTER asking Razorpay about orders due to
 * expire, so a payment made just in time is never lost to expiry. Checkout never depends on it:
 * holds past `expires_at` already don't count as held.
 */
@Injectable()
export class OrdersExpiry {
  private readonly logger = new Logger(OrdersExpiry.name);

  constructor(private readonly orders: OrdersService) {}

  /** Exposed for tests and the poller. Returns how many orders expired. */
  async expireDue(): Promise<number> {
    const n = await this.orders.expireDue();
    if (n > 0) this.logger.log(`Expired ${n} unpaid order(s)`);
    return n;
  }
}
