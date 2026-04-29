/**
 * @CLAUDE_CONTEXT
 * Package : packages/flow-engine
 * File    : src/nodeProcessors/waitForReply.ts
 * Role    : WAIT_FOR_REPLY node — pauses flow until the buyer sends a reply.
 *           Sets execution status to 'waiting_reply'.
 *           The webhook handler resumes execution via FlowEngine.resumeExecution().
 * Exports : waitForReplyProcessor
 */
import type { FlowNode, ExecutionContext } from '../types';
import type { NodeResult, ProcessorDeps } from './types';

export async function waitForReplyProcessor(
  node: FlowNode,
  ctx: ExecutionContext,
  _deps: ProcessorDeps,
): Promise<NodeResult> {
  ctx.executionLog.push({
    nodeId: node.id,
    nodeType: node.type,
    timestamp: new Date().toISOString(),
    status: 'waiting',
    meta: { waitingForBuyerReply: true },
  });

  // The engine will update flow_executions.status = 'waiting_reply' based on this result
  // and set current_node_id to this node so resumeExecution knows where to follow edges from
  return { status: 'waiting_reply' };
}
