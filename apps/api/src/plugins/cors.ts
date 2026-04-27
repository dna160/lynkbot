/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/plugins/cors.ts
 * Role    : CORS configuration Fastify plugin. Allows configured origins with
 *           credentials support. Tighter restrictions in production.
 * Exports : corsPlugin (Fastify plugin)
 * DO NOT  : Use wildcard origin in production
 */
import fp from 'fastify-plugin';
import fastifyCors from '@fastify/cors';
import type { FastifyPluginAsync } from 'fastify';
import { config } from '../config';

const LOCALHOST_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
];

const PROD_ORIGINS = [
  'https://app.lynkbot.id',
  'https://dashboard.lynkbot.id',
  'https://lynk.id',
];

// Pattern matching for Railway-generated domains (*.up.railway.app)
// and any custom domain set via CORS_ORIGIN env var
function isRailwayOrigin(origin: string): boolean {
  return origin.endsWith('.up.railway.app') || origin.endsWith('.railway.app');
}

const corsPluginImpl: FastifyPluginAsync = async (fastify) => {
  // Always allow localhost for local dev + staging. In production also allow prod domains.
  const extraOrigins = (config.CORS_ORIGIN ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const allowedOrigins = [
    ...LOCALHOST_ORIGINS,
    ...(config.NODE_ENV === 'production' ? PROD_ORIGINS : []),
    ...extraOrigins,
  ];

  await fastify.register(fastifyCors, {
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, server-to-server)
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.includes(origin) || isRailwayOrigin(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`), false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 86400, // 24 hours preflight cache
  });
};

export const corsPlugin = fp(corsPluginImpl, {
  name: 'cors',
  fastify: '4.x',
});
