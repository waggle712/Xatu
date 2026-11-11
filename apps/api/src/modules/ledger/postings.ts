import type { SettlementLine } from './settlement-math.js';

/**
 * Pure builders for every ledger transaction. Each returns a balanced set of entries (or null
 * when there is nothing to post: zero legs are left out and an all-zero transaction is skipped,
 * since entries must be > 0). The idempotency key makes each thing post exactly once.
 *
 * Accounts (codes): provider_clearing (asset, money at Razorpay), customer_receipts (liability,
 * buyers' payments not yet allocated to an order), seller_payable:<sellerId> (liability),
 * platform_commission (revenue), gst_on_commission_payable, gst_tcs_payable, tds_194o_payable
 * (liabilities), gateway_fees (expense), gst_input_gateway (asset), bank (asset).
 */
export interface PostingEntry {
  account: string;
  direction: 'debit' | 'credit';
  amountPaise: bigint;
}

export interface Posting {
  idempotencyKey: string;
  kind: string;
  referenceId: string;
  description: string;
  entries: PostingEntry[];
}

export const ACCOUNTS = {
  providerClearing: 'provider_clearing',
  customerReceipts: 'customer_receipts',
  platformCommission: 'platform_commission',
  commissionGst: 'gst_on_commission_payable',
  tcs: 'gst_tcs_payable',
  tds: 'tds_194o_payable',
  gatewayFees: 'gateway_fees',
  gatewayGstInput: 'gst_input_gateway',
  bank: 'bank',
} as const;

export const sellerAccountCode = (sellerId: string) => `seller_payable:${sellerId}`;

const dr = (account: string, amountPaise: bigint): PostingEntry => ({
  account,
  direction: 'debit',
  amountPaise,
});
const cr = (account: string, amountPaise: bigint): PostingEntry => ({
  account,
  direction: 'credit',
  amountPaise,
});

function build(p: Omit<Posting, 'entries'> & { entries: PostingEntry[] }): Posting | null {
  const entries = p.entries.filter((e) => e.amountPaise !== 0n);
  if (entries.some((e) => e.amountPaise < 0n))
    throw new Error(`Negative leg in ${p.idempotencyKey}`);
  if (entries.length === 0) return null;
  const posting = { ...p, entries };
  if (!isBalanced(posting) || entries.length < 2)
    throw new Error(`Unbalanced posting ${p.idempotencyKey}`);
  return posting;
}

export function isBalanced(p: Pick<Posting, 'entries'>): boolean {
  let d = 0n;
  let c = 0n;
  for (const e of p.entries) {
    if (e.direction === 'debit') d += e.amountPaise;
    else c += e.amountPaise;
  }
  return d === c && d > 0n;
}

/** A verified (captured) payment: the money is at Razorpay, owed to the buyer until allocated. */
export function receiptPosting(i: { paymentId: string; amountPaise: bigint }) {
  return build({
    idempotencyKey: `receipt:${i.paymentId}`,
    kind: 'payment_capture',
    referenceId: i.paymentId,
    description: 'Payment captured',
    entries: [
      dr(ACCOUNTS.providerClearing, i.amountPaise),
      cr(ACCOUNTS.customerReceipts, i.amountPaise),
    ],
  });
}

/** The order was placed: the whole order total becomes owed to the seller. */
export function allocationPosting(i: {
  orderId: string;
  sellerAccount: string;
  totalPaise: bigint;
}) {
  return build({
    idempotencyKey: `allocation:${i.orderId}`,
    kind: 'seller_payable',
    referenceId: i.orderId,
    description: 'Order placed: owed to seller',
    entries: [dr(ACCOUNTS.customerReceipts, i.totalPaise), cr(i.sellerAccount, i.totalPaise)],
  });
}

/** A placed order is refunded before settlement: undo the allocation. */
export function reversalPosting(i: { orderId: string; sellerAccount: string; totalPaise: bigint }) {
  return build({
    idempotencyKey: `allocation_reversal:${i.orderId}`,
    kind: 'seller_payable_reversal',
    referenceId: i.orderId,
    description: 'Order refunded before settlement',
    entries: [dr(i.sellerAccount, i.totalPaise), cr(ACCOUNTS.customerReceipts, i.totalPaise)],
  });
}

/** A refund Razorpay confirmed as processed: the money left our Razorpay balance. */
export function refundPosting(i: { refundId: string; amountPaise: bigint }) {
  return build({
    idempotencyKey: `refund:${i.refundId}`,
    kind: 'refund',
    referenceId: i.refundId,
    description: 'Refund processed',
    entries: [
      dr(ACCOUNTS.customerReceipts, i.amountPaise),
      cr(ACCOUNTS.providerClearing, i.amountPaise),
    ],
  });
}

/** At settlement, per order: platform fee, GST on it, TCS and TDS, taken from the seller. */
export function deductionsPosting(i: {
  orderId: string;
  sellerAccount: string;
  line: SettlementLine;
}) {
  const { commissionPaise, commissionGstPaise, tcsPaise, tdsPaise } = i.line;
  return build({
    idempotencyKey: `deductions:${i.orderId}`,
    kind: 'platform_fee_tcs_tds',
    referenceId: i.orderId,
    description: 'Commission, GST on commission, TCS and TDS',
    entries: [
      dr(i.sellerAccount, commissionPaise + commissionGstPaise + tcsPaise + tdsPaise),
      cr(ACCOUNTS.platformCommission, commissionPaise),
      cr(ACCOUNTS.commissionGst, commissionGstPaise),
      cr(ACCOUNTS.tcs, tcsPaise),
      cr(ACCOUNTS.tds, tdsPaise),
    ],
  });
}

/** Finance marked a settlement batch as paid from the bank. */
export function payoutPosting(i: { batchId: string; sellerAccount: string; netPaise: bigint }) {
  return build({
    idempotencyKey: `payout:${i.batchId}`,
    kind: 'seller_payout',
    referenceId: i.batchId,
    description: 'Seller payout',
    entries: [dr(i.sellerAccount, i.netPaise), cr(ACCOUNTS.bank, i.netPaise)],
  });
}

/** Razorpay's fee on a payment (from the settlement report). GST on the fee kept apart for the CA. */
export function gatewayFeePosting(i: { entityId: string; feePaise: bigint; taxPaise: bigint }) {
  return build({
    idempotencyKey: `gateway_fee:${i.entityId}`,
    kind: 'gateway_fee',
    referenceId: i.entityId,
    description: 'Razorpay fee',
    entries: [
      dr(ACCOUNTS.gatewayFees, i.feePaise - i.taxPaise),
      dr(ACCOUNTS.gatewayGstInput, i.taxPaise),
      cr(ACCOUNTS.providerClearing, i.feePaise),
    ],
  });
}

/** Razorpay settled money to our bank account. */
export function providerSettlementPosting(i: { entityId: string; amountPaise: bigint }) {
  return build({
    idempotencyKey: `provider_settlement:${i.entityId}`,
    kind: 'provider_settlement',
    referenceId: i.entityId,
    description: 'Razorpay settlement to bank',
    entries: [dr(ACCOUNTS.bank, i.amountPaise), cr(ACCOUNTS.providerClearing, i.amountPaise)],
  });
}
