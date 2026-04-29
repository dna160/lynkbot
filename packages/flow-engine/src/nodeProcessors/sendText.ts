/**
 * @CLAUDE_CONTEXT
 * Package : packages/flow-engine
 * File    : src/nodeProcessors/sendText.ts
 * Role    : SEND_TEXT node — freeform text (24h session window ONLY).
 *           Throws if buyer has doNotContact=true (compliance violation).
 *           MetaClient.sendText() itself throws if outside 24h window — do NOT catch.
 *           Enforces 500ms min after send.
 * Exports : sendTextProcessor
 */
import type { FlowNode, ExecutionContext, SendTextConfig } from '../types';
import type { NodeResult, ProcessorDeps } from './types';
import { sleep } from './types';
import { resolveVariables } from '../variableResolver';

export async function sendTextProcessor(
  node: FlowNode,
  ctx: ExecutionContext,
  deps: ProcessorDeps,
): Promise<NodeResult> {
  // 1. doNotContact hard check — throw, never silently skip
  if (ctx.buyer.doNotContact) {
    throw new Error(
      `[sendText] COMPLIANCE: buyer ${ctx.buyerId} has doNotContact=true — cannot send freeform text`,
    );
  }

  const config = node.config as SendTextConfig;
  const message = resolveVariables(config.message ?? '', ctx);

  if (!message.trim()) {
    return { nextNodeId: 'default', skipReason: 'empty_message' };
  }

  // 2. Send — MetaClient.sendText() will throw if outside 24h window.
  //    Do NOT catch this — the error is a compliance violation and must propagate.
  const metaClient = await deps.getMetaClient(ctx.tenantId);
  await metaClient.sendText({
    to: ctx.buyer.waPhone,
    message,
    isWithin24hrWindow: true, // Caller context guarantees this is a reply within 24h
  });

  ctx.executionLog.push({
    nodeId: node.id,
    nodeType: node.type,
    timestamp: new Date().toISOString(),
    status: 'ok',
  });

  // 3. 500ms minimum between consecutive outbound messages
  await sleep(500);

  return { nextNodeId: 'default' };
}
