import type { INestApplication } from '@nestjs/common';
import sharp from 'sharp';
import request from 'supertest';

/** Uploads a generated photo the way the phone does and waits until the worker marks it ready. */
export async function readyPhoto(
  app: INestApplication,
  token: string,
  purpose: 'product_photo' | 'shop_cover' = 'product_photo',
): Promise<string> {
  const http = () => request(app.getHttpServer());
  const body = await sharp({
    create: { width: 800, height: 800, channels: 3, background: '#e3a62f' },
  })
    .jpeg()
    .toBuffer();
  const ticket = await http()
    .post('/media/uploads')
    .set('Authorization', `Bearer ${token}`)
    .send({ purpose, contentType: 'image/jpeg', byteSize: body.length })
    .expect(201);
  const { mediaId, uploadUrl } = ticket.body as { mediaId: string; uploadUrl: string };
  await http()
    .put(new URL(uploadUrl).pathname)
    .set('Content-Type', 'image/jpeg')
    .send(body)
    .expect(200);
  await http()
    .post(`/media/${mediaId}/complete`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  for (let i = 0; i < 100; i++) {
    const res = await http()
      .get(`/media/${mediaId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    if (res.body.status === 'ready') return mediaId;
    if (res.body.status === 'rejected') throw new Error(`Photo rejected: ${res.body.rejectReason}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Timed out waiting for the photo');
}

/** Starts an upload but never sends it, so the asset stays pending. */
export async function pendingPhoto(app: INestApplication, token: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/media/uploads')
    .set('Authorization', `Bearer ${token}`)
    .send({ purpose: 'product_photo', contentType: 'image/jpeg', byteSize: 1000 })
    .expect(201);
  return res.body.mediaId as string;
}
