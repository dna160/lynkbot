/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/services/flowEngine.singleton.ts
 * Role    : Module-level FlowEngine singleton for the API process.
 *           Shared across all services that need to trigger flow executions:
 *             - routes/webhooks/meta.ts  (button + keyword triggers)
 *             - services/payment.service.ts  (order event triggers)
 *           DO NOT create multiple FlowEngine instances — each instance opens
 *           its own Redis connection and queue workers.
 * Exports : flowEngineSingleton
 */
import Redis from 'ioredis';
import { FlowEngine } from '@lynkbot/flow-engine';
import { getTenantMetaClient } from './_meta.helper';
import { getRedisConnection } from '../config';

const redisConn = getRedisConnection();
const redisClient = new Redis(redisConn);

export const flowEngineSingleton = new FlowEngine({
  getMetaClient: getTenantMetaClient,
  redisClient,
  redisConnection: redisConn,
});
