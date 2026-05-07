/**
 * @CLAUDE_CONTEXT
 * Package : packages/flow-engine
 * File    : src/nodeProcessors/startScheduling.ts
 * Role    : START_SCHEDULING node — terminal handoff to the scheduling system.
 *           1. Optionally sends an intro message to the buyer.
 *           2. Transitions conversation.state → 'SCHEDULING' so the next inbound
 *              message is handled by conversation.service.handleScheduling().
 *           3. Stores assignedStaffId in conversation.playbookOverride so the
 *              scheduling service routes confirmation to the configured staff.
 *           4. Returns status: 'completed' — flow execution ends here.
 * Exports : startSchedulingProcessor
 */
import { db, conversations, eq } from '@lynkbot/db';
import type { FlowNode, ExecutionContext, StartSchedulingConfig } from '../types';
import type { NodeResult, ProcessorDeps } from './types';

export async function startSchedulingProcessor(
  node: FlowNode,
  ctx: ExecutionContext,
  deps: ProcessorDeps,
): Promise<NodeResult> {
  const config = node.config as StartSchedulingConfig;
  const conversationId = ctx.trigger.conversationId;

  // Send optional intro message before handing off
  if (config.introMessage?.trim() && ctx.buyer.waPhone) {
    try {
      const meta = await deps.getMetaClient(ctx.tenantId);
      await meta.sendText({ to: ctx.buyer.waPhone, message: config.introMessage, isWithin24hrWindow: true });
    } catch (err) {
      console.warn('[startScheduling] Failed to send intro message:', err);
    }
  }

  // Transition conversation state → SCHEDULING and store the assigned staff
  if (conversationId) {
    try {
      const patch: Record<string, unknown> = { state: 'SCHEDULING' };
      // Store assignedStaffId so conversation.service passes it to handleLLMEnvelope
      if (config.assignedStaffId) {
        patch.playbookOverride = `staff:${config.assignedStaffId}`;
      }
      await db.update(conversations)
        .set(patch as any)
        .where(eq(conversations.id, conversationId));
    } catch (err) {
      console.warn('[startScheduling] Failed to transition conversation state:', err);
    }
  }

  ctx.executionLog.push({
    nodeId: node.id,
    nodeType: node.type,
    timestamp: new Date().toISOString(),
    status: 'ok',
    meta: {
      conversationId,
      consultationType: config.consultationType,
      assignedStaffId: config.assignedStaffId,
    },
  });

  return { status: 'completed' };
}
