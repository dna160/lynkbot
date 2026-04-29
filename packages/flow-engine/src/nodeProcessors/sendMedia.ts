/**
 * @CLAUDE_CONTEXT
 * Package : packages/flow-engine
 * File    : src/nodeProcessors/sendMedia.ts
 * Role    : SEND_MEDIA node — stub implementation.
 *           Media sending not yet implemented — logs and passes through.
 * Exports : sendMediaProcessor
 */
import type { FlowNode, ExecutionContext } from '../types';
import type { NodeResult, ProcessorDeps } from './types';

export async function sendMediaProcessor(
  node: FlowNode,
  ctx: ExecutionContext,
  _deps: ProcessorDeps,
): Promise<NodeResult> {
  console.log(`[SEND_MEDIA] Not yet implemented — node ${node.id} for execution ${ctx.executionId}`);

  ctx.executionLog.push({
    nodeId: node.id,
    nodeType: node.type,
    timestamp: new Date().toISOString(),
    status: 'skipped',
    skipReason: 'not_implemented',
  });

  return { nextNodeId: 'default' };
}
