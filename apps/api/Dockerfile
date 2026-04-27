# @CLAUDE_CONTEXT
# Package : apps/api
# File    : Dockerfile
# Role    : 3-stage Docker build for LynkBot API using Turborepo prune.
#
# WHY turbo prune (not sequential pnpm --filter):
#   turbo prune @lynkbot/api --docker extracts a minimal, self-contained
#   workspace containing ONLY the packages apps/api depends on, with a
#   pruned pnpm-lock.yaml. This solves two problems:
#     1. pnpm workspace symlinks stay coherent — install + build happen in
#        the SAME filesystem layer (builder stage), so no cross-stage symlink breakage.
#     2. turbo run build --filter=@lynkbot/api... uses the topological graph
#        to compile dependencies in the correct order automatically.
#
# STAGE OVERVIEW:
#   alpine  — shared base image with pnpm + turbo pre-installed
#   pruner  — copies entire source, runs turbo prune to emit out/
#   builder — installs pruned deps, compiles all packages + api
#   runner  — minimal Alpine image with compiled dist + node_modules

FROM node:20-alpine AS alpine
RUN apk update && apk add --no-cache libc6-compat dumb-init
RUN npm install -g turbo@2 \
    && corepack enable \
    && corepack prepare pnpm@9 --activate

# ---- Stage 1: Pruner ----
# Full source copy + turbo prune to create a minimal workspace for @lynkbot/api
FROM alpine AS pruner
WORKDIR /app
COPY . .
RUN turbo prune @lynkbot/api --docker

# ---- Stage 2: Builder ----
# Two-layer install trick for Docker cache:
#   Layer A: pnpm install with ONLY package.json files (cached until deps change)
#   Layer B: full source copy + turbo build (busts only when source changes)
FROM alpine AS builder
WORKDIR /app

# Layer A — restore dependencies
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile

# Layer B — compile
# tsconfig.base.json lives at the workspace root; turbo prune puts it in out/full
COPY --from=pruner /app/out/full/ .
# Explicit fallback: copy root tsconfig in case turbo prune doesn't include it
COPY --from=pruner /app/tsconfig.base.json ./tsconfig.base.json
RUN turbo run build --filter=@lynkbot/api...

# ---- Stage 3: Runner ----
FROM node:20-alpine AS runner
RUN apk add --no-cache dumb-init
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 apiuser

# Workspace node_modules (pnpm virtual store + workspace symlinks)
COPY --from=builder --chown=apiuser:nodejs /app/node_modules ./node_modules

# Compiled workspace packages — workspace symlinks in node_modules resolve to these
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
