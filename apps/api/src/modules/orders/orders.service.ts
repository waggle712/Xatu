import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  canTransitionOrder,
  type CreateOrderRequest,
  type OrderActor,
  type OrderStatus,
  type OrderView,
  orderTotals,
  pickCommissionRule,
  RESERVATION_TTL_MINUTES,
} from '@xatu/shared';
import { randomInt } from 'node:crypto';
import { AnalyticsService } from '../../analytics/analytics.service.js';
import { AppError } from '../../common/errors.js';
import { paiseToNumber } from '../../common/money.js';
import {
  type Address as AddressRow,
  type Order,
  type OrderItem,
  Prisma,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { AddressesService } from '../identity/addresses.service.js';
import { type OrderingShop, ProfilesService } from '../profiles/profiles.service.js';
import { CartService } from './cart.service.js';

type Tx = Prisma.TransactionClient;
type OrderRow = Order & { items: OrderItem[] };

/** Many buyers can queue on one locked row; give them time instead of failing with a 500. */
const TX_OPTIONS = { maxWait: 15_000, timeout: 20_000 } as const;
const MAX_UNPAID_ORDERS = 3;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I

/**
 * Orders: creation from the bag with stock holds, buyer cancel, expiry. Every status change is
 * a compare-and-set on the current status and writes an order_events row and an outbox row in
 * the same transaction. Payment (prompt 15) is the only way to `placed`.
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly profiles: ProfilesService,
    private readonly addresses: AddressesService,
    private readonly cart: CartService,
    private readonly analytics: AnalyticsService,
  ) {}

  async create(buyerId: string, input: CreateOrderRequest): Promise<OrderView> {
    // Reads that use the shared connection pool happen BEFORE the transaction: inside it, only
    // `tx` may be used, or many buyers queued on one locked row could starve the pool.
    const sellerId = await this.cart.sellerOf(buyerId);
    if (!sellerId) throw new AppError('cart_empty', 'Your bag is empty.', HttpStatus.CONFLICT);
    const shop = await this.profiles.shopForOrder(sellerId);
    if (!shop)
      throw new AppError('cart_has_problems', 'This shop is not available.', HttpStatus.CONFLICT);
    if (shop.ownerUserId === buyerId) {
      throw new AppError(
        'cannot_buy_own',
        "You can't buy from your own shop.",
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!shop.acceptingOrders) {
      throw new AppError(
        'shop_not_accepting',
        'This maker is not taking orders right now.',
        HttpStatus.CONFLICT,
      );
    }
    if (!shop.offeredModes.includes(input.fulfilmentMode)) {
      throw new AppError(
        'fulfilment_not_offered',
        'This maker does not offer that.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const address = input.addressId ? await this.addresses.owned(buyerId, input.addressId) : null;
    // Stops one buyer tying up a maker's stock with orders they never pay.
    const unpaid = await this.prisma.order.count({
      where: { buyerId, status: 'awaiting_payment', expiresAt: { gt: new Date() } },
    });
    if (unpaid >= MAX_UNPAID_ORDERS) {
      throw new AppError(
        'too_many_unpaid_orders',
        'You have unpaid orders waiting. Pay or cancel one first.',
        HttpStatus.CONFLICT,
      );
    }

    for (let attempt = 1; ; attempt++) {
      try {
        const order = await this.prisma.$transaction(
          (tx) => this.createIn(tx, buyerId, input, shop, address),
          TX_OPTIONS,
        );
        // After commit; analytics never affects the order (fire-and-forget).
        this.analytics.capture(buyerId, 'order_created', {
          order_id: order.id,
          seller_id: shop.id,
          total_paise: order.totalPaise,
          fulfilment_mode: order.fulfilmentMode,
          item_count: order.items.reduce((n, i) => n + i.quantity, 0),
        });
        return order;
      } catch (err) {
        // The short order code collided: the whole transaction rolled back, so just try again.
        const codeClash =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          JSON.stringify(err.meta ?? {}).includes('code');
        if (!codeClash || attempt >= 3) throw err;
      }
    }
  }

  private async createIn(
    tx: Tx,
    buyerId: string,
    input: CreateOrderRequest,
    shop: OrderingShop,
    address: AddressRow | null,
  ): Promise<OrderView> {
    const bag = await this.cart.takeLines(tx, buyerId); // empties the bag in this transaction
    if (!bag) throw new AppError('cart_empty', 'Your bag is empty.', HttpStatus.CONFLICT);
    if (bag.sellerId !== shop.id) {
      throw new AppError(
        'cart_changed',
        'Your bag changed. Check it and try again.',
        HttpStatus.CONFLICT,
      );
    }

    const orderId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + RESERVATION_TTL_MINUTES * 60_000);
    const lines = await this.catalog.reserve(tx, { lines: bag.lines });
    if (lines.some((l) => l.sellerId !== shop.id)) {
      throw new AppError(
        'cart_has_problems',
        'Your bag has items from more than one maker.',
        HttpStatus.CONFLICT,
      );
    }
    if (lines.some((l) => !l.fulfilmentModes.includes(input.fulfilmentMode))) {
      throw new AppError(
        'fulfilment_not_offered',
        'Not every item can be had this way.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const now = new Date();
    const rules = await tx.commissionRule.findMany({ where: { validFrom: { lte: now } } });
    const withRules = lines.map((l) => {
      const rule = pickCommissionRule(rules, l.categoryId, now);
      return { ...l, rule, commissionBps: rule?.rateBps ?? 0 };
    });
    const fee = input.fulfilmentMode === 'local_delivery' ? shop.localDeliveryFeePaise : 0n;
    const totals = orderTotals(withRules, fee);
    if (paiseToNumber(totals.totalPaise) !== input.expectedTotalPaise) {
      // Rolls back the holds too.
      throw new AppError(
        'price_changed',
        'The price changed. Check the new total and try again.',
        HttpStatus.CONFLICT,
        {
          totalPaise: paiseToNumber(totals.totalPaise),
        },
      );
    }

    const order = await tx.order.create({
      data: {
        id: orderId,
        code: newOrderCode(),
        buyerId,
        sellerId: shop.id,
        status: 'awaiting_payment',
        fulfilmentMode: input.fulfilmentMode,
        subtotalPaise: totals.subtotalPaise,
        deliveryFeePaise: totals.deliveryFeePaise,
        totalPaise: totals.totalPaise,
        commissionPaise: totals.commissionPaise,
        expiresAt,
        // Purchase-time copies. The exact pickup spot is not copied: it's shown after acceptance.
        sellerSnapshot: {
          handle: shop.handle,
          businessName: shop.businessName,
          areaName: shop.areaName,
          city: shop.city,
        },
        addressSnapshot: address
          ? {
              name: address.name,
              phone: address.phone,
              line1: address.line1,
              line2: address.line2,
              landmark: address.landmark,
              city: address.city,
              state: address.state,
              pincode: address.pincode,
            }
          : Prisma.JsonNull,
        city: shop.city,
        items: {
          create: withRules.map((l, i) => ({
            productId: l.productId,
            variantId: l.variantId,
            titleSnapshot: l.title,
            titleTaSnapshot: l.titleTa,
            variantSnapshot: l.label,
            unitPricePaise: l.unitPricePaise,
            quantity: l.quantity,
            lineTotalPaise: totals.lines[i]!.lineTotalPaise,
            commissionBps: l.commissionBps,
            commissionPaise: totals.lines[i]!.commissionPaise,
            commissionRuleId: l.rule?.id ?? null,
          })),
        },
      },
      include: { items: true },
    });
    await this.catalog.holdForOrder(tx, { buyerId, orderId: order.id, expiresAt, lines });
    await this.recordChange(tx, order.id, null, 'awaiting_payment', buyerId, 'order.created', {
      buyerId,
      sellerId: shop.id,
      totalPaise: paiseToNumber(totals.totalPaise),
      expiresAt: expiresAt.toISOString(),
    });
    return toView(order);
  }

  async list(buyerId: string): Promise<{ items: OrderView[] }> {
    const rows = await this.prisma.order.findMany({
      where: { buyerId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return { items: rows.map(toView) };
  }

  async get(buyerId: string, orderId: string): Promise<OrderView> {
    return toView(await this.owned(buyerId, orderId));
  }

  /** The buyer cancels an unpaid order; its holds are released at once. */
  async cancel(buyerId: string, orderId: string): Promise<OrderView> {
    const order = await this.owned(buyerId, orderId);
    await this.prisma.$transaction(async (tx) => {
      // Unpaid orders only: a paid order needs the refund flow (prompts 15-16).
      await this.transition(
        tx,
        order.id,
        'awaiting_payment',
        'cancelled_by_buyer',
        'buyer',
        buyerId,
      );
      await this.catalog.releaseForOrder(tx, order.id, 'released');
    });
    this.analytics.capture(buyerId, 'order_cancelled', { order_id: order.id, by: 'buyer' });
    return this.get(buyerId, orderId);
  }

  /**
   * A payment for this order was verified (outbox `payment.verified`). Safe to run twice.
   * Unpaid or expired order: lower stock (catalog, under row locks) and place it. If the stock is
   * gone (late payment) or the order was closed meanwhile (cancelled), ask payments to refund
   * (`order.refund_needed`). Never changes a payment itself.
   */
  async onPaymentVerified(input: { orderId: string; paymentId: string }): Promise<void> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ status: OrderStatus; placed_by: string | null }[]>`
        SELECT o.status, (SELECT e.note FROM order_events e WHERE e.order_id = o.id AND e.to_status = 'placed' LIMIT 1) AS placed_by
        FROM orders o WHERE o.id = ${input.orderId}::uuid FOR UPDATE`;
      const row = rows[0];
      if (!row) return 'missing' as const;
      if (row.placed_by === input.paymentId) return 'already' as const;
      if (row.status !== 'awaiting_payment' && row.status !== 'expired') {
        await this.refundNeeded(
          tx,
          input,
          row.status === 'placed' ? 'second_payment' : 'order_closed',
        );
        return 'refund' as const;
      }
      const items = await tx.orderItem.findMany({ where: { orderId: input.orderId } });
      const ok = await this.catalog.commitForOrder(tx, {
        orderId: input.orderId,
        lines: items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
      });
      if (!ok) {
        await this.refundNeeded(tx, input, 'out_of_stock');
        return 'refund' as const;
      }
      await this.transition(
        tx,
        input.orderId,
        row.status,
        'placed',
        'system',
        null,
        input.paymentId,
      );
      return 'placed' as const;
    }, TX_OPTIONS);

    if (outcome === 'placed') {
      const order = await this.prisma.order.findUniqueOrThrow({ where: { id: input.orderId } });
      this.analytics.capture(order.buyerId, 'order_paid', {
        order_id: order.id,
        seller_id: order.sellerId,
        total_paise: paiseToNumber(order.totalPaise),
        fulfilment_mode: order.fulfilmentMode,
      });
    }
  }

  private async refundNeeded(
    tx: Tx,
    input: { orderId: string; paymentId: string },
    reason: 'out_of_stock' | 'order_closed' | 'second_payment',
  ): Promise<void> {
    await tx.outboxEvent.create({
      data: {
        topic: 'order.refund_needed',
        aggregateId: input.orderId,
        payload: { ...input, reason },
      },
    });
  }

  /** For payments: unpaid orders whose hold time is over (check them with Razorpay first). */
  async dueForExpiry(limit = 200): Promise<string[]> {
    const rows = await this.prisma.order.findMany({
      where: { status: 'awaiting_payment', expiresAt: { lte: new Date() } },
      select: { id: true },
      take: limit,
    });
    return rows.map((r) => r.id);
  }

  // ── For the ledger (it never reads order tables itself) ──

  /** What the ledger needs to post an order's seller payable and settlement. */
  async ledgerFacts(orderIds: string[]) {
    const rows = await this.prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: {
        id: true,
        sellerId: true,
        status: true,
        subtotalPaise: true,
        deliveryFeePaise: true,
        totalPaise: true,
        commissionPaise: true,
        completedAt: true,
      },
    });
    return new Map(rows.map((r) => [r.id, r]));
  }

  /**
   * Completed orders past the dispute window (status still `completed`: no dispute or refund),
   * oldest first, one keyset page at a time on (completed_at, id).
   */
  async settlementCandidates(
    completedBefore: Date,
    after: { completedAt: Date; id: string } | null,
    limit = 500,
  ): Promise<{ id: string; completedAt: Date }[]> {
    const rows = await this.prisma.order.findMany({
      where: {
        status: 'completed',
        completedAt: { lte: completedBefore },
        ...(after
          ? {
              OR: [
                { completedAt: { gt: after.completedAt } },
                { completedAt: after.completedAt, id: { gt: after.id } },
              ],
            }
          : {}),
      },
      select: { id: true, completedAt: true },
      orderBy: [{ completedAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map((r) => ({ id: r.id, completedAt: r.completedAt! }));
  }

  /** Orders that were placed (paid) at some point and not refunded, for the completeness check. */
  async placedOrderIds(): Promise<string[]> {
    const rows = await this.prisma.orderEvent.findMany({
      where: { toStatus: 'placed' },
      select: { orderId: true },
      distinct: ['orderId'],
    });
    return rows.map((r) => r.orderId);
  }

  /** For payments: an order's current status, or null. */
  async statusOf(orderId: string): Promise<OrderStatus | null> {
    const row = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    });
    return row?.status ?? null;
  }

  /** Expires unpaid orders whose hold time is over. Safe to run any number of times. */
  async expireDue(limit = 200): Promise<number> {
    const due = await this.prisma.order.findMany({
      where: { status: 'awaiting_payment', expiresAt: { lte: new Date() } },
      select: { id: true },
      orderBy: { expiresAt: 'asc' },
      take: limit,
    });
    let expired = 0;
    for (const { id } of due) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await this.transition(tx, id, 'awaiting_payment', 'expired', 'system', null);
          await this.catalog.releaseForOrder(tx, id, 'expired');
        });
        expired += 1;
      } catch (err) {
        // Cancelled or paid in the meantime: the compare-and-set lost, which is fine.
        if (!(err instanceof AppError && err.code === 'invalid_order_status')) throw err;
      }
    }
    return expired;
  }

  /**
   * Moves an order from `from` to `to` only if it is still in `from` (compare-and-set), so a
   * cancel, the expiry job and a payment can never overwrite each other.
   */
  private async transition(
    tx: Tx,
    orderId: string,
    from: OrderStatus,
    to: OrderStatus,
    actor: OrderActor,
    actorId: string | null,
    note?: string,
  ): Promise<void> {
    if (!canTransitionOrder(from, to, actor)) throw invalidStatus();
    const { count } = await tx.order.updateMany({
      where: { id: orderId, status: from },
      data: {
        status: to,
        ...(to === 'completed' ? { completedAt: new Date() } : {}),
        ...(to === 'awaiting_payment' ? {} : { expiresAt: null }),
      },
    });
    if (count !== 1) throw invalidStatus();
    await this.recordChange(
      tx,
      orderId,
      from,
      to,
      actorId,
      `order.${to}`,
      { from, to, actor },
      note,
    );
  }

  private async recordChange(
    tx: Tx,
    orderId: string,
    from: OrderStatus | null,
    to: OrderStatus,
    actorId: string | null,
    topic: string,
    payload: Prisma.InputJsonObject,
    note?: string,
  ): Promise<void> {
    await tx.orderEvent.create({
      data: { orderId, fromStatus: from, toStatus: to, actorId, note: note ?? null },
    });
    await tx.outboxEvent.create({
      data: { topic, aggregateId: orderId, payload: { orderId, ...payload } },
    });
  }

  private async owned(buyerId: string, orderId: string): Promise<OrderRow> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, buyerId },
      include: { items: true },
    });
    if (!order)
      throw new AppError('order_not_found', 'This order is not available.', HttpStatus.NOT_FOUND);
    return order;
  }
}

