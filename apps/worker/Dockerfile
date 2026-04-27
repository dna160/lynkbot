# @CLAUDE_CONTEXT
# Package : apps/worker
# File    : Dockerfile
# Role    : Multi-stage Docker build for LynkBot background worker service.
#           No HTTP port exposed — pure BullMQ job processor.
# Stage 1 : deps    — install all dependencies (frozen lockfile)
# Stage 2 : builder — compile TypeScript for all packages + worker
# Stage 3 : runner  — minimal production image

FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY pnpm-lock.yaml ./
COPY tsconfig.base.json ./

COPY packages/shared/package.json   ./packages/shared/
COPY packages/db/package.json       ./packages/db/
COPY packages/ai/package.json       ./packages/ai/
COPY packages/meta/package.json     ./packages/meta/
COPY packages/payments/package.json ./packages/payments/
COPY apps/worker/package.json       ./apps/worker/

RUN pnpm install --frozen-lockfile

# ---- Stage 2: Builder ----
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

COPY --from=deps /app/node_modules                  ./node_modules
COPY --from=deps /app/packages/shared/node_modules  ./packages/shared/node_modules
COPY --from=deps /app/packages/db/node_modules      ./packages/db/node_modules
COPY --from=deps /app/packages/ai/node_modules      ./packages/ai/node_modules
COPY --from=deps /app/packages/meta/node_modules    ./packages/meta/node_modules
COPY --from=deps /app/packages/payments/node_modules ./packages/payments/node_modules
COPY --from=deps /app/apps/worker/node_modules      ./apps/worker/node_modules

COPY tsconfig.base.json ./
COPY packages/shared    ./packages/shared
COPY packages/db        ./packages/db
COPY packages/ai        ./packages/ai
COPY packages/meta      ./packages/meta
COPY packages/payments  ./packages/payments
COPY apps/worker        ./apps/worker

RUN pnpm --filter @lynkbot/shared   run build
RUN pnpm --filter @lynkbot/db       run build
RUN pnpm --filter @lynkbot/ai       run build
RUN pnpm --filter @lynkbot/meta     run build
RUN pnpm --filter @lynkbot/payments run build
RUN pnpm --filter @lynkbot/worker   run build

# ---- Stage 3: Runner ----
FROM node:20-alpine AS runner
RUN apk add --no-cache dumb-init
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 worker

COPY --from=builder --chown=worker:nodejs /app/node_modules ./node_modules

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

COPY --from=builder --chown=worker:nodejs /app/apps/worker/dist         ./apps/worker/dist
COPY --from=builder --chown=worker:nodejs /app/apps/worker/package.json ./apps/worker/

USER worker

WORKDIR /app/apps/worker

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
