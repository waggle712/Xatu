import { describe, expect, it } from 'vitest';
import {
  canTransitionProduct,
  createProductSchema,
  fromPrice,
  isProductPublic,
  MAX_PRICE_PAISE,
  moderationOnPublish,
  productDraftSchema,
  publishProblems,
  setProductPhotosSchema,
} from './catalog.ts';

const uuid = (n: number) => `0196f0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;

describe('product status machine', () => {
  it('lets owners publish, pause, resume, archive and restore', () => {
    expect(canTransitionProduct('draft', 'active', 'owner')).toBe(true);
    expect(canTransitionProduct('active', 'paused', 'owner')).toBe(true);
    expect(canTransitionProduct('paused', 'active', 'owner')).toBe(true);
    expect(canTransitionProduct('active', 'archived', 'owner')).toBe(true);
    expect(canTransitionProduct('archived', 'draft', 'owner')).toBe(true);
  });

  it('refuses jumps that skip a step', () => {
    expect(canTransitionProduct('archived', 'active', 'owner')).toBe(false);
    expect(canTransitionProduct('draft', 'paused', 'owner')).toBe(false);
    expect(canTransitionProduct('active', 'draft', 'owner')).toBe(false);
    expect(canTransitionProduct('active', 'active', 'owner')).toBe(false);
  });

  it('admins can take a product down but not publish it for the seller', () => {
    expect(canTransitionProduct('active', 'paused', 'admin')).toBe(true);
    expect(canTransitionProduct('draft', 'active', 'admin')).toBe(false);
  });
});

describe('moderation on publish', () => {
  it('goes live at once', () => {
    expect(moderationOnPublish('pending')).toBe('live');
    expect(moderationOnPublish('live')).toBe('live');
  });

  it('never undoes an admin hold or removal', () => {
    expect(moderationOnPublish('held')).toBe('held');
    expect(moderationOnPublish('removed')).toBe('removed');
  });

  it('buyers see only active and live products', () => {
    expect(isProductPublic({ status: 'active', moderationStatus: 'live' })).toBe(true);
    expect(isProductPublic({ status: 'paused', moderationStatus: 'live' })).toBe(false);
    expect(isProductPublic({ status: 'active', moderationStatus: 'held' })).toBe(false);
    expect(isProductPublic({ status: 'draft', moderationStatus: 'pending' })).toBe(false);
  });
});

describe('draft input', () => {
  it('accepts an empty autosave', () => {
    expect(productDraftSchema.parse({})).toEqual({});
  });

  it('rejects money that is not whole paise, zero, or absurd', () => {
    for (const pricePaise of [450.5, 0, -100, MAX_PRICE_PAISE + 1]) {
      expect(productDraftSchema.safeParse({ variants: [{ pricePaise, stock: 1 }] }).success).toBe(
        false,
      );
    }
  });

  it('rejects negative stock and unknown fields', () => {
    expect(
      productDraftSchema.safeParse({ variants: [{ pricePaise: 100, stock: -1 }] }).success,
    ).toBe(false);
    expect(productDraftSchema.safeParse({ sellerId: uuid(1) }).success).toBe(false);
    expect(productDraftSchema.safeParse({ status: 'active' }).success).toBe(false);
  });

  it('needs a name on each option when there is more than one', () => {
    const unnamed = [
      { pricePaise: 25000, stock: 1 },
      { pricePaise: 45000, stock: 1 },
    ];
    expect(productDraftSchema.safeParse({ variants: unnamed }).success).toBe(false);
    expect(
      productDraftSchema.safeParse({
        variants: [
          { label: '500 g', pricePaise: 25000, stock: 1 },
          { label: '1 kg', pricePaise: 45000, stock: 1, attributes: { weight: '1 kg' } },
        ],
      }).success,
    ).toBe(true);
  });

  it('refuses the same variant twice', () => {
    const v = { id: uuid(9), label: 'A', pricePaise: 100, stock: 1 };
    expect(productDraftSchema.safeParse({ variants: [v, v] }).success).toBe(false);
  });

  it('create needs a client id', () => {
    expect(createProductSchema.safeParse({}).success).toBe(false);
    expect(createProductSchema.safeParse({ id: uuid(1) }).success).toBe(true);
  });

  it('allows at most 8 distinct photos', () => {
    const ids = Array.from({ length: 9 }, (_, i) => uuid(i));
    expect(setProductPhotosSchema.safeParse({ mediaIds: ids }).success).toBe(false);
    expect(setProductPhotosSchema.safeParse({ mediaIds: ids.slice(0, 8) }).success).toBe(true);
    expect(setProductPhotosSchema.safeParse({ mediaIds: [uuid(1), uuid(1)] }).success).toBe(false);
  });
});

describe('publish problems', () => {
  const ready = {
    photoCount: 1,
    title: 'Terracotta diya set',
    categoryId: uuid(1),
    variants: [{ pricePaise: 45000 }],
    madeToOrder: false,
    leadTimeDays: null,
    fulfilmentModes: ['pickup' as const],
  };

  it('is empty for a complete listing', () => {
    expect(publishProblems(ready)).toEqual([]);
  });

  it('lists everything missing', () => {
    expect(
      publishProblems({
        ...ready,
        photoCount: 0,
        title: ' ',
        categoryId: null,
        madeToOrder: true,
        fulfilmentModes: [],
      }),
    ).toEqual(['photo', 'title', 'category', 'lead_time', 'fulfilment']);
  });

  it('from price is the cheapest option', () => {
    expect(fromPrice([{ pricePaise: 45000 }, { pricePaise: 25000 }])).toBe(25000);
  });
});
