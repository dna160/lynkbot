# @CLAUDE_CONTEXT
# Package : apps/worker
# File    : Dockerfile
# Role    : Multi-stage Docker build for LynkBot background worker service.
#           No HTTP port exposed — pure BullMQ job processor.
# Stage 1 : deps    — install all dependencies
# Stage 2 : builder — compile TypeScript to JavaScript
# Stage 3 : runner  — minimal production image

# ---- Stage 1: Dependencies ----
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace manifests
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY pnpm-lock.yaml ./
COPY tsconfig.base.json ./

# Copy package manifests for all workspace packages used by worker
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY packages/ai/package.json ./packages/ai/
COPY packages/wati/package.json ./packages/wati/
COPY packages/payments/package.json ./packages/payments/
COPY apps/worker/package.json ./apps/worker/

# Install dependencies
RUN pnpm install --frozen-lockfile

# ---- Stage 2: Builder ----
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Copy deps from previous stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/ai/node_modules ./packages/ai/node_modules
COPY --from=deps /app/packages/wati/node_modules ./packages/wati/node_modules
COPY --from=deps /app/packages/payments/node_modules ./packages/payments/node_modules
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules

# Copy source
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY packages/ai ./packages/ai
COPY packages/wati ./packages/wati
COPY packages/payments ./packages/payments
COPY apps/worker ./apps/worker

# Build all packages in dependency order
RUN pnpm --filter @lynkbot/shared run build
RUN pnpm --filter @lynkbot/db run build
RUN pnpm --filter @lynkbot/ai run build
RUN pnpm --filter @lynkbot/wati run build
RUN pnpm --filter @lynkbot/payments run build
RUN pnpm --filter @lynkbot/worker run build

# ---- Stage 3: Runner ----
FROM node:20-alpine AS runner
RUN apk add --no-cache dumb-init
WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 worker

# Copy built artifacts and production node_modules
COPY --from=builder --chown=worker:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=worker:nodejs /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=worker:nodejs /app/packages/shared/package.json ./packages/shared/
COPY --from=builder --chown=worker:nodejs /app/packages/db/dist ./packages/db/dist
COPY --from=builder --chown=worker:nodejs /app/packages/db/package.json ./packages/db/
COPY --from=builder --chown=worker:nodejs /app/packages/ai/dist ./packages/ai/dist
COPY --from=builder --chown=worker:nodejs /app/packages/ai/package.json ./packages/ai/
COPY --from=builder --chown=worker:nodejs /app/packages/wati/dist ./packages/wati/dist
COPY --from=builder --chown=worker:nodejs /app/packages/wati/package.json ./packages/wati/
COPY --from=builder --chown=worker:nodejs /app/packages/payments/dist ./packages/payments/dist
COPY --from=builder --chown=worker:nodejs /app/packages/payments/package.json ./packages/payments/
COPY --from=builder --chown=worker:nodejs /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder --chown=worker:nodejs /app/apps/worker/package.json ./apps/worker/

USER worker

# No EXPOSE — worker has no HTTP interface
WORKDIR /app/apps/worker

# Use dumb-init for proper signal forwarding (SIGTERM → graceful shutdown)
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
