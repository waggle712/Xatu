import { z } from 'zod';
import { imageSchema } from './media.ts';

// ───────────────────────────── Limits ─────────────────────────────

export const MAX_PRODUCT_PHOTOS = 8;
export const MAX_VARIANTS = 20;
/** ₹10,00,000. Anything above is a typo, not a handmade product. */
export const MAX_PRICE_PAISE = 100_000_000;
export const MAX_STOCK = 100_000;
export const MAX_LEAD_TIME_DAYS = 60;

export const fulfilmentModeSchema = z.enum(['pickup', 'local_delivery', 'courier']);
export type FulfilmentMode = z.infer<typeof fulfilmentModeSchema>;

// ───────────────────────────── Status ─────────────────────────────

export const productStatusSchema = z.enum(['draft', 'active', 'paused', 'archived']);
export type ProductStatus = z.infer<typeof productStatusSchema>;
export const moderationStatusSchema = z.enum(['pending', 'live', 'held', 'removed']);
export type ModerationStatus = z.infer<typeof moderationStatusSchema>;
export type ProductActor = 'owner' | 'admin';

/**
 * Product lifecycle. Owners publish, pause, resume, archive and restore (back to draft).
 * Moderation (live / held / removed) is separate and belongs to admins.
 */
const PRODUCT_TRANSITIONS: Record<ProductStatus, Partial<Record<ProductStatus, ProductActor[]>>> = {
  draft: { active: ['owner'], archived: ['owner', 'admin'] },
  active: { paused: ['owner', 'admin'], archived: ['owner', 'admin'] },
  paused: { active: ['owner'], archived: ['owner', 'admin'] },
  archived: { draft: ['owner'] },
};

export function canTransitionProduct(
  from: ProductStatus,
  to: ProductStatus,
  actor: ProductActor,
): boolean {
  return PRODUCT_TRANSITIONS[from][to]?.includes(actor) ?? false;
}

/**
 * Moderation when an owner publishes. Decided 10 Nov 2026: a product goes live at once when
 * its shop is active (the shop was already approved by an admin). An admin's hold or removal
 * is never undone by publishing again. Change this one function to require manual review.
 */
export function moderationOnPublish(current: ModerationStatus): ModerationStatus {
  return current === 'held' || current === 'removed' ? current : 'live';
}

/** Buyers see a product only when it is active AND live (the shop must also be public). */
export function isProductPublic(p: {
  status: ProductStatus;
  moderationStatus: ModerationStatus;
}): boolean {
  return p.status === 'active' && p.moderationStatus === 'live';
}

// ───────────────────────────── Inputs ─────────────────────────────

const pricePaise = z.number().int().positive().max(MAX_PRICE_PAISE);
const stock = z.number().int().min(0).max(MAX_STOCK);
const shortText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const variantAttributesSchema = z.strictObject({
  size: shortText(40).optional(),
  flavour: shortText(40).optional(),
  weight: shortText(40).optional(),
});
export type VariantAttributes = z.infer<typeof variantAttributesSchema>;

export const variantInputSchema = z
  .strictObject({
    /** Present for an existing variant; omitted for a new one. */
    id: z.string().uuid().optional(),
    label: optionalText(40),
    labelTa: optionalText(40),
    attributes: variantAttributesSchema.optional(),
    pricePaise,
    stock,
    /**
     * The stock the app last saw from the server (existing variants). Stock is only changed when
     * `stock` differs from it, and only if the server still has `stockBefore`; otherwise 409
     * stock_changed. So an old form can never put sold units back on sale.
     */
    stockBefore: stock.optional(),
  })
  .refine((v) => !v.id || v.stockBefore !== undefined, {
    message: 'stockBefore is required for an existing option',
    path: ['stockBefore'],
  });
export type VariantInput = z.infer<typeof variantInputSchema>;

/** Autosaved draft fields. Every field is optional; a draft may be incomplete. */
export const productDraftSchema = z.strictObject({
  title: optionalText(80),
  titleTa: optionalText(80),
  description: optionalText(2000),
  descriptionTa: optionalText(2000),
  categoryId: z.string().uuid().nullable().optional(),
  madeToOrder: z.boolean().optional(),
  leadTimeDays: z.number().int().min(1).max(MAX_LEAD_TIME_DAYS).nullable().optional(),
  fulfilmentModes: z
    .array(fulfilmentModeSchema)
    .min(1)
    .max(3)
    .refine((m) => new Set(m).size === m.length, 'Each mode once')
    .optional(),
  /**
   * The full list of variants, in order. Existing ones keep their id; missing ids are removed
   * (hidden, never deleted, because orders point at them). Variants with a label need one each.
   */
  variants: z
    .array(variantInputSchema)
    .min(1)
    .max(MAX_VARIANTS)
    .refine(
      (vs) => vs.length === 1 || vs.every((v) => (v.label ?? '').length > 0),
      'Name each option (for example 500 g, 1 kg)',
    )
    .refine((vs) => {
      const ids = vs.flatMap((v) => (v.id ? [v.id] : []));
      return new Set(ids).size === ids.length;
    }, 'A variant appears twice')
    .optional(),
});
export type ProductDraft = z.infer<typeof productDraftSchema>;

