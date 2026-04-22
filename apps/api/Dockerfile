FROM node:20-alpine AS base
RUN npm install -g pnpm
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY packages/ai/package.json ./packages/ai/
COPY packages/wati/package.json ./packages/wati/
COPY packages/payments/package.json ./packages/payments/
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/
RUN pnpm --filter @lynkbot/shared build
RUN pnpm --filter @lynkbot/db build
RUN pnpm --filter @lynkbot/ai build
RUN pnpm --filter @lynkbot/wati build
RUN pnpm --filter @lynkbot/payments build
RUN pnpm --filter @lynkbot/api build

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
EXPOSE 3000
CMD ["node", "dist/index.js"]
