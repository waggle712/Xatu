# Xatu — project guide for Claude Code

Xatu is a mobile shopping app where small makers in India (home bakers, terracotta and jewellery makers, henna artists, plant nurseries) sell through photos and reels, and buyers purchase with trust. Pilot city: Trichy. Keep the app name in ONE config constant (`packages/config/brand.ts`, `APP_NAME = "Xatu"`) and never hard-code it elsewhere.

Full architecture doc: https://claude.ai/artifact/RR9rWqGLLYUdREk3BxXBSM
Brand kit (colours, type, icons): https://claude.ai/artifact/4qirKb8CKu6aNu8vkMQeGH
Screen designs: https://claude.ai/artifact/Y7L5zjTS2xeLx6sVuj5cmx

## Team

- Shivani: founder, product, Figma
- Mithun: backend, database, payments, infra
- Allwin: mobile app screens, Tamil + English, testing

## Stack (decided — do not swap without asking)

| Layer         | Choice                                                                            |
| ------------- | --------------------------------------------------------------------------------- |
| Monorepo      | pnpm workspaces + Turborepo                                                       |
| Language      | TypeScript everywhere, `strict: true`                                             |
| Mobile        | React Native + Expo (dev builds, not Expo Go), Expo Router, EAS Build             |
| App data      | TanStack Query (server state), Zustand (local state)                              |
| Lists / media | FlashList, expo-image, expo-video                                                 |
| i18n          | i18next, `ta` and `en` from day one; no hard-coded UI strings                     |
| Backend       | Node.js + NestJS modular monolith, REST + OpenAPI                                 |
| Validation    | zod schemas in `packages/shared`, used by app and API                             |
| Database      | PostgreSQL 16 (+ PostGIS, pg_trgm), Prisma migrations                             |
| Cache / jobs  | Redis + BullMQ                                                                    |
| Auth          | Firebase phone OTP → API verifies token → issues own JWT + refresh token          |
| Media         | Cloudflare R2 + Images (photos), Cloudflare Stream (reels), signed direct uploads |
| Payments      | Razorpay (Orders, Checkout SDK, webhooks; Route with on-hold transfers later)     |
| Admin         | Next.js app in `apps/admin`                                                       |
| Hosting       | AWS Mumbai (ap-south-1): App Runner/ECS, RDS, ElastiCache                         |
| Monitoring    | Sentry, PostHog (events + feature flags)                                          |

## Repo layout

```
apps/
  mobile/    Expo app. app/ = routes, src/features/<feature>/ = components, hooks, api
  api/       NestJS. src/modules/<module>/ (identity, profiles, content, catalog,
             orders, payments, fulfilment, trust, messaging, notifications, search)
  admin/     Next.js admin panel
packages/
  shared/    zod schemas, types, generated API client
  ui/        design tokens (from the brand kit), shared RN components
  config/    eslint, tsconfig, brand.ts
infra/       docker-compose for local Postgres + Redis
```

## Permanent rules (apply to every task)

This is a startup product with real money and real users, not a demo. Production quality only.

### Money and payments

- Money is integer paise stored as `bigint`. Never floats. Prices, fees and tax are computed on the server; never trust amounts from the app.
- Order status and payment status are SEPARATE state machines:
  - **Order:** `draft → awaiting_payment → placed → accepted → preparing → ready_for_pickup | out_for_delivery → completed`; exits: `expired`, `cancelled_by_buyer`, `cancelled_by_seller`, `in_dispute`, `refunded`, `partially_refunded`.
  - **Payment:** `initiated → pending → verified → settlement_eligible → settled`; exits: `failed`, `expired`, `refund_pending`, `refunded`, `disputed`, `reversed`.
- A payment becomes `verified` ONLY from a signature-checked Razorpay webhook or a server-side fetch from Razorpay, never from the app's success callback.
- Every money movement is an append-only, balanced double-entry ledger transaction. No UPDATE or DELETE on ledger rows; fix mistakes with reversing entries.
- Every mutating order or money endpoint requires an `Idempotency-Key` header, stored in `idempotency_records`.
- Webhooks are stored raw first (unique on provider event id), then processed by a BullMQ job. Duplicate or out-of-order delivery must be harmless.

### Orders and stock

- Stock is held with `inventory_reservations` (15-minute TTL) under row locks. Two buyers can never buy the last unit.
- Orders store snapshots (title, variant, price, maker, address). Every state change writes an event row plus an `outbox_events` row in the same transaction.
- Reviews only for a completed `order_item`, by that order's buyer.
- Delivery/pickup OTP codes are stored hashed, single use, with limited attempts.
- A notification failure never changes order or payment state.

### Security and privacy

- Ownership is checked in services: a seller can never touch another seller's data. Write a test for each resource.
- Every admin action is written to `admin_audit_logs` (before, after, reason). Admin login requires TOTP MFA.
- Modules talk to each other only through their public service, never another module's tables.
- Personal data (users, orders) stays in the Mumbai database. Support account deletion (DPDP Act).
- Secrets only in `.env` files (git-ignored) or AWS Secrets Manager. The repo is public: never commit secrets or internal business documents.

### Screens

- Every screen: Tamil + English, light + dark, loading / empty / error / offline states, 48dp touch targets, accessibility labels, works at 200% font size.
- Brand colours come from `packages/ui` tokens; never paste hex values into screens. Text on marigold buttons is Plum Ink, never white. Body text ≥ 12px.

### Shipping features

- New features ship behind a PostHog feature flag with typed analytics events.
- Tests first for money, orders, inventory and auth. Integration tests use real Postgres (Testcontainers), not mocks.
- Before saying done: lint, typecheck, unit and integration tests are green. Then open a PR with a test summary and a rollback note.
- After every prompt or feature, update `docs/PROGRESS.md`.

## Brand tokens (light theme)

surface (Ivory) #FCF8F1 · surface-raised #FFFFFF · surface-warm (Champagne) #F4E6CF · ink (Plum Ink) #3A2230 · ink-muted #6E5A64 · line #E8DCD3 · taupe (Soft Taupe) #BFB3AA
brand text (deep rose) #9A4E5E · brand-fill (Dusty Rose) #C98A96 · on-brand #3A2230 · blush #EBCFD0 · plum surface #3A2230 + on-plum #FCF8F1
marigold (action) #E3A62F · on-marigold #3A2230 · sage (trust only) #4E6B4C · sage-soft #E2EADB · gold (Antique Gold) #C29A62 · gold-text #7A5826 · critical #B3261E
Banned pairs (fail contrast): Ivory text on Dusty Rose, deep rose text on Blush, white text on Marigold.
Fonts: Fraunces (display, prices; Tamil falls back to Noto Serif Tamil), Hind Madurai (body). Radius 8 / 14 / 22 / pill. Spacing 4-based.
Full token list with dark theme: the brand kit at https://claude.ai/artifact/4qirKb8CKu6aNu8vkMQeGH (also `docs/brand-kit/tokens.json`).

## Working style

- Small PRs, one feature per branch.
- When unsure about a product decision, ask instead of guessing.
- Commands: `pnpm dev` (all), `pnpm --filter api dev`, `pnpm --filter mobile start`, `pnpm test`, `pnpm test:e2e`, `pnpm lint`, `pnpm typecheck`.
