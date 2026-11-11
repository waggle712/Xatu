import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  allocationPosting,
  deductionsPosting,
  gatewayFeePosting,
  isBalanced,
  payoutPosting,
  type Posting,
  providerSettlementPosting,
  receiptPosting,
  refundPosting,
  reversalPosting,
} from './postings.js';
import { pickRate, settlementLine } from './settlement-math.js';

const SELLER = 'seller_payable:00000000-0000-7000-8000-000000000001';
const paise = (max: number) => fc.bigInt({ min: 0n, max: BigInt(max) });

/** Every posting a random lifecycle of payments, placements, refunds and settlements produces. */
const lifecycle = fc.array(
  fc.record({
    amount: fc.bigInt({ min: 1n, max: 100_000_000n }),
    delivery: paise(100_000),
    commissionBps: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 3_000 })),
    placed: fc.boolean(),
    refunded: fc.boolean(),
    settled: fc.boolean(),
    fee: paise(5_000),
    feeTax: paise(1_000),
    tcsBps: fc.oneof(fc.constant(50), fc.integer({ min: 0, max: 200 })),
    tdsBps: fc.oneof(fc.constant(10), fc.integer({ min: 0, max: 200 })),
    gstBps: fc.oneof(fc.constant(1800), fc.constant(0)),
  }),
  { maxLength: 30 },
);

function postingsFor(ops: Parameters<typeof run>[0]): Posting[] {
  return run(ops);
}

function run(
  ops: {
    amount: bigint;
    delivery: bigint;
    commissionBps: number;
    placed: boolean;
    refunded: boolean;
    settled: boolean;
    fee: bigint;
    feeTax: bigint;
    tcsBps: number;
    tdsBps: number;
    gstBps: number;
  }[],
): Posting[] {
  const out: (Posting | null)[] = [];
  ops.forEach((op, i) => {
    const total = op.amount + op.delivery;
    const id = String(i);
    out.push(receiptPosting({ paymentId: id, amountPaise: total }));
    if (op.fee > 0n)
      out.push(
        gatewayFeePosting({ entityId: id, feePaise: op.fee + op.feeTax, taxPaise: op.feeTax }),
      );
    if (op.placed) {
      out.push(allocationPosting({ orderId: id, sellerAccount: SELLER, totalPaise: total }));
      if (op.refunded) {
        out.push(reversalPosting({ orderId: id, sellerAccount: SELLER, totalPaise: total }));
        out.push(refundPosting({ refundId: id, amountPaise: total }));
      } else if (op.settled) {
        const commission = (op.amount * BigInt(op.commissionBps) + 5_000n) / 10_000n;
        const line = settlementLine({
          itemsPaise: op.amount,
          deliveryPaise: op.delivery,
          commissionPaise: commission,
          rates: { tcsBps: op.tcsBps, tdsBps: op.tdsBps, commissionGstBps: op.gstBps },
        });
        out.push(deductionsPosting({ orderId: id, sellerAccount: SELLER, line }));
        out.push(payoutPosting({ batchId: id, sellerAccount: SELLER, netPaise: line.netPaise }));
      }
    } else if (op.refunded) {
      out.push(refundPosting({ refundId: id, amountPaise: total }));
    }
    if (op.settled)
      out.push(
        providerSettlementPosting({
          entityId: id,
          amountPaise: total - op.fee - op.feeTax > 0n ? total - op.fee - op.feeTax : 0n,
        }),
      );
  });
  return out.filter((p): p is Posting => p !== null);
}

