/**
 * @CLAUDE_CONTEXT
 * Package : packages/flow-engine
 * File    : src/nodeProcessors/endFlow.ts
 * Role    : END_FLOW node — marks execution completed.
 *           Updates flow_executions and decrements buyers.active_flow_count.
 *           The actual DB updates happen in engine.ts based on returned status.
 * Exports : endFlowProcessor
 */
import type { FlowNode, ExecutionContext, EndFlowConfig } from '../types';
import type { NodeResult, ProcessorDeps } from './types';

export async function endFlowProcessor(
  node: FlowNode,
  ctx: ExecutionContext,
  _deps: ProcessorDeps,
): Promise<NodeResult> {
  const config = node.config as EndFlowConfig;
  const reason = config.reason ?? 'flow_completed';

  ctx.executionLog.push({
    nodeId: node.id,
    nodeType: node.type,
    timestamp: new Date().toISOString(),
    status: 'ok',
    meta: { reason },
  });

  // The engine will update flow_executions.status='completed' and decrement buyers.active_flow_count
  return { status: 'completed' };
}
