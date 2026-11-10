import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  clearRateLimits,
  createTestApp,
  type RecordedEvent,
  signInNewUser,
} from './support/app.js';

// Runs against Testcontainers (see test/global-setup.ts).
describe('Shops (e2e)', () => {
  let app: INestApplication;
  let events: RecordedEvent[];
  let prisma: PrismaService;
  let categoryId: string;
  const http = () => request(app.getHttpServer());
  const handle = (prefix: string) =>
    `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;

  const completeShop = {
    storyEn: 'Third-generation potter making diyas in Woraiyur.',
    storyTa: 'வொரையூரில் மூன்றாம் தலைமுறை குயவர்.',
    areaName: 'Woraiyur',
    city: 'Trichy',
    pincode: '620003',
    location: { lat: 10.828512, lng: 78.679534 },
    pickupAddressLine: '12, Kumaran Street, Woraiyur',
    pickupLandmark: 'Near the temple tank',
    openingHours: {
      mon: [{ open: '09:00', close: '18:00' }],
      sat: [{ open: '10:00', close: '13:00' }],
    },
  };

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

  beforeEach(async () => {
    await clearRateLimits(app);
  });

  afterAll(async () => {
    await app.close();
  });

  async function openShop(token: string, name = 'Meena Clay Studio') {
    const res = await http()
      .post('/sellers')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessName: name, handle: handle('shop'), categoryId })
      .expect(201);
    return res.body as { id: string; handle: string; status: string; missingForSubmit: string[] };
  }

  it('opens a draft shop, adds the seller role and sends seller_signed_up', async () => {
    const { token, userId } = await signInNewUser(app);
    const shop = await openShop(token);
    expect(shop.status).toBe('draft');
    expect(shop.missingForSubmit).toEqual(
      expect.arrayContaining(['story', 'area', 'pickup_address', 'location', 'opening_hours']),
    );

    const me = await http().get('/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(me.body.isSeller).toBe(true);
    expect(me.body.roles).toContain('seller');
    expect(events).toContainEqual(
      expect.objectContaining({
        distinctId: userId,
        event: 'seller_signed_up',
        properties: expect.objectContaining({ seller_id: shop.id, category_slug: 'terracotta' }),
      }),
    );
    const outbox = await prisma.outboxEvent.count({
      where: { topic: 'profiles.shop_created', aggregateId: shop.id },
    });
    expect(outbox).toBe(1);
  });

  it('allows one shop per user and unique handles', async () => {
    const a = await signInNewUser(app);
    const shop = await openShop(a.token);
    await http()
      .post('/sellers')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ businessName: 'Second', handle: handle('second'), categoryId })
      .expect(409)
      .expect((res) => expect(res.body.error.code).toBe('shop_exists'));

    const b = await signInNewUser(app);
    await http()
      .post('/sellers')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ businessName: 'Copycat', handle: shop.handle, categoryId })
      .expect(409)
      .expect((res) => expect(res.body.error.code).toBe('handle_taken'));
  });

  describe('ownership: seller A can never manage seller B', () => {
    it('refuses edit, submit, pause and resume on another seller’s shop', async () => {
      const a = await signInNewUser(app);
      const b = await signInNewUser(app);
      const shopB = await openShop(b.token, 'Shop B');

      for (const [method, path, body] of [
        ['patch', `/sellers/${shopB.id}`, { businessName: 'Hijacked' }],
        ['post', `/sellers/${shopB.id}/submit`, {}],
        ['post', `/sellers/${shopB.id}/pause`, {}],
        ['post', `/sellers/${shopB.id}/resume`, {}],
      ] as const) {
        const res = await http()
          [method](path)
          .set('Authorization', `Bearer ${a.token}`)
          .send(body)
          .expect(403);
        expect(res.body.error.code).toBe('forbidden');
      }
      const stored = await prisma.sellerProfile.findUniqueOrThrow({ where: { id: shopB.id } });
      expect(stored.businessName).toBe('Shop B');
      expect(stored.status).toBe('draft');
    });

    it('needs a signed-in user for every shop write', async () => {
      await http().post('/sellers').send({}).expect(401);
      await http().patch('/sellers/0196f0a0-0000-7000-8000-000000000001').send({}).expect(401);
    });
  });

  it('validates input with field-level errors', async () => {
    const { token } = await signInNewUser(app);
    const shop = await openShop(token);
    const res = await http()
      .patch(`/sellers/${shop.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ pincode: '12', openingHours: { mon: [{ open: '18:00', close: '09:00' }] } })
      .expect(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(
      expect.arrayContaining(['pincode', 'openingHours.mon.0']),
    );
  });

  it('submits only a complete shop, then pauses and resumes once approved', async () => {
    const { token } = await signInNewUser(app);
    const shop = await openShop(token);

    const early = await http()
      .post(`/sellers/${shop.id}/submit`)
      .set('Authorization', `Bearer ${token}`)
      .expect(422);
    expect(early.body.error.code).toBe('shop_incomplete');

    const updated = await http()
      .patch(`/sellers/${shop.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send(completeShop)
      .expect(200);
    expect(updated.body.missingForSubmit).toEqual([]);
    expect(updated.body.location).toEqual(completeShop.location);

    const submitted = await http()
      .post(`/sellers/${shop.id}/submit`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(submitted.body.status).toBe('kyc_pending');

    // Owners cannot approve themselves.
    await http()
      .post(`/sellers/${shop.id}/resume`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);

    // Approval is an admin action (admin console, prompt 20); simulate it here.
    await prisma.sellerProfile.update({ where: { id: shop.id }, data: { status: 'active' } });
    const paused = await http()
      .post(`/sellers/${shop.id}/pause`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(paused.body.status).toBe('paused');
    const resumed = await http()
      .post(`/sellers/${shop.id}/resume`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(resumed.body.status).toBe('active');

    const changes = await prisma.outboxEvent.count({
      where: { topic: 'profiles.shop_status_changed', aggregateId: shop.id },
    });
    expect(changes).toBe(3);
  });

  it('blocks edits to a suspended shop', async () => {
    const { token } = await signInNewUser(app);
    const shop = await openShop(token);
    await prisma.sellerProfile.update({ where: { id: shop.id }, data: { status: 'suspended' } });
    const res = await http()
      .patch(`/sellers/${shop.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ businessName: 'Back' })
      .expect(409);
    expect(res.body.error.code).toBe('shop_suspended');
  });

  describe('public shop page', () => {
    it('hides draft and under-review shops', async () => {
      const { token } = await signInNewUser(app);
      const shop = await openShop(token);
      await http().get(`/shops/${shop.handle}`).expect(404);
      await prisma.sellerProfile.update({
        where: { id: shop.id },
        data: { status: 'kyc_pending' },
      });
      await http().get(`/shops/${shop.handle}`).expect(404);
    });

    it('shows an active shop with only an approximate location — never the exact pickup point or address', async () => {
      const { token } = await signInNewUser(app);
      const shop = await openShop(token);
      await http()
        .patch(`/sellers/${shop.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send(completeShop)
        .expect(200);
      await prisma.sellerProfile.update({
        where: { id: shop.id },
        data: { status: 'active', verificationStatus: 'verified' },
      });

      const res = await http().get(`/shops/${shop.handle.toUpperCase()}`).expect(200);
      expect(res.body).toMatchObject({
        handle: shop.handle,
        areaName: 'Woraiyur',
        approximateLocation: { lat: 10.83, lng: 78.68 },
        verified: true,
        status: 'active',
        category: { slug: 'terracotta' },
      });
      const text = JSON.stringify(res.body);
      expect(text).not.toContain('Kumaran Street');
      expect(text).not.toContain('temple tank');
      expect(text).not.toContain('10.828512');
      expect(text).not.toContain('78.679534');
      expect(res.body).not.toHaveProperty('pickupAddressLine');
      expect(res.body).not.toHaveProperty('location');
      expect(res.body).not.toHaveProperty('id');
    });
  });

  it('checks handle availability', async () => {
    const { token } = await signInNewUser(app);
    const shop = await openShop(token);
    await http()
      .get(`/sellers/handle-available?handle=${shop.handle}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200, { available: false });
    await http()
      .get(`/sellers/handle-available?handle=${handle('free')}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200, { available: true });
    await http()
      .get('/sellers/handle-available?handle=admin')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('returns my shop or null', async () => {
    const { token } = await signInNewUser(app);
    await http()
      .get('/sellers/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200, { shop: null });
    const shop = await openShop(token);
    const res = await http().get('/sellers/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.shop.id).toBe(shop.id);
  });

  it('lists categories in both languages', async () => {
    const res = await http().get('/categories').expect(200);
    expect(res.body).toContainEqual(
      expect.objectContaining({ slug: 'terracotta', nameTa: 'சுடுமண்' }),
    );
  });
});
