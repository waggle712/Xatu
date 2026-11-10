# syntax=docker/dockerfile:1
# Build from the repo root:  docker build -f apps/api/Dockerfile -t xatu-api .
# Targets: `runtime` (default, the API) and `migrate` (runs prisma migrate deploy).

FROM node:24-slim AS base
ENV CI=1
RUN npm install -g pnpm@12.18.0
WORKDIR /repo
# Workspace manifests only, so dependency layers stay cached when source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/mobile/package.json apps/mobile/
COPY apps/admin/package.json apps/admin/
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/

# ---- build: all dependencies, Prisma client, compiled API ----
FROM base AS build
COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/
RUN pnpm install --frozen-lockfile --filter "api..."
COPY packages/config packages/config
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter api build

# ---- production dependencies only ----
FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter "api..."

# ---- migrate: one-off task before each deploy ----
FROM build AS migrate
WORKDIR /repo/apps/api
CMD ["npx", "prisma", "migrate", "deploy"]

# ---- runtime ----
FROM node:24-slim AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /repo
COPY --from=prod-deps /repo/node_modules node_modules
# Workspace packages are imported as TypeScript source (Node type stripping).
COPY packages/config/package.json packages/config/
COPY packages/config/src packages/config/src
COPY packages/shared/package.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY apps/api/package.json apps/api/
COPY --from=build /repo/apps/api/dist apps/api/dist
WORKDIR /repo/apps/api
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/src/main.js"]
