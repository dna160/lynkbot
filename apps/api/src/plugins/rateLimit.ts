/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/plugins/rateLimit.ts
 * Role    : Rate limiting via @fastify/rate-limit. Strict limits on webhook
 *           endpoints (100/min). Relaxed on general API routes (1000/min).
 *           Uses Redis as store in production for distributed limiting.
 * Exports : rateLimitPlugin (Fastify plugin)
 * DO NOT  : Apply to /health endpoint
 */
import fp from 'fastify-plugin';
import fastifyRateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';
import { config } from '../config';

// eslint-disable-next-line @typescript-eslint/no-var-requires
function makeRedis(url: string, opts: object) { const { Redis } = require('ioredis'); return new Redis(url, opts); }

const rateLimitPluginImpl: FastifyPluginAsync = async (fastify) => {
  // Connect to Redis for distributed rate limiting
  const redis = makeRedis(config.REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    enableOfflineQueue: false,
  });

  redis.on('error', (err: Error) => {
    fastify.log.warn({ err }, 'Redis rate-limit connection error — falling back to memory store');
  });

  try {
    await redis.connect();
  } catch {
    fastify.log.warn('Redis unavailable — rate limiting will use in-memory store');
  }

  await fastify.register(fastifyRateLimit, {
    global: true,
    max: 1000,
    timeWindow: '1 minute',
    // Skip health check from rate limiting
    skip: (request: import('fastify').FastifyRequest) => request.url === '/health',
  } as Parameters<typeof fastifyRateLimit>[1]);

  // Override rate limit for webhook endpoints (stricter: 100/min per IP)
  fastify.addHook('onRoute', (routeOptions) => {
    if (routeOptions.url.startsWith('/webhooks/')) {
      routeOptions.config = {
        ...(routeOptions.config ?? {}),
        rateLimit: {
          max: 100,
          timeWindow: '1 minute',
          keyGenerator: (request: any) => `webhook:${request.ip}`,
        },
      };
    }
  });
};

export const rateLimitPlugin = fp(rateLimitPluginImpl, {
  name: 'rate-limit',
  fastify: '4.x',
});
