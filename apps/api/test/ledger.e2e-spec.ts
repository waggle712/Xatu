import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { FinanceService } from '../src/modules/ledger/finance.service.js';
import { LedgerService } from '../src/modules/ledger/ledger.service.js';
import { ReconciliationService } from '../src/modules/ledger/reconciliation.service.js';
import { SettlementsService } from '../src/modules/ledger/settlements.service.js';
import { PaymentsPoller } from '../src/modules/payments/payments.poller.js';
import { WebhookProcessor } from '../src/modules/payments/webhook.processor.js';
import { OutboxRelay } from '../src/outbox/outbox.relay.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { clearRateLimits, createTestApp, signInNewUser } from './support/app.js';
import { type FakeRazorpay, sign, webhookBody } from './support/razorpay.js';

// Prompt 16: the ledger. The app runs as a login user in the xatu_app role (see global-setup),
// which may only SELECT and INSERT on ledger tables, exactly as in production.
describe('Ledger, refunds, settlements and reconciliation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let razorpay: FakeRazorpay;
  let categoryId: string;
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const key = () => ({ 'Idempotency-Key': randomUUID() });
  let n = 0;

  beforeAll(async () => {
    ({ app, razorpay } = await createTestApp());
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

  async function settle() {
    for (let i = 0; i < 6; i++) {
      await app.get(WebhookProcessor).processPending(0);
      await app.get(OutboxRelay).drain();
    }
  }

  async function shop(name?: string) {
    await clearRateLimits(app);
    const owner = await signInNewUser(app);
    n += 1;
    const created = await http()
      .post('/sellers')
      .set(auth(owner.token))
      .send({
        businessName: name ?? `Ledger Maker ${n}`,
        handle: `led_${Date.now().toString(36)}${n}`,
        categoryId,
      })
      .expect(201);
    await prisma.sellerProfile.update({
      where: { id: created.body.id },
      data: { status: 'active', areaName: 'Woraiyur', city: 'Trichy', pickupAvailable: true },
    });
    return { id: created.body.id as string, handle: created.body.handle as string };
  }

  /** A paid (placed) order: bag → order → pay → captured webhook → settled. */
  async function paidOrder(opts: { sellerId?: string; price?: bigint; stock?: number } = {}) {
    const sellerId = opts.sellerId ?? (await shop()).id;
    const product = await prisma.product.create({
      data: {
        sellerId,
        categoryId,
        title: `Ledger pot ${++n}`,
        status: 'active',
        moderationStatus: 'live',
        publishedAt: new Date(),
        fulfilmentModes: ['pickup'],
        variants: { create: { pricePaise: opts.price ?? 45_100n, stock: opts.stock ?? 5 } },
      },
      include: { variants: true },
    });
    await clearRateLimits(app);
    const buyer = await signInNewUser(app);
    const price = Number(opts.price ?? 45_100n);
    await http()
      .put(`/cart/items/${product.variants[0]!.id}`)
      .set(auth(buyer.token))
      .send({ quantity: 1 })
      .expect(200);
    const order = await http()
      .post('/orders')
      .set(auth(buyer.token))
      .set(key())
      .send({ fulfilmentMode: 'pickup', expectedTotalPaise: price })
      .expect(201);
    const start = await http()
      .post(`/orders/${order.body.id}/pay`)
      .set(auth(buyer.token))
      .set(key())
      .expect(201);
    const captured = razorpay.attempt(start.body.providerOrderId, 'captured');
    await webhook('payment.captured', {
      orderId: start.body.providerOrderId,
      paymentId: captured.id,
      amount: price,
      xatuOrderId: order.body.id,
    });
    await settle();
    return {
      sellerId,
      buyer,
      orderId: order.body.id as string,
      paymentId: start.body.paymentId as string,
      providerPaymentId: captured.id,
      providerOrderId: start.body.providerOrderId as string,
      price,
      variantId: product.variants[0]!.id,
    };
  }

  async function webhook(
    event: Parameters<typeof webhookBody>[0],
    p: Parameters<typeof webhookBody>[1],
  ) {
    const body = webhookBody(event, p);
    await http()
      .post('/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', sign(body))
      .set('x-razorpay-event-id', `evt_${randomUUID().replaceAll('-', '').slice(0, 14)}`)
      .send(body)
      .expect(200);
  }

  const balance = async (code: string) => {
    const rows = await prisma.$queryRaw<{ debit: bigint | null; credit: bigint | null }[]>`
      SELECT SUM(e.amount_paise) FILTER (WHERE e.direction = 'debit')::bigint AS debit,
             SUM(e.amount_paise) FILTER (WHERE e.direction = 'credit')::bigint AS credit
      FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id WHERE a.code = ${code}`;
    return { debit: rows[0]?.debit ?? 0n, credit: rows[0]?.credit ?? 0n };
  };
  const txnsFor = (referenceId: string) =>
    prisma.ledgerTransaction.findMany({ where: { referenceId }, include: { entries: true } });

  async function complete(orderId: string, hoursAgo: number) {
    const at = new Date(Date.now() - hoursAgo * 60 * 60_000);
    await prisma.order.update({
      where: { id: orderId },
      data: { status: 'completed', completedAt: at },
    });
  }

  // ───────────────────────────── The database guards the ledger ─────────────────────────────

  describe('database guards', () => {
    it('refuses an unbalanced transaction, and a transaction with no entries, at commit', async () => {
      const account = await prisma.ledgerAccount.findUniqueOrThrow({ where: { code: 'bank' } });
      const other = await prisma.ledgerAccount.findUniqueOrThrow({
        where: { code: 'provider_clearing' },
      });
      const unbalanced = randomUUID();
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.ledgerTransaction.create({
            data: {
              id: unbalanced,
              idempotencyKey: `test:${unbalanced}`,
              kind: 'test',
              referenceId: unbalanced,
            },
          });
          await tx.ledgerEntry.createMany({
            data: [
              {
                transactionId: unbalanced,
                accountId: account.id,
                direction: 'debit',
                amountPaise: 100n,
              },
              {
                transactionId: unbalanced,
                accountId: other.id,
                direction: 'credit',
                amountPaise: 99n,
              },
            ],
          });
        }),
      ).rejects.toThrow(/not balanced/);
      const empty = randomUUID();
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.ledgerTransaction.create({
            data: { id: empty, idempotencyKey: `test:${empty}`, kind: 'test', referenceId: empty },
          });
        }),
      ).rejects.toThrow(/not balanced/);
      expect(
        await prisma.ledgerTransaction.count({ where: { id: { in: [unbalanced, empty] } } }),
      ).toBe(0);
    });

    it('the app role can only add to the ledger, never change or delete it', async () => {
      const o = await paidOrder();
      const t = (await txnsFor(o.paymentId))[0]!;
      await expect(
        prisma.$executeRaw`UPDATE ledger_entries SET amount_paise = 1 WHERE transaction_id = ${t.id}::uuid`,
      ).rejects.toThrow(/permission denied/);
      await expect(
        prisma.$executeRaw`DELETE FROM ledger_transactions WHERE id = ${t.id}::uuid`,
      ).rejects.toThrow(/permission denied/);
      await expect(prisma.$executeRaw`UPDATE ledger_accounts SET name = 'x'`).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  // ───────────────────────────── Capture and allocation ─────────────────────────────

  it('a paid order posts the capture and the seller payable once, balanced, even when handlers run again', async () => {
    const o = await paidOrder({ price: 45_100n });
    const capture = await txnsFor(o.paymentId);
    expect(capture.map((t) => t.kind)).toEqual(['payment_capture']);
    const allocation = await txnsFor(o.orderId);
    expect(allocation.map((t) => t.kind)).toEqual(['seller_payable']);
    // Replaying every handler changes nothing.
    await app.get(LedgerService).backfill();
    await settle();
    expect(await txnsFor(o.paymentId)).toHaveLength(1);
    expect(await txnsFor(o.orderId)).toHaveLength(1);
    const seller = await balance(`seller_payable:${o.sellerId}`);
    expect(seller.credit - seller.debit).toBe(45_100n);
  });

  it('backfills payments verified before the ledger existed', async () => {
    const o = await paidOrder();
    // Pretend the handler run was lost: a verified payment with no capture posting.
    const p2 = await paidOrder({ sellerId: o.sellerId });
    const lostPayment = await prisma.payment.create({
      data: {
        orderId: p2.orderId,
        status: 'refunded',
        amountPaise: 1_000n,
        providerOrderId: `order_lost${Date.now()}`,
        providerPaymentId: `pay_lost${Date.now()}`,
        verifiedAt: new Date(),
        verifiedBy: 'webhook',
      },
    });
    expect(await txnsFor(lostPayment.id)).toHaveLength(0);
    await app.get(LedgerService).backfill();
    expect((await txnsFor(lostPayment.id)).map((t) => t.kind)).toEqual(['payment_capture']);
  });

  // ───────────────────────────── Automatic refunds ─────────────────────────────

  /** A buyer whose order expired pays late, after the last unit was sold: refund needed. */
  async function latePaymentNoStock() {
    const s = await shop();
    const last = await paidOrder({ sellerId: s.id, stock: 1 }); // sells the only unit
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: last.orderId } });
    const buyer = await signInNewUser(app);
    const order = await prisma.order.create({
      data: {
        code: `XT-${randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase()}`,
        buyerId: buyer.userId,
        sellerId: s.id,
        status: 'expired',
        fulfilmentMode: 'pickup',
        subtotalPaise: 45_100n,
        totalPaise: 45_100n,
        sellerSnapshot: { handle: s.handle, businessName: 'x', areaName: null, city: 'Trichy' },
        items: {
          create: {
            productId: item.productId,
            variantId: item.variantId,
            titleSnapshot: 'x',
            unitPricePaise: 45_100n,
            quantity: 1,
            lineTotalPaise: 45_100n,
            commissionBps: 0,
          },
        },
      },
    });
    const rzpOrder = await razorpay.createOrder({
      amountPaise: 45_100,
      receipt: order.code,
      notes: {},
    });
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        status: 'expired',
        amountPaise: 45_100n,
        providerOrderId: rzpOrder.id,
      },
    });
    const late = razorpay.attempt(rzpOrder.id, 'captured');
    await webhook('payment.captured', {
      orderId: rzpOrder.id,
      paymentId: late.id,
      amount: 45_100,
      xatuOrderId: order.id,
    });
    return { order, payment, late, rzpOrder };
  }

  it('a payment marked for refund is refunded through Razorpay automatically and posted when processed', async () => {
    const { order, payment, late, rzpOrder } = await latePaymentNoStock();
    await settle();

    const refund = await prisma.refundRequest.findFirstOrThrow({
      where: { paymentId: payment.id },
    });
    expect(refund).toMatchObject({
      status: 'processing',
      requestedById: null,
      amountPaise: 45_100n,
    });
    expect(razorpay.refunds.get(late.id)).toHaveLength(1);
    expect(razorpay.refunds.get(late.id)![0]!.receipt).toBe(refund.id);

    // Razorpay confirms the refund.
    await webhook('refund.processed', {
      orderId: rzpOrder.id,
      paymentId: late.id,
      amount: 45_100,
      xatuOrderId: order.id,
      refundId: refund.providerRefundId!,
      receipt: refund.id,
    });
    await settle();
    expect(
      (await prisma.refundRequest.findUniqueOrThrow({ where: { id: refund.id } })).status,
    ).toBe('completed');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      'refunded',
    );
    expect((await txnsFor(refund.id)).map((t) => t.kind)).toEqual(['refund']);
    expect((await txnsFor(payment.id)).map((t) => t.kind)).toEqual(['payment_capture']);
  });

  it('never refunds twice when Razorpay timed out after creating the refund', async () => {
    razorpay.failNextRefundAfterCreating = true;
    const { payment, late } = await latePaymentNoStock();
    await settle(); // the refund call "times out" after Razorpay made the refund
    const first = await prisma.refundRequest.findFirstOrThrow({ where: { paymentId: payment.id } });
    expect(first.providerRefundId).toBeNull();
    await prisma.refundRequest.updateMany({
      where: { id: first.id },
      data: { attempts: first.attempts },
    });
    await app.get(PaymentsPoller).pollOnce(); // retries: finds the refund Razorpay already made
    await settle();
    expect(razorpay.refunds.get(late.id)).toHaveLength(1);
    const refund = await prisma.refundRequest.findUniqueOrThrow({ where: { id: first.id } });
    expect(refund).toMatchObject({
      status: 'processing',
      providerRefundId: razorpay.refunds.get(late.id)![0]!.id,
    });
  });

  it('a processed refund is found by the poller when its webhook never comes', async () => {
    const { payment, late } = await latePaymentNoStock();
    await settle();
    razorpay.refunds.get(late.id)![0]!.status = 'processed';
    const refund = await prisma.refundRequest.findFirstOrThrow({
      where: { paymentId: payment.id },
    });
    await prisma.$executeRaw`UPDATE refund_requests SET updated_at = now() - interval '20 minutes' WHERE id = ${refund.id}::uuid`;
    await app.get(PaymentsPoller).pollOnce();
    await settle();
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      'refunded',
    );
  });

  // ───────────────────────────── Settlements ─────────────────────────────

  it('settles completed orders after the 48h window: one line per order with the rates used, once', async () => {
    const s = await shop();
    const ready = await paidOrder({ sellerId: s.id, price: 45_100n });
    const tooSoon = await paidOrder({ sellerId: s.id });
    const disputed = await paidOrder({ sellerId: s.id });
    await complete(ready.orderId, 49);
    await complete(tooSoon.orderId, 47);
    await complete(disputed.orderId, 60);
    await prisma.order.update({ where: { id: disputed.orderId }, data: { status: 'in_dispute' } });

    await app.get(SettlementsService).createBatches(new Date());
    const batches = await prisma.settlementBatch.findMany({
      where: { sellerId: s.id },
      include: { lines: true },
    });
    expect(batches).toHaveLength(1);
    expect(batches[0]!.lines.map((l) => l.orderId)).toEqual([ready.orderId]);
    // 0.5% TCS and 0.1% TDS of ₹451.00, 0% commission: 226 and 45 paise.
    expect(batches[0]!.lines[0]).toMatchObject({
      itemsPaise: 45_100n,
      tcsBps: 50,
      tdsBps: 10,
      tcsPaise: 226n,
      tdsPaise: 45n,
      commissionPaise: 0n,
    });
    expect(batches[0]).toMatchObject({
      status: 'pending_approval',
      grossPaise: 45_100n,
      netPaise: 45_100n - 226n - 45n,
    });
    expect((await txnsFor(ready.orderId)).map((t) => t.kind).sort()).toEqual([
      'platform_fee_tcs_tds',
      'seller_payable',
    ]);

    // Running the nightly job again changes nothing.
    await app.get(SettlementsService).createBatches(new Date());
    expect(await prisma.settlementLine.count({ where: { orderId: ready.orderId } })).toBe(1);
    expect(await prisma.settlementBatch.count({ where: { sellerId: s.id } })).toBe(1);
  });

  it('finance approves, exports a safe CSV, marks paid; the seller payable ends at zero; all audited', async () => {
    const s = await shop('=HYPERLINK("http://evil","Click")');
    const o = await paidOrder({ sellerId: s.id });
    await complete(o.orderId, 50);
    await app.get(SettlementsService).createBatches(new Date());
    const batch = await prisma.settlementBatch.findFirstOrThrow({ where: { sellerId: s.id } });
    const admin = await signInNewUser(app);
    await prisma.user.update({ where: { id: admin.userId }, data: { roles: ['buyer', 'admin'] } });
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { id: admin.userId } });
    const finance = app.get(FinanceService);

    await expect(
      finance.markPaid({
        batchId: batch.id,
        adminPhone: adminUser.phone,
        reference: 'UTR1',
        reason: 'paid',
      }),
    ).rejects.toThrow(/approved and exported/);
    const notAdmin = await signInNewUser(app);
    const plain = await prisma.user.findUniqueOrThrow({ where: { id: notAdmin.userId } });
    await expect(
      finance.approve({ batchIds: [batch.id], adminPhone: plain.phone, reason: 'x' }),
    ).rejects.toThrow(/admin/);

    await finance.approve({
      batchIds: [batch.id],
      adminPhone: adminUser.phone,
      reason: 'Nightly batch checked',
    });
    const csv = await finance.exportCsv({ adminPhone: adminUser.phone, reason: 'Bank upload' });
    expect(csv).toContain(batch.id);
    expect(csv).not.toMatch(/(^|,)"?=HYPERLINK/m); // formula neutralised
    expect(csv).toContain(`"'=HYPERLINK`);
    await finance.markPaid({
      batchId: batch.id,
      adminPhone: adminUser.phone,
      reference: 'UTR123456',
      reason: 'Transferred',
    });

    const seller = await balance(`seller_payable:${s.id}`);
    expect(seller.credit - seller.debit).toBe(0n);
    const audit = await prisma.adminAuditLog.findMany({
      where: { targetId: batch.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.map((a) => a.action)).toEqual([
      'settlement.approve',
      'settlement.export',
      'settlement.mark_paid',
    ]);
    expect(audit.every((a) => a.adminId === admin.userId && a.reason)).toBe(true);
  });

  // ───────────────────────────── Reconciliation ─────────────────────────────

  it('reconciles a day against the settlement report: posts fees and settlement, flags every mismatch once', async () => {
    const good = await paidOrder({ price: 50_000n });
    const wrong = await paidOrder({ price: 30_000n });
    const missing = await paidOrder({ price: 20_000n });
    await prisma.payment.update({
      where: { id: missing.paymentId },
      data: { verifiedAt: new Date(Date.now() - 4 * 86_400_000) },
    });
    const day = new Date();
    razorpay.recon = [
      {
        entity_id: good.providerPaymentId,
        type: 'payment',
        amount: 50_000,
        fee: 1_180,
        tax: 180,
        settled: true,
        settlement_id: 'setl_1',
        order_id: good.providerOrderId,
      },
      {
        entity_id: wrong.providerPaymentId,
        type: 'payment',
        amount: 29_000,
        fee: 0,
        tax: 0,
        settled: false,
        settlement_id: null,
        order_id: wrong.providerOrderId,
      },
      {
        entity_id: 'pay_unknown123',
        type: 'payment',
        amount: 777,
        fee: 0,
        tax: 0,
        settled: true,
        settlement_id: 'setl_1',
        order_id: null,
      },
    ];
    const alerts = await app.get(ReconciliationService).reconcile(day);
    expect(alerts).toBe(3);

    expect((await txnsFor(good.providerPaymentId)).map((t) => t.kind).sort()).toEqual([
      'gateway_fee',
      'provider_settlement',
    ]);
    const fee = (await txnsFor(good.providerPaymentId)).find((t) => t.kind === 'gateway_fee')!;
    expect(fee.entries.find((e) => e.direction === 'credit')!.amountPaise).toBe(1_180n);
    const issues = await prisma.reconciliationIssue.findMany({
      where: {
        entityId: { in: [wrong.providerPaymentId, 'pay_unknown123', missing.providerPaymentId] },
      },
    });
    expect(issues.map((i) => i.kind).sort()).toEqual([
      'amount_mismatch',
      'missing_in_report',
      'unknown_in_report',
    ]);

    // The same night run again alerts on nothing new and posts nothing twice.
    expect(await app.get(ReconciliationService).reconcile(day)).toBe(0);
    expect(await txnsFor(good.providerPaymentId)).toHaveLength(2);
  });

  it('every account in the ledger balances overall', async () => {
    const rows = await prisma.$queryRaw<{ debit: bigint; credit: bigint }[]>`
      SELECT COALESCE(SUM(amount_paise) FILTER (WHERE direction = 'debit'), 0)::bigint AS debit,
             COALESCE(SUM(amount_paise) FILTER (WHERE direction = 'credit'), 0)::bigint AS credit FROM ledger_entries`;
    expect(rows[0]!.debit).toBe(rows[0]!.credit);
  });
});
