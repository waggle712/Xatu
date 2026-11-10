import { describe, expect, it } from 'vitest';
import { analyticsEvents, FEATURE_FLAGS, parseAnalyticsEvent } from './analytics.ts';

describe('analytics events', () => {
  it('defines exactly the pilot and media events', () => {
    expect(Object.keys(analyticsEvents).sort()).toEqual(
      [
        'buyer_signed_up',
        'feed_item_opened',
        'media_upload_failed',
        'media_upload_started',
        'media_upload_succeeded',
        'order_delivered',
        'order_paid',
        'product_draft_started',
        'product_listed',
        'product_viewed',
        'search_performed',
        'seller_signed_up',
      ].sort(),
    );
  });

  it('accepts valid properties', () => {
    expect(
      parseAnalyticsEvent('order_paid', {
        order_id: '0196f0a0-0000-7000-8000-000000000001',
        seller_id: '0196f0a0-0000-7000-8000-000000000002',
        total_paise: 45000,
        fulfilment_mode: 'pickup',
      }),
    ).toMatchObject({ total_paise: 45000 });
  });

  it('rejects money that is not integer paise', () => {
    expect(() =>
      parseAnalyticsEvent('order_paid', {
        order_id: '0196f0a0-0000-7000-8000-000000000001',
        seller_id: '0196f0a0-0000-7000-8000-000000000002',
        total_paise: 450.5,
        fulfilment_mode: 'pickup',
      }),
    ).toThrow();
  });

  it('rejects unknown properties, so personal data cannot slip in', () => {
    expect(() =>
      parseAnalyticsEvent('buyer_signed_up', { language: 'ta', phone: '+919876543210' } as never),
    ).toThrow();
  });

  it('never has a property that looks like personal data', () => {
    const banned = /phone|name|address|email|pincode/i;
    for (const schema of Object.values(analyticsEvents)) {
      for (const key of Object.keys(schema.shape)) expect(key).not.toMatch(banned);
    }
  });

  it('media failure events carry a known reason only', () => {
    expect(
      parseAnalyticsEvent('media_upload_failed', {
        purpose: 'shop_cover',
        reason: 'rejected',
        reject_reason: 'too_small',
      }),
    ).toMatchObject({ reason: 'rejected' });
    expect(() =>
      parseAnalyticsEvent('media_upload_failed', {
        purpose: 'shop_cover',
        reason: 'oops',
      } as never),
    ).toThrow();
  });

  it('feature flags default to off', () => {
    for (const flag of Object.values(FEATURE_FLAGS)) expect(flag.default).toBe(false);
  });
});
