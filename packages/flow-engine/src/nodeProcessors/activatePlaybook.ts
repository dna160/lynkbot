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
import { db, conversations, eq, and } from '@lynkbot/db';
import type { PlaybookOverrideData } from '@lynkbot/db';
import type { FlowNode, ExecutionContext, ActivatePlaybookConfig } from '../types';
import type { NodeResult, ProcessorDeps } from './types';

export async function activatePlaybookProcessor(
  node: FlowNode,
  ctx: ExecutionContext,
  _deps: ProcessorDeps,
): Promise<NodeResult> {
  const config = node.config as ActivatePlaybookConfig;

  // Prefer conversationId from trigger context; fall back to querying by tenantId+buyerId.
  // The trigger context may not carry conversationId when a keyword flow fires without
  // an explicit conversation reference.
  let conversationId = ctx.trigger.conversationId;

  if (!conversationId) {
    try {
      const conv = await db.query.conversations.findFirst({
        where: and(
          eq(conversations.tenantId, ctx.tenantId),
          eq(conversations.buyerId, ctx.buyerId),
          eq(conversations.isActive, true),
        ),
        columns: { id: true },
      });
      conversationId = conv?.id;
    } catch (err) {
      console.warn('[activatePlaybook] Failed to resolve conversationId:', err);
    }
  }

  if (conversationId && config.intentKey) {
    try {
      const override: PlaybookOverrideData = { type: 'playbook', intentKey: config.intentKey };
      await db.update(conversations)
        .set({ playbookOverride: override } as any)
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
