import { z } from 'zod';
import { imageSchema } from './media.ts';

// ───────────────────────────── Order state machine ─────────────────────────────

/** Order lifecycle (CLAUDE.md). Payment has its own, separate state machine. */
export const ORDER_STATUSES = [
  'draft',
  'awaiting_payment',
  'placed',
  'accepted',
  'preparing',
  'ready_for_pickup',
  'out_for_delivery',
  'completed',
  'expired',
  'cancelled_by_buyer',
  'cancelled_by_seller',
  'in_dispute',
  'refunded',
  'partially_refunded',
] as const;
export const orderStatusSchema = z.enum(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

/** buyer / seller act in the app; system = jobs and the payment flow; admin = trust team. */
export type OrderActor = 'buyer' | 'seller' | 'system' | 'admin';

const T: Partial<Record<OrderStatus, Partial<Record<OrderStatus, OrderActor[]>>>> = {
  draft: { awaiting_payment: ['buyer'] },
  awaiting_payment: {
    // Only from a verified payment (webhook or server fetch), never the app's callback.
    placed: ['system'],
    expired: ['system'],
    cancelled_by_buyer: ['buyer'],
  },
  placed: {
    accepted: ['seller'],
    cancelled_by_seller: ['seller', 'system'], // system: seller didn't respond in time
    cancelled_by_buyer: ['buyer'],
    in_dispute: ['buyer', 'admin'],
  },
  accepted: {
    preparing: ['seller'],
    cancelled_by_seller: ['seller'],
    in_dispute: ['buyer', 'admin'],
  },
  preparing: {
    ready_for_pickup: ['seller'],
    out_for_delivery: ['seller'],
    in_dispute: ['buyer', 'admin'],
  },
  ready_for_pickup: { completed: ['seller', 'system'], in_dispute: ['buyer', 'admin'] },
  out_for_delivery: { completed: ['seller', 'system'], in_dispute: ['buyer', 'admin'] },
  completed: { in_dispute: ['buyer', 'admin'] },
  // A late payment (captured after the hold ran out) places the order if stock is still there.
  expired: { placed: ['system'] },
  in_dispute: {
    refunded: ['admin'],
    partially_refunded: ['admin'],
    completed: ['admin'],
  },
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus, actor: OrderActor): boolean {
  return T[from]?.[to]?.includes(actor) ?? false;
}

/** No way out. (`completed` is not terminal: a dispute can still be opened.) */
export function isTerminalOrderStatus(s: OrderStatus): boolean {
  return Object.keys(T[s] ?? {}).length === 0;
}

/** How long an unpaid order holds its stock. */
export const RESERVATION_TTL_MINUTES = 15;

// ───────────────────────────── Pricing (server only; bigint paise) ─────────────────────────────

export interface PriceLine {
  unitPricePaise: bigint;
  quantity: number;
  /** Basis points from the commission rule (500 = 5%). */
  commissionBps: number;
}

/** Commission on a line in paise, rounded half up. Integers only. */
export function commissionPaise(lineTotalPaise: bigint, bps: number): bigint {
  return (lineTotalPaise * BigInt(bps) + 5_000n) / 10_000n;
}

/**
 * Order totals. Prices include GST (as shown to buyers); the GST breakdown and TCS on commission
 * are open CA questions, so no tax is added or split out here (`taxInclusive: true`). The buyer
 * pays item prices plus the delivery fee; commission is the seller-side cut, recorded for the
 * ledger (prompt 16), never added to what the buyer pays.
 */
export function orderTotals(lines: PriceLine[], deliveryFeePaise: bigint) {
  if (lines.length === 0) throw new Error('An order needs at least one line');
  if (deliveryFeePaise < 0n) throw new Error('Negative delivery fee');
  const priced = lines.map((l) => {
    if (l.unitPricePaise < 0n) throw new Error('Negative price');
    if (!Number.isInteger(l.quantity) || l.quantity < 1) throw new Error('Bad quantity');
    if (!Number.isInteger(l.commissionBps) || l.commissionBps < 0 || l.commissionBps > 10_000) {
      throw new Error('Bad commission rate');
    }
    const lineTotalPaise = l.unitPricePaise * BigInt(l.quantity);
    return { lineTotalPaise, commissionPaise: commissionPaise(lineTotalPaise, l.commissionBps) };
  });
  const subtotalPaise = priced.reduce((s, l) => s + l.lineTotalPaise, 0n);
  return {
    lines: priced,
    subtotalPaise,
    deliveryFeePaise,
    totalPaise: subtotalPaise + deliveryFeePaise,
    commissionPaise: priced.reduce((s, l) => s + l.commissionPaise, 0n),
    taxInclusive: true as const,
  };
}

export interface CommissionRuleLike {
  id: string;
  categoryId: string | null;
  rateBps: number;
  validFrom: Date;
  validTo: Date | null;
}

/** A rule for the category beats the default (no category); within each, the latest start wins. */
export function pickCommissionRule<R extends CommissionRuleLike>(
  rules: R[],
  categoryId: string | null,
  at: Date,
): R | null {
  const live = rules.filter((r) => r.validFrom <= at && (!r.validTo || r.validTo > at));
  const latest = (list: R[]) =>
    list.reduce<R | null>((best, r) => (!best || r.validFrom > best.validFrom ? r : best), null);
  return (
    (categoryId ? latest(live.filter((r) => r.categoryId === categoryId)) : null) ??
    latest(live.filter((r) => r.categoryId === null))
  );
}

// ───────────────────────────── Cart ─────────────────────────────

export const MAX_LINE_QUANTITY = 20;
export const MAX_CART_LINES = 20;

export const setCartItemSchema = z.strictObject({
  /** 0 removes the line. */
  quantity: z.number().int().min(0).max(MAX_LINE_QUANTITY),
  /** The bag holds one maker; true empties it first when this item is from another maker. */
  replaceCart: z.boolean().default(false),
});
export type SetCartItemRequest = z.input<typeof setCartItemSchema>;

export const orderModeSchema = z.enum(['pickup', 'local_delivery']);
export type OrderMode = z.infer<typeof orderModeSchema>;

export const cartLineSchema = z.object({
  variantId: z.string().uuid(),
  productId: z.string().uuid(),
  title: z.string(),
  titleTa: z.string().nullable(),
  variantLabel: z.string().nullable(),
  variantLabelTa: z.string().nullable(),
  unitPricePaise: z.number().int(),
  quantity: z.number().int(),
  photo: imageSchema.nullable(),
  /** How many can be bought right now (stock minus holds); null when the product is gone. */
  available: z.number().int().nullable(),
  /** Why this line can't be ordered as it is, if so. */
  problem: z.enum(['unavailable', 'not_enough_stock']).nullable(),
});
export type CartLine = z.infer<typeof cartLineSchema>;

export const cartSchema = z.object({
  seller: z
    .object({
      handle: z.string(),
      businessName: z.string(),
      areaName: z.string().nullable(),
      city: z.string(),
      acceptingOrders: z.boolean(),
    })
    .nullable(),
  lines: z.array(cartLineSchema),
  subtotalPaise: z.number().int(),
  /** Ways this bag can be fulfilled (offered by the shop and every item), with the total for each. */
  options: z.array(
    z.object({
      mode: orderModeSchema,
      deliveryFeePaise: z.number().int(),
      totalPaise: z.number().int(),
    }),
  ),
});
export type Cart = z.infer<typeof cartSchema>;

// ───────────────────────────── Addresses ─────────────────────────────

export const MAX_ADDRESSES = 10;

const indianMobile = z
  .string()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .transform((v) => (v.startsWith('+91') ? v.slice(3) : v.startsWith('0') ? v.slice(1) : v))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile number'))
  .transform((v) => `+91${v}`);

export const addressInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  phone: indianMobile,
  line1: z.string().trim().min(3).max(200),
  line2: z.string().trim().max(200).optional(),
  landmark: z.string().trim().max(100).optional(),
  city: z.string().trim().min(2).max(60),
  state: z.string().trim().min(2).max(60).default('Tamil Nadu'),
  pincode: z
    .string()
    .trim()
    .regex(/^[1-9]\d{5}$/, 'Enter a 6-digit pincode'),
});
export type AddressInput = z.input<typeof addressInputSchema>;

