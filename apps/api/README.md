# api

NestJS modular monolith on PostgreSQL (Prisma 7). ESM, strict TypeScript.

## Run locally

```bash
pnpm db:up                      # from the repo root: Postgres + Redis
cp apps/api/.env.example apps/api/.env
pnpm --filter api db:deploy     # apply migrations
pnpm --filter api db:seed       # 3 sample makers in Trichy
pnpm --filter api dev           # http://localhost:3000
```

- Health check: `GET /health`
- OpenAPI docs: `/docs` (JSON at `/docs/openapi.json`)
- Tests: `pnpm --filter api test` (unit), `pnpm --filter api test:e2e` (needs the database)

## Layout

```
src/
  main.ts, app.module.ts, app.setup.ts   bootstrap, global error filter, OpenAPI
  config/env.ts                          zod-validated environment
  common/                                AppError, error filter, ZodValidationPipe
  prisma/                                PrismaService (pg driver adapter)
  health/                                GET /health
  modules/<module>/                      identity, profiles, content, catalog, orders,
                                         payments, fulfilment, trust, messaging,
                                         notifications, search
prisma/
  schema.prisma, migrations/, seed.ts
```

## Conventions

- Every error is `{ "error": { "code", "message", "details?" } }`. Throw `AppError` with a stable `code`.
- Validate input with zod schemas from `@xatu/shared` via `ZodValidationPipe`.
- Money is integer paise. Database `CHECK` constraints back this up.
- `ledger_entries` is append-only (a trigger blocks UPDATE/DELETE); corrections are reversing entries.
- Schema changes: edit `schema.prisma`, run `pnpm --filter api db:migrate --name <change>`, review the SQL, commit it.
