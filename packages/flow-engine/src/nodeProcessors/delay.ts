/**
 * @CLAUDE_CONTEXT
 * Package : packages/flow-engine
 * File    : src/nodeProcessors/delay.ts
 * Role    : DELAY node — enqueues a delayed BullMQ job for resuming later.
 *           COMPLIANCE: Never sleep() in-process. Always use BullMQ delay.
 * Exports : delayProcessor
 */
import type { FlowNode, ExecutionContext, DelayConfig } from '../types';
import type { NodeResult, ProcessorDeps } from './types';

export async function delayProcessor(
  node: FlowNode,
  ctx: ExecutionContext,
  deps: ProcessorDeps,
): Promise<NodeResult> {
  const config = node.config as DelayConfig;
  const delayMs = typeof config.delayMs === 'number' ? config.delayMs : 3000;

  // Find the next node id by following edges from this node
  // The engine's executeNode will resume from current_node_id after the delay
  await deps.queue.add(
    'flow.resume_after_delay',
    {
      executionId: ctx.executionId,
      nodeId: node.id, // Resume from this node; engine follows edges
    },
    {
      delay: delayMs,
      jobId: `delay-${ctx.executionId}-${node.id}`,
    },
  );

  ctx.executionLog.push({
    nodeId: node.id,
    nodeType: node.type,
    timestamp: new Date().toISOString(),
    status: 'waiting',
    meta: { delayMs },
  });

  return { status: 'delayed' };
}
