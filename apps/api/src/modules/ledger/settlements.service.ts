import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { LedgerService } from './ledger.service.js';
import { deductionsPosting, sellerAccountCode } from './postings.js';
import { pickRate, type SettlementLine, settlementLine } from './settlement-math.js';

/** Orders settle 48 hours after completion (the dispute window). */
export const DISPUTE_WINDOW_MS = 48 * 60 * 60_000;

/** The calendar day in India (YYYY-MM-DD) as a date-only value. */
export function istDay(at: Date): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(at);
  return new Date(`${ymd}T00:00:00Z`);
}

/**
 * Nightly (01:00 IST): one settlement batch per seller per day for orders completed more than
 * 48 hours ago and still `completed` (not disputed or refunded). Each order gets one line, ever,
 * with the rates it used (from dated config, at its completion time) and its deductions posted
 * to the ledger in the same transaction. Batches wait for finance approval; no Route transfers.
 */
@Injectable()
export class SettlementsService {
  private readonly logger = new Logger(SettlementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly ledger: LedgerService,
  ) {}

  /** Safe to run any number of times: an order already in a batch is never added again. */
  async createBatches(now: Date): Promise<number> {
    const candidates = await this.orders.settlementCandidates(
      new Date(now.getTime() - DISPUTE_WINDOW_MS),
    );
    if (candidates.length === 0) return 0;
    const settled = await this.prisma.settlementLine.findMany({
      where: { orderId: { in: candidates } },
      select: { orderId: true },
    });
    const done = new Set(settled.map((l) => l.orderId));
    const facts = await this.orders.ledgerFacts(candidates.filter((id) => !done.has(id)));
    const rates = await this.prisma.financeRate.findMany();
    const bySeller = new Map<
      string,
      {
        orderId: string;
        line: SettlementLine;
        at: Date;
        itemsPaise: bigint;
        deliveryPaise: bigint;
        r: { tcsBps: number; tdsBps: number; commissionGstBps: number };
      }[]
    >();
    for (const order of facts.values()) {
      const at = order.completedAt!;
      try {
        const r = {
          tcsBps: pickRate(rates, 'tcs', at),
          tdsBps: pickRate(rates, 'tds', at),
          commissionGstBps: pickRate(rates, 'commission_gst', at),
        };
        const line = settlementLine({
          itemsPaise: order.subtotalPaise,
          deliveryPaise: order.deliveryFeePaise,
          commissionPaise: order.commissionPaise,
          rates: r,
        });
        const list = bySeller.get(order.sellerId) ?? [];
        list.push({
          orderId: order.id,
          line,
          at,
          itemsPaise: order.subtotalPaise,
          deliveryPaise: order.deliveryFeePaise,
          r,
        });
        bySeller.set(order.sellerId, list);
      } catch (err) {
        // Missing rate or a negative payout: flag it, never guess or settle it.
        await this.prisma.reconciliationIssue.createMany({
          data: { kind: 'settlement_blocked', entityId: order.id, details: { error: String(err) } },
          skipDuplicates: true,
        });
        Sentry.captureMessage(`Order ${order.id} can't be settled: ${String(err)}`, 'error');
      }
    }

    const day = istDay(now);
    let lines = 0;
    for (const [sellerId, list] of bySeller) {
      await this.prisma.$transaction(async (tx) => {
        const batch =
          (await tx.settlementBatch.findUnique({
            where: { sellerId_businessDay: { sellerId, businessDay: day } },
          })) ??
          (await tx.settlementBatch.create({
            data: {
              sellerId,
              businessDay: day,
              grossPaise: 0n,
              commissionPaise: 0n,
              commissionGstPaise: 0n,
              tcsPaise: 0n,
              tdsPaise: 0n,
              netPaise: 0n,
            },
          }));
        if (batch.status !== 'pending_approval') return; // approved already: these wait for tomorrow
        const sum = { gross: 0n, commission: 0n, gst: 0n, tcs: 0n, tds: 0n, net: 0n };
        for (const { orderId, line, at, itemsPaise, deliveryPaise, r } of list) {
          const { count } = await tx.settlementLine.createMany({
            data: {
              batchId: batch.id,
              orderId,
              itemsPaise,
              deliveryPaise,
              grossPaise: line.grossPaise,
              commissionPaise: line.commissionPaise,
              commissionGstPaise: line.commissionGstPaise,
              tcsPaise: line.tcsPaise,
              tdsPaise: line.tdsPaise,
              netPaise: line.netPaise,
              tcsBps: r.tcsBps,
              tdsBps: r.tdsBps,
              commissionGstBps: r.commissionGstBps,
              ratesAt: at,
            },
            skipDuplicates: true,
          });
          if (count === 0) continue; // a parallel run settled it
          await this.ledger.post(
            deductionsPosting({ orderId, sellerAccount: sellerAccountCode(sellerId), line }),
            tx,
          );
          sum.gross += line.grossPaise;
          sum.commission += line.commissionPaise;
          sum.gst += line.commissionGstPaise;
          sum.tcs += line.tcsPaise;
          sum.tds += line.tdsPaise;
          sum.net += line.netPaise;
          lines += 1;
        }
        await tx.settlementBatch.update({
          where: { id: batch.id },
          data: {
            grossPaise: { increment: sum.gross },
            commissionPaise: { increment: sum.commission },
            commissionGstPaise: { increment: sum.gst },
            tcsPaise: { increment: sum.tcs },
            tdsPaise: { increment: sum.tds },
            netPaise: { increment: sum.net },
          },
        });
      });
    }
    if (lines > 0)
      this.logger.log(
        `Settlement: ${lines} order(s) batched for ${day.toISOString().slice(0, 10)}`,
      );
    return lines;
  }
}
