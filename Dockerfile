# @CLAUDE_CONTEXT
# File    : Dockerfile (repo root)
# Role    : Unified Docker build for LynkBot API and Worker.
#
# SERVICE build arg selects which app to build:
#   api    (default) — Fastify HTTP server, port 3000
#   worker           — BullMQ background processor, no HTTP port
#
# Railway setup:
#   lynkbot-api    → no config needed (SERVICE=api is the default)
#   lynkbot-worker → set Build Variable: SERVICE=worker
#   Dashboard uses apps/dashboard/Dockerfile via infra/dashboard.railway.toml
#
# Local test:
#   docker build .                              # builds api
#   docker build --build-arg SERVICE=worker .   # builds worker

ARG SERVICE=api

# ─── Shared base ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS alpine
RUN apk update && apk add --no-cache libc6-compat dumb-init
RUN npm install -g turbo@2 \
    && corepack enable \
    && corepack prepare pnpm@9 --activate

# ─── Stage 1: Pruner ─────────────────────────────────────────────────────────
# turbo prune extracts only the packages @lynkbot/$SERVICE needs, with a
# trimmed pnpm-lock.yaml — this is what makes the build fast and reliable.
FROM alpine AS pruner
ARG SERVICE
WORKDIR /app
COPY . .
RUN turbo prune @lynkbot/${SERVICE} --docker

# ─── Stage 2: Builder ────────────────────────────────────────────────────────
# Install pruned deps then compile — ALL in ONE stage so pnpm workspace
# symlinks are valid (they can't survive a cross-stage COPY).
FROM alpine AS builder
ARG SERVICE
WORKDIR /app

# Layer A — deps (cached until any package.json changes)
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile

# Layer B — compile (turbo resolves dep order automatically)
COPY --from=pruner /app/out/full/ .
COPY --from=pruner /app/tsconfig.base.json ./tsconfig.base.json
RUN turbo run build --filter=@lynkbot/${SERVICE}...

# ─── Stage 3: Runner ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
ARG SERVICE
RUN apk add --no-cache dumb-init
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 appuser

# Workspace node_modules — contains pnpm virtual store + workspace symlinks.
# Symlinks resolve to packages/${pkg} which we copy below.
COPY --from=builder --chown=appuser:nodejs /app/node_modules ./node_modules

# Compiled workspace packages. turbo prune means only $SERVICE's deps are here.
COPY --from=builder --chown=appuser:nodejs /app/packages ./packages

# App dist
COPY --from=builder --chown=appuser:nodejs /app/apps/${SERVICE}/dist      ./apps/${SERVICE}/dist
COPY --from=builder --chown=appuser:nodejs /app/apps/${SERVICE}/package.json ./apps/${SERVICE}/

USER appuser
EXPOSE 3000
WORKDIR /app/apps/${SERVICE}
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
