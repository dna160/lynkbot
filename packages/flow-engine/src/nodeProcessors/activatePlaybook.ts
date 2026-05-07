/**
 * @CLAUDE_CONTEXT
 * Package : packages/flow-engine
 * File    : src/nodeProcessors/activatePlaybook.ts
 * Role    : ACTIVATE_PLAYBOOK node — terminal node that forces a specific AI Playbook
 *           for the buyer's next AI interaction after the flow completes.
 *           Sets conversations.playbookOverride so conversation.service.sendAiResponse
 *           uses the configured playbook's system prompt instead of auto-detecting intent.
 * Exports : activatePlaybookProcessor
 */
import { db, conversations, eq } from '@lynkbot/db';
import type { FlowNode, ExecutionContext, ActivatePlaybookConfig } from '../types';
import type { NodeResult, ProcessorDeps } from './types';

export async function activatePlaybookProcessor(
  node: FlowNode,
  ctx: ExecutionContext,
  _deps: ProcessorDeps,
): Promise<NodeResult> {
  const config = node.config as ActivatePlaybookConfig;
  const conversationId = ctx.trigger.conversationId;

  if (conversationId && config.intentKey) {
    try {
      await db.update(conversations)
        .set({ playbookOverride: config.intentKey } as any)
        .where(eq(conversations.id, conversationId));
    } catch (err) {
      console.warn('[activatePlaybook] Failed to set playbookOverride:', err);
    }
  }

  ctx.executionLog.push({
    nodeId: node.id,
    nodeType: node.type,
    timestamp: new Date().toISOString(),
    status: 'ok',
    meta: { conversationId, intentKey: config.intentKey },
  });

  return { status: 'completed' };
}
