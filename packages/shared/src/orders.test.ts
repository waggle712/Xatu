import { describe, expect, it } from 'vitest';
import {
  addressInputSchema,
  canTransitionOrder,
  commissionPaise,
  createOrderSchema,
  isTerminalOrderStatus,
  MAX_LINE_QUANTITY,
  ORDER_STATUSES,
  type OrderStatus,
  orderTotals,
  pickCommissionRule,
  setCartItemSchema,
} from './orders.ts';

describe('order state machine', () => {
  it('follows the happy paths for pickup and delivery', () => {
    const pickup: OrderStatus[] = [
      'draft',
      'awaiting_payment',
      'placed',
      'accepted',
      'preparing',
      'ready_for_pickup',
      'completed',
    ];
    const delivery: OrderStatus[] = [
      'awaiting_payment',
      'placed',
      'accepted',
      'preparing',
      'out_for_delivery',
      'completed',
    ];
    const actor = {
      awaiting_payment: 'buyer',
      placed: 'system',
      accepted: 'seller',
      preparing: 'seller',
      ready_for_pickup: 'seller',
      out_for_delivery: 'seller',
      completed: 'seller',
    } as const;
    for (const path of [pickup, delivery]) {
      for (let i = 1; i < path.length; i++) {
        const to = path[i]!;
        expect(canTransitionOrder(path[i - 1]!, to, actor[to as keyof typeof actor]), to).toBe(
          true,
        );
      }
    }
  });

  it('only the payment system moves an order to placed (never the buyer or seller)', () => {
    expect(canTransitionOrder('awaiting_payment', 'placed', 'system')).toBe(true);
    expect(canTransitionOrder('awaiting_payment', 'placed', 'buyer')).toBe(false);
    expect(canTransitionOrder('awaiting_payment', 'placed', 'seller')).toBe(false);
    expect(canTransitionOrder('awaiting_payment', 'placed', 'admin')).toBe(false);
  });

  it('unpaid orders expire or are cancelled by the buyer; sellers cannot cancel unpaid orders', () => {
    expect(canTransitionOrder('awaiting_payment', 'expired', 'system')).toBe(true);
    expect(canTransitionOrder('awaiting_payment', 'cancelled_by_buyer', 'buyer')).toBe(true);
    expect(canTransitionOrder('awaiting_payment', 'cancelled_by_seller', 'seller')).toBe(false);
    expect(canTransitionOrder('awaiting_payment', 'expired', 'buyer')).toBe(false);
  });

  it('sellers decline paid orders before they are ready; buyers cancel only before acceptance', () => {
    expect(canTransitionOrder('placed', 'cancelled_by_seller', 'seller')).toBe(true);
    expect(canTransitionOrder('accepted', 'cancelled_by_seller', 'seller')).toBe(true);
    expect(canTransitionOrder('placed', 'cancelled_by_buyer', 'buyer')).toBe(true);
    expect(canTransitionOrder('accepted', 'cancelled_by_buyer', 'buyer')).toBe(false);
    expect(canTransitionOrder('ready_for_pickup', 'cancelled_by_seller', 'seller')).toBe(false);
  });

  it('disputes and refunds come from paid states and are handled by admins', () => {
    expect(canTransitionOrder('completed', 'in_dispute', 'buyer')).toBe(true);
    expect(canTransitionOrder('in_dispute', 'refunded', 'admin')).toBe(true);
    expect(canTransitionOrder('in_dispute', 'partially_refunded', 'admin')).toBe(true);
    expect(canTransitionOrder('in_dispute', 'completed', 'admin')).toBe(true);
    expect(canTransitionOrder('awaiting_payment', 'in_dispute', 'buyer')).toBe(false);
    expect(canTransitionOrder('in_dispute', 'refunded', 'seller')).toBe(false);
  });

  it('terminal states go nowhere, and nothing skips steps or goes backwards', () => {
    for (const s of ORDER_STATUSES.filter(isTerminalOrderStatus)) {
      for (const to of ORDER_STATUSES) {
        for (const a of ['buyer', 'seller', 'system', 'admin'] as const) {
          expect(canTransitionOrder(s, to, a), `${s}→${to}`).toBe(false);
        }
      }
    }
    expect(isTerminalOrderStatus('completed')).toBe(false); // a dispute can still be opened
    expect(canTransitionOrder('placed', 'completed', 'seller')).toBe(false);
    expect(canTransitionOrder('accepted', 'placed', 'seller')).toBe(false);
    expect(canTransitionOrder('placed', 'placed', 'system')).toBe(false);
  });
});

