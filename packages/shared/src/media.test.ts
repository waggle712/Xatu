import { describe, expect, it } from 'vitest';
import {
  canTransitionMedia,
  createUploadSchema,
  MAX_IMAGE_BYTES,
  pickVariant,
  sniffImageType,
} from './media.ts';

describe('upload request', () => {
  it('accepts jpeg, png and webp up to 10 MB', () => {
    for (const contentType of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(
        createUploadSchema.safeParse({ purpose: 'shop_cover', contentType, byteSize: 1_000_000 })
          .success,
      ).toBe(true);
    }
  });
  it('rejects other types and oversize files', () => {
    expect(
      createUploadSchema.safeParse({
        purpose: 'shop_cover',
        contentType: 'image/gif',
        byteSize: 10,
      }).success,
    ).toBe(false);
    expect(
      createUploadSchema.safeParse({
        purpose: 'shop_cover',
        contentType: 'application/pdf',
        byteSize: 10,
      }).success,
    ).toBe(false);
    expect(
      createUploadSchema.safeParse({
        purpose: 'shop_cover',
        contentType: 'image/jpeg',
        byteSize: MAX_IMAGE_BYTES + 1,
      }).success,
    ).toBe(false);
    expect(
      createUploadSchema.safeParse({
        purpose: 'shop_cover',
        contentType: 'image/jpeg',
        byteSize: 0,
      }).success,
    ).toBe(false);
  });
});

describe('status machine', () => {
  it('allows pending → processing → ready | rejected only', () => {
    expect(canTransitionMedia('pending', 'processing')).toBe(true);
    expect(canTransitionMedia('processing', 'ready')).toBe(true);
    expect(canTransitionMedia('processing', 'rejected')).toBe(true);
    expect(canTransitionMedia('pending', 'rejected')).toBe(true);
    expect(canTransitionMedia('pending', 'ready')).toBe(false);
    expect(canTransitionMedia('ready', 'processing')).toBe(false);
    expect(canTransitionMedia('rejected', 'ready')).toBe(false);
  });
});

const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));

describe('sniffImageType', () => {
  it('reads magic bytes, not the file name', () => {
    expect(sniffImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      'image/png',
    );
    expect(sniffImageType(ascii('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffImageType(ascii('%PDF-1.7'))).toBeNull();
    expect(sniffImageType(ascii('<svg xmlns='))).toBeNull();
  });
});

describe('pickVariant', () => {
  it('chooses the smallest variant that covers the displayed size', () => {
    expect(pickVariant(80, 3)).toBe('thumb');
    expect(pickVariant(120, 3)).toBe('card');
    expect(pickVariant(390, 3)).toBe('full');
    expect(pickVariant(200, 2)).toBe('card');
  });
});
