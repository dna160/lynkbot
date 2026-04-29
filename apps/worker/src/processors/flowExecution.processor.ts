/**
 * @CLAUDE_CONTEXT
 * Package : apps/worker
 * File    : src/processors/flowExecution.processor.ts
 * Role    : BullMQ processor for FLOW_EXECUTION queue.
 *           Handles all Flow Engine job types: execute_node, resume_after_delay,
 *           check_time_triggers, broadcast_segment.
 * Exports : flowExecutionProcessor, flowEngine
 */
import type { Processor } from 'bullmq';
import { createDecipheriv } from 'node:crypto';
import { FlowEngine } from '@lynkbot/flow-engine';
import { MetaClient } from '@lynkbot/meta';
import { db, tenants, eq } from '@lynkbot/db';
import Redis from 'ioredis';

// ── AES-256-GCM decrypt (co-located copy of apps/api/src/utils/crypto.ts decrypt) ──
// Worker cannot import from apps/api — inline the decrypt only.

const ALGORITHM = 'aes-256-gcm' as const;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

function decryptToken(bundled: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== KEY_BYTES) throw new Error(`decrypt: key must be ${KEY_BYTES} bytes`);
  const buf = Buffer.from(bundled, 'base64');
  if (buf.length < IV_BYTES + TAG_BYTES) throw new Error('decrypt: ciphertext too short');
  const iv = buf.subarray(0, IV_BYTES);
  const authTag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// ── Redis connection ──────────────────────────────────────────────────────────

function getRedisConnection() {
  if (process.env.REDIS_URL) {
    const url = new URL(process.env.REDIS_URL);
    return {
      host: url.hostname,
      port: Number(url.port) || 6379,
      password: url.password || undefined,
    };
  }
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD,
  };
}

// ── Per-tenant MetaClient ─────────────────────────────────────────────────────

async function getTenantMetaClientForWorker(tenantId: string): Promise<MetaClient> {
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { metaAccessToken: true, metaPhoneNumberId: true },
  });

  if (!tenant?.metaAccessToken || !tenant?.metaPhoneNumberId) {
    throw new Error(`Tenant ${tenantId} has no active WABA credentials`);
  }

  const encKey = process.env.WABA_POOL_ENCRYPTION_KEY ?? '';
  const accessToken = encKey
    ? decryptToken(tenant.metaAccessToken, encKey)
    : tenant.metaAccessToken;

  return MetaClient.fromTenant({
    metaAccessToken: accessToken,
    metaPhoneNumberId: tenant.metaPhoneNumberId,
  });
}

// ── FlowEngine singleton ──────────────────────────────────────────────────────

const redisConn = getRedisConnection();
const redisClient = new Redis(redisConn);

export const flowEngine = new FlowEngine({
  getMetaClient: getTenantMetaClientForWorker,
  redisClient,
  redisConnection: redisConn,
});

// ── Processor ─────────────────────────────────────────────────────────────────

export const flowExecutionProcessor: Processor = async (job) => {
  const { name, data } = job;

  if (name === 'flow.execute_node') {
    await flowEngine.executeNode(data.executionId as string, data.nodeId as string);
  } else if (name === 'flow.resume_after_delay') {
    await flowEngine.executeNode(data.executionId as string, data.nodeId as string);
  } else if (name === 'flow.check_time_triggers') {
    await flowEngine.evaluateTimeTriggers(data.tenantId as string | undefined);
  } else if (name === 'flow.broadcast_segment') {
    await flowEngine.broadcastToSegment(
      data.tenantId as string,
      data.flowId as string,
      data.segmentFilter as Record<string, unknown>,
    );
  } else {
    console.warn(`[flowExecutionProcessor] Unknown job name: ${name}`);
  }
};
