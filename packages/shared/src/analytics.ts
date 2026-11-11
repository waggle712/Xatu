import { z } from 'zod';
import { reportReasonSchema } from './social.ts';

const id = z.string().uuid();
const fulfilmentMode = z.enum(['courier', 'pickup', 'local_delivery']);
const mediaPurpose = z.enum(['shop_cover', 'product_photo']);
const shareTargetType = z.enum(['product', 'shop']);
const handle = z.string().max(30);

/**
 * Pilot analytics events (30-day pilot targets). Shared by the API and the app so both
 * send the same names and shapes. Properties are strict: no personal data (phone, name,
 * address) ever goes to analytics. The distinct id is always the Xatu user id (UUID).
 */
export const analyticsEvents = {
  /** A new account was created. Fired by the API on first sign-in. */
  buyer_signed_up: z.strictObject({ language: z.enum(['ta', 'en']) }),
  /** A seller profile was created. */
  seller_signed_up: z.strictObject({
    seller_id: id,
    category_slug: z.string().optional(),
    city: z.string(),
  }),
  /** A product went live. */
  product_listed: z.strictObject({
    product_id: id,
    seller_id: id,
    category_slug: z.string().optional(),
    price_paise: z.number().int().nonnegative(),
  }),
  /** Payment verified by the server (webhook or Razorpay fetch), never from the app. */
  order_paid: z.strictObject({
    order_id: id,
    seller_id: id,
    total_paise: z.number().int().positive(),
    fulfilment_mode: fulfilmentMode,
  }),
  /** The order reached `completed` (picked up or delivered). */
  order_delivered: z.strictObject({ order_id: id, seller_id: id, fulfilment_mode: fulfilmentMode }),
  /** A buyer opened a product page. */
  product_viewed: z.strictObject({ product_id: id, shop_handle: z.string().max(30) }),
  /** A seller started a new listing (the draft was created). */
  product_draft_started: z.strictObject({ product_id: id, seller_id: id }),
  /** A buyer searched. The words themselves are never sent (they can contain names). */
  search_performed: z.strictObject({
    query_length: z.number().int().min(1).max(60),
    results: z.number().int().nonnegative(),
    transliterated: z.boolean(),
  }),
  /** A buyer opened a product from the feed or search. */
  feed_item_opened: z.strictObject({
    product_id: id,
    position: z.number().int().nonnegative(),
    source: z.enum(['feed', 'search']),
  }),
  /** A seller picked or took a photo and the upload began. */
  media_upload_started: z.strictObject({
    purpose: mediaPurpose,
    source: z.enum(['library', 'camera']),
    retry: z.boolean(),
  }),
  /** The worker finished the photo and it is ready to show. */
  media_upload_succeeded: z.strictObject({
    purpose: mediaPurpose,
    media_id: id,
    byte_size: z.number().int().positive(),
    duration_ms: z.number().int().nonnegative(),
  }),
  /** The upload or processing failed. `reject_reason` is the worker's code, e.g. `too_small`. */
  media_upload_failed: z.strictObject({
    purpose: mediaPurpose,
    reason: z.enum(['permission', 'network', 'rejected', 'timeout', 'unknown']),
    reject_reason: z.string().max(40).optional(),
  }),
  /** A buyer added an item to the bag (or changed its quantity). */
  cart_item_added: z.strictObject({ product_id: id, quantity: z.number().int().min(1).max(20) }),
  /** The order was created and its stock held (awaiting payment). Fired by the API. */
  order_created: z.strictObject({
    order_id: id,
    seller_id: id,
    total_paise: z.number().int().nonnegative(),
    fulfilment_mode: fulfilmentMode,
    item_count: z.number().int().positive(),
  }),
  /** The order couldn't be created; only the reason code. Fired by the app. */
  order_failed: z.strictObject({
    reason: z.enum([
      'out_of_stock',
      'price_changed',
      'cart_has_problems',
      'shop_not_accepting',
      'network',
      'other',
    ]),
  }),
  /** The buyer tapped Pay and Razorpay Checkout opened. Fired by the app (never means paid). */
  payment_started: z.strictObject({ order_id: id }),
  /** A buyer cancelled an unpaid order. Fired by the API. */
  order_cancelled: z.strictObject({ order_id: id, by: z.enum(['buyer', 'seller', 'system']) }),
  /** A buyer saved a product (heart). */
  product_saved: z.strictObject({
    product_id: id,
    source: z.enum(['feed', 'search', 'product', 'saved']),
  }),
  product_unsaved: z.strictObject({ product_id: id }),
  shop_followed: z.strictObject({ shop_handle: handle }),
  shop_unfollowed: z.strictObject({ shop_handle: handle }),
  /** The share sheet was opened for a product or shop link. */
  share_tapped: z.strictObject({ target_type: shareTargetType }),
  /** The app was opened from a shared link. */
  share_link_opened: z.strictObject({ target_type: shareTargetType, signed_in: z.boolean() }),
  /** A report was sent. Only the reason; the details text never goes to analytics. */
  report_submitted: z.strictObject({
    target_type: shareTargetType,
    reason: reportReasonSchema,
  }),
} as const;

export type AnalyticsEventName = keyof typeof analyticsEvents;
export type AnalyticsEventProps<E extends AnalyticsEventName> = z.infer<
  (typeof analyticsEvents)[E]
>;

/** Validates properties for an event; throws if they don't match. */
export function parseAnalyticsEvent<E extends AnalyticsEventName>(
  event: E,
  props: AnalyticsEventProps<E>,
): AnalyticsEventProps<E> {
  return analyticsEvents[event].parse(props) as AnalyticsEventProps<E>;
}

/**
 * PostHog feature flags. Every new feature ships behind one. Off unless PostHog says
 * otherwise, so the app behaves safely when PostHog is unreachable or not configured.
 */
export const FEATURE_FLAGS = {
  checkout: {
    key: 'checkout',
    default: false,
    description: 'Bag, checkout, orders (and payment from prompt 15). Needs `catalog` on too.',
  },
  seller_onboarding: {
    key: 'seller-onboarding',
    default: false,
    description: 'Open your shop flow',
  },
  discovery: {
    key: 'discovery',
    default: false,
    description: 'Home feed, search and map. Needs `catalog` on too (cards open product pages).',
  },
  social: {
    key: 'social',
    default: false,
    description:
      'Save (heart), follow a maker, share links and report. Needs `catalog` on too (product pages).',
  },
  catalog: {
    key: 'catalog',
    default: false,
    description: 'Seller product listing, product pages and shop product grids',
  },
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;
