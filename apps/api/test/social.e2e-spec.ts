import type { INestApplication } from '@nestjs/common';
import { MAX_SAVED_PRODUCTS } from '@xatu/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { clearRateLimits, createTestApp, signInNewUser } from './support/app.js';

// Prompt 13: save (heart), follow, share links and web previews, reports.
// Runs against Testcontainers (see test/global-setup.ts, which sets the link settings).
describe('Saved, following, reports and share links (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let categoryId: string;
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
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

  async function shop(opts: { status?: 'active' | 'paused' | 'draft'; name?: string } = {}) {
    const owner = await signInNewUser(app);
    n += 1;
    const created = await http()
      .post('/sellers')
      .set(auth(owner.token))
      .send({
        businessName: opts.name ?? `Social Maker ${n}`,
        handle: `soc_${Date.now().toString(36)}${n}`,
        categoryId,
      })
      .expect(201);
    await prisma.sellerProfile.update({
      where: { id: created.body.id },
      data: { status: opts.status ?? 'active', areaName: 'Woraiyur', city: 'Trichy' },
    });
    return { ...owner, id: created.body.id as string, handle: created.body.handle as string };
  }

  async function product(
    sellerId: string,
    data: {
      title?: string;
      description?: string;
      status?: 'active' | 'paused' | 'draft';
      moderationStatus?: 'live' | 'held' | 'removed';
    } = {},
  ) {
    n += 1;
    return prisma.product.create({
      data: {
        sellerId,
        categoryId,
        title: data.title ?? `Social product ${n}`,
        description: data.description ?? null,
        status: data.status ?? 'active',
        moderationStatus: data.moderationStatus ?? 'live',
        publishedAt: new Date(),
        variants: { create: { pricePaise: 45000n, stock: 5 } },
      },
    });
  }

  describe('saved products (heart)', () => {
    it('saves, lists and unsaves, and both calls are safe to repeat', async () => {
      const s = await shop();
      const a = await product(s.id, { title: 'Diya set' });
      const b = await product(s.id, { title: 'Clay pot' });
      const buyer = await signInNewUser(app);

      await http().put(`/me/saved-products/${a.id}`).set(auth(buyer.token)).expect(204);
      await http().put(`/me/saved-products/${a.id}`).set(auth(buyer.token)).expect(204);
      await http().put(`/me/saved-products/${b.id}`).set(auth(buyer.token)).expect(204);

      const state = await http().get('/me/saved').set(auth(buyer.token)).expect(200);
      expect(state.body.productIds.sort()).toEqual([a.id, b.id].sort());

      const list = await http().get('/me/saved-products').set(auth(buyer.token)).expect(200);
      // Newest saved first, with the maker so the card can say whose it is.
      expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([b.id, a.id]);
      expect(list.body.items[0]).toMatchObject({
        title: 'Clay pot',
        fromPricePaise: 45000,
        maker: { handle: s.handle, businessName: expect.any(String) },
      });

      await http().delete(`/me/saved-products/${a.id}`).set(auth(buyer.token)).expect(204);
      await http().delete(`/me/saved-products/${a.id}`).set(auth(buyer.token)).expect(204);
      const after = await http().get('/me/saved').set(auth(buyer.token)).expect(200);
      expect(after.body.productIds).toEqual([b.id]);

      // One outbox row per new save, none for repeats (prompt 25 builds alerts on these).
      const events = await prisma.outboxEvent.findMany({
        where: { topic: 'product.saved', aggregateId: { in: [a.id, b.id] } },
      });
      expect(events).toHaveLength(2);
    });

    it("can't newly save a product buyers can't see, and hides saved ones that went away", async () => {
      const s = await shop();
      const hidden = await product(s.id, { status: 'draft' });
      const later = await product(s.id, { title: 'Will be removed' });
      const buyer = await signInNewUser(app);

      await http().put(`/me/saved-products/${hidden.id}`).set(auth(buyer.token)).expect(404);
      await http()
        .put('/me/saved-products/0195f0e2-7c1a-4b3e-9d2f-1a2b3c4d5e6f')
        .set(auth(buyer.token))
        .expect(404);
      await http().put(`/me/saved-products/${later.id}`).set(auth(buyer.token)).expect(204);

      await prisma.product.update({
        where: { id: later.id },
        data: { moderationStatus: 'removed' },
      });
      const list = await http().get('/me/saved-products').set(auth(buyer.token)).expect(200);
      expect(list.body.items).toEqual([]);
      expect(JSON.stringify(list.body)).not.toContain('Will be removed');
      // Saving again while it's hidden is still a quiet no-op, not an error.
      await http().put(`/me/saved-products/${later.id}`).set(auth(buyer.token)).expect(204);
    });

    it('keeps each buyer’s saves private', async () => {
      const s = await shop();
      const p = await product(s.id);
      const alice = await signInNewUser(app);
      const bob = await signInNewUser(app);
      await http().put(`/me/saved-products/${p.id}`).set(auth(alice.token)).expect(204);

      expect((await http().get('/me/saved').set(auth(bob.token))).body.productIds).toEqual([]);
      expect((await http().get('/me/saved-products').set(auth(bob.token))).body.items).toEqual([]);
      // Bob removing "his" save never touches Alice's.
      await http().delete(`/me/saved-products/${p.id}`).set(auth(bob.token)).expect(204);
      expect((await http().get('/me/saved').set(auth(alice.token))).body.productIds).toEqual([
        p.id,
      ]);
      await http().get('/me/saved').expect(401);
      await http().put(`/me/saved-products/${p.id}`).expect(401);
    });

    it('pages the saved list', async () => {
      const s = await shop();
      const buyer = await signInNewUser(app);
      for (let i = 0; i < 25; i++) {
        const p = await product(s.id);
        await http().put(`/me/saved-products/${p.id}`).set(auth(buyer.token)).expect(204);
      }
      const first = await http().get('/me/saved-products').set(auth(buyer.token)).expect(200);
      expect(first.body.items).toHaveLength(20);
      const second = await http()
        .get(`/me/saved-products?cursor=${first.body.nextCursor}`)
        .set(auth(buyer.token))
        .expect(200);
      expect(second.body.items).toHaveLength(5);
      expect(second.body.nextCursor).toBeNull();
      const ids = [...first.body.items, ...second.body.items].map((i: { id: string }) => i.id);
      expect(new Set(ids).size).toBe(25);
    });

    it('stops at the saved limit', async () => {
      const s = await shop();
      const buyer = await signInNewUser(app);
      const products = await Promise.all(
        Array.from({ length: MAX_SAVED_PRODUCTS }, () => product(s.id)),
      );
      await prisma.savedProduct.createMany({
        data: products.map((p) => ({ userId: buyer.userId, productId: p.id })),
      });
      const one = await product(s.id);
      const res = await http()
        .put(`/me/saved-products/${one.id}`)
        .set(auth(buyer.token))
        .expect(409);
      expect(res.body.error.code).toBe('saved_list_full');
      // An already-saved one is still fine.
      await http().put(`/me/saved-products/${products[0]!.id}`).set(auth(buyer.token)).expect(204);
    });
  });

  describe('following makers', () => {
    it('follows and unfollows by handle, shows the count, and lists followed shops', async () => {
      const s = await shop({ name: 'Amma Clay Works' });
      const buyer = await signInNewUser(app);
      const other = await signInNewUser(app);

      await http().put(`/me/following/${s.handle}`).set(auth(buyer.token)).expect(204);
      await http()
        .put(`/me/following/${s.handle.toUpperCase()}`)
        .set(auth(buyer.token))
        .expect(204);
      await http().put(`/me/following/${s.handle}`).set(auth(other.token)).expect(204);

      const page = await http().get(`/shops/${s.handle}`).expect(200);
      expect(page.body.followerCount).toBe(2);

      const state = await http().get('/me/saved').set(auth(buyer.token)).expect(200);
      expect(state.body.shopHandles).toEqual([s.handle]);
      const list = await http().get('/me/following').set(auth(buyer.token)).expect(200);
      expect(list.body.items).toEqual([
        expect.objectContaining({
          handle: s.handle,
          businessName: 'Amma Clay Works',
          acceptingOrders: true,
        }),
      ]);
      // Public fields only.
      expect(JSON.stringify(list.body)).not.toMatch(/pickup|location|phone/i);

      await http().delete(`/me/following/${s.handle}`).set(auth(buyer.token)).expect(204);
      await http().delete(`/me/following/${s.handle}`).set(auth(buyer.token)).expect(204);
      expect((await http().get(`/shops/${s.handle}`)).body.followerCount).toBe(1);
      expect(
        await prisma.outboxEvent.count({ where: { topic: 'shop.followed', aggregateId: s.id } }),
      ).toBe(2);
    });

    it("refuses your own shop and shops buyers can't see", async () => {
      const s = await shop();
      const draft = await shop({ status: 'draft' });
      const own = await http().put(`/me/following/${s.handle}`).set(auth(s.token)).expect(400);
      expect(own.body.error.code).toBe('cannot_follow_own_shop');
      const buyer = await signInNewUser(app);
      await http().put(`/me/following/${draft.handle}`).set(auth(buyer.token)).expect(404);
      await http().put('/me/following/no_such_shop_here').set(auth(buyer.token)).expect(404);
      await http().put('/me/following/BAD!').set(auth(buyer.token)).expect(400);
    });

    it('keeps the Following list to shops still public', async () => {
      const s = await shop();
      const buyer = await signInNewUser(app);
      await http().put(`/me/following/${s.handle}`).set(auth(buyer.token)).expect(204);
      await prisma.sellerProfile.update({ where: { id: s.id }, data: { status: 'suspended' } });
      expect((await http().get('/me/following').set(auth(buyer.token))).body.items).toEqual([]);
      expect((await http().get('/me/saved').set(auth(buyer.token))).body.shopHandles).toEqual([]);
    });
  });

  describe('reports', () => {
    it('reports a product once while it is open, and stores the reason and details', async () => {
      const s = await shop();
      const p = await product(s.id);
      const buyer = await signInNewUser(app);
      const body = {
        target: { type: 'product', id: p.id },
        reason: 'counterfeit',
        details: 'Looks like a factory copy',
      };
      const first = await http().post('/reports').set(auth(buyer.token)).send(body).expect(201);
      expect(first.body).toEqual({ id: expect.any(String), alreadyReported: false });
      const again = await http()
        .post('/reports')
        .set(auth(buyer.token))
        .send({ ...body, reason: 'scam' })
        .expect(201);
      expect(again.body).toEqual({ id: first.body.id, alreadyReported: true });

      const rows = await prisma.report.findMany({ where: { targetId: p.id } });
      expect(rows).toEqual([
        expect.objectContaining({
          reporterId: buyer.userId,
          targetType: 'product',
          reason: 'counterfeit',
          details: 'Looks like a factory copy',
          status: 'open',
        }),
      ]);
      expect(
        await prisma.outboxEvent.count({ where: { topic: 'report.created', aggregateId: p.id } }),
      ).toBe(1);

      // Once the trust team closes it, the same person can report again.
      await prisma.report.update({ where: { id: first.body.id }, data: { status: 'dismissed' } });
      const third = await http().post('/reports').set(auth(buyer.token)).send(body).expect(201);
      expect(third.body.alreadyReported).toBe(false);
    });

    it('two parallel reports from one person still make one open report', async () => {
      const s = await shop();
      const p = await product(s.id);
      const buyer = await signInNewUser(app);
      const body = { target: { type: 'product', id: p.id }, reason: 'misleading' };
      const results = await Promise.all(
        [0, 1, 2].map(() => http().post('/reports').set(auth(buyer.token)).send(body)),
      );
      expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
      expect(await prisma.report.count({ where: { targetId: p.id } })).toBe(1);
    });

    it('reports a shop by handle, stored against the seller id', async () => {
      const s = await shop();
      const buyer = await signInNewUser(app);
      await http()
        .post('/reports')
        .set(auth(buyer.token))
        .send({ target: { type: 'shop', handle: s.handle }, reason: 'scam' })
        .expect(201);
      const row = await prisma.report.findFirstOrThrow({ where: { reporterId: buyer.userId } });
      expect(row).toMatchObject({ targetType: 'seller', targetId: s.id, details: null });
    });

    it('refuses your own listing or shop, hidden targets and bad input', async () => {
      const s = await shop();
      const p = await product(s.id);
      const hidden = await product(s.id, { status: 'draft' });
      const ownProduct = await http()
        .post('/reports')
        .set(auth(s.token))
        .send({ target: { type: 'product', id: p.id }, reason: 'scam' })
        .expect(400);
      expect(ownProduct.body.error.code).toBe('cannot_report_own');
      await http()
        .post('/reports')
        .set(auth(s.token))
        .send({ target: { type: 'shop', handle: s.handle }, reason: 'scam' })
        .expect(400);

      const buyer = await signInNewUser(app);
      await http()
        .post('/reports')
        .set(auth(buyer.token))
        .send({ target: { type: 'product', id: hidden.id }, reason: 'scam' })
        .expect(404);
      await http()
        .post('/reports')
        .set(auth(buyer.token))
        .send({ target: { type: 'product', id: p.id }, reason: 'other' })
        .expect(400);
      await http()
        .post('/reports')
        .send({ target: { type: 'product', id: p.id }, reason: 'scam' })
        .expect(401);
    });
  });

  describe('share links and web previews', () => {
    it('serves the iOS and Android link files for product and shop paths only', async () => {
      const aasa = await http().get('/.well-known/apple-app-site-association').expect(200);
      expect(aasa.headers['content-type']).toMatch(/^application\/json/);
      expect(aasa.body).toEqual({
        applinks: {
          details: [
            {
              appIDs: ['TEAMID1234.in.xatu.app'],
              components: [{ '/': '/p/*' }, { '/': '/s/*' }],
            },
          ],
        },
      });
      const links = await http().get('/.well-known/assetlinks.json').expect(200);
      expect(links.body).toEqual([
        {
          relation: ['delegate_permission/common.handle_all_urls'],
          target: {
            namespace: 'android_app',
            package_name: 'in.xatu.app',
            sha256_cert_fingerprints: [expect.stringMatching(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/)],
          },
        },
      ]);
    });

    it('shows a small product preview with link tags, escaping everything the seller wrote', async () => {
      const s = await shop({ name: 'Amma & Sons <Clay>' });
      const p = await product(s.id, {
        title: '"><script>alert(1)</script>',
        description: "Hand made <img src=x onerror=alert(2)> & fired in a wood kiln, it's lovely",
      });
      const res = await http().get(`/p/${p.id}`).expect(200);
      expect(res.headers['content-type']).toMatch(/^text\/html/);
      expect(res.headers['content-security-policy']).toContain("default-src 'none'");
      expect(res.headers['content-security-policy']).not.toContain('script-src');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.text).not.toContain('<script');
      expect(res.text).not.toContain('<img src=x');
      expect(res.text).toContain('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(res.text).toContain('Amma &amp; Sons &lt;Clay&gt;');
      expect(res.text).toContain(`<meta property="og:url" content="https://links.test/p/${p.id}">`);
      expect(res.text).toContain('₹450');
      expect(res.text).toContain(`xatu://p/${p.id}`);
      // Nothing about money being held until Protected Pay is confirmed.
      expect(res.text).not.toMatch(/protected pay|money held|escrow/i);
    });

    it('shows a shop preview without the exact location', async () => {
      const s = await shop({ name: 'Woraiyur Bakes' });
      await http()
        .patch(`/sellers/${s.id}`)
        .set(auth(s.token))
        .send({
          location: { lat: 10.828512, lng: 78.679534 },
          pickupAddressLine: '12 Secret Street',
        })
        .expect(200);
      const res = await http().get(`/s/${s.handle}`).expect(200);
      expect(res.text).toContain('Woraiyur Bakes');
      expect(res.text).toContain(
        `<meta property="og:url" content="https://links.test/s/${s.handle}">`,
      );
      expect(res.text).not.toContain('10.828512');
      expect(res.text).not.toContain('Secret Street');
    });

    it("answers 404 with a plain page for anything buyers can't see", async () => {
      const s = await shop();
      const draft = await product(s.id, { status: 'draft', title: 'Secret draft' });
      const hiddenShop = await shop({ status: 'draft', name: 'Hidden shop' });
      for (const path of [
        `/p/${draft.id}`,
        '/p/0195f0e2-7c1a-4b3e-9d2f-1a2b3c4d5e6f',
        '/p/not-a-uuid',
        `/s/${hiddenShop.handle}`,
        '/s/no_such_shop_here',
      ]) {
        const res = await http().get(path).expect(404);
        expect(res.headers['content-type']).toMatch(/^text\/html/);
        expect(res.text).not.toMatch(/Secret draft|Hidden shop/);
      }
    });
  });
});
