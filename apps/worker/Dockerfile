# @CLAUDE_CONTEXT
# Package : apps/worker
# File    : Dockerfile
# Role    : 3-stage Docker build for LynkBot background worker using Turborepo prune.
#           No HTTP port exposed — pure BullMQ job processor.
#
# See apps/api/Dockerfile for full explanation of why turbo prune is used.
# Worker prunes @lynkbot/worker (excludes @lynkbot/pantheon which only api needs).

FROM node:20-alpine AS alpine
RUN apk update && apk add --no-cache libc6-compat dumb-init
RUN npm install -g turbo@2 \
    && corepack enable \
    && corepack prepare pnpm@9 --activate

# ---- Stage 1: Pruner ----
FROM alpine AS pruner
WORKDIR /app
COPY . .
RUN turbo prune @lynkbot/worker --docker

# ---- Stage 2: Builder ----
FROM alpine AS builder
WORKDIR /app

# Layer A — restore dependencies (cached until deps change)
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile

# Layer B — compile
COPY --from=pruner /app/out/full/ .
COPY --from=pruner /app/tsconfig.base.json ./tsconfig.base.json
RUN turbo run build --filter=@lynkbot/worker...

# ---- Stage 3: Runner ----
FROM node:20-alpine AS runner
RUN apk add --no-cache dumb-init
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 worker

# Workspace node_modules (pnpm virtual store + workspace symlinks)
COPY --from=builder --chown=worker:nodejs /app/node_modules ./node_modules

# Compiled workspace packages
COPY --from=builder --chown=worker:nodejs /app/packages/shared/dist         ./packages/shared/dist
COPY --from=builder --chown=worker:nodejs /app/packages/shared/package.json ./packages/shared/
COPY --from=builder --chown=worker:nodejs /app/packages/db/dist             ./packages/db/dist
COPY --from=builder --chown=worker:nodejs /app/packages/db/package.json     ./packages/db/
COPY --from=builder --chown=worker:nodejs /app/packages/ai/dist             ./packages/ai/dist
COPY --from=builder --chown=worker:nodejs /app/packages/ai/package.json     ./packages/ai/
COPY --from=builder --chown=worker:nodejs /app/packages/meta/dist           ./packages/meta/dist
COPY --from=builder --chown=worker:nodejs /app/packages/meta/package.json   ./packages/meta/
COPY --from=builder --chown=worker:nodejs /app/packages/payments/dist       ./packages/payments/dist
COPY --from=builder --chown=worker:nodejs /app/packages/payments/package.json ./packages/payments/

# Worker dist
COPY --from=builder --chown=worker:nodejs /app/apps/worker/dist         ./apps/worker/dist
COPY --from=builder --chown=worker:nodejs /app/apps/worker/package.json ./apps/worker/

USER worker

WORKDIR /app/apps/worker

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