export const addressSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  phone: z.string(),
  line1: z.string(),
  line2: z.string().nullable(),
  landmark: z.string().nullable(),
  city: z.string(),
  state: z.string(),
  pincode: z.string(),
  isDefault: z.boolean(),
});
export type Address = z.infer<typeof addressSchema>;

// ───────────────────────────── Orders ─────────────────────────────

export const createOrderSchema = z
  .strictObject({
    fulfilmentMode: orderModeSchema,
    addressId: z.string().uuid().optional(),
    /** The total the buyer saw. If the server's total differs, the order is refused (price_changed). */
    expectedTotalPaise: z.number().int().nonnegative(),
  })
  .refine((o) => (o.fulfilmentMode === 'local_delivery') === (o.addressId !== undefined), {
    message: 'Local delivery needs an address; pickup takes none',
    path: ['addressId'],
  });
export type CreateOrderRequest = z.infer<typeof createOrderSchema>;

export const orderItemViewSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid(),
  title: z.string(),
  titleTa: z.string().nullable(),
  variantLabel: z.string().nullable(),
  unitPricePaise: z.number().int(),
  quantity: z.number().int(),
  lineTotalPaise: z.number().int(),
});

export const orderViewSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  status: orderStatusSchema,
  fulfilmentMode: orderModeSchema,
  seller: z.object({
    handle: z.string(),
    businessName: z.string(),
    areaName: z.string().nullable(),
    city: z.string(),
  }),
  items: z.array(orderItemViewSchema),
  subtotalPaise: z.number().int(),
  deliveryFeePaise: z.number().int(),
  totalPaise: z.number().int(),
  /** Delivery address (local delivery only). Shown to the buyer, and to the seller once paid. */
  address: addressSchema.omit({ id: true, isDefault: true }).nullable(),
  /** When an unpaid order stops holding stock. */
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
});
export type OrderView = z.infer<typeof orderViewSchema>;