/** The app makes the id, so a retried create never makes two drafts. */
export const createProductSchema = productDraftSchema.extend({ id: z.string().uuid() });
export type CreateProductRequest = z.infer<typeof createProductSchema>;

export const setProductPhotosSchema = z.strictObject({
  mediaIds: z
    .array(z.string().uuid())
    .max(MAX_PRODUCT_PHOTOS)
    .refine((ids) => new Set(ids).size === ids.length, 'A photo appears twice'),
});
export type SetProductPhotosRequest = z.infer<typeof setProductPhotosSchema>;

/** Compare-and-set: applied only if the server still has `stockBefore`. */
export const setStockSchema = z.strictObject({ stock, stockBefore: stock });
export type SetStockRequest = z.infer<typeof setStockSchema>;

// ───────────────────────────── Publish checks ─────────────────────────────

export const publishProblemSchema = z.enum([
  'photo',
  'title',
  'category',
  'price',
  'lead_time',
  'fulfilment',
]);
export type PublishProblem = z.infer<typeof publishProblemSchema>;

/** What is still missing before a draft can go live. Same rules in the app and the API. */
export function publishProblems(p: {
  photoCount: number;
  title: string | null;
  categoryId: string | null;
  variants: { pricePaise: number }[];
  madeToOrder: boolean;
  leadTimeDays: number | null;
  fulfilmentModes: FulfilmentMode[];
}): PublishProblem[] {
  const problems: PublishProblem[] = [];
  if (p.photoCount < 1) problems.push('photo');
  if (!p.title || p.title.trim().length < 3) problems.push('title');
  if (!p.categoryId) problems.push('category');
  if (p.variants.length === 0 || p.variants.some((v) => v.pricePaise <= 0)) problems.push('price');
  if (p.madeToOrder && !p.leadTimeDays) problems.push('lead_time');
  if (p.fulfilmentModes.length === 0) problems.push('fulfilment');
  return problems;
}

// ───────────────────────────── Responses ─────────────────────────────

const variantView = z.object({
  id: z.string().uuid(),
  label: z.string().nullable(),
  labelTa: z.string().nullable(),
  attributes: variantAttributesSchema,
  pricePaise: z.number().int(),
  stock: z.number().int(),
});
export type ProductVariantView = z.infer<typeof variantView>;

export const sellerProductSchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  titleTa: z.string().nullable(),
  description: z.string().nullable(),
  descriptionTa: z.string().nullable(),
  categoryId: z.string().uuid().nullable(),
  madeToOrder: z.boolean(),
  leadTimeDays: z.number().int().nullable(),
  fulfilmentModes: z.array(fulfilmentModeSchema),
  status: productStatusSchema,
  moderationStatus: moderationStatusSchema,
  variants: z.array(variantView),
  photos: z.array(imageSchema),
  publishProblems: z.array(publishProblemSchema),
  updatedAt: z.string(),
});
export type SellerProduct = z.infer<typeof sellerProductSchema>;

export const productCardSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  titleTa: z.string().nullable(),
  /** Lowest price across variants. */
  fromPricePaise: z.number().int(),
  hasOptions: z.boolean(),
  inStock: z.boolean(),
  madeToOrder: z.boolean(),
  photo: imageSchema.nullable(),
});
export type ProductCard = z.infer<typeof productCardSchema>;

export const sellerProductCardSchema = productCardSchema.extend({
  title: z.string().nullable(),
  status: productStatusSchema,
  moderationStatus: moderationStatusSchema,
  totalStock: z.number().int(),
});
export type SellerProductCard = z.infer<typeof sellerProductCardSchema>;

export const publicProductSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  titleTa: z.string().nullable(),
  description: z.string().nullable(),
  descriptionTa: z.string().nullable(),
  category: z.object({ slug: z.string(), nameEn: z.string(), nameTa: z.string() }).nullable(),
  madeToOrder: z.boolean(),
  leadTimeDays: z.number().int().nullable(),
  fulfilmentModes: z.array(fulfilmentModeSchema),
  variants: z.array(variantView),
  photos: z.array(imageSchema),
  maker: z.object({
    handle: z.string(),
    businessName: z.string(),
    verified: z.boolean(),
    areaName: z.string().nullable(),
    city: z.string(),
    /** Paused shops stay visible but can't take orders. */
    acceptingOrders: z.boolean(),
  }),
});
export type PublicProduct = z.infer<typeof publicProductSchema>;

export const productPageSchema = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });
export interface ProductPage<T> {
  items: T[];
  nextCursor: string | null;
}

/** Lowest price, for "from ₹220" on cards. */
export function fromPrice(variants: { pricePaise: number }[]): number {
  return variants.reduce((min, v) => Math.min(min, v.pricePaise), Number.POSITIVE_INFINITY);
}
