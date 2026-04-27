# @CLAUDE_CONTEXT
# Package : apps/dashboard
# File    : Dockerfile
# Role    : Multi-stage Docker build for LynkBot React dashboard.
#           Stage 1 : deps    — install node_modules (dashboard only)
#           Stage 2 : builder — vite build → static files in dist/
#           Stage 3 : runner  — nginx serves static files on port 80
#
# RAILWAY SETUP — set this as a Build Variable in the Railway lynkbot-dashboard service:
#   VITE_API_URL = https://<your-api-public-domain>
#   Find your API public domain: Railway → lynkbot-api service → Settings → Networking → Public Domain
#   Example: https://lynkbot-api-production.up.railway.app
#
# Vite bakes VITE_* env vars into the JS bundle at BUILD TIME, so it must be a Build Variable
# (not a regular Railway env var, which is only available at runtime).

ARG VITE_API_URL=""

# ---- Stage 1: Deps ----
FROM node:20-alpine AS deps
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY pnpm-lock.yaml ./
COPY apps/dashboard/package.json ./apps/dashboard/

# Install only dashboard deps (workspace filter skips all other packages)
RUN pnpm install --frozen-lockfile --filter @lynkbot/dashboard

# ---- Stage 2: Builder ----
FROM node:20-alpine AS builder
WORKDIR /app

# Re-declare ARG so the value flows into this stage
ARG VITE_API_URL=""
# Set as ENV so the vite build process sees it
ENV VITE_API_URL=$VITE_API_URL

COPY --from=deps /app/node_modules              ./node_modules
COPY --from=deps /app/apps/dashboard/node_modules ./apps/dashboard/node_modules

COPY apps/dashboard ./apps/dashboard

WORKDIR /app/apps/dashboard
# Use vite directly (skip tsc typecheck to avoid tsconfig reference issues in Docker)
RUN node_modules/.bin/vite build

# ---- Stage 3: Runner (nginx) ----
FROM nginx:1.27-alpine AS runner

COPY --from=builder /app/apps/dashboard/dist /usr/share/nginx/html

# Remove the default nginx config so only ours is loaded
RUN rm -f /etc/nginx/conf.d/default.conf

# Write config with __PORT__ as a plain-text placeholder.
# sed replaces it at runtime — no envsubst, no $ ambiguity with nginx variables.
RUN printf 'server {\n\
    listen __PORT__;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
    gzip on;\n\
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;\n\
    location / {\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
    location ~* \\.(?:js|css|woff2?|png|jpg|svg|ico)$ {\n\
        expires 1y;\n\
        add_header Cache-Control "public, immutable";\n\
    }\n\
}\n' > /tmp/nginx.conf.template

ENV PORT=80
EXPOSE 80

# At startup: substitute __PORT__ with $PORT then launch nginx
CMD ["/bin/sh", "-c", "sed \"s/__PORT__/${PORT}/g\" /tmp/nginx.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
