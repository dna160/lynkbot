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
import { FlowEngine } from '@lynkbot/flow-engine';
import { getTenantMetaClient } from './_meta.helper';
import { redisConnection, makeRedisClient } from './redis';

const redisClient = makeRedisClient();

export const workerFlowEngine = new FlowEngine({
  getMetaClient: getTenantMetaClient,
  redisClient,
  redisConnection,
});
