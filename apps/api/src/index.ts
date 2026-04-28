/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/index.ts
 * Role    : Fastify server bootstrap. Registers all plugins and routes.
 *           Starts HTTP server on PORT env var.
 * Exports : nothing (entry point)
 * DO NOT  : Add business logic here — only server setup
 */
import Fastify from 'fastify';
import { config } from './config';
import { runMigrations } from './migrate';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Sentry: any = null;

// Plugins
import { corsPlugin } from './plugins/cors';
import { rateLimitPlugin } from './plugins/rateLimit';
import { authPlugin } from './plugins/auth';
import multipart from '@fastify/multipart';

// Webhook routes
import { metaWebhookRoutes } from './routes/webhooks/meta';
import { midtransWebhookRoutes } from './routes/webhooks/midtrans';
import { xenditWebhookRoutes } from './routes/webhooks/xendit';

// v1 routes
import { authRoutes } from './routes/v1/auth';
import { tenantRoutes } from './routes/v1/tenants';
import { productRoutes } from './routes/v1/products';
import { inventoryRoutes } from './routes/v1/inventory';
import { orderRoutes } from './routes/v1/orders';
import { conversationRoutes } from './routes/v1/conversations';
import { analyticsRoutes } from './routes/v1/analytics';
import { buyerRoutes } from './routes/v1/buyers';
import { broadcastRoutes } from './routes/v1/broadcasts';
import { aiRoutes } from './routes/v1/ai';
import { intelligenceRoutes } from './routes/v1/intelligence';

// Lazy-load Sentry only when DSN is configured
if (config.SENTRY_DSN) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Sentry = require('@sentry/node');
  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.NODE_ENV,
    tracesSampleRate: config.NODE_ENV === 'production' ? 0.1 : 1.0,
  });
}

const server = Fastify({
  logger: process.stdout.isTTY
    ? { level: config.LOG_LEVEL, transport: { target: 'pino-pretty', options: { colorize: true } } }
    : { level: config.LOG_LEVEL },
  trustProxy: true,
  // Body size limit: 10MB for product PDF uploads
  bodyLimit: 10 * 1024 * 1024,
});

async function bootstrap(): Promise<void> {
  // --- Run DB migrations before accepting traffic ---
  await runMigrations();

  // --- Core plugins ---
  await server.register(corsPlugin);
  await server.register(rateLimitPlugin);
  await server.register(authPlugin);
  // Multipart needed for file uploads (buyers CSV/XLSX import)
  await server.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } }); // 50 MB for PDFs

  // --- Health check (no auth, no rate limit) ---
  server.get('/health', async (_request, _reply) => {
    return {
      status: 'ok',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      env: config.NODE_ENV,
    };
  });

  // --- Webhook routes (signature verification applied per-route) ---
  await server.register(metaWebhookRoutes);
  await server.register(midtransWebhookRoutes);
  await server.register(xenditWebhookRoutes);

  // --- v1 API routes (prefixed with /api so full paths are /api/v1/...) ---
  await server.register(authRoutes, { prefix: '/api' });
  await server.register(tenantRoutes, { prefix: '/api' });
  await server.register(productRoutes, { prefix: '/api' });
  await server.register(inventoryRoutes, { prefix: '/api' });
  await server.register(orderRoutes, { prefix: '/api' });
  await server.register(conversationRoutes, { prefix: '/api' });
  await server.register(analyticsRoutes, { prefix: '/api' });
  await server.register(buyerRoutes, { prefix: '/api' });
  await server.register(broadcastRoutes, { prefix: '/api' });
  await server.register(aiRoutes, { prefix: '/api' });
  await server.register(intelligenceRoutes, { prefix: '/api' });

  // --- Sentry error handler ---
  server.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'Unhandled error');
    if (config.SENTRY_DSN) {
      Sentry.captureException(error, {
        extra: {
          url: request.url,
          method: request.method,
          tenantId: (request as any).user?.tenantId,
        },
      });
    }
    const statusCode = error.statusCode ?? 500;
    return reply.status(statusCode).send({
      error: error.message ?? 'Internal server error',
      statusCode,
    });
  });

  // --- Start listening ---
  await server.listen({ port: config.PORT, host: '0.0.0.0' });
  server.log.info(`LynkBot API listening on port ${config.PORT}`);
}

// --- Graceful shutdown ---
async function shutdown(signal: string): Promise<void> {
  server.log.info(`Received ${signal} — shutting down gracefully`);
  try {
    await server.close();
    server.log.info('Server closed');
    process.exit(0);
  } catch (err) {
    server.log.error({ err }, 'Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

bootstrap().catch(err => {
  console.error('Failed to start server:', err);
  if (config.SENTRY_DSN) {
    Sentry.captureException(err);
  }
  process.exit(1);
});
