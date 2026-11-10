# Progress

Updated after every prompt or feature. Prompts come from the Xatu kit's `START-HERE.md`.

_Last updated: 10 Nov 2026_

## Foundation prompts

| #   | Prompt                             | Status | PR                  | Notes                                                                                                                                                                                            |
| --- | ---------------------------------- | ------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Monorepo skeleton                  | Done   | committed to `main` | pnpm 12 workspaces, Turborepo, strict TS, shared ESLint/Prettier, `APP_NAME` in `packages/config`                                                                                                |
| 2   | Local database and Redis           | Done   | #1                  | PostGIS 16 on port 5434, Redis on 6380, `pnpm db:up` / `db:down`                                                                                                                                 |
| 3   | Backend skeleton + schema          | Done   | #2                  | NestJS 12, `/health`, `/docs`, zod, global error format; schema follows the founder's audit; seed with 3 Trichy makers                                                                           |
| 4   | Phone OTP login                    | Done   | #3                  | Firebase token → Xatu JWT + rotating refresh token, `GET /me`, Redis rate limits; manual steps in `docs/firebase-setup.md`                                                                       |
| 5   | Mobile app skeleton                | Done   | #4                  | Expo SDK 58, brand tokens in `packages/ui`, welcome + phone + code screens, 5 tabs; verified on Android emulator and iOS simulator                                                               |
| 6   | CI and staging                     | Done   | #6                  | GitHub Actions (format, lint, typecheck, unit, Testcontainers integration tests, API image build); API Dockerfile; `docs/deploy.md` for ECS Express Mode (App Runner is closed to new customers) |
| 7   | Error tracking and pilot analytics | Done   | #7                  | Sentry (API + app) with DPDP-safe settings; PostHog typed events in `packages/shared` (`buyer_signed_up` wired, others defined); typed feature flags; see `docs/analytics.md`                    |
| 8   | Not defined                        | –      | –                   | The kit lists prompts 1–7 only; define prompt 8 before work starts                                                                                                                               |

Merge order: #1 → #2 → #3 → #4, as merge commits (stacked branches). Each PR has a test summary and a rollback note.

## Gaps against the permanent rules in CLAUDE.md

The rules were added after prompts 1–5. These parts of the existing code don't meet them yet and must be fixed before or alongside the first money feature (checkout):

| Rule                                      | Current state                                                                                      | Fix                                                                                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Money is `bigint`                         | Paise columns are `integer` (int4)                                                                 | Migration to `bigint` (`BigInt` in Prisma) and `bigint`-safe JSON serialisation                                                          |
| New order state machine                   | `OrderStatus` uses the earlier states (`pending_payment`, `paid`, `shipped`, `delivered`, ...)     | Migration to the new enum (`draft`, `awaiting_payment`, `placed`, ... `partially_refunded`) plus a transition table in the orders module |
| Payment state machine                     | Enum matches; no transition code yet                                                               | Payments module with allowed transitions, tests first                                                                                    |
| `idempotency_records`                     | Table is named `idempotency_keys`; no middleware yet                                               | Rename, then an Idempotency-Key interceptor for mutating order and money endpoints                                                       |
| Raw webhook storage + BullMQ              | `payment_webhook_events` table exists; no endpoint or BullMQ worker yet                            | Webhook endpoint (store raw, then enqueue) and an idempotent BullMQ processor                                                            |
| 15-minute reservations under row locks    | `inventory_reservations` table exists; no checkout code yet                                        | Reservation service with `SELECT ... FOR UPDATE` and an expiry job                                                                       |
| Order snapshots include variant           | No variants table yet                                                                              | Add product variants (audit P1) and the variant snapshot                                                                                 |
| Ownership tests per resource              | No seller-owned endpoints yet                                                                      | Write with each seller resource                                                                                                          |
| Admin TOTP MFA                            | No admin app yet                                                                                   | Build into `apps/admin` login                                                                                                            |
| Screens: dark mode, all states, 200% font | Theme supports dark; not every screen has loading/empty/error/offline states; 200% font not tested | Audit the 8 current screens and add the missing states                                                                                   |

## Not verified yet

- Real Firebase SMS login (needs the Firebase project; see `docs/firebase-setup.md`)
- The app on a physical Android phone or iPhone
- Tamil strings checked by a native speaker
