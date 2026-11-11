# Error tracking and pilot analytics

Both are **off unless configured**. With no keys set (local development, tests) nothing is sent anywhere.

## Sentry (errors and crashes)

| Where | Setting                                         | Notes                                                                                                                                                  |
| ----- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API   | `SENTRY_DSN`, `SENTRY_ENVIRONMENT`              | Captures unhandled errors (HTTP 500s) from the global error filter.                                                                                    |
| App   | `EXPO_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_APP_ENV` | Native crashes and JS errors. Source maps upload during EAS builds when `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` are set as EAS secrets. |

Privacy (DPDP):

- **API:** no request or response bodies, cookies, query strings or user details are sent. Only `user-agent`, `content-type` and `accept-language` headers are kept. `Authorization` and `Idempotency-Key` headers are redacted again in `beforeSend`. This is tested in `src/instrument.spec.ts`.
- **App:**
  - `sendDefaultPii: false`
  - no screenshots, view hierarchy or accessibility identifiers
  - query strings removed from HTTP breadcrumbs
  - the Sentry user is only the Xatu user id

## PostHog (pilot events and feature flags)

| Where | Setting                                               |
| ----- | ----------------------------------------------------- |
| API   | `POSTHOG_API_KEY`, `POSTHOG_HOST`                     |
| App   | `EXPO_PUBLIC_POSTHOG_KEY`, `EXPO_PUBLIC_POSTHOG_HOST` |

The default host is PostHog EU Cloud (`https://eu.i.posthog.com`). Whether pilot analytics may leave India, and which region to use, is a decision for the founder with the privacy adviser. Change the host if needed.

### Events (`packages/shared/src/analytics.ts`)

Typed with strict zod schemas shared by the API and the app. Unknown properties are rejected, so personal data cannot slip in. The distinct id is always the Xatu user id (UUID), never a phone number.

| Event                    | Fired by                     | When                                                                       | Properties                                                              |
| ------------------------ | ---------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `buyer_signed_up`        | API                          | First sign-in creates the account                                          | `language`                                                              |
| `seller_signed_up`       | API (with seller onboarding) | A seller profile is created                                                | `seller_id`, `category_slug?`, `city`                                   |
| `product_listed`         | API (with catalogue)         | A product goes live for the first time (not when a paused product resumes) | `product_id`, `seller_id`, `category_slug?`, `price_paise`              |
| `product_draft_started`  | API                          | A seller starts a new listing                                              | `product_id`, `seller_id`                                               |
| `product_viewed`         | App                          | A buyer opens a product page                                               | `product_id`, `shop_handle`                                             |
| `search_performed`       | App                          | A search finished                                                          | `query_length`, `results`, `transliterated` (never the words)           |
| `feed_item_opened`       | App                          | A product opened from the feed or search                                   | `product_id`, `position`, `source`                                      |
| `product_saved`          | App                          | A buyer saved a product (heart)                                            | `product_id`, `source`                                                  |
| `product_unsaved`        | App                          | A buyer removed a saved product                                            | `product_id`                                                            |
| `shop_followed`          | App                          | A buyer followed a maker                                                   | `shop_handle`                                                           |
| `shop_unfollowed`        | App                          | A buyer unfollowed a maker                                                 | `shop_handle`                                                           |
| `share_tapped`           | App                          | The share sheet opened for a product or shop                               | `target_type`                                                           |
| `share_link_opened`      | App                          | The app was opened from a shared link                                      | `target_type`, `signed_in`                                              |
| `report_submitted`       | App                          | A report was sent                                                          | `target_type`, `reason` (never the details text)                        |
| `cart_item_added`        | App                          | A buyer added an item to the bag                                           | `product_id`, `quantity`                                                |
| `order_created`          | API                          | An order was created and its stock held (awaiting payment)                 | `order_id`, `seller_id`, `total_paise`, `fulfilment_mode`, `item_count` |
| `order_failed`           | App                          | Placing an order was refused or failed                                     | `reason` (code only)                                                    |
| `payment_started`        | App                          | Pay tapped and Razorpay Checkout opened (never means paid)                 | `order_id`                                                              |
| `order_cancelled`        | API                          | An unpaid order was cancelled                                              | `order_id`, `by`                                                        |
| `order_paid`             | API (with payments)          | Payment **verified** by webhook or server fetch, never the app callback    | `order_id`, `seller_id`, `total_paise`, `fulfilment_mode`               |
| `order_delivered`        | API (with fulfilment)        | Order reaches `completed`                                                  | `order_id`, `seller_id`, `fulfilment_mode`                              |
| `media_upload_started`   | App                          | A seller picked or took a photo and the upload began                       | `purpose`, `source`, `retry`                                            |
| `media_upload_succeeded` | App                          | The worker marked the photo ready                                          | `purpose`, `media_id`, `byte_size`, `duration_ms`                       |
| `media_upload_failed`    | App                          | Permission refused, network error, timeout or rejected by the worker       | `purpose`, `reason`, `reject_reason`                                    |

`buyer_signed_up`, `product_draft_started`, `product_listed`, `product_viewed`, `search_performed`, `feed_item_opened`, the three `media_upload_*` events and the seven save, follow, share and report events, the four bag and order events, `payment_started`, and `order_paid` (from the API after a verified payment places the order) are wired today. The others are defined so each feature sends them in the agreed shape when it is built. Money events are sent from the API, not the app, so they count only what really happened.

Analytics is fire-and-forget: a PostHog failure is logged and never changes a login, order or payment. An integration test checks that sign-in still works while analytics throws.

### Feature flags

Every new feature ships behind a flag (`FEATURE_FLAGS` in `packages/shared`):

| Flag                | PostHog key         | Default               |
| ------------------- | ------------------- | --------------------- |
| `checkout`          | `checkout`          | off                   |
| `seller_onboarding` | `seller-onboarding` | off                   |
| `catalog`           | `catalog`           | off                   |
| `discovery`         | `discovery`         | off (needs `catalog`) |
| `social`            | `social`            | off (needs `catalog`) |

In the app use `useFeatureFlag('checkout')` from `src/lib/analytics`. It returns `false` when PostHog is not configured or unreachable. Create the flag in PostHog with the same key before turning it on.

App settings: no autocapture, no session replay, no app-lifecycle events, geo-IP off, person profiles only for signed-in users (`identify` on sign-in, `reset` on sign-out).

### Pilot targets these events measure

Sellers signed up (20), products listed (100), buyer sign-ups (150) and real orders (20) in the first 30 days.
