/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/config.ts
 * Role    : Environment variable validation and typed config object.
 *           Fails fast at startup if required vars are missing.
 * Exports : config object with all validated env vars
 * DO NOT  : Access process.env directly elsewhere — always import from here
 */
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3000').transform(Number),
  WORKER_CONCURRENCY: z.string().default('5').transform(Number),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string(),
  JWT_SECRET: z.string().min(32),
  LYNK_INTERNAL_API_KEY: z.string().min(10),
  XAI_API_KEY: z.string().min(1),
  XAI_BASE_URL: z.string().url().default('https://api.x.ai/v1'),
  LLM_MODEL: z.string().default('grok-4-1-fast-reasoning'),
  LLM_PROVIDER: z.string().default('xai'),
  LLM_FALLBACK_MODEL: z.string().default('grok-3'),
  XAI_EMBEDDING_MODEL: z.string().default('v1'),
  // ── Meta WhatsApp Cloud API ──────────────────────────────────────────────────
  // System User Access Token from Meta Business Manager
  META_ACCESS_TOKEN: z.string().default(''),
  // Phone Number ID for +6281947888808 (found in Meta App Dashboard → WhatsApp → API Setup)
  META_PHONE_NUMBER_ID: z.string().default(''),
  // WhatsApp Business Account ID
  META_WABA_ID: z.string().default(''),
  // App Secret from Meta App Dashboard → Settings → Basic (used for HMAC webhook verification)
  META_APP_SECRET: z.string().default(''),
  // Any string you choose — must match what you enter in Meta Developer Console webhook config
  META_WEBHOOK_VERIFY_TOKEN: z.string().default('lynkbot_webhook_verify'),
  // Graph API version — pin to avoid unexpected breaking changes
  META_API_VERSION: z.string().default('v23.0'),
  PAYMENT_PROVIDER: z.enum(['midtrans', 'xendit']).default('midtrans'),
  MIDTRANS_SERVER_KEY: z.string().optional(),
  MIDTRANS_CLIENT_KEY: z.string().optional(),
  MIDTRANS_IS_PRODUCTION: z.string().default('false').transform(v => v === 'true'),
  XENDIT_SECRET_KEY: z.string().optional(),
  XENDIT_WEBHOOK_TOKEN: z.string().optional(),
  RAJAONGKIR_API_KEY: z.string().default(''),
  RAJAONGKIR_BASE_URL: z.string().url().default('https://pro.rajaongkir.com/api'),
  GOOGLE_MAPS_API_KEY: z.string().default(''),
  S3_BUCKET: z.string().default(''),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  S3_ENDPOINT: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  CORS_ORIGIN: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  // ── Apify (external OSINT — LinkedIn + Instagram scraping) ──────────────────
  // Optional. If not set, external profile scraping is skipped gracefully.
  APIFY_API_KEY: z.string().default(''),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;

/**
 * Parse REDIS_URL into ioredis-compatible { host, port, password } object.
 * BullMQ passes `connection` directly to ioredis — it does NOT accept { url: '...' }.
 * Use this everywhere a BullMQ Queue or Worker is instantiated.
 */
export function getRedisConnection() {
  const url = new URL(config.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    password: url.password || undefined,
    tls: url.protocol === 'rediss:' ? {} : undefined,
  };
}
