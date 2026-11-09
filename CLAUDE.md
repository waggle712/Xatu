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

## Rules that matter

- Money is integer paise, never floats. Prices are always read from the DB, never trusted from the app.
- An order becomes `paid` ONLY from a verified Razorpay webhook (check signature, handle idempotently).
- Every money endpoint takes an `Idempotency-Key` header. State changes write an `outbox_events` row in the same transaction.
- Order states: pending_payment → paid → accepted → ready_for_pickup | shipped → delivered; exits: cancelled, refunded. Every change writes `order_events`.
- Reviews only for a delivered `order_item` by that buyer.
- Delivery/pickup OTP codes stored hashed, single use, limited attempts.
- Modules talk to each other only through their public service, never another module's tables.
- Personal data (users, orders) stays in the Mumbai database. Support account deletion (DPDP Act).
- Brand colours come from `packages/ui/tokens.ts`; never paste hex values into screens. Text on marigold buttons is Plum Ink `#3A2230`, never white.
- Touch targets ≥ 48px, body text ≥ 12px, every icon-only button has an accessibility label.

## Brand tokens (light theme)

surface (Ivory) #FCF8F1 · surface-raised #FFFFFF · surface-warm (Champagne) #F4E6CF · ink (Plum Ink) #3A2230 · ink-muted #6E5A64 · line #E8DCD3 · taupe (Soft Taupe) #BFB3AA
brand text (deep rose) #9A4E5E · brand-fill (Dusty Rose) #C98A96 · on-brand #3A2230 · blush #EBCFD0 · plum surface #3A2230 + on-plum #FCF8F1
marigold (action) #E3A62F · on-marigold #3A2230 · sage (trust only) #4E6B4C · sage-soft #E2EADB · gold (Antique Gold) #C29A62 · gold-text #7A5826 · critical #B3261E
Banned pairs (fail contrast): Ivory text on Dusty Rose, deep rose text on Blush, white text on Marigold.
Fonts: Fraunces (display, prices; Tamil falls back to Noto Serif Tamil), Hind Madurai (body). Radius 8 / 14 / 22 / pill. Spacing 4-based.
Full token list with dark theme: the brand kit at https://claude.ai/artifact/4qirKb8CKu6aNu8vkMQeGH (also `brand-kit/tokens.json` in the zip).

## Working style

- Small PRs, one feature per branch. Run lint, typecheck and tests before saying a task is done.
- Write tests for money, order state and auth code first.
- When unsure about a product decision, ask instead of guessing.
- Commands: `pnpm dev` (all), `pnpm --filter api dev`, `pnpm --filter mobile start`, `pnpm test`, `pnpm lint`, `pnpm typecheck`.