describe('ledger postings (property tests)', () => {
  it('any sequence of payments, refunds and settlements keeps every transaction balanced', () => {
    fc.assert(
      fc.property(lifecycle, (ops) => {
        for (const p of postingsFor(ops)) {
          expect(isBalanced(p), p.idempotencyKey).toBe(true);
          expect(p.entries.length).toBeGreaterThanOrEqual(2);
          for (const e of p.entries) expect(e.amountPaise > 0n).toBe(true); // no zero or negative legs
        }
      }),
      { numRuns: 500 },
    );
  });

  it("a seller's payable account ends at zero once every placed order is refunded or settled and paid", () => {
    fc.assert(
      fc.property(lifecycle, (ops) => {
        const all = postingsFor(ops.map((o) => ({ ...o, placed: true, settled: !o.refunded })));
        let balance = 0n; // credit-positive (liability)
        for (const p of all) {
          for (const e of p.entries) {
            if (e.account !== SELLER) continue;
            balance += e.direction === 'credit' ? e.amountPaise : -e.amountPaise;
          }
        }
        expect(balance).toBe(0n);
      }),
      { numRuns: 300 },
    );
  });

  it('idempotency keys are unique per thing posted', () => {
    const p = postingsFor([
      {
        amount: 45_000n,
        delivery: 4_000n,
        commissionBps: 500,
        placed: true,
        refunded: false,
        settled: true,
        fee: 1_000n,
        feeTax: 180n,
        tcsBps: 50,
        tdsBps: 10,
        gstBps: 1800,
      },
    ]);
    const keys = p.map((x) => x.idempotencyKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('skips a transaction whose legs are all zero (0% commission and tiny amounts)', () => {
    const line = settlementLine({
      itemsPaise: 1n,
      deliveryPaise: 0n,
      commissionPaise: 0n,
      rates: { tcsBps: 50, tdsBps: 10, commissionGstBps: 1800 },
    });
    expect(line).toMatchObject({
      tcsPaise: 0n,
      tdsPaise: 0n,
      commissionGstPaise: 0n,
      netPaise: 1n,
    });
    expect(deductionsPosting({ orderId: 'x', sellerAccount: SELLER, line })).toBeNull();
    expect(gatewayFeePosting({ entityId: 'x', feePaise: 0n, taxPaise: 0n })).toBeNull();
  });
});

describe('settlement math', () => {
  it('rounds each deduction half up per order, from the item value incl. GST (not the delivery fee)', () => {
    const line = settlementLine({
      itemsPaise: 45_100n,
      deliveryPaise: 4_000n,
      commissionPaise: 2_255n,
      rates: { tcsBps: 50, tdsBps: 10, commissionGstBps: 1800 },
    });
    // TCS 0.5% of 451.00 = 2.255 → 2.26; TDS 0.1% = 0.451 → 0.45; GST 18% of 22.55 = 4.059 → 4.06
    expect(line).toEqual({
      grossPaise: 49_100n,
      commissionPaise: 2_255n,
      commissionGstPaise: 406n,
      tcsPaise: 226n,
      tdsPaise: 45n,
      netPaise: 49_100n - 2_255n - 406n - 226n - 45n,
    });
  });

  it('reads rates from dated config: the rate in force on the date, latest start wins', () => {
    const rates = [
      {
        key: 'tcs',
        rateBps: 100,
        validFrom: new Date('2024-01-01'),
        validTo: new Date('2024-07-10'),
      },
      { key: 'tcs', rateBps: 50, validFrom: new Date('2024-07-10'), validTo: null },
      { key: 'tds', rateBps: 10, validFrom: new Date('2024-10-01'), validTo: null },
    ];
    expect(pickRate(rates, 'tcs', new Date('2024-03-01'))).toBe(100);
    expect(pickRate(rates, 'tcs', new Date('2026-11-12'))).toBe(50);
    expect(() => pickRate(rates, 'tds', new Date('2024-09-01'))).toThrow(/No tds rate/);
  });

  it('never makes a negative payout', () => {
    expect(() =>
      settlementLine({
        itemsPaise: 100n,
        deliveryPaise: 0n,
        commissionPaise: 200n,
        rates: { tcsBps: 0, tdsBps: 0, commissionGstBps: 0 },
      }),
    ).toThrow(/negative/);
  });
});