function invalidStatus(): AppError {
  return new AppError(
    'invalid_order_status',
    'This order can no longer be changed that way.',
    HttpStatus.CONFLICT,
  );
}

function newOrderCode(): string {
  let s = 'XT-';
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

function toView(o: OrderRow): OrderView {
  const seller = o.sellerSnapshot as {
    handle: string;
    businessName: string;
    areaName: string | null;
    city: string;
  };
  const address = o.addressSnapshot as OrderView['address'];
  return {
    id: o.id,
    code: o.code,
    status: o.status,
    fulfilmentMode: o.fulfilmentMode as OrderView['fulfilmentMode'],
    seller: {
      handle: seller.handle,
      businessName: seller.businessName,
      areaName: seller.areaName,
      city: seller.city,
    },
    items: o.items.map((i) => ({
      productId: i.productId,
      variantId: i.variantId,
      title: i.titleSnapshot,
      titleTa: i.titleTaSnapshot,
      variantLabel: i.variantSnapshot,
      unitPricePaise: paiseToNumber(i.unitPricePaise),
      quantity: i.quantity,
      lineTotalPaise: paiseToNumber(i.lineTotalPaise),
    })),
    subtotalPaise: paiseToNumber(o.subtotalPaise),
    deliveryFeePaise: paiseToNumber(o.deliveryFeePaise),
    totalPaise: paiseToNumber(o.totalPaise),
    address: address
      ? {
          name: address.name,
          phone: address.phone,
          line1: address.line1,
          line2: address.line2 ?? null,
          landmark: address.landmark ?? null,
          city: address.city,
          state: address.state,
          pincode: address.pincode,
        }
      : null,
    expiresAt: o.status === 'awaiting_payment' && o.expiresAt ? o.expiresAt.toISOString() : null,
    createdAt: o.createdAt.toISOString(),
  };
}
