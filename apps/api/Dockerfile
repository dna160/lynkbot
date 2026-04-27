# @CLAUDE_CONTEXT
# Package : apps/api
# File    : Dockerfile
# Role    : Two-stage Docker build for LynkBot API (Fastify, port 3000).
#
# WHY SINGLE BUILD STAGE (not 3-stage deps/builder/runner):
#   pnpm workspaces wire @lynkbot/* as symlinks inside node_modules.
#   Copying those symlinks between Docker stages breaks them because the
#   target paths (.pnpm virtual store + package source dirs) must exist in
#   the SAME filesystem layer. Installing and building in one stage avoids
#   this entirely.
#
# CACHE STRATEGY:
#   Layer 1: Install pnpm + copy workspace manifests + package.json files
#   Layer 2: pnpm install  (cached until any package.json changes)
#   Layer 3: Copy source   (cached until source changes)
#   Layer 4+: Build steps  (one layer per package = granular invalidation)

# ---- Stage 1: Build ----
FROM node:20-alpine AS build
RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# Workspace manifests + only package.json files (deps cache layer)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json    ./packages/shared/
COPY packages/db/package.json        ./packages/db/
COPY packages/ai/package.json        ./packages/ai/
COPY packages/meta/package.json      ./packages/meta/
COPY packages/pantheon/package.json  ./packages/pantheon/
COPY packages/payments/package.json  ./packages/payments/
COPY apps/api/package.json           ./apps/api/

# Install all deps — pnpm creates workspace symlinks in this same layer
RUN pnpm install --frozen-lockfile

# Copy source (after install so the install layer is cached separately)
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

# ---- Stage 2: Runner ----
FROM node:20-alpine AS runner
RUN apk add --no-cache dumb-init
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 apiuser

# Copy the entire workspace node_modules (contains pnpm .pnpm virtual store + symlinks)
COPY --from=build --chown=apiuser:nodejs /app/node_modules ./node_modules

# Copy compiled workspace packages (dist + package.json for module resolution)
COPY --from=build --chown=apiuser:nodejs /app/packages/shared/dist         ./packages/shared/dist
COPY --from=build --chown=apiuser:nodejs /app/packages/shared/package.json ./packages/shared/
COPY --from=build --chown=apiuser:nodejs /app/packages/db/dist             ./packages/db/dist
COPY --from=build --chown=apiuser:nodejs /app/packages/db/package.json     ./packages/db/
COPY --from=build --chown=apiuser:nodejs /app/packages/ai/dist             ./packages/ai/dist
COPY --from=build --chown=apiuser:nodejs /app/packages/ai/package.json     ./packages/ai/
COPY --from=build --chown=apiuser:nodejs /app/packages/meta/dist           ./packages/meta/dist
COPY --from=build --chown=apiuser:nodejs /app/packages/meta/package.json   ./packages/meta/
COPY --from=build --chown=apiuser:nodejs /app/packages/pantheon/dist       ./packages/pantheon/dist
COPY --from=build --chown=apiuser:nodejs /app/packages/pantheon/package.json ./packages/pantheon/
COPY --from=build --chown=apiuser:nodejs /app/packages/payments/dist       ./packages/payments/dist
COPY --from=build --chown=apiuser:nodejs /app/packages/payments/package.json ./packages/payments/

# Copy app dist
COPY --from=build --chown=apiuser:nodejs /app/apps/api/dist         ./apps/api/dist
COPY --from=build --chown=apiuser:nodejs /app/apps/api/package.json ./apps/api/

USER apiuser
EXPOSE 3000
WORKDIR /app/apps/api

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
