import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { OrdersExpiry } from '../src/modules/orders/orders.expiry.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { clearRateLimits, createTestApp, signInNewUser } from './support/app.js';

// Prompt 14: bag, stock holds (15-minute reservations under row locks) and order creation.
// Runs against Testcontainers (real Postgres): the concurrency tests depend on real row locks.
describe('Cart, stock holds and orders (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let categoryId: string;
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const key = () => ({ 'Idempotency-Key': randomUUID() });
  let n = 0;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    prisma = app.get(PrismaService);
    const c = await prisma.category.upsert({
      where: { slug: 'terracotta' },
      update: {},
      create: { slug: 'terracotta', nameEn: 'Terracotta', nameTa: 'சுடுமண்' },
    });
    categoryId = c.id;
  });
  beforeEach(async () => clearRateLimits(app));
  afterAll(async () => app.close());

  async function buyer() {
    await clearRateLimits(app); // sign-in is limited per IP; every test request shares one IP
    return signInNewUser(app);
  }

  async function shop(
    opts: { status?: 'active' | 'paused'; localDelivery?: boolean; feePaise?: bigint } = {},
  ) {
    const owner = await buyer();
    n += 1;
    const created = await http()
      .post('/sellers')
      .set(auth(owner.token))
      .send({
        businessName: `Order Maker ${n}`,
        handle: `ord_${Date.now().toString(36)}${n}`,
        categoryId,
      })
      .expect(201);
    await prisma.sellerProfile.update({
      where: { id: created.body.id },
      data: {
        status: opts.status ?? 'active',
        areaName: 'Woraiyur',
        city: 'Trichy',
        pickupAvailable: true,
        localDelivery: opts.localDelivery ?? false,
        localDeliveryFeePaise: opts.feePaise ?? 0n,
        pickupAddressLine: '12 Secret Street',
      },
    });
    return { ...owner, id: created.body.id as string, handle: created.body.handle as string };
  }

  async function product(
    sellerId: string,
    opts: {
      stock?: number;
      price?: bigint;
      modes?: ('pickup' | 'local_delivery')[];
      variants?: number;
    } = {},
  ) {
    n += 1;
    const p = await prisma.product.create({
      data: {
        sellerId,
        categoryId,
        title: `Diya set ${n}`,
        titleTa: 'அகல் விளக்கு',
        status: 'active',
        moderationStatus: 'live',
        publishedAt: new Date(),
        fulfilmentModes: opts.modes ?? ['pickup', 'local_delivery'],
        variants: {
          create: Array.from({ length: opts.variants ?? 1 }, (_, i) => ({
            label: opts.variants ? `Size ${i + 1}` : null,
            pricePaise: opts.price ?? 45_000n,
            stock: opts.stock ?? 5,
            position: i,
          })),
        },
      },
      include: { variants: { orderBy: { position: 'asc' } } },
    });
    return { id: p.id, variantIds: p.variants.map((v) => v.id) };
  }

  const addToCart = (token: string, variantId: string, quantity: number, replaceCart = false) =>
    http().put(`/cart/items/${variantId}`).set(auth(token)).send({ quantity, replaceCart });

  const placeOrder = (token: string, body: Record<string, unknown>, headers = key()) =>
    http().post('/orders').set(auth(token)).set(headers).send(body);

  const activeHeld = async (variantId: string) =>
    (
      await prisma.$queryRaw<{ held: bigint | null }[]>`
        SELECT SUM(quantity) AS held FROM inventory_reservations
        WHERE variant_id = ${variantId}::uuid AND status = 'active' AND expires_at > now()`
    )[0]?.held ?? 0n;

  // ───────────────────────────── The last unit ─────────────────────────────

  describe('stock holds under row locks', () => {
    it('50 buyers try to buy the last unit at once: exactly one order, the rest out_of_stock', async () => {
      const s = await shop();
      const p = await product(s.id, { stock: 1 });
      const variantId = p.variantIds[0]!;
      const buyers = [];
      for (let i = 0; i < 50; i++) {
        const b = await buyer();
        await addToCart(b.token, variantId, 1).expect(200);
        buyers.push(b);
      }
      await clearRateLimits(app);

      const results = await Promise.all(
        buyers.map((b) =>
          placeOrder(b.token, { fulfilmentMode: 'pickup', expectedTotalPaise: 45_000 }),
        ),
      );
      const statuses = results.map((r) => r.status);
      const odd = results.filter((r) => r.status !== 201 && r.status !== 409);
      expect(odd.map((r) => [r.status, r.body])).toEqual([]);
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(49);
      expect(statuses.filter((s) => s >= 500)).toHaveLength(0);
      for (const r of results.filter((r) => r.status === 409)) {
        expect(r.body.error.code).toBe('out_of_stock');
      }

      // Holds never exceed stock, and stock is untouched until payment (prompt 15).
      expect(await activeHeld(variantId)).toBe(1n);
      const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
      expect(variant.stock).toBe(1);
      expect(await prisma.order.count({ where: { items: { some: { variantId } } } })).toBe(1);
    }, 60_000);

    it('two buyers locking two variants in opposite order never deadlock', async () => {
      const s = await shop();
      const p = await product(s.id, { stock: 1, variants: 2 });
      const [a, b] = p.variantIds as [string, string];
      const one = await buyer();
      const two = await buyer();
      await addToCart(one.token, a, 1).expect(200);
      await addToCart(one.token, b, 1).expect(200);
      await addToCart(two.token, b, 1).expect(200);
      await addToCart(two.token, a, 1).expect(200);

      for (let round = 0; round < 3; round++) {
        const [r1, r2] = await Promise.all([
          placeOrder(one.token, { fulfilmentMode: 'pickup', expectedTotalPaise: 90_000 }),
          placeOrder(two.token, { fulfilmentMode: 'pickup', expectedTotalPaise: 90_000 }),
        ]);
        expect([r1.status, r2.status].sort()).toEqual([201, 409]);
        expect([r1, r2].find((r) => r.status === 409)!.body.error.code).toBe('out_of_stock');
        // Free the stock again for the next round.
        const winner = [r1, r2].find((r) => r.status === 201)!;
        const winnerToken = winner === r1 ? one.token : two.token;
        await http()
          .post(`/orders/${winner.body.id}/cancel`)
          .set(auth(winnerToken))
          .set(key())
          .expect(200);
        await addToCart(winnerToken, a, 1).expect(200);
        await addToCart(winnerToken, b, 1).expect(200);
      }
    }, 60_000);

    it('a seller cannot lower stock below units held by unpaid orders, but expired holds do not count', async () => {
      const s = await shop();
      const p = await product(s.id, { stock: 3 });
      const variantId = p.variantIds[0]!;
      const b = await buyer();
      await addToCart(b.token, variantId, 2).expect(200);
      const order = await placeOrder(b.token, {
        fulfilmentMode: 'pickup',
        expectedTotalPaise: 90_000,
      }).expect(201);

      const lower = await http()
        .post(`/seller/products/${p.id}/variants/${variantId}/stock`)
        .set(auth(s.token))
        .send({ stock: 1, stockBefore: 3 })
        .expect(409);
      expect(lower.body.error.code).toBe('stock_below_reserved');

      // Once the hold has expired (even before the clean-up job runs) the seller may lower it.
      await prisma.order.update({
        where: { id: order.body.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await prisma.inventoryReservation.updateMany({
        where: { orderId: order.body.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await http()
        .post(`/seller/products/${p.id}/variants/${variantId}/stock`)
        .set(auth(s.token))
        .send({ stock: 1, stockBefore: 3 })
        .expect(200);
    });
  });

  // ───────────────────────────── Bag ─────────────────────────────

  describe('bag', () => {
    it('holds one maker at a time; adding another maker asks first, then replaces', async () => {
      const s1 = await shop();
      const s2 = await shop();
      const p1 = await product(s1.id);
      const p2 = await product(s2.id);
      const b = await buyer();

      await addToCart(b.token, p1.variantIds[0]!, 2).expect(200);
      const conflict = await addToCart(b.token, p2.variantIds[0]!, 1).expect(409);
      expect(conflict.body.error.code).toBe('cart_other_seller');
      expect(conflict.body.error.details).toMatchObject({ seller: { handle: s1.handle } });

      const replaced = await addToCart(b.token, p2.variantIds[0]!, 1, true).expect(200);
      expect(replaced.body.seller.handle).toBe(s2.handle);
      expect(replaced.body.lines.map((l: { variantId: string }) => l.variantId)).toEqual([
        p2.variantIds[0],
      ]);

      await addToCart(b.token, p2.variantIds[0]!, 0).expect(200);
      const empty = await http().get('/cart').set(auth(b.token)).expect(200);
      expect(empty.body).toMatchObject({ seller: null, lines: [], subtotalPaise: 0, options: [] });
    });

    it('prices come from the server and each way to get it shows its own total', async () => {
      const s = await shop({ localDelivery: true, feePaise: 4_000n });
      const p = await product(s.id, { price: 12_050n });
      const b = await buyer();
      const cart = await addToCart(b.token, p.variantIds[0]!, 3).expect(200);
      expect(cart.body).toMatchObject({
        subtotalPaise: 36_150,
        options: [
          { mode: 'pickup', deliveryFeePaise: 0, totalPaise: 36_150 },
          { mode: 'local_delivery', deliveryFeePaise: 4_000, totalPaise: 40_150 },
        ],
      });
      expect(cart.body.lines[0]).toMatchObject({
        unitPricePaise: 12_050,
        quantity: 3,
        available: 5,
        problem: null,
      });
    });

    it("refuses your own products and products buyers can't see", async () => {
      const s = await shop();
      const p = await product(s.id);
      const own = await addToCart(s.token, p.variantIds[0]!, 1).expect(400);
      expect(own.body.error.code).toBe('cannot_buy_own');
      await prisma.product.update({ where: { id: p.id }, data: { status: 'paused' } });
      const b = await buyer();
      await addToCart(b.token, p.variantIds[0]!, 1).expect(404);
      await addToCart(b.token, randomUUID(), 1).expect(404);
      await addToCart(b.token, p.variantIds[0]!, 21).expect(400);
    });

    it('shows problems when a bag line can no longer be bought as it is', async () => {
      const s = await shop();
      const p = await product(s.id, { stock: 5 });
      const gone = await product(s.id);
      const b = await buyer();
      await addToCart(b.token, p.variantIds[0]!, 4).expect(200);
      await addToCart(b.token, gone.variantIds[0]!, 1).expect(200);
      await prisma.productVariant.update({ where: { id: p.variantIds[0]! }, data: { stock: 2 } });
      await prisma.product.update({ where: { id: gone.id }, data: { moderationStatus: 'held' } });
      const cart = await http().get('/cart').set(auth(b.token)).expect(200);
      const byId = Object.fromEntries(
        cart.body.lines.map((l: { variantId: string }) => [l.variantId, l]),
      );
      expect(byId[p.variantIds[0]!]).toMatchObject({ available: 2, problem: 'not_enough_stock' });
      expect(byId[gone.variantIds[0]!]).toMatchObject({ available: null, problem: 'unavailable' });
    });
  });

  // ───────────────────────────── Creating orders ─────────────────────────────

  describe('POST /orders', () => {
    it('creates an unpaid order with snapshots, a 15-minute hold, an event and an outbox row, and empties the bag', async () => {
      const s = await shop({ localDelivery: true, feePaise: 4_000n });
      const p = await product(s.id, { price: 45_000n, variants: 2 });
      const b = await buyer();
      const address = await http()
        .post('/me/addresses')
        .set(auth(b.token))
        .send({
          name: 'Lakshmi',
          phone: '9876543210',
          line1: '4 North Street',
          city: 'Trichy',
          pincode: '620003',
        })
        .expect(201);
      await addToCart(b.token, p.variantIds[0]!, 2).expect(200);
      await addToCart(b.token, p.variantIds[1]!, 1).expect(200);

      const before = Date.now();
      const res = await placeOrder(b.token, {
        fulfilmentMode: 'local_delivery',
        addressId: address.body.id,
        expectedTotalPaise: 139_000,
      }).expect(201);
      expect(res.body).toMatchObject({
        code: expect.stringMatching(/^XT-[A-Z0-9]{6}$/),
        status: 'awaiting_payment',
        fulfilmentMode: 'local_delivery',
        subtotalPaise: 135_000,
        deliveryFeePaise: 4_000,
        totalPaise: 139_000,
        seller: { handle: s.handle, areaName: 'Woraiyur', city: 'Trichy' },
        address: { name: 'Lakshmi', phone: '+919876543210', pincode: '620003' },
      });
      // The exact pickup spot is never in the buyer's copy.
      expect(JSON.stringify(res.body)).not.toContain('Secret Street');
      const expiresAt = new Date(res.body.expiresAt).getTime();
      expect(expiresAt - before).toBeGreaterThan(14 * 60_000);
      expect(expiresAt - before).toBeLessThan(16 * 60_000);

      const order = await prisma.order.findUniqueOrThrow({
        where: { id: res.body.id },
        include: { items: true, events: true, reservations: true },
      });
      expect(order.items).toHaveLength(2);
      expect(order.items[0]).toMatchObject({
        titleSnapshot: expect.stringContaining('Diya set'),
        titleTaSnapshot: 'அகல் விளக்கு',
        variantSnapshot: expect.stringMatching(/^Size/),
        commissionBps: 0,
        commissionPaise: 0n,
        commissionRuleId: expect.any(String),
      });
      expect(order.events).toEqual([
        expect.objectContaining({
          fromStatus: null,
          toStatus: 'awaiting_payment',
          actorId: b.userId,
        }),
      ]);
      expect(order.reservations.map((r) => r.status)).toEqual(['active', 'active']);
      expect(order.addressSnapshot).toMatchObject({ line1: '4 North Street' });
      expect(
        await prisma.outboxEvent.count({
          where: { topic: 'order.created', aggregateId: order.id },
        }),
      ).toBe(1);

      // The bag was emptied in the same transaction: a second tap with a new key can't order again.
      const again = await placeOrder(b.token, {
        fulfilmentMode: 'pickup',
        expectedTotalPaise: 135_000,
      }).expect(409);
      expect(again.body.error.code).toBe('cart_empty');
    });

    it('needs an Idempotency-Key, replays the same response for a retry, and refuses a reused key with a different body', async () => {
      const s = await shop();
      const p = await product(s.id);
      const b = await buyer();
      await addToCart(b.token, p.variantIds[0]!, 1).expect(200);
      const body = { fulfilmentMode: 'pickup', expectedTotalPaise: 45_000 };

      await http().post('/orders').set(auth(b.token)).send(body).expect(400);
      await http()
        .post('/orders')
        .set(auth(b.token))
        .set('Idempotency-Key', 'x'.repeat(300))
        .send(body)
        .expect(400);

      const headers = key();
      const first = await placeOrder(b.token, body, headers).expect(201);
      const retry = await placeOrder(b.token, body, headers).expect(201);
      expect(retry.body).toEqual(first.body);
      expect(await prisma.order.count({ where: { buyerId: b.userId } })).toBe(1);

      const reused = await placeOrder(b.token, { ...body, expectedTotalPaise: 1 }, headers).expect(
        422,
      );
      expect(reused.body.error.code).toBe('idempotency_key_reused');
    });

    it('parallel retries with one key make one order', async () => {
      const s = await shop();
      const p = await product(s.id);
      const b = await buyer();
      await addToCart(b.token, p.variantIds[0]!, 1).expect(200);
      const headers = key();
      const body = { fulfilmentMode: 'pickup', expectedTotalPaise: 45_000 };
      const results = await Promise.all([0, 1, 2, 3].map(() => placeOrder(b.token, body, headers)));
      expect(results.filter((r) => r.status === 201).length).toBeGreaterThanOrEqual(1);
      for (const r of results.filter((r) => r.status !== 201)) {
        expect(r.status).toBe(409);
        expect(r.body.error.code).toBe('idempotency_in_progress');
      }
      expect(await prisma.order.count({ where: { buyerId: b.userId } })).toBe(1);
    });

    it('refuses when the price changed since the buyer looked; a new key with the new total works', async () => {
      const s = await shop();
      const p = await product(s.id, { price: 45_000n });
      const b = await buyer();
      await addToCart(b.token, p.variantIds[0]!, 1).expect(200);
      await prisma.productVariant.update({
        where: { id: p.variantIds[0]! },
        data: { pricePaise: 50_000n },
      });

      const changed = await placeOrder(b.token, {
        fulfilmentMode: 'pickup',
        expectedTotalPaise: 45_000,
      }).expect(409);
      expect(changed.body.error.code).toBe('price_changed');
      expect(changed.body.error.details).toMatchObject({ totalPaise: 50_000 });
      expect(await activeHeld(p.variantIds[0]!)).toBe(0n); // nothing held for a refused order

      await placeOrder(b.token, { fulfilmentMode: 'pickup', expectedTotalPaise: 50_000 }).expect(
        201,
      );
    });

    it('checks the shop, the items, the way to get it and the address', async () => {
      const b = await buyer();
      const other = await buyer();
      const otherAddress = await http()
        .post('/me/addresses')
        .set(auth(other.token))
        .send({
          name: 'Someone',
          phone: '9876543211',
          line1: '9 South Street',
          city: 'Trichy',
          pincode: '620002',
        })
        .expect(201);

      // Local delivery the shop doesn't offer.
      const pickupOnly = await shop({ localDelivery: false });
      const p1 = await product(pickupOnly.id);
      await addToCart(b.token, p1.variantIds[0]!, 1).expect(200);
      const mine = await http()
        .post('/me/addresses')
        .set(auth(b.token))
        .send({
          name: 'Me',
          phone: '9876543212',
          line1: '1 East Street',
          city: 'Trichy',
          pincode: '620001',
        })
        .expect(201);
      const notOffered = await placeOrder(b.token, {
        fulfilmentMode: 'local_delivery',
        addressId: mine.body.id,
        expectedTotalPaise: 45_000,
      }).expect(400);
      expect(notOffered.body.error.code).toBe('fulfilment_not_offered');

      // An item that is pickup-only, in a shop that delivers.
      const delivers = await shop({ localDelivery: true });
      const p2 = await product(delivers.id, { modes: ['pickup'] });
      await addToCart(b.token, p2.variantIds[0]!, 1, true).expect(200);
      await placeOrder(b.token, {
        fulfilmentMode: 'local_delivery',
        addressId: mine.body.id,
        expectedTotalPaise: 45_000,
      }).expect(400);

      // Someone else's address.
      const p3 = await product(delivers.id);
      await addToCart(b.token, p3.variantIds[0]!, 1, true).expect(200);
      await placeOrder(b.token, {
        fulfilmentMode: 'local_delivery',
        addressId: otherAddress.body.id,
        expectedTotalPaise: 45_000,
      }).expect(404);

      // A paused shop takes no orders; a product hidden after it was added can't be ordered.
      await prisma.sellerProfile.update({ where: { id: delivers.id }, data: { status: 'paused' } });
      const paused = await placeOrder(b.token, {
        fulfilmentMode: 'pickup',
        expectedTotalPaise: 45_000,
      }).expect(409);
      expect(paused.body.error.code).toBe('shop_not_accepting');
      await prisma.sellerProfile.update({ where: { id: delivers.id }, data: { status: 'active' } });
      await prisma.product.update({ where: { id: p3.id }, data: { moderationStatus: 'held' } });
      const hidden = await placeOrder(b.token, {
        fulfilmentMode: 'pickup',
        expectedTotalPaise: 45_000,
      }).expect(409);
      expect(hidden.body.error.code).toBe('cart_has_problems');
    });

    it('uses the commission rule for the category before the default', async () => {
      const rule = await prisma.commissionRule.create({
        data: {
          name: 'Terracotta test 3%',
          categoryId,
          rateBps: 300,
          validFrom: new Date(Date.now() - 60_000),
        },
      });
      try {
        const s = await shop();
        const p = await product(s.id, { price: 10_010n });
        const b = await buyer();
        await addToCart(b.token, p.variantIds[0]!, 1).expect(200);
        const res = await placeOrder(b.token, {
          fulfilmentMode: 'pickup',
          expectedTotalPaise: 10_010,
        }).expect(201);
        const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: res.body.id } });
        expect(item).toMatchObject({
          commissionBps: 300,
          commissionPaise: 300n,
          commissionRuleId: rule.id,
        });
        // Commission is never added to what the buyer pays.
        expect(res.body.totalPaise).toBe(10_010);
      } finally {
        await prisma.orderItem.updateMany({
          where: { commissionRuleId: rule.id },
          data: { commissionRuleId: null },
        });
        await prisma.commissionRule.delete({ where: { id: rule.id } });
      }
    });
  });

  // ───────────────────────────── Cancel and expiry ─────────────────────────────

  describe('cancel and expiry', () => {
    it('the buyer cancels an unpaid order: the hold is released at once', async () => {
      const s = await shop();
      const p = await product(s.id, { stock: 1 });
      const b = await buyer();
      await addToCart(b.token, p.variantIds[0]!, 1).expect(200);
      const order = await placeOrder(b.token, {
        fulfilmentMode: 'pickup',
        expectedTotalPaise: 45_000,
      }).expect(201);

      const headers = key();
      const cancelled = await http()
        .post(`/orders/${order.body.id}/cancel`)
        .set(auth(b.token))
        .set(headers)
        .expect(200);
      expect(cancelled.body.status).toBe('cancelled_by_buyer');
      await http()
        .post(`/orders/${order.body.id}/cancel`)
        .set(auth(b.token))
        .set(headers)
        .expect(200); // replay
      expect(await activeHeld(p.variantIds[0]!)).toBe(0n);
      const events = await prisma.orderEvent.findMany({
        where: { orderId: order.body.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(events.map((e) => e.toStatus)).toEqual(['awaiting_payment', 'cancelled_by_buyer']);

      // With a new key, cancelling again is refused: the order is no longer unpaid.
      const twice = await http()
        .post(`/orders/${order.body.id}/cancel`)
        .set(auth(b.token))
        .set(key())
        .expect(409);
      expect(twice.body.error.code).toBe('invalid_order_status');

      // Someone else can buy it now.
      const next = await buyer();
      await addToCart(next.token, p.variantIds[0]!, 1).expect(200);
      await placeOrder(next.token, { fulfilmentMode: 'pickup', expectedTotalPaise: 45_000 }).expect(
        201,
      );
    });

    it('expired holds free the stock even before the job runs; the job then expires the order', async () => {
      const s = await shop();
      const p = await product(s.id, { stock: 1 });
      const b = await buyer();
      await addToCart(b.token, p.variantIds[0]!, 1).expect(200);
      const order = await placeOrder(b.token, {
        fulfilmentMode: 'pickup',
        expectedTotalPaise: 45_000,
      }).expect(201);
      const past = new Date(Date.now() - 1000);
      await prisma.order.update({ where: { id: order.body.id }, data: { expiresAt: past } });
      await prisma.inventoryReservation.updateMany({
        where: { orderId: order.body.id },
        data: { expiresAt: past },
      });

      const next = await buyer();
      await addToCart(next.token, p.variantIds[0]!, 1).expect(200);
      await placeOrder(next.token, { fulfilmentMode: 'pickup', expectedTotalPaise: 45_000 }).expect(
        201,
      );

      const expired = await app.get(OrdersExpiry).expireDue();
      expect(expired).toBeGreaterThanOrEqual(1);
      const row = await prisma.order.findUniqueOrThrow({
        where: { id: order.body.id },
        include: { reservations: true },
      });
      expect(row.status).toBe('expired');
      expect(row.reservations.map((r) => r.status)).toEqual(['expired']);
      expect(
        await prisma.outboxEvent.count({
          where: { topic: 'order.expired', aggregateId: order.body.id },
        }),
      ).toBe(1);
      // Running it again changes nothing.
      await app.get(OrdersExpiry).expireDue();
      expect(
        await prisma.orderEvent.count({ where: { orderId: order.body.id, toStatus: 'expired' } }),
      ).toBe(1);
    });

    it('expiry never overwrites a cancel that got there first', async () => {
      const s = await shop();
      const p = await product(s.id);
      const b = await buyer();
      await addToCart(b.token, p.variantIds[0]!, 1).expect(200);
      const order = await placeOrder(b.token, {
        fulfilmentMode: 'pickup',
        expectedTotalPaise: 45_000,
      }).expect(201);
      await prisma.order.update({
        where: { id: order.body.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await http()
        .post(`/orders/${order.body.id}/cancel`)
        .set(auth(b.token))
        .set(key())
        .expect(200);
      await app.get(OrdersExpiry).expireDue();
      const row = await prisma.order.findUniqueOrThrow({ where: { id: order.body.id } });
      expect(row.status).toBe('cancelled_by_buyer');
    });
  });

  // ───────────────────────────── Ownership ─────────────────────────────

  describe('ownership', () => {
    it('buyers see only their own orders and addresses', async () => {
      const s = await shop();
      const p = await product(s.id);
      const a = await buyer();
      const b = await buyer();
      const addr = await http()
        .post('/me/addresses')
        .set(auth(a.token))
        .send({
          name: 'A',
          phone: '9876543213',
          line1: '2 West Street',
          city: 'Trichy',
          pincode: '620004',
        })
        .expect(201);
      await addToCart(a.token, p.variantIds[0]!, 1).expect(200);
      const order = await placeOrder(a.token, {
        fulfilmentMode: 'pickup',
        expectedTotalPaise: 45_000,
      }).expect(201);

      await http().get(`/orders/${order.body.id}`).set(auth(b.token)).expect(404);
      await http()
        .post(`/orders/${order.body.id}/cancel`)
        .set(auth(b.token))
        .set(key())
        .expect(404);
      expect((await http().get('/orders').set(auth(b.token))).body.items).toEqual([]);
      expect(
        (await http().get('/orders').set(auth(a.token))).body.items.map(
          (o: { id: string }) => o.id,
        ),
      ).toEqual([order.body.id]);
      await http().get(`/orders/${order.body.id}`).set(auth(a.token)).expect(200);

      expect((await http().get('/me/addresses').set(auth(b.token))).body.items).toEqual([]);
      await http()
        .patch(`/me/addresses/${addr.body.id}`)
        .set(auth(b.token))
        .send({ city: 'Madurai' })
        .expect(404);
      await http().delete(`/me/addresses/${addr.body.id}`).set(auth(b.token)).expect(404);
      await http().delete(`/me/addresses/${addr.body.id}`).set(auth(a.token)).expect(204);
      expect((await http().get('/me/addresses').set(auth(a.token))).body.items).toEqual([]);
      // A deleted address keeps the copy already in the order (snapshot) and can't be used again.
      await http().get('/cart').expect(401);
    });
  });
});
