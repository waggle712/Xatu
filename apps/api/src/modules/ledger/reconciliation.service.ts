import { Inject, Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { RAZORPAY_CLIENT, type RazorpayClient } from '../payments/razorpay.client.js';
import { LedgerService } from './ledger.service.js';
import {
  gatewayFeePosting,
  providerSettlementPosting,
  refundSettlementPosting,
} from './postings.js';
import { istDay } from './settlements.service.js';

/** A verified payment not in any settlement report this long after is flagged (Razorpay is ~T+2). */
const MISSING_AFTER_MS = 3 * 86_400_000;

/**
 * Nightly (02:00 IST): compares yesterday's Razorpay settlement report with our records. Posts
 * Razorpay's fee (GST on it apart) and money settled to the bank; flags amount mismatches, items
 * we don't know and our payments missing from every report. Each issue is stored once and
 * alerted once. Also runs the ledger completeness check. Test mode doesn't settle, so this is
 * exercised with a fake report until there is live money.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly ledger: LedgerService,
    @Inject(RAZORPAY_CLIENT) private readonly razorpay: RazorpayClient,
  ) {}

  /** Returns how many NEW issues were raised (each alerted once). */
  async reconcile(day: Date): Promise<number> {
    const businessDay = istDay(day);
    const items = await this.razorpay.fetchSettlementRecon(day);
    await this.prisma.reconciliationItem.createMany({
      data: items.map((i) => ({
        entityId: i.entity_id,
        type: i.type,
        amountPaise: BigInt(i.amount),
        feePaise: BigInt(i.fee),
        taxPaise: BigInt(i.tax),
        settled: i.settled,
        day: businessDay,
      })),
      skipDuplicates: true,
    });

    const issues: { kind: string; entityId: string; details: object }[] = [];
    const refunds = new Map(
      (await this.payments.completedRefunds()).map((r) => [r.providerRefundId, r]),
    );
    for (const item of items) {
      if (item.type === 'payment') {
        const ours = await this.payments.byProviderPaymentId(item.entity_id);
        if (!ours) {
          issues.push({ kind: 'unknown_in_report', entityId: item.entity_id, details: { item } });
          continue;
        }
        if (BigInt(item.amount) !== ours.amountPaise) {
          issues.push({
            kind: 'amount_mismatch',
            entityId: item.entity_id,
            details: { ours: String(ours.amountPaise), razorpay: item.amount, paymentId: ours.id },
          });
          continue;
        }
        await this.ledger.post(
          gatewayFeePosting({
            entityId: item.entity_id,
            feePaise: BigInt(item.fee),
            taxPaise: BigInt(item.tax),
          }),
        );
        if (item.settled) {
          await this.ledger.post(
            providerSettlementPosting({
              entityId: item.entity_id,
              amountPaise: BigInt(item.amount) - BigInt(item.fee),
            }),
          );
        }
      } else if (item.type === 'refund') {
        const ours = refunds.get(item.entity_id);
        if (!ours) {
          issues.push({ kind: 'unknown_in_report', entityId: item.entity_id, details: { item } });
        } else if (BigInt(item.amount) !== ours.amountPaise) {
          issues.push({
            kind: 'amount_mismatch',
            entityId: item.entity_id,
            details: { ours: String(ours.amountPaise), razorpay: item.amount },
          });
        } else if (item.settled) {
          // Razorpay takes refunds out of the settlement: less reached the bank.
          await this.ledger.post(
            refundSettlementPosting({ entityId: item.entity_id, amountPaise: BigInt(item.amount) }),
          );
        }
      } else {
        issues.push({ kind: 'needs_review', entityId: item.entity_id, details: { item } });
      }
    }

    // Our captured payments that no report has shown after T+3.
    const seen = new Set(
      (
        await this.prisma.reconciliationItem.findMany({
          where: { type: 'payment' },
          select: { entityId: true },
        })
      ).map((i) => i.entityId),
    );
    const cutoff = new Date(day.getTime() - MISSING_AFTER_MS);
    for (const p of await this.payments.capturedPayments()) {
      if (
        p.providerPaymentId &&
        p.verifiedAt &&
        p.verifiedAt < cutoff &&
        !seen.has(p.providerPaymentId)
      ) {
        issues.push({
          kind: 'missing_in_report',
          entityId: p.providerPaymentId,
          details: { paymentId: p.id },
        });
      }
    }

    const { count } = await this.prisma.reconciliationIssue.createMany({
      data: issues.map((i) => ({ kind: i.kind, entityId: i.entityId, details: i.details })),
      skipDuplicates: true,
    });
    if (count > 0) {
      Sentry.captureMessage(
        `Reconciliation ${businessDay.toISOString().slice(0, 10)}: ${count} new mismatch(es)`,
        'error',
      );
      this.logger.error(`Reconciliation found ${count} new mismatch(es)`);
    }
    await this.prisma.reconciliationRun.upsert({
      where: { day: businessDay },
      create: { day: businessDay, items: items.length, issues: count, finishedAt: new Date() },
      update: { items: items.length, issues: { increment: count }, finishedAt: new Date() },
    });
    await this.ledger.backfill();
    return count;
  }
}
