# @CLAUDE_CONTEXT
# Package : apps/dashboard
# File    : Dockerfile
# Role    : Multi-stage Docker build for LynkBot React dashboard.
#           Stage 1 : deps    — install dependencies
#           Stage 2 : builder — vite build → static files in /app/dist
#           Stage 3 : runner  — nginx serves static files on port 80

FROM node:20-alpine AS deps
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# Workspace manifests (dashboard only imports @lynkbot/shared types — no build step needed)
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY pnpm-lock.yaml ./

COPY packages/shared/package.json   ./packages/shared/
COPY apps/dashboard/package.json    ./apps/dashboard/

RUN pnpm install --frozen-lockfile

# ---- Stage 2: Builder ----
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

COPY --from=deps /app/node_modules                   ./node_modules
COPY --from=deps /app/packages/shared/node_modules   ./packages/shared/node_modules
COPY --from=deps /app/apps/dashboard/node_modules    ./apps/dashboard/node_modules

# Copy shared types (dashboard imports from @lynkbot/shared types only — no compile needed)
COPY packages/shared ./packages/shared

# Copy dashboard source
COPY apps/dashboard ./apps/dashboard

# Build — tsc + vite produces apps/dashboard/dist/
WORKDIR /app/apps/dashboard
RUN pnpm run build

# ---- Stage 3: Runner (nginx) ----
FROM nginx:alpine AS runner

# Copy built assets
COPY --from=builder /app/apps/dashboard/dist /usr/share/nginx/html

# nginx config: SPA fallback (all routes → index.html)
RUN printf 'server {\n\
  listen 80;\n\
  root /usr/share/nginx/html;\n\
  index index.html;\n\
  location / {\n\
    try_files $uri $uri/ /index.html;\n\
  }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
