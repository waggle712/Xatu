import { describe, expect, it } from 'vitest';
import {
  approximateLocation,
  canTransitionSeller,
  handleSchema,
  missingForSubmit,
  openingHoursSchema,
  type SellerStatus,
} from './seller.ts';

describe('seller status machine', () => {
  const allowed: [SellerStatus, SellerStatus, 'owner' | 'admin'][] = [
    ['draft', 'kyc_pending', 'owner'],
    ['kyc_pending', 'active', 'admin'],
    ['kyc_pending', 'draft', 'admin'],
    ['active', 'paused', 'owner'],
    ['paused', 'active', 'owner'],
    ['active', 'suspended', 'admin'],
    ['paused', 'suspended', 'admin'],
    ['kyc_pending', 'suspended', 'admin'],
    ['suspended', 'active', 'admin'],
  ];

  it.each(allowed)('%s → %s by %s is allowed', (from, to, actor) => {
    expect(canTransitionSeller(from, to, actor)).toBe(true);
  });

  it.each([
    ['draft', 'active', 'owner'],
    ['kyc_pending', 'active', 'owner'],
    ['suspended', 'active', 'owner'],
    ['active', 'suspended', 'owner'],
    ['suspended', 'paused', 'owner'],
    ['draft', 'paused', 'owner'],
    ['active', 'draft', 'admin'],
  ] as const)('%s → %s by %s is refused', (from, to, actor) => {
    expect(canTransitionSeller(from, to, actor)).toBe(false);
  });
});

describe('handle', () => {
  it.each(['meenaclaystudio', 'sweet_box', 'abi123'])('accepts %s', (h) => {
    expect(handleSchema.safeParse(h).success).toBe(true);
  });
  it.each(['ab', 'Meena Clay', 'xatu', 'admin', 'a'.repeat(31), 'meena-clay', '_meena'])(
    'rejects %s',
    (h) => {
      expect(handleSchema.safeParse(h).success).toBe(false);
    },
  );
});

describe('opening hours', () => {
  it('accepts open days with ranges and closed days', () => {
    const hours = {
      mon: [
        { open: '09:00', close: '13:00' },
        { open: '16:00', close: '20:00' },
      ],
      sun: [],
    };
    expect(openingHoursSchema.safeParse(hours).success).toBe(true);
  });
  it('rejects a range that closes before it opens', () => {
    expect(openingHoursSchema.safeParse({ mon: [{ open: '18:00', close: '09:00' }] }).success).toBe(
      false,
    );
  });
  it('rejects overlapping ranges', () => {
    const hours = {
      tue: [
        { open: '09:00', close: '14:00' },
        { open: '13:00', close: '18:00' },
      ],
    };
    expect(openingHoursSchema.safeParse(hours).success).toBe(false);
  });
  it('rejects bad times', () => {
    expect(openingHoursSchema.safeParse({ wed: [{ open: '9am', close: '25:00' }] }).success).toBe(
      false,
    );
  });
});

describe('submit checklist', () => {
  it('lists what is missing before a shop can be submitted', () => {
    expect(
      missingForSubmit({
        businessName: 'Meena Clay Studio',
        categoryId: null,
        storyEn: null,
        storyTa: null,
        areaName: 'Woraiyur',
        pickupAddressLine: null,
        hasLocation: false,
        openingHours: {},
      }).sort(),
    ).toEqual(['category', 'location', 'opening_hours', 'pickup_address', 'story'].sort());
  });
});

describe('approximate location', () => {
  it('rounds to about 1 km so the exact pickup point is never public', () => {
    expect(approximateLocation({ lat: 10.828512, lng: 78.679534 })).toEqual({
      lat: 10.83,
      lng: 78.68,
    });
  });
});
