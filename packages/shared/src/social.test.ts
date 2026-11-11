import { describe, expect, it } from 'vitest';
import { parseAnalyticsEvent } from './analytics.ts';
import {
  createReportSchema,
  parseShareLink,
  productSharePath,
  REPORT_REASONS,
  shareUrl,
  shopSharePath,
} from './social.ts';

const productId = '0195f0e2-7c1a-4b3e-9d2f-1a2b3c4d5e6f';

describe('share links', () => {
  it('builds paths for products and shops', () => {
    expect(productSharePath(productId)).toBe(`/p/${productId}`);
    expect(shopSharePath('ammas_kitchen')).toBe('/s/ammas_kitchen');
    expect(shareUrl('https://links.example.in/', '/s/ammas_kitchen')).toBe(
      'https://links.example.in/s/ammas_kitchen',
    );
  });

  it('reads product and shop links from https, the app scheme and bare paths', () => {
    expect(parseShareLink(`https://links.example.in/p/${productId}`)).toEqual({
      type: 'product',
      id: productId,
    });
    expect(parseShareLink(`xatu://p/${productId}`)).toEqual({ type: 'product', id: productId });
    expect(parseShareLink('/s/Ammas_Kitchen')).toEqual({ type: 'shop', handle: 'ammas_kitchen' });
    expect(parseShareLink(`/p/${productId}/?utm_source=whatsapp#top`)).toEqual({
      type: 'product',
      id: productId,
    });
  });

  it('accepts nothing else, so a link can never open seller or account screens', () => {
    for (const link of [
      'xatu://shop/product/123',
      '/shop',
      '/p/not-a-uuid',
      `/p/${productId}/edit`,
      '/s/ab',
      '/s/shop',
      '/s/../shop',
      '/profile',
      'javascript:alert(1)',
      '',
      `https://links.example.in/products/${productId}`,
    ]) {
      expect(parseShareLink(link), link).toBeNull();
    }
  });
});

describe('reports', () => {
  it('takes a product id or a shop handle, a reason and optional details', () => {
    expect(
      createReportSchema.parse({
        target: { type: 'product', id: productId },
        reason: 'counterfeit',
      }),
    ).toEqual({ target: { type: 'product', id: productId }, reason: 'counterfeit' });
    expect(
      createReportSchema.parse({
        target: { type: 'shop', handle: 'Ammas_Kitchen' },
        reason: 'scam',
        details: '  Asked me to pay outside the app  ',
      }),
    ).toEqual({
      target: { type: 'shop', handle: 'ammas_kitchen' },
      reason: 'scam',
      details: 'Asked me to pay outside the app',
    });
  });

  it('needs details when the reason is "other", and caps their length', () => {
    const base = { target: { type: 'product', id: productId } };
    expect(createReportSchema.safeParse({ ...base, reason: 'other' }).success).toBe(false);
    expect(createReportSchema.safeParse({ ...base, reason: 'other', details: '  ' }).success).toBe(
      false,
    );
    expect(
      createReportSchema.safeParse({ ...base, reason: 'other', details: 'x'.repeat(501) }).success,
    ).toBe(false);
    expect(createReportSchema.safeParse({ ...base, reason: 'spam_reason' }).success).toBe(false);
    expect(createReportSchema.safeParse({ ...base, reason: 'scam', extra: true }).success).toBe(
      false,
    );
  });

  it('has a fixed list of reasons', () => {
    expect(REPORT_REASONS).toContain('prohibited');
    expect(REPORT_REASONS).toContain('other');
  });
});

describe('social analytics', () => {
  it('never carries report details or free text', () => {
    expect(() =>
      parseAnalyticsEvent('report_submitted', {
        target_type: 'product',
        reason: 'scam',
        // @ts-expect-error details are never sent
        details: 'phone 98765 43210',
      }),
    ).toThrow();
    expect(parseAnalyticsEvent('product_saved', { product_id: productId, source: 'feed' })).toEqual(
      { product_id: productId, source: 'feed' },
    );
  });
});
