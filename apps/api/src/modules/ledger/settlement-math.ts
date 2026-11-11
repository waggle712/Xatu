/** Basis points (50 = 0.5%) of an amount in paise, rounded half up. Integers only. */
export function bps(amountPaise: bigint, rateBps: number): bigint {
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10_000) throw new Error('Bad rate');
  return (amountPaise * BigInt(rateBps) + 5_000n) / 10_000n;
}

export interface RateRow {
  key: string;
  rateBps: number;
  validFrom: Date;
  validTo: Date | null;
}

/** The rate in force at `at` from dated config (latest start wins). Throws if none: never guess. */
export function pickRate(rates: RateRow[], key: string, at: Date): number {
  const live = rates.filter(
    (r) => r.key === key && r.validFrom <= at && (!r.validTo || r.validTo > at),
  );
  if (live.length === 0) throw new Error(`No ${key} rate in force on ${at.toISOString()}`);
  return live.reduce((a, b) => (b.validFrom > a.validFrom ? b : a)).rateBps;
}

export interface SettlementRates {
  /** GST TCS (Sec 52), on the item value incl. GST (decided 12 Nov 2026; CA to confirm). */
  tcsBps: number;
  /** Income-tax TDS (194-O), on the same base. */
  tdsBps: number;
  /** GST on Xatu's commission. */
  commissionGstBps: number;
}

export interface SettlementLine {
  /** What the buyer paid for this order: items + delivery fee. */
  grossPaise: bigint;
  commissionPaise: bigint;
  commissionGstPaise: bigint;
  tcsPaise: bigint;
  tdsPaise: bigint;
  /** What the seller receives for this order. */
  netPaise: bigint;
}

/**
 * One order's settlement. Each deduction is rounded half up per order; TCS and TDS are on the
 * item value incl. GST, excluding the delivery fee. A batch is the sum of its lines.
 */
export function settlementLine(input: {
  itemsPaise: bigint;
  deliveryPaise: bigint;
  commissionPaise: bigint;
  rates: SettlementRates;
}): SettlementLine {
  const grossPaise = input.itemsPaise + input.deliveryPaise;
  const commissionGstPaise = bps(input.commissionPaise, input.rates.commissionGstBps);
  const tcsPaise = bps(input.itemsPaise, input.rates.tcsBps);
  const tdsPaise = bps(input.itemsPaise, input.rates.tdsBps);
  const netPaise = grossPaise - input.commissionPaise - commissionGstPaise - tcsPaise - tdsPaise;
  if (netPaise < 0n) throw new Error('Settlement would be negative');
  return {
    grossPaise,
    commissionPaise: input.commissionPaise,
    commissionGstPaise,
    tcsPaise,
    tdsPaise,
    netPaise,
  };
}
