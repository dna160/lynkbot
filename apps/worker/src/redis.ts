/**
 * @CLAUDE_CONTEXT
 * Package : apps/worker
 * File    : src/redis.ts
 * Role    : Single source of truth for the ioredis connection config used by every
 *           BullMQ Worker, Queue, and direct Redis client in the worker process.
 *
 * Handles:
 *   - REDIS_URL        (preferred — Railway variable reference ${{Redis.REDIS_URL}})
 *   - REDIS_PRIVATE_URL (Railway internal-network alias, checked as fallback)
 *   - REDIS_HOST / REDIS_PORT / REDIS_PASSWORD (legacy individual vars)
 *   - rediss:// TLS URLs (Railway managed Redis uses TLS on the public endpoint)
 *
 * Logs the resolved host:port at startup (password masked) so connection issues
 * are immediately visible in Railway logs.
 *
 * Exports : redisConnection  — pass directly to BullMQ `connection:` options
 *           makeRedisClient  — creates a bare ioredis client with the same config
 */
import Redis from 'ioredis';

export interface RedisConnectionConfig {
  host: string;
  port: number;
  password?: string;
  tls?: object;
  username?: string;
}

function resolveRedisConnection(): RedisConnectionConfig {
  // Accept both REDIS_URL and REDIS_PRIVATE_URL (Railway exposes both)
  const rawUrl = process.env.REDIS_URL || process.env.REDIS_PRIVATE_URL;

  if (rawUrl && rawUrl.trim() !== '') {
    try {
      const url = new URL(rawUrl);
      const isTLS = url.protocol === 'rediss:';
      const conn: RedisConnectionConfig = {
        host: url.hostname,
        port: Number(url.port) || (isTLS ? 6380 : 6379),
        password: url.password ? decodeURIComponent(url.password) : undefined,
        username: url.username && url.username !== 'default' ? url.username : undefined,
        ...(isTLS && { tls: {} }),
      };

      const maskedPassword = conn.password ? `****` : '(none)';
      const tlsTag = isTLS ? ' [TLS]' : '';
      console.log(`[redis] Connecting to ${conn.host}:${conn.port}${tlsTag} password=${maskedPassword}`);
      return conn;
    } catch (err) {
      console.error(`[redis] Failed to parse REDIS_URL "${rawUrl.slice(0, 30)}…": ${(err as Error).message}`);
      console.error('[redis] Falling back to individual REDIS_HOST/PORT/PASSWORD vars');
    }
  } else {
    console.warn('[redis] REDIS_URL is not set — falling back to REDIS_HOST/PORT/PASSWORD vars');
  }

  const fallback: RedisConnectionConfig = {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD || undefined,
  };
  console.log(`[redis] Connecting to ${fallback.host}:${fallback.port} (fallback)`);
  return fallback;
}

/** Shared BullMQ connection config — pass as `connection:` to all Workers and Queues */
export const redisConnection: RedisConnectionConfig = resolveRedisConnection();

/** Create a bare ioredis client using the same resolved config */
export function makeRedisClient(): Redis {
  const client = new Redis(redisConnection);
  client.on('error', (err) => {
    // Suppress ioredis's default "Unhandled error event" crash — log instead
    console.error('[redis] ioredis error:', err.message);
  });
  return client;
}
