import { z } from 'zod';
import { productCardSchema } from './catalog.ts';
import { imageSchema } from './media.ts';
import { handleSchema } from './seller.ts';

// ───────────────────────────── Saved and following ─────────────────────────────

/** Caps so one account can't grow unbounded lists (and the "saved ids" query stays small). */
export const MAX_SAVED_PRODUCTS = 500;
export const MAX_FOLLOWED_SHOPS = 500;

/** What the app needs to draw hearts and Follow buttons: ids only, for the signed-in buyer. */
export const savedStateSchema = z.object({
  productIds: z.array(z.string().uuid()),
  shopHandles: z.array(z.string()),
});
export type SavedState = z.infer<typeof savedStateSchema>;

/** A product in the buyer's Saved list: the usual card plus whose it is. */
export const savedProductCardSchema = productCardSchema.extend({
  maker: z.object({ handle: z.string(), businessName: z.string(), verified: z.boolean() }),
});
export type SavedProductCard = z.infer<typeof savedProductCardSchema>;

/** A shop in the buyer's Following list. Public fields only. */
export const followedShopSchema = z.object({
  handle: z.string(),
  businessName: z.string(),
  verified: z.boolean(),
  areaName: z.string().nullable(),
  city: z.string(),
  cover: imageSchema.nullable(),
  acceptingOrders: z.boolean(),
});
export type FollowedShop = z.infer<typeof followedShopSchema>;

// ───────────────────────────── Reports ─────────────────────────────

export const REPORT_REASONS = [
  'counterfeit',
  'prohibited',
  'misleading',
  'unsafe',
  'offensive',
  'scam',
  'other',
] as const;
export const reportReasonSchema = z.enum(REPORT_REASONS);
export type ReportReason = z.infer<typeof reportReasonSchema>;
export const MAX_REPORT_DETAILS = 500;

export const reportTargetSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('product'), id: z.string().uuid() }),
  z.strictObject({
    type: z.literal('shop'),
    handle: z.string().trim().toLowerCase().pipe(handleSchema),
  }),
]);
export type ReportTarget = z.infer<typeof reportTargetSchema>;

export const createReportSchema = z
  .strictObject({
    target: reportTargetSchema,
    reason: reportReasonSchema,
    /** Optional, but needed for "other". Stored for the trust team; never sent to analytics. */
    details: z.string().trim().max(MAX_REPORT_DETAILS).optional(),
  })
  .transform(({ details, ...rest }) => (details ? { ...rest, details } : rest))
  .refine((r) => r.reason !== 'other' || 'details' in r, {
    message: 'Please tell us what is wrong',
    path: ['details'],
  });
export type CreateReportRequest = z.input<typeof createReportSchema>;
export type CreateReport = z.output<typeof createReportSchema>;

export const reportReceiptSchema = z.object({
  id: z.string().uuid(),
  /** True when this person already had an open report on the same listing or shop. */
  alreadyReported: z.boolean(),
});
export type ReportReceipt = z.infer<typeof reportReceiptSchema>;

// ───────────────────────────── Share links ─────────────────────────────

export const productSharePath = (id: string) => `/p/${id}`;
export const shopSharePath = (handle: string) => `/s/${handle}`;
export const shareUrl = (base: string, path: string) => `${base.replace(/\/+$/, '')}${path}`;

export type ShareTarget = { type: 'product'; id: string } | { type: 'shop'; handle: string };

const uuid = z.string().uuid();

/**
 * Reads an incoming link (https web link, xatu:// link or a bare path). Only a product page or
 * a shop page is accepted; anything else returns null, so a crafted link can never open seller,
 * account or settings screens.
 */
export function parseShareLink(link: string): ShareTarget | null {
  const bare = link.trim().split(/[?#]/, 1)[0]!;
  let path: string;
  const web = /^https?:\/\/[^/]+(\/.*)?$/i.exec(bare);
  const app = /^xatu:\/\/(.*)$/i.exec(bare);
  if (web) path = web[1] ?? '/';
  else if (app)
    path = `/${app[1]}`; // xatu://p/<id>
  else if (bare.startsWith('/')) path = bare;
  else return null;
  const parts = path.split('/').filter(Boolean);
  if (parts.length !== 2) return null;
  const [kind, value] = parts as [string, string];
  if (kind === 'p' && uuid.safeParse(value).success) {
    return { type: 'product', id: value.toLowerCase() };
  }
  if (kind === 's') {
    // Handles are [a-z0-9_] only, so nothing needs percent-decoding.
    const handle = handleSchema.safeParse(value.toLowerCase());
    if (handle.success) return { type: 'shop', handle: handle.data };
  }
  return null;
}

export function sharePath(target: ShareTarget): string {
  return target.type === 'product' ? productSharePath(target.id) : shopSharePath(target.handle);
}
