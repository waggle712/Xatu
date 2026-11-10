import { z } from 'zod';
import { imageSchema } from './media.ts';

/** Trichy city centre (Chathiram bus stand area): where the feed starts without a location. */
export const TRICHY_CENTRE = { lat: 10.81, lng: 78.69 } as const;
export const DEFAULT_RADIUS_KM = 25;
export const MAX_RADIUS_KM = 100;
export const FEED_PAGE_SIZE = 20;
export const MAX_QUERY_LENGTH = 60;

/**
 * A buyer's position, rounded to 2 decimals (about 1 km) on the phone AND on the server, before
 * it goes into a URL (URLs end up in logs). Rounding also lets cached feeds match more often.
 */
export function roundPoint(point: { lat: number; lng: number }): { lat: number; lng: number } {
  return { lat: Math.round(point.lat * 100) / 100, lng: Math.round(point.lng * 100) / 100 };
}

const lat = z.coerce.number().min(-90).max(90);
const lng = z.coerce.number().min(-180).max(180);

export const feedQuerySchema = z
  .strictObject({
    lat: lat.optional(),
    lng: lng.optional(),
    category: z
      .string()
      .regex(/^[a-z0-9-]{1,40}$/)
      .optional(),
    radiusKm: z.coerce.number().int().min(1).max(MAX_RADIUS_KM).default(DEFAULT_RADIUS_KM),
    cursor: z.string().max(300).optional(),
  })
  .refine((q) => (q.lat === undefined) === (q.lng === undefined), 'Send both lat and lng');
export type FeedQuery = z.infer<typeof feedQuerySchema>;

export const searchQuerySchema = z
  .strictObject({
    q: z.string().trim().min(1).max(MAX_QUERY_LENGTH),
    lat: lat.optional(),
    lng: lng.optional(),
    cursor: z.string().max(300).optional(),
  })
  .refine((q) => (q.lat === undefined) === (q.lng === undefined), 'Send both lat and lng');
export type SearchQuery = z.infer<typeof searchQuerySchema>;

const point = z.object({ lat: z.number(), lng: z.number() });

export const makerSummarySchema = z.object({
  handle: z.string(),
  businessName: z.string(),
  verified: z.boolean(),
  areaName: z.string().nullable(),
  city: z.string(),
});
export type MakerSummary = z.infer<typeof makerSummarySchema>;

export const feedItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  titleTa: z.string().nullable(),
  description: z.string().nullable(),
  descriptionTa: z.string().nullable(),
  fromPricePaise: z.number().int(),
  hasOptions: z.boolean(),
  inStock: z.boolean(),
  madeToOrder: z.boolean(),
  photo: imageSchema.nullable(),
  maker: makerSummarySchema,
  /** From the shop's rounded public point, to one decimal. */
  distanceKm: z.number(),
});
export type FeedItem = z.infer<typeof feedItemSchema>;

/** A shop for the maker row and the map. `location` is the rounded public point only. */
export const nearbyMakerSchema = makerSummarySchema.extend({
  location: point,
  distanceKm: z.number(),
  liveProducts: z.number().int(),
});
export type NearbyMaker = z.infer<typeof nearbyMakerSchema>;

export const feedPageSchema = z.object({
  items: z.array(feedItemSchema),
  nextCursor: z.string().nullable(),
  /** Where the feed was measured from; `approximate` when no location was sent (Trichy centre). */
  origin: point.extend({ approximate: z.boolean() }),
  /** First page only: makers near you, nearest first. */
  makers: z.array(nearbyMakerSchema).optional(),
});
export type FeedPage = z.infer<typeof feedPageSchema>;

export const searchPageSchema = z.object({
  items: z.array(feedItemSchema),
  nextCursor: z.string().nullable(),
  /** The words actually searched, after adding Tamil/Latin spellings. */
  terms: z.array(z.string()),
});
export type SearchPage = z.infer<typeof searchPageSchema>;

/** Collapses spaces and case so "  Murukku " and "murukku" are the same search. */
export function normaliseQuery(q: string): string {
  return q.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase().slice(0, MAX_QUERY_LENGTH);
}

/** True when the text has Tamil letters (U+0B80–U+0BFF). */
export function hasTamil(text: string): boolean {
  return /[஀-௿]/.test(text);
}
