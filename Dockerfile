# syntax=docker/dockerfile:1.7
#
# One Dockerfile for the monorepo; docker-compose.yml picks a target per service:
#   api  — Express REST API          (apps/backend)
#   ws   — realtime websocket service (apps/websocket)
#   web  — Next.js frontend           (apps/frontend)
#   tools — API image + Prisma CLI, used for migrations and seeding

ARG BUN_VERSION=1.4.0
ARG NODE_VERSION=20

# ---------------------------------------------------------------- dependencies
FROM oven/bun:${BUN_VERSION} AS manifests
WORKDIR /app
COPY package.json bun.lock turbo.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/websocket/package.json apps/websocket/
COPY apps/frontend/package.json apps/frontend/
COPY packages/db/package.json packages/db/
COPY packages/ui/package.json packages/ui/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/typescript-config/package.json packages/typescript-config/
# The db package generates its Prisma client on install, so it needs the schema.
COPY packages/db/prisma packages/db/prisma
COPY packages/db/prisma.config.ts packages/db/
# Placeholder only — generating the client never connects to a database.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build

# Server images only get the backend/websocket/db dependency graph (no Next.js, React, Playwright…).
FROM manifests AS server-deps
RUN bun install --frozen-lockfile --filter backend --filter websocket --filter db

FROM manifests AS web-deps
RUN bun install --frozen-lockfile --filter frontend

# ---------------------------------------------------------------- bun services
FROM server-deps AS server-src
COPY packages/db packages/db
COPY apps/backend apps/backend
COPY apps/websocket apps/websocket
RUN cd packages/db && bunx prisma generate

FROM oven/bun:${BUN_VERSION}-slim AS runtime-base
WORKDIR /app
ENV NODE_ENV=production
COPY --from=server-src --chown=bun:bun /app /app
# Attachment storage; mount a volume here so files survive container restarts.
RUN mkdir -p /data/uploads && chown bun:bun /data/uploads
ENV UPLOAD_DIR=/data/uploads
USER bun

FROM runtime-base AS tools
WORKDIR /app/packages/db
CMD ["bunx", "prisma", "migrate", "deploy"]

FROM runtime-base AS api
WORKDIR /app/apps/backend
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD bun -e "fetch('http://127.0.0.1:' + (process.env.PORT ?? 4000) + '/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["bun", "index.ts"]

FROM runtime-base AS ws
WORKDIR /app/apps/websocket
EXPOSE 4001
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD bun -e "fetch('http://127.0.0.1:' + (process.env.WS_PORT ?? 4001) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["bun", "index.ts"]

# ---------------------------------------------------------------- frontend
FROM node:${NODE_VERSION}-bookworm-slim AS web-build
WORKDIR /app
COPY --from=web-deps /app/node_modules node_modules
COPY --from=web-deps /app/apps/frontend/node_modules apps/frontend/node_modules
COPY apps/frontend apps/frontend
# NEXT_PUBLIC_* values are baked into the client bundle and the CSP at build time.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_WS_URL=ws://localhost:4001
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL \
    NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID \
    NEXT_TELEMETRY_DISABLED=1
RUN cd apps/frontend && node node_modules/next/dist/bin/next build

FROM node:${NODE_VERSION}-bookworm-slim AS web
WORKDIR /app/apps/frontend
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=web-build --chown=node:node /app /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3000"]