describe('pricing', () => {
  it('adds lines and the delivery fee in exact paise', () => {
    const totals = orderTotals(
      [
        { unitPricePaise: 45_000n, quantity: 2, commissionBps: 0 },
        { unitPricePaise: 12_050n, quantity: 3, commissionBps: 0 },
      ],
      4_000n,
    );
    expect(totals).toEqual({
      lines: [
        { lineTotalPaise: 90_000n, commissionPaise: 0n },
        { lineTotalPaise: 36_150n, commissionPaise: 0n },
      ],
      subtotalPaise: 126_150n,
      deliveryFeePaise: 4_000n,
      totalPaise: 130_150n,
      commissionPaise: 0n,
      taxInclusive: true,
    });
  });

  it('rounds commission half up per line, in integers', () => {
    expect(commissionPaise(10_001n, 500)).toBe(500n); // 500.05 → 500
    expect(commissionPaise(10_010n, 500)).toBe(501n); // 500.5 → 501
    expect(commissionPaise(99n, 0)).toBe(0n);
    expect(commissionPaise(100_000_000n * 20n, 10_000)).toBe(2_000_000_000n);
  });

  it('never accepts negative or fractional input', () => {
    expect(() =>
      orderTotals([{ unitPricePaise: -1n, quantity: 1, commissionBps: 0 }], 0n),
    ).toThrow();
    expect(() =>
      orderTotals([{ unitPricePaise: 1n, quantity: 0, commissionBps: 0 }], 0n),
    ).toThrow();
    expect(() =>
      orderTotals([{ unitPricePaise: 1n, quantity: 1.5, commissionBps: 0 }], 0n),
    ).toThrow();
    expect(() =>
      orderTotals([{ unitPricePaise: 1n, quantity: 1, commissionBps: 10_001 }], 0n),
    ).toThrow();
    expect(() =>
      orderTotals([{ unitPricePaise: 1n, quantity: 1, commissionBps: 0 }], -1n),
    ).toThrow();
    expect(() => orderTotals([], 0n)).toThrow();
  });
});

describe('commission rule selection', () => {
  const at = new Date('2026-12-01T10:00:00Z');
  const rule = (id: string, categoryId: string | null, from: string, to: string | null = null) => ({
    id,
    categoryId,
    rateBps: 0,
    validFrom: new Date(from),
    validTo: to ? new Date(to) : null,
  });

  it('prefers a rule for the category, then the latest default in its valid window', () => {
    const rules = [
      rule('old-default', null, '2026-11-01T00:00:00Z'),
      rule('new-default', null, '2026-11-11T00:00:00Z'),
      rule('future-default', null, '2027-01-01T00:00:00Z'),
      rule('cakes', 'cat-cakes', '2026-11-05T00:00:00Z'),
      rule('expired-cakes', 'cat-cakes', '2026-11-20T00:00:00Z', '2026-11-25T00:00:00Z'),
    ];
    expect(pickCommissionRule(rules, 'cat-cakes', at)?.id).toBe('cakes');
    expect(pickCommissionRule(rules, 'cat-pots', at)?.id).toBe('new-default');
    expect(pickCommissionRule(rules, null, at)?.id).toBe('new-default');
    expect(pickCommissionRule([rule('future', null, '2027-01-01T00:00:00Z')], null, at)).toBeNull();
  });
});

describe('inputs', () => {
  const id = '0195f0e2-7c1a-4b3e-9d2f-1a2b3c4d5e6f';

  it('cart quantities are small whole numbers; 0 removes the line', () => {
    expect(setCartItemSchema.parse({ quantity: 2 })).toEqual({ quantity: 2, replaceCart: false });
    expect(setCartItemSchema.parse({ quantity: 0, replaceCart: true }).quantity).toBe(0);
    expect(setCartItemSchema.safeParse({ quantity: MAX_LINE_QUANTITY + 1 }).success).toBe(false);
    expect(setCartItemSchema.safeParse({ quantity: 1.5 }).success).toBe(false);
    expect(setCartItemSchema.safeParse({ quantity: -1 }).success).toBe(false);
  });

  it('local delivery needs an address; pickup must not send one', () => {
    expect(
      createOrderSchema.safeParse({ fulfilmentMode: 'pickup', expectedTotalPaise: 45000 }).success,
    ).toBe(true);
    expect(
      createOrderSchema.safeParse({ fulfilmentMode: 'local_delivery', expectedTotalPaise: 45000 })
        .success,
    ).toBe(false);
    expect(
      createOrderSchema.safeParse({
        fulfilmentMode: 'local_delivery',
        addressId: id,
        expectedTotalPaise: 45000,
      }).success,
    ).toBe(true);
    expect(
      createOrderSchema.safeParse({
        fulfilmentMode: 'pickup',
        addressId: id,
        expectedTotalPaise: 1,
      }).success,
    ).toBe(false);
    expect(
      createOrderSchema.safeParse({ fulfilmentMode: 'courier', expectedTotalPaise: 1 }).success,
    ).toBe(false);
    expect(
      createOrderSchema.safeParse({ fulfilmentMode: 'pickup', expectedTotalPaise: 1.5 }).success,
    ).toBe(false);
  });

  it('addresses: Indian mobile and pincode, trimmed', () => {
    const ok = addressInputSchema.parse({
      name: ' Lakshmi ',
      phone: '98765 43210',
      line1: '12, North Street',
      city: 'Trichy',
      pincode: '620003',
    });
    expect(ok).toMatchObject({ name: 'Lakshmi', phone: '+919876543210', state: 'Tamil Nadu' });
    for (const bad of [
      { pincode: '020003' },
      { pincode: '62000' },
      { phone: '12345' },
      { phone: '+15551234567' },
      { name: '' },
    ]) {
      expect(
        addressInputSchema.safeParse({ ...ok, phone: '9876543210', ...bad }).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });
});
