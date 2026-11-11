import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import {
  allocationPosting,
  type Posting,
  receiptPosting,
  refundPosting,
  sellerAccountCode,
} from './postings.js';

export type Tx = Prisma.TransactionClient;

/**
 * The append-only, double-entry ledger. Every posting comes from a pure builder (postings.ts),
 * is balanced (checked again by a deferred trigger at commit) and posts exactly once (unique
 * idempotency key, ON CONFLICT DO NOTHING, so a repeat is a quiet no-op inside any transaction).
 * The app's database role can only SELECT and INSERT here; mistakes are fixed with reversing
 * transactions, never edits.
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
  ) {}

  /** Posts one transaction. Returns false when there was nothing to post or it was already posted. */
  async post(posting: Posting | null, tx?: Tx): Promise<boolean> {
    if (!posting) return false;
    const run = async (t: Tx) => {
      const codes = [...new Set(posting.entries.map((e) => e.account))];
      await this.ensureSellerAccounts(t, codes);
      const accounts = await t.ledgerAccount.findMany({ where: { code: { in: codes } } });
      const idOf = new Map(accounts.map((a) => [a.code, a.id]));
      const missing = codes.filter((c) => !idOf.has(c));
      if (missing.length) throw new Error(`Unknown ledger accounts: ${missing.join(', ')}`);
      const id = randomUUID();
      const inserted = await t.$queryRaw<{ id: string }[]>`
        INSERT INTO ledger_transactions (id, idempotency_key, kind, reference_id, description, posted_at, created_at, updated_at)
        VALUES (${id}::uuid, ${posting.idempotencyKey}, ${posting.kind}, ${posting.referenceId}, ${posting.description}, now(), now(), now())
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id`;
      if (inserted.length === 0) return false; // already posted
      await t.ledgerEntry.createMany({
        data: posting.entries.map((e) => ({
          transactionId: id,
          accountId: idOf.get(e.account)!,
          direction: e.direction,
          amountPaise: e.amountPaise,
        })),
      });
      return true;
    };
    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  /** Seller payable accounts are made on first use (INSERT only; no upsert, no UPDATE grant). */
  private async ensureSellerAccounts(t: Tx, codes: string[]): Promise<void> {
    const sellers = codes.filter((c) => c.startsWith('seller_payable:'));
    if (sellers.length === 0) return;
    await t.ledgerAccount.createMany({
      data: sellers.map((code) => ({
        code,
        name: `Payable to seller ${code.slice('seller_payable:'.length)}`,
        type: 'liability' as const,
        sellerId: code.slice('seller_payable:'.length),
      })),
      skipDuplicates: true,
    });
  }

  // ── Handlers (outbox; at least once, so every one is safe to repeat) ──

  /** payment.verified: the captured money, owed to the buyer until an order uses it. */
  onPaymentVerified(p: { paymentId: string; amountPaise: number }) {
    return this.post(
      receiptPosting({ paymentId: p.paymentId, amountPaise: BigInt(p.amountPaise) }),
    );
  }

  /** order.placed: the whole order total becomes owed to the seller. */
  async onOrderPlaced(orderId: string) {
    const order = (await this.orders.ledgerFacts([orderId])).get(orderId);
    if (!order) return false;
    return this.post(
      allocationPosting({
        orderId,
        sellerAccount: sellerAccountCode(order.sellerId),
        totalPaise: order.totalPaise,
      }),
    );
  }

  /** payment.refunded: Razorpay sent the money back to the buyer. */
  onPaymentRefunded(p: { refundId: string; amountPaise: number }) {
    return this.post(refundPosting({ refundId: p.refundId, amountPaise: BigInt(p.amountPaise) }));
  }

  /**
   * Completeness check (nightly, and after deploy): every captured payment has its capture,
   * every placed order its seller payable, every processed refund its refund posting. Catches
   * lost handler runs and backfills payments from before the ledger existed. Same idempotency
   * keys, so nothing posts twice. Returns how many were missing.
   */
  async backfill(): Promise<number> {
    let posted = 0;
    for (const p of await this.payments.capturedPayments()) {
      if (await this.post(receiptPosting({ paymentId: p.id, amountPaise: p.amountPaise })))
        posted += 1;
    }
    for (const orderId of await this.orders.placedOrderIds()) {
      if (await this.onOrderPlaced(orderId)) posted += 1;
    }
    for (const r of await this.payments.completedRefunds()) {
      if (await this.post(refundPosting({ refundId: r.id, amountPaise: r.amountPaise })))
        posted += 1;
    }
    if (posted > 0) this.logger.warn(`Ledger backfill posted ${posted} missing transaction(s)`);
    return posted;
  }
}
