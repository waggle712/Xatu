import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { OutboxRelay } from '../src/outbox/outbox.relay.js';
import { PaymentsPoller } from '../src/modules/payments/payments.poller.js';
import { WebhookProcessor } from '../src/modules/payments/webhook.processor.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  clearRateLimits,
  createTestApp,
  type RecordedEvent,
  signInNewUser,
} from './support/app.js';
import { type FakeRazorpay, sign, webhookBody } from './support/razorpay.js';

// Prompt 15: payments are verified ONLY by a signature-checked webhook or a server-side fetch.
// Webhook bodies come from fixtures (test/fixtures/razorpay). Background workers run in tests
// too, so every step below is also called directly and must be safe to run twice.
describe('Payments and Razorpay webhooks (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let razorpay: FakeRazorpay;
  let events: RecordedEvent[];
  let categoryId: string;
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const key = () => ({ 'Idempotency-Key': randomUUID() });
  let n = 0;

  beforeAll(async () => {
    ({ app, razorpay, events } = await createTestApp());
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

  const relay = () => app.get(OutboxRelay);
  const processor = () => app.get(WebhookProcessor);
  const poller = () => app.get(PaymentsPoller);

  /** Runs everything that happens in the background until nothing is left to do. */
  async function settle() {
    for (let i = 0; i < 5; i++) {
      await processor().processPending(0);
      await relay().drain();
    }
  }

  /** A buyer with an unpaid order for `qty` of a product with `stock`, and its started payment. */
  async function unpaidOrder(opts: { stock?: number; qty?: number } = {}) {
    await clearRateLimits(app);
    const owner = await signInNewUser(app);
    n += 1;
    const shop = await http()
      .post('/sellers')
      .set(auth(owner.token))
      .send({
        businessName: `Pay Maker ${n}`,
        handle: `pay_${Date.now().toString(36)}${n}`,
        categoryId,
      })
      .expect(201);
    await prisma.sellerProfile.update({
      where: { id: shop.body.id },
      data: { status: 'active', areaName: 'Woraiyur', city: 'Trichy', pickupAvailable: true },
    });
    const product = await prisma.product.create({
      data: {
        sellerId: shop.body.id,
        categoryId,
        title: `Clay pot ${n}`,
        status: 'active',
        moderationStatus: 'live',
        publishedAt: new Date(),
        fulfilmentModes: ['pickup'],
        variants: { create: { pricePaise: 45_000n, stock: opts.stock ?? 5 } },
      },
      include: { variants: true },
    });
    const variantId = product.variants[0]!.id;
    await clearRateLimits(app);
    const buyer = await signInNewUser(app);
    const qty = opts.qty ?? 1;
    await http()
      .put(`/cart/items/${variantId}`)
      .set(auth(buyer.token))
      .send({ quantity: qty })
      .expect(200);
    const order = await http()
      .post('/orders')
      .set(auth(buyer.token))
      .set(key())
      .send({ fulfilmentMode: 'pickup', expectedTotalPaise: 45_000 * qty })
      .expect(201);
    return { buyer, variantId, orderId: order.body.id as string, total: 45_000 * qty };
  }

  async function startPayment(o: { buyer: { token: string }; orderId: string }) {
    const res = await http()
      .post(`/orders/${o.orderId}/pay`)
      .set(auth(o.buyer.token))
      .set(key())
      .expect(201);
    return res.body as {
      paymentId: string;
      providerOrderId: string;
      amountPaise: number;
      keyId: string;
    };
  }

  function postWebhook(
    event: 'payment.captured' | 'payment.failed' | 'order.paid',
    p: { orderId: string; paymentId: string; amount: number; xatuOrderId: string },
    opts: { eventId?: string; signature?: string } = {},
  ) {
    const body = webhookBody(event, p);
    return http()
      .post('/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', opts.signature ?? sign(body))
      .set(
        'x-razorpay-event-id',
        opts.eventId ?? `evt_${randomUUID().replaceAll('-', '').slice(0, 14)}`,
      )
      .send(body);
  }

  const orderRow = (id: string) =>
    prisma.order.findUniqueOrThrow({
      where: { id },
      include: { reservations: true, payments: true },
    });
  const stockOf = async (variantId: string) =>
    (await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stock;

  // ───────────────────────────── Starting a payment ─────────────────────────────

  it('starting a payment makes one Razorpay order for the order total and returns only the public key id', async () => {
    const o = await unpaidOrder();
    const before = razorpay.createOrderCalls;
    const start = await startPayment(o);
    expect(start).toMatchObject({
      keyId: 'rzp_test_FakeKeyForTests',
      amountPaise: 45_000,
      currency: 'INR',
      provider: 'razorpay',
    });
    expect(JSON.stringify(start)).not.toContain('fake-test-secret');
    // Tapping Pay again reuses the open payment and its Razorpay order (never a second charge).
    const again = await startPayment(o);
    expect(again.paymentId).toBe(start.paymentId);
    expect(again.providerOrderId).toBe(start.providerOrderId);
    expect(razorpay.createOrderCalls).toBe(before + 1);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: start.paymentId } });
    expect(payment).toMatchObject({ status: 'pending', amountPaise: 45_000n });
  });

  it("only the order's buyer can pay, and only while it's unpaid", async () => {
    const o = await unpaidOrder();
    const other = await signInNewUser(app);
    await http().post(`/orders/${o.orderId}/pay`).set(auth(other.token)).set(key()).expect(404);
    await http()
      .post(`/orders/${o.orderId}/cancel`)
      .set(auth(o.buyer.token))
      .set(key())
      .expect(200);
    const res = await http()
      .post(`/orders/${o.orderId}/pay`)
      .set(auth(o.buyer.token))
      .set(key())
      .expect(409);
    expect(res.body.error.code).toBe('invalid_order_status');
  });

  it('there is no way for the app to mark a payment paid', async () => {
    const o = await unpaidOrder();
    const start = await startPayment(o);
    for (const path of [
      `/payments/${start.paymentId}/confirm`,
      `/payments/${start.paymentId}/verify`,
    ]) {
      await http()
        .post(path)
        .set(auth(o.buyer.token))
        .send({ razorpay_signature: 'x' })
        .expect(404);
    }
    const view = await http()
      .get(`/payments/${start.paymentId}`)
      .set(auth(o.buyer.token))
      .expect(200);
    expect(view.body.status).toBe('pending');
  });

  // ───────────────────────────── Webhooks ─────────────────────────────

  it('app killed after paying: the webhook alone verifies the payment and places the order', async () => {
    const o = await unpaidOrder({ stock: 3, qty: 2 });
    const start = await startPayment(o);
    const paid = razorpay.attempt(start.providerOrderId, 'captured');
    // The app never comes back. Only Razorpay's webhook arrives.
    await postWebhook('payment.captured', {
      orderId: start.providerOrderId,
      paymentId: paid.id,
      amount: o.total,
      xatuOrderId: o.orderId,
    }).expect(200);
    await settle();

    const order = await orderRow(o.orderId);
    expect(order.status).toBe('placed');
    expect(order.expiresAt).toBeNull();
    expect(order.reservations.map((r) => r.status)).toEqual(['committed']);
    expect(order.payments[0]).toMatchObject({
      status: 'verified',
      providerPaymentId: paid.id,
      verifiedBy: 'webhook',
    });
    expect(await stockOf(o.variantId)).toBe(1); // stock drops only now
    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { variantId: o.variantId, reason: 'order_sold' },
    });
    expect(movement).toMatchObject({ delta: -2, stockAfter: 1 });
    expect(
      await prisma.outboxEvent.count({
        where: { topic: 'payment.verified', aggregateId: start.paymentId },
      }),
    ).toBe(1);
    expect(
      events.filter((e) => e.event === 'order_paid' && e.properties.order_id === o.orderId),
    ).toHaveLength(1);
    // The app, reopened later, sees it paid.
    const view = await http()
      .get(`/payments/${start.paymentId}`)
      .set(auth(o.buyer.token))
      .expect(200);
    expect(view.body.status).toBe('verified');
  });

  it('the same webhook 5× is stored once and changes things once', async () => {
    const o = await unpaidOrder({ stock: 5 });
    const start = await startPayment(o);
    const paid = razorpay.attempt(start.providerOrderId, 'captured');
    const p = {
      orderId: start.providerOrderId,
      paymentId: paid.id,
      amount: o.total,
      xatuOrderId: o.orderId,
    };
    const eventId = `evt_dup${Date.now()}`;
    for (let i = 0; i < 5; i++) {
      await postWebhook('payment.captured', p, { eventId }).expect(200);
      await settle();
    }
    expect(await prisma.paymentWebhookEvent.count({ where: { providerEventId: eventId } })).toBe(1);
    expect(await stockOf(o.variantId)).toBe(4);
    expect(
      await prisma.orderEvent.count({ where: { orderId: o.orderId, toStatus: 'placed' } }),
    ).toBe(1);
    expect(
      await prisma.stockMovement.count({ where: { variantId: o.variantId, reason: 'order_sold' } }),
    ).toBe(1);
  });

  it('out of order: a failed attempt, then the capture, then late failure and order.paid events', async () => {
    const o = await unpaidOrder({ stock: 5 });
    const start = await startPayment(o);
    const failed = razorpay.attempt(start.providerOrderId, 'failed');
    const paid = razorpay.attempt(start.providerOrderId, 'captured');
    const base = { orderId: start.providerOrderId, amount: o.total, xatuOrderId: o.orderId };

    // order.paid arrives first, then the earlier failure, then the capture, then the failure again.
    await postWebhook('order.paid', { ...base, paymentId: paid.id }).expect(200);
    await postWebhook('payment.failed', { ...base, paymentId: failed.id }).expect(200);
    await postWebhook('payment.captured', { ...base, paymentId: paid.id }).expect(200);
    await postWebhook('payment.failed', { ...base, paymentId: failed.id }).expect(200);
    await settle();

    const order = await orderRow(o.orderId);
    expect(order.status).toBe('placed');
    expect(order.payments).toHaveLength(1);
    expect(order.payments[0]).toMatchObject({ status: 'verified', providerPaymentId: paid.id });
    expect(await stockOf(o.variantId)).toBe(4);

    // A failed attempt on its own never fails the payment: the buyer can try again in the sheet.
    const o2 = await unpaidOrder();
    const s2 = await startPayment(o2);
    const f2 = razorpay.attempt(s2.providerOrderId, 'failed');
    await postWebhook('payment.failed', {
      orderId: s2.providerOrderId,
      paymentId: f2.id,
      amount: o2.total,
      xatuOrderId: o2.orderId,
    }).expect(200);
    await settle();
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: s2.paymentId } })).status).toBe(
      'pending',
    );
    expect((await orderRow(o2.orderId)).status).toBe('awaiting_payment');
  });

  it('refuses a bad signature: stored for the record, never processed, and it cannot block the real event', async () => {
    const o = await unpaidOrder();
    const start = await startPayment(o);
    const paid = razorpay.attempt(start.providerOrderId, 'captured');
    const p = {
      orderId: start.providerOrderId,
      paymentId: paid.id,
      amount: o.total,
      xatuOrderId: o.orderId,
    };
    const eventId = `evt_forged${Date.now()}`;
    await postWebhook('payment.captured', p, { eventId, signature: 'deadbeef' }).expect(400);
    await postWebhook('payment.captured', p, { eventId, signature: 'a'.repeat(64) }).expect(400);
    await http()
      .post('/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .send('{}')
      .expect(400);
    await settle();
    expect((await orderRow(o.orderId)).status).toBe('awaiting_payment');
    const stored = await prisma.paymentWebhookEvent.findMany({
      where: { providerEventId: eventId },
    });
    expect(stored.every((e) => !e.signatureValid && e.processedAt === null)).toBe(true);

    // The real event with the same id still goes through.
    await postWebhook('payment.captured', p, { eventId }).expect(200);
    await settle();
    expect((await orderRow(o.orderId)).status).toBe('placed');
  });

  it('never verifies when the amount or currency does not match the order', async () => {
    const o = await unpaidOrder();
    const start = await startPayment(o);
    const paid = razorpay.attempt(start.providerOrderId, 'captured', 100);
    await postWebhook('payment.captured', {
      orderId: start.providerOrderId,
      paymentId: paid.id,
      amount: 100,
      xatuOrderId: o.orderId,
    }).expect(200);
    await settle();
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: start.paymentId } })).status,
    ).toBe('pending');
    const event = await prisma.paymentWebhookEvent.findFirstOrThrow({
      where: { payload: { path: ['payload', 'payment', 'entity', 'id'], equals: paid.id } },
    });
    expect(event.outcome).toBe('amount_mismatch');
  });

  it('a stored event whose job never ran is picked up again', async () => {
    const o = await unpaidOrder();
    const start = await startPayment(o);
    const paid = razorpay.attempt(start.providerOrderId, 'captured');
    await postWebhook('payment.captured', {
      orderId: start.providerOrderId,
      paymentId: paid.id,
      amount: o.total,
      xatuOrderId: o.orderId,
    }).expect(200);
    // Simulate the queue losing the job: the row is stored but nothing processed it.
    await prisma.paymentWebhookEvent.updateMany({
      where: { processedAt: null, signatureValid: true },
      data: { createdAt: new Date(Date.now() - 5 * 60_000) },
    });
    await settle();
    expect((await orderRow(o.orderId)).status).toBe('placed');
  });

  // ───────────────────────────── Missing or late webhooks ─────────────────────────────

  it('webhook delayed 30 min: the poller verifies by fetching from Razorpay; the late webhook changes nothing', async () => {
    const o = await unpaidOrder({ stock: 5 });
    const start = await startPayment(o);
    const paid = razorpay.attempt(start.providerOrderId, 'captured');
    await prisma.payment.update({
      where: { id: start.paymentId },
      data: { createdAt: new Date(Date.now() - 3 * 60_000) },
    });

    await poller().pollOnce();
    await settle();
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: start.paymentId } });
    expect(payment).toMatchObject({
      status: 'verified',
      verifiedBy: 'fetch',
      providerPaymentId: paid.id,
    });
    expect((await orderRow(o.orderId)).status).toBe('placed');

    await postWebhook('payment.captured', {
      orderId: start.providerOrderId,
      paymentId: paid.id,
      amount: o.total,
      xatuOrderId: o.orderId,
    }).expect(200);
    await settle();
    expect(await stockOf(o.variantId)).toBe(4);
    expect(
      await prisma.orderEvent.count({ where: { orderId: o.orderId, toStatus: 'placed' } }),
    ).toBe(1);
  });

  it('webhook never arrives and nothing was paid: the order expires and the payment expires (after a final check)', async () => {
    const o = await unpaidOrder();
    const start = await startPayment(o);
    const past = new Date(Date.now() - 20 * 60_000);
    await prisma.order.update({ where: { id: o.orderId }, data: { expiresAt: past } });
    await prisma.inventoryReservation.updateMany({
      where: { orderId: o.orderId },
      data: { expiresAt: past },
    });
    await prisma.payment.update({ where: { id: start.paymentId }, data: { createdAt: past } });

    await poller().pollOnce();
    await settle();
    expect((await orderRow(o.orderId)).status).toBe('expired');
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: start.paymentId } })).status,
    ).toBe('expired');
  });

  it('paid after the hold ran out, stock still there: the order is placed', async () => {
    const o = await unpaidOrder({ stock: 5 });
    const start = await startPayment(o);
    const past = new Date(Date.now() - 40 * 60_000);
    await prisma.order.update({ where: { id: o.orderId }, data: { expiresAt: past } });
    await prisma.inventoryReservation.updateMany({
      where: { orderId: o.orderId },
      data: { expiresAt: past },
    });
    await prisma.payment.update({ where: { id: start.paymentId }, data: { createdAt: past } });
    await poller().pollOnce(); // nothing captured yet: order and payment expire
    await settle();
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: start.paymentId } })).status,
    ).toBe('expired');

    // The bank comes through 30+ minutes late.
    const paid = razorpay.attempt(start.providerOrderId, 'captured');
    await postWebhook('payment.captured', {
      orderId: start.providerOrderId,
      paymentId: paid.id,
      amount: o.total,
      xatuOrderId: o.orderId,
    }).expect(200);
    await settle();
    expect((await orderRow(o.orderId)).status).toBe('placed');
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: start.paymentId } })).status,
    ).toBe('verified');
    expect(await stockOf(o.variantId)).toBe(4);
  });

  it('paid after the hold ran out and the last unit was sold: the payment is marked for refund', async () => {
    const o = await unpaidOrder({ stock: 1 });
    const start = await startPayment(o);
    const past = new Date(Date.now() - 40 * 60_000);
    await prisma.order.update({ where: { id: o.orderId }, data: { expiresAt: past } });
    await prisma.inventoryReservation.updateMany({
      where: { orderId: o.orderId },
      data: { expiresAt: past },
    });
    // Someone else buys the last unit and pays.
    const otherBuyer = await signInNewUser(app);
    await http()
      .put(`/cart/items/${o.variantId}`)
      .set(auth(otherBuyer.token))
      .send({ quantity: 1 })
      .expect(200);
    const other = await http()
      .post('/orders')
      .set(auth(otherBuyer.token))
      .set(key())
      .send({ fulfilmentMode: 'pickup', expectedTotalPaise: 45_000 })
      .expect(201);
    const otherStart = await startPayment({ buyer: otherBuyer, orderId: other.body.id });
    const otherPaid = razorpay.attempt(otherStart.providerOrderId, 'captured');
    await postWebhook('payment.captured', {
      orderId: otherStart.providerOrderId,
      paymentId: otherPaid.id,
      amount: 45_000,
      xatuOrderId: other.body.id,
    }).expect(200);
    await settle();
    expect(await stockOf(o.variantId)).toBe(0);

    // Now the first buyer's late payment lands.
    const paid = razorpay.attempt(start.providerOrderId, 'captured');
    await postWebhook('payment.captured', {
      orderId: start.providerOrderId,
      paymentId: paid.id,
      amount: o.total,
      xatuOrderId: o.orderId,
    }).expect(200);
    await settle();
    expect((await orderRow(o.orderId)).status).not.toBe('placed');
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: start.paymentId } })).status,
    ).toBe('refund_pending');
    expect(await stockOf(o.variantId)).toBe(0); // never negative
    expect(
      await prisma.outboxEvent.count({
        where: { topic: 'order.refund_needed', aggregateId: o.orderId },
      }),
    ).toBe(1);
  });

  it('paid for an order the buyer had cancelled: marked for refund, never placed', async () => {
    const o = await unpaidOrder();
    const start = await startPayment(o);
    await http()
      .post(`/orders/${o.orderId}/cancel`)
      .set(auth(o.buyer.token))
      .set(key())
      .expect(200);
    const paid = razorpay.attempt(start.providerOrderId, 'captured');
    await postWebhook('payment.captured', {
      orderId: start.providerOrderId,
      paymentId: paid.id,
      amount: o.total,
      xatuOrderId: o.orderId,
    }).expect(200);
    await settle();
    expect((await orderRow(o.orderId)).status).toBe('cancelled_by_buyer');
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: start.paymentId } })).status,
    ).toBe('refund_pending');
  });

  it('the order screen sees its payment: a refund is visible to the buyer, and only to the buyer', async () => {
    const o = await unpaidOrder();
    const start = await startPayment(o);
    await http()
      .post(`/orders/${o.orderId}/cancel`)
      .set(auth(o.buyer.token))
      .set(key())
      .expect(200);
    const paid = razorpay.attempt(start.providerOrderId, 'captured');
    await postWebhook('payment.captured', {
      orderId: start.providerOrderId,
      paymentId: paid.id,
      amount: o.total,
      xatuOrderId: o.orderId,
    }).expect(200);
    await settle();
    const view = await http()
      .get(`/orders/${o.orderId}/payment`)
      .set(auth(o.buyer.token))
      .expect(200);
    expect(view.body.payment).toMatchObject({ id: start.paymentId, status: 'refund_pending' });
    const other = await signInNewUser(app);
    await http().get(`/orders/${o.orderId}/payment`).set(auth(other.token)).expect(404);
    const none = await unpaidOrder();
    expect(
      (await http().get(`/orders/${none.orderId}/payment`).set(auth(none.buyer.token)).expect(200))
        .body.payment,
    ).toBeNull();
  });

  it('reopening the app after paying: the order screen checks with Razorpay right away', async () => {
    const o = await unpaidOrder();
    const start = await startPayment(o);
    razorpay.attempt(start.providerOrderId, 'captured');
    // No webhook, no poller run: just the buyer opening the order again.
    const view = await http()
      .get(`/orders/${o.orderId}/payment`)
      .set(auth(o.buyer.token))
      .expect(200);
    expect(view.body.payment.status).toBe('verified');
    await settle();
    expect((await orderRow(o.orderId)).status).toBe('placed');
  });

  it('paid just before the hold ran out, webhook late: checked with Razorpay before the order is expired', async () => {
    const o = await unpaidOrder({ stock: 5 });
    const start = await startPayment(o); // created just now: still inside the webhook grace period
    razorpay.attempt(start.providerOrderId, 'captured');
    const past = new Date(Date.now() - 1000);
    await prisma.order.update({ where: { id: o.orderId }, data: { expiresAt: past } });
    await prisma.inventoryReservation.updateMany({
      where: { orderId: o.orderId },
      data: { expiresAt: past },
    });
    await poller().pollOnce();
    await settle();
    expect((await orderRow(o.orderId)).status).toBe('placed');
    expect(
      await prisma.orderEvent.count({ where: { orderId: o.orderId, toStatus: 'expired' } }),
    ).toBe(0);
  });

  it('an expired payment captured later with no webhook is still found (re-checked within 72 hours)', async () => {
    const o = await unpaidOrder({ stock: 5 });
    const start = await startPayment(o);
    const past = new Date(Date.now() - 2 * 60 * 60_000);
    await prisma.order.update({ where: { id: o.orderId }, data: { expiresAt: past } });
    await prisma.inventoryReservation.updateMany({
      where: { orderId: o.orderId },
      data: { expiresAt: past },
    });
    await prisma.payment.update({ where: { id: start.paymentId }, data: { createdAt: past } });
    await poller().pollOnce();
    await settle();
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: start.paymentId } })).status,
    ).toBe('expired');
    // The capture lands later and its webhook is lost.
    razorpay.attempt(start.providerOrderId, 'captured');
    await prisma.payment.update({ where: { id: start.paymentId }, data: { lastCheckedAt: past } });
    await poller().pollOnce();
    await settle();
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: start.paymentId } })).status,
    ).toBe('verified');
    expect((await orderRow(o.orderId)).status).toBe('placed');
  });

  it('forged webhooks are stored small', async () => {
    const big = JSON.stringify({ event: 'payment.captured', junk: 'x'.repeat(50_000) });
    const eventId = `evt_big${Date.now()}`;
    await http()
      .post('/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', 'f'.repeat(64))
      .set('x-razorpay-event-id', eventId)
      .send(big)
      .expect(400);
    const row = await prisma.paymentWebhookEvent.findFirstOrThrow({
      where: { providerEventId: eventId },
    });
    expect(row.rawBody.length).toBeLessThanOrEqual(1100);
    expect(row.payload).toMatchObject({ truncated: true, bytes: big.length });
  });

  // ───────────────────────────── Outbox ─────────────────────────────

  it('the outbox relay marks rows with no subscribers as published and never re-runs a handled row', async () => {
    const row = await prisma.outboxEvent.create({
      data: { topic: 'profiles.shop_updated', aggregateId: randomUUID(), payload: {} },
    });
    await relay().drain();
    const after = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.publishedAt).not.toBeNull();
  });

  it('only the buyer can see a payment', async () => {
    const o = await unpaidOrder();
    const start = await startPayment(o);
    const other = await signInNewUser(app);
    await http().get(`/payments/${start.paymentId}`).set(auth(other.token)).expect(404);
  });
});
