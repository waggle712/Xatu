import type { INestApplication } from '@nestjs/common';
import { existsSync } from 'node:fs';
import sharp from 'sharp';
import request from 'supertest';
import { env } from '../src/config/env.js';
import { localPath } from '../src/modules/media/local-storage.js';
import { MediaService } from '../src/modules/media/media.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { clearRateLimits, createTestApp, signInNewUser } from './support/app.js';

// Runs against Testcontainers with the local media storage (see test/global-setup.ts).
describe('Media pipeline (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  async function photo(width = 900, height = 700): Promise<Buffer> {
    return sharp({ create: { width, height, channels: 3, background: '#c98a96' } })
      .jpeg()
      .withExif({
        IFD0: { Make: 'TestCam' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '10/1 49/1 42/1' },
      })
      .toBuffer();
  }

  /** Requests a ticket and PUTs the bytes to it, like the phone does. */
  async function upload(
    token: string,
    body: Buffer,
    opts: { contentType?: string; purpose?: string; declaredBytes?: number } = {},
  ) {
    const contentType = opts.contentType ?? 'image/jpeg';
    const ticket = await http()
      .post('/media/uploads')
      .set('Authorization', `Bearer ${token}`)
      .send({
        purpose: opts.purpose ?? 'shop_cover',
        contentType,
        byteSize: opts.declaredBytes ?? body.length,
      })
      .expect(201);
    const path = new URL(ticket.body.uploadUrl).pathname;
    return {
      ticket: ticket.body as { mediaId: string; uploadUrl: string },
      put: () => http().put(path).set('Content-Type', contentType).send(body),
    };
  }

  async function waitFor(token: string, mediaId: string, status: 'ready' | 'rejected') {
    for (let i = 0; i < 100; i++) {
      const res = await http()
        .get(`/media/${mediaId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      if (res.body.status === status) return res.body;
      if (res.body.status === 'ready' || res.body.status === 'rejected')
        throw new Error(`Expected ${status}, got ${res.body.status} (${res.body.rejectReason})`);
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('Timed out waiting for media processing');
  }

  beforeAll(async () => {
    ({ app } = await createTestApp());
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => clearRateLimits(app));
  afterAll(async () => app.close());

  it('uploads, processes and serves an image with GPS removed', async () => {
    const { token } = await signInNewUser(app);
    const { ticket, put } = await upload(token, await photo());
    await put().expect(200);
    await http()
      .post(`/media/${ticket.mediaId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const ready = await waitFor(token, ticket.mediaId, 'ready');
    expect(ready.image).toMatchObject({ width: 900, height: 700, blurhash: expect.any(String) });
    expect(Object.keys(ready.image.urls)).toEqual(['thumb', 'card', 'full']);

    const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: ticket.mediaId } });
    expect(row.storageKey).toBe(`media/${ticket.mediaId}.jpg`);
    const stored = await sharp(localPath(row.storageKey!)).metadata();
    expect(stored.exif).toBeUndefined();
    expect(existsSync(localPath(row.uploadKey))).toBe(false); // original upload deleted

    const thumbPath = new URL(ready.image.urls.thumb).pathname;
    const thumb = await http().get(thumbPath).expect(200);
    expect((await sharp(thumb.body as Buffer).metadata()).width).toBe(320);

    expect(
      await prisma.outboxEvent.count({
        where: { topic: 'media.ready', aggregateId: ticket.mediaId },
      }),
    ).toBe(1);
  });

  it('completing twice processes once', async () => {
    const { token } = await signInNewUser(app);
    const { ticket, put } = await upload(token, await photo());
    await put().expect(200);
    for (let i = 0; i < 3; i++)
      await http()
        .post(`/media/${ticket.mediaId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    await waitFor(token, ticket.mediaId, 'ready');
    expect(
      await prisma.outboxEvent.count({
        where: { topic: 'media.ready', aggregateId: ticket.mediaId },
      }),
    ).toBe(1);
  });

  it('rejects a file that is not really an image, without retrying', async () => {
    const { token } = await signInNewUser(app);
    const fake = Buffer.from('%PDF-1.7 pretending to be a photo'.padEnd(400, ' '));
    const { ticket, put } = await upload(token, fake);
    await put().expect(200);
    await http()
      .post(`/media/${ticket.mediaId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const rejected = await waitFor(token, ticket.mediaId, 'rejected');
    expect(rejected).toMatchObject({ rejectReason: 'not_an_image', image: null });
    const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: ticket.mediaId } });
    expect(row.attempts).toBe(1);
  });

  it('refuses uploads that do not match the signed request', async () => {
    const { token } = await signInNewUser(app);
    const body = await photo();
    const declaredSmaller = await upload(token, body, { declaredBytes: body.length - 10 });
    await declaredSmaller.put().expect(403);
    await http()
      .put('/media/local/upload/forged.token')
      .set('Content-Type', 'image/jpeg')
      .send(body)
      .expect(403);
  });

  it('validates the upload request', async () => {
    const { token } = await signInNewUser(app);
    const auth = { Authorization: `Bearer ${token}` };
    await http()
      .post('/media/uploads')
      .set(auth)
      .send({ purpose: 'shop_cover', contentType: 'image/gif', byteSize: 100 })
      .expect(400);
    await http()
      .post('/media/uploads')
      .set(auth)
      .send({ purpose: 'shop_cover', contentType: 'image/jpeg', byteSize: 11 * 1024 * 1024 })
      .expect(400);
    await http()
      .post('/media/uploads')
      .send({ purpose: 'shop_cover', contentType: 'image/jpeg', byteSize: 100 })
      .expect(401);
  });

  it('retries a missing upload, then dead-letters it and marks it rejected', async () => {
    const { token } = await signInNewUser(app);
    const { ticket } = await upload(token, await photo()); // never PUT
    const media = app.get(MediaService);
    await media.queue.add(
      'process',
      { mediaId: ticket.mediaId },
      { jobId: `dlq-${ticket.mediaId}`, attempts: 2, backoff: { type: 'fixed', delay: 50 } },
    );
    const rejected = await waitFor(token, ticket.mediaId, 'rejected');
    expect(rejected.rejectReason).toBe('processing_failed');
    const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: ticket.mediaId } });
    expect(row.attempts).toBe(2);
  });

  describe('ownership: one user can never use another user’s photo', () => {
    it('refuses to read, complete or attach someone else’s media', async () => {
      const a = await signInNewUser(app);
      const b = await signInNewUser(app);
      const { ticket, put } = await upload(a.token, await photo());
      await put().expect(200);
      await http()
        .post(`/media/${ticket.mediaId}/complete`)
        .set('Authorization', `Bearer ${a.token}`)
        .expect(200);
      await waitFor(a.token, ticket.mediaId, 'ready');

      await http()
        .get(`/media/${ticket.mediaId}`)
        .set('Authorization', `Bearer ${b.token}`)
        .expect(403);
      await http()
        .post(`/media/${ticket.mediaId}/complete`)
        .set('Authorization', `Bearer ${b.token}`)
        .expect(403);

      const category = await prisma.category.upsert({
        where: { slug: 'terracotta' },
        update: {},
        create: { slug: 'terracotta', nameEn: 'Terracotta', nameTa: 'சுடுமண்' },
      });
      const shopB = await http()
        .post('/sellers')
        .set('Authorization', `Bearer ${b.token}`)
        .send({
          businessName: 'Shop B',
          handle: `b_${Date.now().toString(36)}`,
          categoryId: category.id,
        })
        .expect(201);
      const res = await http()
        .patch(`/sellers/${shopB.body.id}`)
        .set('Authorization', `Bearer ${b.token}`)
        .send({ coverMediaId: ticket.mediaId })
        .expect(403);
      expect(res.body.error.code).toBe('forbidden');
    });
  });

  it('sets a ready photo as the shop cover and shows it on the public page', async () => {
    const { token } = await signInNewUser(app);
    const category = await prisma.category.upsert({
      where: { slug: 'terracotta' },
      update: {},
      create: { slug: 'terracotta', nameEn: 'Terracotta', nameTa: 'சுடுமண்' },
    });
    const shop = await http()
      .post('/sellers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        businessName: 'Cover Shop',
        handle: `c_${Date.now().toString(36)}`,
        categoryId: category.id,
      })
      .expect(201);

    const pending = await upload(token, await photo());
    await http()
      .patch(`/sellers/${shop.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ coverMediaId: pending.ticket.mediaId })
      .expect(409);

    const product = await upload(token, await photo(), { purpose: 'product_photo' });
    await product.put().expect(200);
    await http()
      .post(`/media/${product.ticket.mediaId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await waitFor(token, product.ticket.mediaId, 'ready');
    await http()
      .patch(`/sellers/${shop.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ coverMediaId: product.ticket.mediaId })
      .expect(422);

    await pending.put().expect(200);
    await http()
      .post(`/media/${pending.ticket.mediaId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await waitFor(token, pending.ticket.mediaId, 'ready');
    const updated = await http()
      .patch(`/sellers/${shop.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ coverMediaId: pending.ticket.mediaId })
      .expect(200);
    expect(updated.body.cover).toMatchObject({
      id: pending.ticket.mediaId,
      blurhash: expect.any(String),
    });

    await prisma.sellerProfile.update({ where: { id: shop.body.id }, data: { status: 'active' } });
    const pub = await http().get(`/shops/${shop.body.handle}`).expect(200);
    expect(pub.body.cover.urls.card).toContain(env.PUBLIC_API_URL);
  });
});
