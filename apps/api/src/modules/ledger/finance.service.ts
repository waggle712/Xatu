import { Injectable } from '@nestjs/common';
import type { SettlementBatch } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { LedgerService } from './ledger.service.js';
import { payoutPosting, sellerAccountCode } from './postings.js';

/** Spreadsheet-safe CSV cell: always quoted; formulas neutralised (seller names are user input). */
export function csvCell(value: string | number | bigint | null | undefined): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}

const rupees = (paise: bigint) => `${paise / 100n}.${String(paise % 100n).padStart(2, '0')}`;

/**
 * Finance actions on settlement batches, run from the command line by a person with the admin
 * role (src/cli/finance.ts) until the admin console (prompt 20). Every action needs a reason and
 * is written to admin_audit_logs with before and after. Payouts are a CSV for the bank, approved
 * by finance; no Razorpay Route transfers.
 */
@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly profiles: ProfilesService,
  ) {}

  async approve(input: {
    batchIds: string[];
    adminPhone: string;
    reason: string;
  }): Promise<number> {
    const admin = await this.admin(input.adminPhone, input.reason);
    let n = 0;
    for (const id of input.batchIds) {
      const before = await this.prisma.settlementBatch.findUnique({ where: { id } });
      if (!before || before.status !== 'pending_approval') continue;
      await this.prisma.$transaction(async (tx) => {
        const after = await tx.settlementBatch.update({
          where: { id, status: 'pending_approval' },
          data: { status: 'approved', approvedById: admin, approvedAt: new Date() },
        });
        await this.audit(tx, admin, 'settlement.approve', before, after, input.reason);
      });
      n += 1;
    }
    return n;
  }

  /** CSV of every approved batch (then marked exported). Bank details come with KYC (prompt 19). */
  async exportCsv(input: { adminPhone: string; reason: string }): Promise<string> {
    const admin = await this.admin(input.adminPhone, input.reason);
    const batches = await this.prisma.settlementBatch.findMany({
      where: { status: 'approved' },
      orderBy: { businessDay: 'asc' },
    });
    const names = await this.profiles.payoutNames([...new Set(batches.map((b) => b.sellerId))]);
    const header = [
      'batch_id',
      'business_day',
      'seller_id',
      'shop_handle',
      'business_name',
      'net_inr',
      'gross_inr',
      'commission_inr',
      'gst_on_commission_inr',
      'tcs_inr',
      'tds_inr',
      'bank_account',
      'ifsc',
    ];
    const rows = batches.map((b) => {
      const name = names.get(b.sellerId);
      return [
        b.id,
        b.businessDay.toISOString().slice(0, 10),
        b.sellerId,
        name?.handle ?? '',
        name?.businessName ?? '',
        rupees(b.netPaise),
        rupees(b.grossPaise),
        rupees(b.commissionPaise),
        rupees(b.commissionGstPaise),
        rupees(b.tcsPaise),
        rupees(b.tdsPaise),
        '', // from KYC (prompt 19)
        '',
      ];
    });
    for (const before of batches) {
      await this.prisma.$transaction(async (tx) => {
        const after = await tx.settlementBatch.update({
          where: { id: before.id, status: 'approved' },
          data: { status: 'exported', exportedAt: new Date() },
        });
        await this.audit(tx, admin, 'settlement.export', before, after, input.reason);
      });
    }
    return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
  }

  /** After the bank transfer: posts the payout to the ledger (Dr seller payable / Cr bank). */
  async markPaid(input: {
    batchId: string;
    adminPhone: string;
    reference: string;
    reason: string;
  }): Promise<void> {
    const admin = await this.admin(input.adminPhone, input.reason);
    if (!input.reference.trim()) throw new Error('A bank reference (UTR) is required');
    const before = await this.prisma.settlementBatch.findUnique({ where: { id: input.batchId } });
    if (!before || before.status !== 'exported') {
      throw new Error('Only batches that were approved and exported can be marked paid');
    }
    await this.prisma.$transaction(async (tx) => {
      const after = await tx.settlementBatch.update({
        where: { id: before.id, status: 'exported' },
        data: { status: 'paid', paidAt: new Date(), paymentReference: input.reference.trim() },
      });
      await this.ledger.post(
        payoutPosting({
          batchId: before.id,
          sellerAccount: sellerAccountCode(before.sellerId),
          netPaise: before.netPaise,
        }),
        tx,
      );
      await this.audit(tx, admin, 'settlement.mark_paid', before, after, input.reason);
    });
  }

  private async admin(phone: string, reason: string): Promise<string> {
    if (!reason.trim()) throw new Error('A reason is required');
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user || !user.roles.includes('admin') || user.status !== 'active') {
      throw new Error('Only an active admin can do this');
    }
    return user.id;
  }

  private async audit(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    adminId: string,
    action: string,
    before: SettlementBatch,
    after: SettlementBatch,
    reason: string,
  ) {
    const plain = (b: SettlementBatch) =>
      JSON.parse(JSON.stringify(b, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
    await tx.adminAuditLog.create({
      data: {
        adminId,
        action,
        targetType: 'settlement_batch',
        targetId: before.id,
        before: plain(before),
        after: plain(after),
        reason,
      },
    });
  }
}
