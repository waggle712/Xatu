import type { INestApplication } from '@nestjs/common';
import { approximateLocation } from '@xatu/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { clearRateLimits, createTestApp, signInNewUser } from './support/app.js';

interface Item {
  id: string;
  title: string;
  distanceKm: number;
  maker: { handle: string };
}

// Runs against Testcontainers (see test/global-setup.ts). Each test uses its own far-away spot
// so results from other tests (and other test files) never fall inside its radius.
describe('Discovery: feed and search (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const categories: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  let n = 0;
  let spot = 0;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    prisma = app.get(PrismaService);
    for (const [slug, nameEn, nameTa] of [
      ['terracotta', 'Terracotta', 'சுடுமண்'],
      ['cakes', 'Cakes and bakes', 'கேக்'],
    ]) {
      const c = await prisma.category.upsert({
        where: { slug: slug! },
        update: {},
        create: { slug: slug!, nameEn: nameEn!, nameTa: nameTa! },
      });
      categories[slug!] = c.id;
    }
  });
  beforeEach(async () => clearRateLimits(app));
  afterAll(async () => app.close());

  /** A fresh area for one test: a base point far from every other test's. */
  function area() {
    spot += 1;
    return { lat: 8 + spot * 0.5, lng: 76 + spot * 0.5 };
  }

  /** An approved shop at an exact point (set through the API, so approx_location is written). */
  async function shop(at: { lat: number; lng: number }, opts: { verified?: boolean } = {}) {
    const user = await signInNewUser(app);
    n += 1;
    const created = await http()
      .post('/sellers')
      .set('Authorization', `Bearer ${user.token}`)
      .send({
        businessName: `Maker ${n}`,
        handle: `disc_${Date.now().toString(36)}${n}`,
        categoryId: categories.terracotta,
      })
      .expect(201);
    await http()
      .patch(`/sellers/${created.body.id}`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ location: at, areaName: 'Woraiyur' })
      .expect(200);
    await prisma.sellerProfile.update({
      where: { id: created.body.id },
      data: {
        status: 'active',
        verificationStatus: opts.verified ? 'verified' : 'unverified',
      },
    });
    return { ...user, id: created.body.id as string, handle: created.body.handle as string };
  }

  /** A live product written directly (fast); the same rows the catalog API writes. */
  async function product(
    sellerId: string,
    data: {
      title?: string | null;
      titleTa?: string | null;
      publishedAt?: Date;
      status?: 'active' | 'paused' | 'draft';
      moderationStatus?: 'live' | 'held' | 'pending';
      category?: 'terracotta' | 'cakes';
      price?: number;
    } = {},
  ) {
    n += 1;
    return prisma.product.create({
      data: {
        sellerId,
        categoryId: categories[data.category ?? 'terracotta'],
        title: data.title === undefined ? `Product ${n}` : data.title,
        titleTa: data.titleTa ?? null,
        status: data.status ?? 'active',
        moderationStatus: data.moderationStatus ?? 'live',
        publishedAt: data.publishedAt ?? new Date(),
        variants: { create: { pricePaise: BigInt(data.price ?? 45000), stock: 5 } },
      },
    });
  }

  const feed = (at: { lat: number; lng: number }, extra = '') =>
    http().get(`/feed?lat=${at.lat}&lng=${at.lng}${extra}`);

  describe('feed', () => {
    it('shows only visible products of approved shops nearby, measured from the rounded point', async () => {
      const base = area();
      const near = await shop({ lat: base.lat + 0.001234, lng: base.lng + 0.004321 });
      const far = await shop({ lat: base.lat + 1, lng: base.lng + 1 }); // ~150 km away
      const paused = await shop({ lat: base.lat, lng: base.lng });
      const visible = await product(near.id, { title: 'Diya set' });
      await product(near.id, { status: 'draft' });
      await product(near.id, { status: 'paused' });
      await product(near.id, { moderationStatus: 'held' });
      await product(near.id, { title: null });
      await product(far.id);
      await product(paused.id);
      await prisma.sellerProfile.update({ where: { id: paused.id }, data: { status: 'paused' } });

      const res = await feed(base).expect(200);
      expect(res.body.items.map((i: Item) => i.id)).toEqual([visible.id]);
      expect(res.body.origin).toEqual({ ...base, approximate: false });

      // Distance comes from the rounded public point, never the exact one.
      const rounded = approximateLocation({ lat: base.lat + 0.001234, lng: base.lng + 0.004321 });
      expect(res.body.makers).toEqual([
        expect.objectContaining({ handle: near.handle, location: rounded, liveProducts: 1 }),
      ]);
      // The map pin equals what the public shop page shows.
      const page = await http().get(`/shops/${near.handle}`).expect(200);
      expect(page.body.approximateLocation).toEqual(res.body.makers[0].location);
      expect(JSON.stringify(res.body)).not.toContain(String(base.lat + 0.001234));
    });

    it('every item opens as a product page', async () => {
      const base = area();
      const s = await shop(base);
      for (let i = 0; i < 3; i++) await product(s.id);
      const res = await feed(base).expect(200);
      expect(res.body.items).toHaveLength(3);
      for (const item of res.body.items as Item[]) {
        await http().get(`/products/${item.id}`).expect(200);
      }
    });

    it('ranks nearer, fresher and verified first', async () => {
      const base = area();
      const close = await shop(base);
      const away = await shop({ lat: base.lat + 0.1, lng: base.lng }); // ~11 km
      const verified = await shop({ lat: base.lat + 0.1, lng: base.lng }, { verified: true });
      const now = Date.now();
      const nearNew = await product(close.id, { publishedAt: new Date(now) });
      const nearOld = await product(close.id, { publishedAt: new Date(now - 60 * 86_400_000) });
      const farNew = await product(away.id, { publishedAt: new Date(now) });
      const farVerified = await product(verified.id, { publishedAt: new Date(now) });

      const ids = (await feed(base).expect(200)).body.items.map((i: Item) => i.id);
      expect(ids.indexOf(nearNew.id)).toBe(0);
      expect(ids.indexOf(farVerified.id)).toBeLessThan(ids.indexOf(farNew.id));
      expect(ids.indexOf(nearNew.id)).toBeLessThan(ids.indexOf(nearOld.id));
    });

    it('pages through ties without duplicates or gaps, and ignores products published meanwhile', async () => {
      const base = area();
      const s = await shop(base);
      const sameTime = new Date(Date.now() - 3_600_000);
      const made = new Set<string>();
      for (let i = 0; i < 45; i++) made.add((await product(s.id, { publishedAt: sameTime })).id);

      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res: request.Response = await feed(base, cursor ? `&cursor=${cursor}` : '').expect(
          200,
        );
        seen.push(...res.body.items.map((i: Item) => i.id));
        cursor = res.body.nextCursor;
        pages += 1;
        if (pages === 1) {
          expect(res.body.makers).toBeDefined();
          // Published after page 1 was made: must not appear in later pages or shift them.
          await product(s.id, { publishedAt: new Date() });
        } else {
          expect(res.body.makers).toBeUndefined();
        }
      } while (cursor);

      expect(pages).toBe(3);
      expect(seen).toHaveLength(45);
      expect(new Set(seen)).toEqual(made);
    });

    it('refuses a cursor made for a different place, filter or radius', async () => {
      const base = area();
      const s = await shop(base);
      for (let i = 0; i < 21; i++) await product(s.id);
      const first = await feed(base).expect(200);
      const cursor = first.body.nextCursor as string;
      expect(cursor).toEqual(expect.any(String));
      await feed({ lat: base.lat + 0.01, lng: base.lng }, `&cursor=${cursor}`).expect(400);
      await feed(base, `&cursor=${cursor}&radiusKm=10`).expect(400);
      await feed(base, `&cursor=${cursor}&category=cakes`).expect(400);
      await feed(base, '&cursor=garbage').expect(400);
      await feed(base, `&cursor=${cursor}`).expect(200);
    });

    it('filters by category and radius', async () => {
      const base = area();
      const s = await shop(base);
      const other = await shop({ lat: base.lat + 0.2, lng: base.lng }); // ~22 km
      const cake = await product(s.id, { category: 'cakes' });
      await product(s.id, { category: 'terracotta' });
      const farCake = await product(other.id, { category: 'cakes' });

      const cakes = await feed(base, '&category=cakes').expect(200);
      expect(cakes.body.items.map((i: Item) => i.id).sort()).toEqual([cake.id, farCake.id].sort());
      const close = await feed(base, '&category=cakes&radiusKm=10').expect(200);
      expect(close.body.items.map((i: Item) => i.id)).toEqual([cake.id]);
    });

    it('starts from Trichy when no location is sent, and rounds a sent location', async () => {
      const res = await http().get('/feed').expect(200);
      expect(res.body.origin).toEqual({ lat: 10.81, lng: 78.69, approximate: true });
      const precise = await http().get('/feed?lat=10.828512&lng=78.679534').expect(200);
      expect(precise.body.origin).toEqual({ lat: 10.83, lng: 78.68, approximate: false });
      await http().get('/feed?lat=10.8').expect(400);
    });
  });

  describe('search', () => {
    it('finds Tamil titles from a Latin spelling, and English titles from Tamil', async () => {
      const base = area();
      const s = await shop(base);
      const tamilOnly = await product(s.id, {
        title: 'Millet snack',
        titleTa: 'சிறுதானிய முறுக்கு',
      });
      const englishOnly = await product(s.id, { title: 'Butter murukku, 250 g', titleTa: null });
      await product(s.id, { title: 'Clay pot' });
      await product(s.id, { title: 'Hidden murukku', status: 'draft' });

      const latin = await http()
        .get(`/search?q=murukku&lat=${base.lat}&lng=${base.lng}`)
        .expect(200);
      expect(latin.body.items.map((i: Item) => i.id).sort()).toEqual(
        [tamilOnly.id, englishOnly.id].sort(),
      );
      expect(latin.body.terms).toEqual(expect.arrayContaining(['murukku', 'முறுக்கு']));

      const tamil = await http()
        .get(`/search?q=${encodeURIComponent('முறுக்கு')}&lat=${base.lat}&lng=${base.lng}`)
        .expect(200);
      expect(tamil.body.items.map((i: Item) => i.id).sort()).toEqual(
        [tamilOnly.id, englishOnly.id].sort(),
      );
    });

    it('expands whole words only', async () => {
      const potato = await http().get('/search?q=sweet%20potato').expect(200);
      expect(potato.body.terms).not.toContain('பானை');
      expect(potato.body.terms).toContain('இனிப்பு'); // "sweet" is a whole word
      const shampoo = await http().get('/search?q=shampoo').expect(200);
      expect(shampoo.body.terms).toEqual(['shampoo']);
      const multi = await http().get('/search?q=mysore%20pak').expect(200);
      expect(multi.body.terms).toContain('மைசூர் பாக்');
    });

    it('finds products by shop name, best match first', async () => {
      const base = area();
      const s = await shop(base);
      await prisma.sellerProfile.update({
        where: { id: s.id },
        data: { businessName: 'Kaveri Terracotta' },
      });
      const p = await product(s.id, { title: 'Hanging planter' });
      const exact = await product(s.id, { title: 'Kaveri lamp' });
      const res = await http().get(`/search?q=kaveri&lat=${base.lat}&lng=${base.lng}`).expect(200);
      const ids = res.body.items.map((i: Item) => i.id);
      expect(ids).toEqual(expect.arrayContaining([p.id, exact.id]));
      expect(ids[0]).toBe(exact.id);
    });

    it('validates the query and pages results', async () => {
      await http().get('/search').expect(400);
      await http()
        .get(`/search?q=${'x'.repeat(61)}`)
        .expect(400);
      const base = area();
      const s = await shop(base);
      for (let i = 0; i < 25; i++) await product(s.id, { title: `Terracotta diya ${i}` });
      const first = await http().get(`/search?q=diya&lat=${base.lat}&lng=${base.lng}`).expect(200);
      expect(first.body.items).toHaveLength(20);
      const second = await http()
        .get(`/search?q=diya&lat=${base.lat}&lng=${base.lng}&cursor=${first.body.nextCursor}`)
        .expect(200);
      expect(second.body.items).toHaveLength(5);
      const all = [...first.body.items, ...second.body.items].map((i: Item) => i.id);
      expect(new Set(all).size).toBe(25);
      await http()
        .get(`/search?q=lamp&lat=${base.lat}&lng=${base.lng}&cursor=${first.body.nextCursor}`)
        .expect(400);
    });
  });
});
