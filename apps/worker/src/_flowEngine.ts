/**
 * @CLAUDE_CONTEXT
 * Package : apps/worker
 * File    : src/_flowEngine.ts
 * Role    : Module-level FlowEngine singleton for the worker process.
 *           Shared across all BullMQ processors that need to fire order-event
 *           flow executions (paymentExpiry, tracking). The webhookMessage
 *           processor creates its own instance inline — do NOT replace that one.
 *           Mirrors apps/api/src/services/flowEngine.singleton.ts but
 *           standalone so the worker has no import dependency on apps/api.
 * Exports : workerFlowEngine
 */
import Redis from 'ioredis';
import { FlowEngine } from '@lynkbot/flow-engine';
import { getTenantMetaClient } from './_meta.helper';

function getRedisConnection() {
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD,
  };
}

const redisConn = getRedisConnection();
const redisClient = new Redis(redisConn);

export const workerFlowEngine = new FlowEngine({
  getMetaClient: getTenantMetaClient,
  redisClient,
  redisConnection: redisConn,
});
