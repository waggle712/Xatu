# Xatu

Mobile shopping app where small makers in India sell through photos, and buyers purchase with trust. Pilot city: Trichy.

One Expo app for Android and iOS, one NestJS API, PostgreSQL. Project rules for contributors and Claude Code are in [CLAUDE.md](CLAUDE.md); the brand kit is in [docs/brand-kit](docs/brand-kit/README.md) and the screen designs in [docs/screens](docs/screens).

## Layout

```
apps/
  mobile/    Expo app (Android + iOS)
  api/       NestJS API
  admin/     Next.js admin panel (later)
packages/
  shared/    zod schemas and types used by app and API
  ui/        design tokens and shared React Native components
  config/    ESLint, TypeScript config, brand.ts (APP_NAME)
infra/       docker-compose for local Postgres + Redis
docs/        brand kit, screen designs
```

## Setup

You need Node.js 24 (`nvm use` reads `.nvmrc`), pnpm 12 and Docker Desktop.

```bash
npm install -g pnpm@12
pnpm install
```

## Commands

| Command          | What it does              |
| ---------------- | ------------------------- |
| `pnpm dev`       | Run every app in dev mode |
| `pnpm test`      | Run all tests             |
| `pnpm lint`      | Lint all packages         |
| `pnpm typecheck` | Type-check all packages   |
| `pnpm format`    | Format with Prettier      |
