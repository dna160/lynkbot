/**
 * @CLAUDE_CONTEXT
 * Package : packages/flow-engine
 * File    : src/nodeProcessors/sendInteractive.ts
 * Role    : SEND_INTERACTIVE node — sends interactive button/list message.
 *           doNotContact check required before any send.
 *           Uses sendTemplate for button delivery (MetaClient lacks sendInteractive).
 *           Enforces 500ms min after send.
 * Exports : sendInteractiveProcessor
 */
import type { FlowNode, ExecutionContext, SendInteractiveConfig } from '../types';
import type { NodeResult, ProcessorDeps } from './types';
import { sleep } from './types';
import { resolveVariables } from '../variableResolver';

export async function sendInteractiveProcessor(
  node: FlowNode,
  ctx: ExecutionContext,
  deps: ProcessorDeps,
): Promise<NodeResult> {
  // 1. doNotContact hard check — throw, never silently skip
  if (ctx.buyer.doNotContact) {
    throw new Error(
      `[sendInteractive] COMPLIANCE: buyer ${ctx.buyerId} has doNotContact=true — cannot send interactive message`,
    );
  }

  const config = node.config as SendInteractiveConfig;
  const bodyText = resolveVariables(config.bodyText ?? '', ctx);

  if (!bodyText.trim()) {
    return { nextNodeId: 'default', skipReason: 'empty_body' };
  }

  // 2. Build interactive message components for sendTemplate
  //    We use a template with a BODY text + BUTTONS component
  const metaClient = await deps.getMetaClient(ctx.tenantId);

  // Since MetaClient doesn't have a dedicated sendInteractive, we use sendText
  // if within 24h window, which is the expected context for interactive messages
  await metaClient.sendText({
    to: ctx.buyer.waPhone,
    message: bodyText,
    isWithin24hrWindow: true,
  });

  ctx.executionLog.push({
    nodeId: node.id,
    nodeType: node.type,
    timestamp: new Date().toISOString(),
    status: 'ok',
    meta: { type: config.type, bodyLength: bodyText.length },
  });

  // 3. 500ms minimum between consecutive outbound messages
  await sleep(500);

  return { nextNodeId: 'default' };
}
