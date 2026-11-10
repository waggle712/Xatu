import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  clearRateLimits,
  createTestApp,
  type RecordedEvent,
  signInNewUser,
} from './support/app.js';
import { pendingPhoto, readyPhoto } from './support/media.js';

interface Variant {
  id: string;
  label: string | null;
  pricePaise: number;
  stock: number;
}
interface Product {
  id: string;
  title: string | null;
  status: string;
  moderationStatus: string;
  categoryId: string | null;
  fulfilmentModes: string[];
  variants: Variant[];
  photos: { id: string }[];
  publishProblems: string[];
}

// Runs against Testcontainers (see test/global-setup.ts).
describe('Catalog (e2e)', () => {
  let app: INestApplication;
  let events: RecordedEvent[];
  let prisma: PrismaService;
  let categoryId: string;
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  let n = 0;

  beforeAll(async () => {
    ({ app, events } = await createTestApp());
    prisma = app.get(PrismaService);
    const cat = await prisma.category.upsert({
      where: { slug: 'terracotta' },
      update: {},
      create: { slug: 'terracotta', nameEn: 'Terracotta', nameTa: 'சுடுமண்' },
    });
    categoryId = cat.id;
  });
  beforeEach(async () => clearRateLimits(app));
  afterAll(async () => app.close());

  /** A seller whose shop an admin has approved (admin console comes in prompt 20). */
  async function seller(opts: { status?: 'active' | 'draft'; localDelivery?: boolean } = {}) {
    const user = await signInNewUser(app);
    n += 1;
    const shop = await http()
      .post('/sellers')
      .set(auth(user.token))
      .send({
        businessName: `Maker ${n}`,
        handle: `maker_${Date.now().toString(36)}${n}`,
        categoryId,
      })
      .expect(201);
    await prisma.sellerProfile.update({
      where: { id: shop.body.id },
      data: { status: opts.status ?? 'active', localDelivery: opts.localDelivery ?? true },
    });
    return { ...user, shopId: shop.body.id as string, handle: shop.body.handle as string };
  }

  async function draft(token: string, body: Record<string, unknown> = {}): Promise<Product> {
    const res = await http()
      .post('/seller/products')
      .set(auth(token))
      .send({ id: randomUUID(), ...body })
      .expect(201);
    return res.body;
  }

  /** A complete, published product. */
  async function liveProduct(token: string, pricePaise = 45000): Promise<Product> {
    const p = await draft(token, {
      title: 'Terracotta diya set, 6 pieces',
      titleTa: 'மண் அகல் விளக்கு, 6',
      variants: [{ pricePaise, stock: 12 }],
    });
    const photo = await readyPhoto(app, token);
    await http()
      .put(`/seller/products/${p.id}/photos`)
      .set(auth(token))
      .send({ mediaIds: [photo] })
      .expect(200);
    const res = await http().post(`/seller/products/${p.id}/publish`).set(auth(token)).expect(200);
    return res.body;
  }

  describe('drafts and autosave', () => {
    it('creates a draft once even when the request is retried', async () => {
      const s = await seller();
      const id = randomUUID();
      const first = await http()
        .post('/seller/products')
        .set(auth(s.token))
        .send({ id })
        .expect(201);
      const again = await http()
        .post('/seller/products')
        .set(auth(s.token))
        .send({ id })
        .expect(201);
      expect(again.body.id).toBe(first.body.id);
      expect(await prisma.product.count({ where: { id } })).toBe(1);
      expect(first.body).toMatchObject({
        status: 'draft',
        moderationStatus: 'pending',
        categoryId, // defaults to the shop's category
        fulfilmentModes: ['pickup'],
        publishProblems: expect.arrayContaining(['photo', 'title', 'price']),
      });
      expect(
        events.filter((e) => e.event === 'product_draft_started' && e.properties.product_id === id),
      ).toHaveLength(1);
    });

    it('two simultaneous creates with the same id make one draft', async () => {
      const s = await seller();
      const id = randomUUID();
      const results = await Promise.all(
        [1, 2, 3].map(() => http().post('/seller/products').set(auth(s.token)).send({ id })),
      );
      expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
      expect(await prisma.product.count({ where: { id } })).toBe(1);
    });

    it('needs a shop, and refuses an id another seller already used', async () => {
      const buyer = await signInNewUser(app);
      await http()
        .post('/seller/products')
        .set(auth(buyer.token))
        .send({ id: randomUUID() })
        .expect(403)
        .expect(({ body }) => expect(body.error.code).toBe('shop_required'));

      const a = await seller();
      const b = await seller();
      const p = await draft(a.token);
      await http()
        .post('/seller/products')
        .set(auth(b.token))
        .send({ id: p.id, title: 'Hijack' })
        .expect(409);
      expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).title).toBeNull();
    });

    it('saves variants as a full list: edits kept ones, adds new ones, hides removed ones', async () => {
      const s = await seller();
      const p = await draft(s.token);
      const saved = await http()
        .patch(`/seller/products/${p.id}`)
        .set(auth(s.token))
        .send({
          title: 'Millet cookies',
          variants: [
            { label: 'Box of 6', pricePaise: 15000, stock: 10, attributes: { size: '6' } },
            { label: 'Box of 12', pricePaise: 25000, stock: 4 },
          ],
        })
        .expect(200);
      const [six, twelve] = saved.body.variants as Variant[];

      const next = await http()
        .patch(`/seller/products/${p.id}`)
        .set(auth(s.token))
        .send({
          variants: [
            { id: twelve!.id, label: 'Box of 12', pricePaise: 26000, stock: 7 },
            { label: 'Box of 24', pricePaise: 48000, stock: 2 },
          ],
        })
        .expect(200);
      expect(next.body.variants.map((v: Variant) => [v.label, v.pricePaise, v.stock])).toEqual([
        ['Box of 12', 26000, 7],
        ['Box of 24', 48000, 2],
      ]);
      const hidden = await prisma.productVariant.findUniqueOrThrow({ where: { id: six!.id } });
      expect(hidden.deletedAt).not.toBeNull();
      const moves = await prisma.stockMovement.findMany({
        where: { variantId: twelve!.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(moves.map((m) => [m.reason, m.delta, m.stockAfter])).toEqual([
        ['listing_created', 4, 4],
        ['seller_set', 3, 7],
      ]);
    });

    it('validates money, stock and lead time', async () => {
      const s = await seller();
      const p = await draft(s.token);
      for (const variants of [
        [{ pricePaise: 450.5, stock: 1 }],
        [{ pricePaise: 0, stock: 1 }],
        [{ pricePaise: 100, stock: -1 }],
        [{ pricePaise: 100_000_001, stock: 1 }],
      ]) {
        await http()
          .patch(`/seller/products/${p.id}`)
          .set(auth(s.token))
          .send({ variants })
          .expect(400);
      }
      await http()
        .patch(`/seller/products/${p.id}`)
        .set(auth(s.token))
        .send({ madeToOrder: false, leadTimeDays: 3 })
        .expect(422);
      const mto = await http()
        .patch(`/seller/products/${p.id}`)
        .set(auth(s.token))
        .send({ madeToOrder: true })
        .expect(200);
      expect(mto.body.publishProblems).toContain('lead_time');
      const off = await http()
        .patch(`/seller/products/${p.id}`)
        .set(auth(s.token))
        .send({ leadTimeDays: 2 })
        .expect(200);
      expect(off.body.leadTimeDays).toBe(2);
      const cleared = await http()
        .patch(`/seller/products/${p.id}`)
        .set(auth(s.token))
        .send({ madeToOrder: false })
        .expect(200);
      expect(cleared.body.leadTimeDays).toBeNull();
    });

    it('only offers delivery modes the shop has turned on', async () => {
      const s = await seller({ localDelivery: false });
      const p = await draft(s.token);
      await http()
        .patch(`/seller/products/${p.id}`)
        .set(auth(s.token))
        .send({ fulfilmentModes: ['pickup', 'courier'] })
        .expect(422)
        .expect(({ body }) => expect(body.error.code).toBe('fulfilment_not_offered'));
    });

    it('stores the largest allowed price as bigint and reads it back exactly', async () => {
      const s = await seller();
      const live = await liveProduct(s.token, 100_000_000);
      const row = await prisma.productVariant.findFirstOrThrow({ where: { productId: live.id } });
      expect(row.pricePaise).toBe(100_000_000n);
      const pub = await http().get(`/products/${live.id}`).expect(200);
      expect(pub.body.variants[0].pricePaise).toBe(100_000_000);
    });
  });

  describe('publishing', () => {
    it('lists what is missing, then goes live once and sends product_listed once', async () => {
      const s = await seller();
      const p = await draft(s.token, {
        title: 'Hanging planter',
        variants: [{ pricePaise: 22000, stock: 8 }],
      });
      await http()
        .post(`/seller/products/${p.id}/publish`)
        .set(auth(s.token))
        .expect(422)
        .expect(({ body }) => expect(body.error.details.missing).toEqual(['photo']));

      const photo = await readyPhoto(app, s.token);
      await http()
        .put(`/seller/products/${p.id}/photos`)
        .set(auth(s.token))
        .send({ mediaIds: [photo] })
        .expect(200);
      const live = await http()
        .post(`/seller/products/${p.id}/publish`)
        .set(auth(s.token))
        .expect(200);
      expect(live.body).toMatchObject({
        status: 'active',
        moderationStatus: 'live',
        publishProblems: [],
      });

      await http().post(`/seller/products/${p.id}/pause`).set(auth(s.token)).expect(200);
      await http().get(`/products/${p.id}`).expect(404);
      await http().post(`/seller/products/${p.id}/resume`).set(auth(s.token)).expect(200);
      await http().get(`/products/${p.id}`).expect(200);

      const listed = events.filter(
        (e) => e.event === 'product_listed' && e.properties.product_id === p.id,
      );
      expect(listed).toHaveLength(1);
      expect(listed[0]!.properties).toMatchObject({
        seller_id: s.shopId,
        category_slug: 'terracotta',
        price_paise: 22000,
      });
      const changes = await prisma.outboxEvent.count({
        where: { aggregateId: p.id, topic: 'catalog.product_status_changed' },
      });
      expect(changes).toBe(3);
    });

    it('a shop that is not approved yet cannot publish', async () => {
      const s = await seller({ status: 'draft' });
      const p = await draft(s.token, { title: 'Diya', variants: [{ pricePaise: 100, stock: 1 }] });
      await http()
        .post(`/seller/products/${p.id}/publish`)
        .set(auth(s.token))
        .expect(409)
        .expect(({ body }) => expect(body.error.code).toBe('shop_not_active'));
    });

    it('a live product cannot be emptied by an edit', async () => {
      const s = await seller();
      const live = await liveProduct(s.token);
      await http()
        .patch(`/seller/products/${live.id}`)
        .set(auth(s.token))
        .send({ title: null })
        .expect(422);
      await http()
        .put(`/seller/products/${live.id}/photos`)
        .set(auth(s.token))
        .send({ mediaIds: [] })
        .expect(422);
      const pub = await http().get(`/products/${live.id}`).expect(200);
      expect(pub.body.title).toBe('Terracotta diya set, 6 pieces');
    });

    it('archives and restores to a draft, and an archived product cannot be edited', async () => {
      const s = await seller();
      const live = await liveProduct(s.token);
      await http().post(`/seller/products/${live.id}/archive`).set(auth(s.token)).expect(200);
      await http()
        .patch(`/seller/products/${live.id}`)
        .set(auth(s.token))
        .send({ title: 'x' })
        .expect(409);
      await http().post(`/seller/products/${live.id}/publish`).set(auth(s.token)).expect(409);
      const restored = await http()
        .post(`/seller/products/${live.id}/restore`)
        .set(auth(s.token))
        .expect(200);
      expect(restored.body.status).toBe('draft');
      const archived = await http()
        .get('/seller/products?archived=true')
        .set(auth(s.token))
        .expect(200);
      expect(archived.body.items).toHaveLength(0);
    });

    it('never undoes an admin hold', async () => {
      const s = await seller();
      const live = await liveProduct(s.token);
      await prisma.product.update({ where: { id: live.id }, data: { moderationStatus: 'held' } });
      await http().post(`/seller/products/${live.id}/pause`).set(auth(s.token)).expect(200);
      const resumed = await http()
        .post(`/seller/products/${live.id}/resume`)
        .set(auth(s.token))
        .expect(200);
      expect(resumed.body.moderationStatus).toBe('held');
      await http().get(`/products/${live.id}`).expect(404);
    });
  });

  describe('what buyers see', () => {
    it('only active, live products of public shops, with the maker summary', async () => {
      const s = await seller();
      const live = await liveProduct(s.token);
      const hidden = await draft(s.token, {
        title: 'Not yet',
        variants: [{ pricePaise: 100, stock: 1 }],
      });

      const page = await http().get(`/products/${live.id}`).expect(200);
      expect(page.body).toMatchObject({
        title: 'Terracotta diya set, 6 pieces',
        category: { slug: 'terracotta' },
        maker: { handle: s.handle, acceptingOrders: true },
        variants: [{ pricePaise: 45000, stock: 12 }],
        photos: [expect.objectContaining({ blurhash: expect.any(String) })],
      });
      expect(page.body).not.toHaveProperty('sellerId');
      await http().get(`/products/${hidden.id}`).expect(404);

      const list = await http().get(`/shops/${s.handle}/products`).expect(200);
      expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([live.id]);
      expect(list.body.items[0]).toMatchObject({
        fromPricePaise: 45000,
        inStock: true,
        hasOptions: false,
      });
      expect(list.body.nextCursor).toBeNull();
    });

    it('a paused shop stays visible but not accepting orders; a suspended shop disappears', async () => {
      const s = await seller();
      const live = await liveProduct(s.token);
      await prisma.sellerProfile.update({ where: { id: s.shopId }, data: { status: 'paused' } });
      const paused = await http().get(`/products/${live.id}`).expect(200);
      expect(paused.body.maker.acceptingOrders).toBe(false);

      await prisma.sellerProfile.update({ where: { id: s.shopId }, data: { status: 'suspended' } });
      await http().get(`/products/${live.id}`).expect(404);
      await http().get(`/shops/${s.handle}/products`).expect(404);
    });

    it('pages with a cursor, newest first', async () => {
      const s = await seller();
      const made: string[] = [];
      for (let i = 0; i < 21; i++) {
        const p = await draft(s.token, {
          title: `Diya ${i}`,
          variants: [{ pricePaise: 100, stock: 1 }],
        });
        const photo = await readyPhoto(app, s.token);
        await http()
          .put(`/seller/products/${p.id}/photos`)
          .set(auth(s.token))
          .send({ mediaIds: [photo] })
          .expect(200);
        await http().post(`/seller/products/${p.id}/publish`).set(auth(s.token)).expect(200);
        made.push(p.id);
      }
      const newestFirst = [...made].reverse();
      const first = await http().get(`/shops/${s.handle}/products`).expect(200);
      expect(first.body.items.map((i: { id: string }) => i.id)).toEqual(newestFirst.slice(0, 20));
      expect(first.body.nextCursor).toEqual(expect.any(String));
      const second = await http()
        .get(`/shops/${s.handle}/products?cursor=${first.body.nextCursor}`)
        .expect(200);
      expect(second.body.items.map((i: { id: string }) => i.id)).toEqual([made[0]]);
      expect(second.body.nextCursor).toBeNull();
      await http().get(`/shops/${s.handle}/products?cursor=not-a-cursor`).expect(400);
    }, 60_000);
  });

  describe('photos', () => {
    it('accepts up to 8 ready product photos the seller owns, in order', async () => {
      const s = await seller();
      const p = await draft(s.token);
      const [a, b] = [await readyPhoto(app, s.token), await readyPhoto(app, s.token)];
      const res = await http()
        .put(`/seller/products/${p.id}/photos`)
        .set(auth(s.token))
        .send({ mediaIds: [b, a] })
        .expect(200);
      expect(res.body.photos.map((ph: { id: string }) => ph.id)).toEqual([b, a]);

      const nine = Array.from({ length: 9 }, () => randomUUID());
      await http()
        .put(`/seller/products/${p.id}/photos`)
        .set(auth(s.token))
        .send({ mediaIds: nine })
        .expect(400);
    });

    it('refuses photos that are not ready, are for something else, or belong to someone else', async () => {
      const s = await seller();
      const other = await seller();
      const p = await draft(s.token);
      const put = (mediaIds: string[]) =>
        http().put(`/seller/products/${p.id}/photos`).set(auth(s.token)).send({ mediaIds });

      await put([await pendingPhoto(app, s.token)]).expect(409);
      await put([await readyPhoto(app, s.token, 'shop_cover')]).expect(422);
      await put([await readyPhoto(app, other.token)]).expect(403);
    });

    it('a photo can be on one product only', async () => {
      const s = await seller();
      const [p1, p2] = [await draft(s.token), await draft(s.token)];
      const photo = await readyPhoto(app, s.token);
      await http()
        .put(`/seller/products/${p1.id}/photos`)
        .set(auth(s.token))
        .send({ mediaIds: [photo] })
        .expect(200);
      await http()
        .put(`/seller/products/${p2.id}/photos`)
        .set(auth(s.token))
        .send({ mediaIds: [photo] })
        .expect(409)
        .expect(({ body }) => expect(body.error.code).toBe('photo_in_use'));
    });
  });

  describe('ownership', () => {
    it("another seller can't read or change any part of my product", async () => {
      const a = await seller();
      const b = await seller();
      const live = await liveProduct(a.token);
      const variantId = live.variants[0]!.id;
      const as = (req: request.Test) => req.set(auth(b.token));

      const attempts = [
        as(http().get(`/seller/products/${live.id}`)),
        as(http().patch(`/seller/products/${live.id}`)).send({ title: 'Mine now' }),
        as(http().put(`/seller/products/${live.id}/photos`)).send({ mediaIds: [] }),
        as(http().post(`/seller/products/${live.id}/variants/${variantId}/stock`)).send({
          stock: 0,
        }),
        as(http().post(`/seller/products/${live.id}/publish`)),
        as(http().post(`/seller/products/${live.id}/pause`)),
        as(http().post(`/seller/products/${live.id}/resume`)),
        as(http().post(`/seller/products/${live.id}/archive`)),
        as(http().post(`/seller/products/${live.id}/restore`)),
      ];
      for (const attempt of attempts) {
        const res = await attempt;
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('forbidden');
      }
      const after = await http().get(`/seller/products/${live.id}`).set(auth(a.token)).expect(200);
      expect(after.body).toMatchObject({
        title: 'Terracotta diya set, 6 pieces',
        status: 'active',
      });
      expect(after.body.variants[0].stock).toBe(12);

      const mine = await http().get('/seller/products').set(auth(b.token)).expect(200);
      expect(mine.body.items).toHaveLength(0);
      await http().get(`/seller/products/${randomUUID()}`).set(auth(b.token)).expect(404);
    });

    it("can't reach another product's variant through my own product", async () => {
      const a = await seller();
      const b = await seller();
      const mine = await liveProduct(a.token);
      const myOther = await liveProduct(a.token);
      const theirs = await liveProduct(b.token);

      await http()
        .post(`/seller/products/${mine.id}/variants/${myOther.variants[0]!.id}/stock`)
        .set(auth(a.token))
        .send({ stock: 0 })
        .expect(404);
      await http()
        .post(`/seller/products/${mine.id}/variants/${theirs.variants[0]!.id}/stock`)
        .set(auth(a.token))
        .send({ stock: 0 })
        .expect(404);
      await http()
        .patch(`/seller/products/${mine.id}`)
        .set(auth(a.token))
        .send({ variants: [{ id: theirs.variants[0]!.id, pricePaise: 1, stock: 0 }] })
        .expect(422);

      const untouched = await prisma.productVariant.findUniqueOrThrow({
        where: { id: theirs.variants[0]!.id },
      });
      expect([untouched.stock, untouched.pricePaise, untouched.productId]).toEqual([
        12,
        45000n,
        theirs.id,
      ]);
    });
  });

  describe('stock', () => {
    async function reserve(productId: string, variantId: string, quantity: number, minutes = 15) {
      const buyer = await signInNewUser(app);
      await prisma.inventoryReservation.create({
        data: {
          productId,
          variantId,
          buyerId: buyer.userId,
          quantity,
          expiresAt: new Date(Date.now() + minutes * 60_000),
        },
      });
    }

    it('20 parallel stock changes leave a consistent, append-only history', async () => {
      const s = await seller();
      const live = await liveProduct(s.token);
      const variantId = live.variants[0]!.id;
      const targets = Array.from({ length: 20 }, (_, i) => 20 + i);
      const results = await Promise.all(
        targets.map((stock) =>
          http()
            .post(`/seller/products/${live.id}/variants/${variantId}/stock`)
            .set(auth(s.token))
            .send({ stock }),
        ),
      );
      expect(results.every((r) => r.status === 200)).toBe(true);

      const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
      const moves = await prisma.stockMovement.findMany({
        where: { variantId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      expect(moves).toHaveLength(21); // listing_created + 20 changes
      let running = 0;
      for (const m of moves) {
        running += m.delta;
        expect(m.stockAfter).toBe(running);
      }
      expect(running).toBe(variant.stock);
      expect(targets).toContain(variant.stock);
    });

    it("can't go below what buyers are holding in checkout; expired holds don't count", async () => {
      const s = await seller();
      const live = await liveProduct(s.token);
      const variantId = live.variants[0]!.id;
      await reserve(live.id, variantId, 3);
      await reserve(live.id, variantId, 5, -1); // already expired

      await http()
        .post(`/seller/products/${live.id}/variants/${variantId}/stock`)
        .set(auth(s.token))
        .send({ stock: 2 })
        .expect(409)
        .expect(({ body }) => expect(body.error.details.reserved).toBe(3));
      await http()
        .post(`/seller/products/${live.id}/variants/${variantId}/stock`)
        .set(auth(s.token))
        .send({ stock: 3 })
        .expect(200);

      // A held option can't be removed either.
      await http()
        .patch(`/seller/products/${live.id}`)
        .set(auth(s.token))
        .send({ variants: [{ label: 'New', pricePaise: 100, stock: 1 }] })
        .expect(409)
        .expect(({ body }) => expect(body.error.code).toBe('variant_reserved'));
    });

    it('the database refuses negative stock and edits to stock history', async () => {
      const s = await seller();
      const live = await liveProduct(s.token);
      const variantId = live.variants[0]!.id;
      await expect(
        prisma.productVariant.update({ where: { id: variantId }, data: { stock: -1 } }),
      ).rejects.toThrow();
      const move = await prisma.stockMovement.findFirstOrThrow({ where: { variantId } });
      await expect(
        prisma.stockMovement.update({ where: { id: move.id }, data: { delta: 99 } }),
      ).rejects.toThrow(/append-only/);
      await expect(prisma.stockMovement.delete({ where: { id: move.id } })).rejects.toThrow(
        /append-only/,
      );
    });
  });
});
