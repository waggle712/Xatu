import { z } from 'zod';
import { imageSchema } from './media.ts';

export const sellerStatusSchema = z.enum(['draft', 'kyc_pending', 'active', 'paused', 'suspended']);
export type SellerStatus = z.infer<typeof sellerStatusSchema>;
export type SellerActor = 'owner' | 'admin';

/**
 * Who may move a shop between statuses. Owners submit, pause and resume; only admins
 * approve, send back, suspend and reinstate (admin actions are audited in the admin console).
 */
const TRANSITIONS: Record<SellerStatus, Partial<Record<SellerStatus, SellerActor[]>>> = {
  draft: { kyc_pending: ['owner'] },
  kyc_pending: { active: ['admin'], draft: ['admin'], suspended: ['admin'] },
  active: { paused: ['owner', 'admin'], suspended: ['admin'] },
  paused: { active: ['owner', 'admin'], suspended: ['admin'] },
  suspended: { active: ['admin'] },
};

export function canTransitionSeller(
  from: SellerStatus,
  to: SellerStatus,
  actor: SellerActor,
): boolean {
  return TRANSITIONS[from][to]?.includes(actor) ?? false;
}

/** Shops buyers can open. Paused shops stay visible but can't take orders. */
export const PUBLIC_SELLER_STATUSES: readonly SellerStatus[] = ['active', 'paused'];

const RESERVED_HANDLES = new Set([
  'xatu',
  'admin',
  'support',
  'help',
  'shop',
  'shops',
  'me',
  'api',
  'www',
  'settings',
]);

export const handleSchema = z
  .string()
  .min(3)
  .max(30)
  .regex(/^[a-z0-9][a-z0-9_]*$/, 'Use lowercase letters, numbers and underscores')
  .refine((h) => !RESERVED_HANDLES.has(h), 'This name is reserved');

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24 hour)');
const range = z
  .object({ open: time, close: time })
  .refine((r) => r.open < r.close, 'Closing time must be after opening time');
const dayRanges = z
  .array(range)
  .max(3)
  .refine((ranges) => {
    const sorted = [...ranges].sort((a, b) => a.open.localeCompare(b.open));
    return sorted.every((r, i) => i === 0 || sorted[i - 1]!.close <= r.open);
  }, 'Time ranges overlap');

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Opening hours in IST. A missing or empty day means closed. */
export const openingHoursSchema = z.partialRecord(z.enum(WEEKDAYS), dayRanges);
export type OpeningHours = z.infer<typeof openingHoursSchema>;

const latLng = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const pincode = z.string().regex(/^[1-9]\d{5}$/, 'Enter a 6-digit pincode');
const story = z.string().trim().max(600);

export const createShopSchema = z.strictObject({
  businessName: z.string().trim().min(2).max(60),
  handle: handleSchema,
  categoryId: z.string().uuid(),
});
export type CreateShopRequest = z.infer<typeof createShopSchema>;

export const updateShopSchema = z
  .strictObject({
    businessName: z.string().trim().min(2).max(60),
    categoryId: z.string().uuid(),
    storyEn: story.nullable(),
    storyTa: story.nullable(),
    areaName: z.string().trim().min(2).max(60),
    city: z.string().trim().min(2).max(60),
    pincode,
    /** Exact pickup point. Private: only the owner and, later, buyers of accepted orders see it. */
    location: latLng,
    pickupAddressLine: z.string().trim().min(5).max(200),
    pickupLandmark: z.string().trim().max(100).nullable(),
    openingHours: openingHoursSchema,
    pickupAvailable: z.boolean(),
    localDelivery: z.boolean(),
    /** A ready `shop_cover` upload owned by this user, or null to remove the cover. */
    coverMediaId: z.string().uuid().nullable(),
  })
  .partial();
export type UpdateShopRequest = z.infer<typeof updateShopSchema>;

export interface SubmitChecklistInput {
  businessName: string;
  categoryId: string | null;
  storyEn: string | null;
  storyTa: string | null;
  areaName: string | null;
  pickupAddressLine: string | null;
  hasLocation: boolean;
  openingHours: OpeningHours;
}

export type SubmitRequirement =
  'category' | 'story' | 'area' | 'pickup_address' | 'location' | 'opening_hours';

/** What a draft shop still needs before it can be submitted for review. */
export function missingForSubmit(shop: SubmitChecklistInput): SubmitRequirement[] {
  const missing: SubmitRequirement[] = [];
  if (!shop.categoryId) missing.push('category');
  if (!shop.storyEn?.trim() && !shop.storyTa?.trim()) missing.push('story');
  if (!shop.areaName?.trim()) missing.push('area');
  if (!shop.pickupAddressLine?.trim()) missing.push('pickup_address');
  if (!shop.hasLocation) missing.push('location');
  if (!Object.values(shop.openingHours).some((ranges) => (ranges?.length ?? 0) > 0))
    missing.push('opening_hours');
  return missing;
}

/** Rounds to 2 decimal places (about 1.1 km) for anything shown publicly. */
export function approximateLocation(point: { lat: number; lng: number }): {
  lat: number;
  lng: number;
} {
  return { lat: Math.round(point.lat * 100) / 100, lng: Math.round(point.lng * 100) / 100 };
}

/** What the owner sees in "My shop", including the private pickup address. */
export const myShopSchema = z.object({
  id: z.string().uuid(),
  handle: z.string(),
  businessName: z.string(),
  categoryId: z.string().uuid().nullable(),
  storyEn: z.string().nullable(),
  storyTa: z.string().nullable(),
  areaName: z.string().nullable(),
  city: z.string(),
  pincode: z.string().nullable(),
  location: latLng.nullable(),
  pickupAddressLine: z.string().nullable(),
  pickupLandmark: z.string().nullable(),
  openingHours: openingHoursSchema,
  pickupAvailable: z.boolean(),
  localDelivery: z.boolean(),
  cover: imageSchema.nullable(),
  status: sellerStatusSchema,
  verified: z.boolean(),
  missingForSubmit: z.array(z.string()),
});
export type MyShop = z.infer<typeof myShopSchema>;

/** What anyone can see. Never contains the exact pickup point, address or phone number. */
export const publicShopSchema = z.object({
  handle: z.string(),
  businessName: z.string(),
  category: z.object({ slug: z.string(), nameEn: z.string(), nameTa: z.string() }).nullable(),
  storyEn: z.string().nullable(),
  storyTa: z.string().nullable(),
  areaName: z.string().nullable(),
  city: z.string(),
  approximateLocation: latLng.nullable(),
  openingHours: openingHoursSchema,
  pickupAvailable: z.boolean(),
  localDelivery: z.boolean(),
  cover: imageSchema.nullable(),
  status: z.enum(['active', 'paused']),
  verified: z.boolean(),
  liveProductCount: z.number().int(),
  completedOrderCount: z.number().int(),
  followerCount: z.number().int(),
});
export type PublicShop = z.infer<typeof publicShopSchema>;

export const categorySchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  nameEn: z.string(),
  nameTa: z.string(),
});
export type Category = z.infer<typeof categorySchema>;
