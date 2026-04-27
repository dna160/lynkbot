# @CLAUDE_CONTEXT
# Package : apps/api
# File    : Dockerfile
# Role    : Multi-stage Docker build for LynkBot API service (Fastify on port 3000).
# Stage 1 : deps    — install all workspace dependencies (frozen lockfile)
# Stage 2 : builder — compile TypeScript for all packages + api
# Stage 3 : runner  — minimal production image (no devDeps, no src files)

FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# Workspace manifests first (cache-friendly layer)
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY pnpm-lock.yaml ./
COPY tsconfig.base.json ./

# Package manifests only (triggers pnpm install cache invalidation on dep changes)
COPY packages/shared/package.json    ./packages/shared/
COPY packages/db/package.json        ./packages/db/
COPY packages/ai/package.json        ./packages/ai/
COPY packages/meta/package.json      ./packages/meta/
COPY packages/pantheon/package.json  ./packages/pantheon/
COPY packages/payments/package.json  ./packages/payments/
COPY apps/api/package.json           ./apps/api/

RUN pnpm install --frozen-lockfile

# ---- Stage 2: Builder ----
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Restore node_modules from deps stage
COPY --from=deps /app/node_modules                    ./node_modules
COPY --from=deps /app/packages/shared/node_modules    ./packages/shared/node_modules
COPY --from=deps /app/packages/db/node_modules        ./packages/db/node_modules
COPY --from=deps /app/packages/ai/node_modules        ./packages/ai/node_modules
COPY --from=deps /app/packages/meta/node_modules      ./packages/meta/node_modules
COPY --from=deps /app/packages/pantheon/node_modules  ./packages/pantheon/node_modules
COPY --from=deps /app/packages/payments/node_modules  ./packages/payments/node_modules
COPY --from=deps /app/apps/api/node_modules           ./apps/api/node_modules

# Copy source
COPY tsconfig.base.json ./
COPY packages/shared    ./packages/shared
COPY packages/db        ./packages/db
COPY packages/ai        ./packages/ai
COPY packages/meta      ./packages/meta
COPY packages/pantheon  ./packages/pantheon
COPY packages/payments  ./packages/payments
COPY apps/api           ./apps/api

# Build workspace packages in dependency order, then the app
RUN pnpm --filter @lynkbot/shared   run build
RUN pnpm --filter @lynkbot/db       run build
RUN pnpm --filter @lynkbot/ai       run build
RUN pnpm --filter @lynkbot/meta     run build
RUN pnpm --filter @lynkbot/pantheon run build
RUN pnpm --filter @lynkbot/payments run build
RUN pnpm --filter @lynkbot/api      run build

# ---- Stage 3: Runner ----
FROM node:20-alpine AS runner
RUN apk add --no-cache dumb-init
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 apiuser

# Root node_modules (external deps like fastify, bullmq, etc.)
COPY --from=builder --chown=apiuser:nodejs /app/node_modules ./node_modules

# Workspace package dist + package.json (needed so require('@lynkbot/x') resolves)
COPY --from=builder --chown=apiuser:nodejs /app/packages/shared/dist         ./packages/shared/dist
COPY --from=builder --chown=apiuser:nodejs /app/packages/shared/package.json ./packages/shared/
COPY --from=builder --chown=apiuser:nodejs /app/packages/db/dist             ./packages/db/dist
COPY --from=builder --chown=apiuser:nodejs /app/packages/db/package.json     ./packages/db/
COPY --from=builder --chown=apiuser:nodejs /app/packages/ai/dist             ./packages/ai/dist
COPY --from=builder --chown=apiuser:nodejs /app/packages/ai/package.json     ./packages/ai/
COPY --from=builder --chown=apiuser:nodejs /app/packages/meta/dist           ./packages/meta/dist
COPY --from=builder --chown=apiuser:nodejs /app/packages/meta/package.json   ./packages/meta/
COPY --from=builder --chown=apiuser:nodejs /app/packages/pantheon/dist       ./packages/pantheon/dist
COPY --from=builder --chown=apiuser:nodejs /app/packages/pantheon/package.json ./packages/pantheon/
COPY --from=builder --chown=apiuser:nodejs /app/packages/payments/dist       ./packages/payments/dist
COPY --from=builder --chown=apiuser:nodejs /app/packages/payments/package.json ./packages/payments/

# App dist
COPY --from=builder --chown=apiuser:nodejs /app/apps/api/dist         ./apps/api/dist
COPY --from=builder --chown=apiuser:nodejs /app/apps/api/package.json ./apps/api/

USER apiuser

EXPOSE 3000
WORKDIR /app/apps/api

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
