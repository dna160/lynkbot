/**
 * @CLAUDE_CONTEXT
 * Package : packages/flow-engine
 * File    : src/nodeProcessors/rateLimit.ts
 * Role    : RATE_LIMIT node — checks Redis counter ratelimit:waba:{wabaId}:marketing:{YYYY-MM-DD-HH}.
 *           Max 1000 marketing templates per WABA per hour.
 *           If >= 1000: skip with 'rate_limit_reached'. Otherwise increment (TTL 2h).
 * Exports : rateLimitProcessor
 */
import type { FlowNode, ExecutionContext } from '../types';
import type { NodeResult, ProcessorDeps } from './types';

export async function rateLimitProcessor(
  node: FlowNode,
  ctx: ExecutionContext,
  deps: ProcessorDeps,
): Promise<NodeResult> {
  const wabaId = ctx.wabaId ?? ctx.tenantId; // Fallback to tenantId if wabaId not set

  // Build Redis key: ratelimit:waba:{wabaId}:marketing:{YYYY-MM-DD-HH}
  const now = new Date();
  const dateHour = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    String(now.getUTCHours()).padStart(2, '0'),
  ].join('-');
  const redisKey = `ratelimit:waba:${wabaId}:marketing:${dateHour}`;

  const MAX_PER_HOUR = 1000;

  // Check current count
  const currentStr = await deps.redisClient.get(redisKey);
  const current = currentStr ? parseInt(currentStr, 10) : 0;

  if (current >= MAX_PER_HOUR) {
    ctx.executionLog.push({
      nodeId: node.id,
      nodeType: node.type,
      timestamp: new Date().toISOString(),
      status: 'skipped',
      skipReason: 'rate_limit_reached',
      meta: { current, maxPerHour: MAX_PER_HOUR, redisKey },
    });
    return { nextNodeId: 'default', skipReason: 'rate_limit_reached' };
  }

  // Increment counter with 2-hour TTL
  await deps.redisClient.incr(redisKey);
  await deps.redisClient.expire(redisKey, 2 * 60 * 60);

  ctx.executionLog.push({
    nodeId: node.id,
    nodeType: node.type,
    timestamp: new Date().toISOString(),
    status: 'ok',
    meta: { current: current + 1, maxPerHour: MAX_PER_HOUR },
  });

  return { nextNodeId: 'default' };
}
