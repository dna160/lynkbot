/**
 * @CLAUDE_CONTEXT
 * Package : packages/flow-engine
 * File    : src/nodeProcessors/startScheduling.ts
 * Role    : START_SCHEDULING node — terminal handoff to the scheduling system.
 *           1. Optionally sends an intro message to the buyer.
 *           2. Transitions conversation.state → 'SCHEDULING'.
 *           3. Stores { type: 'staff', staffId, confirmationModel? } as JSONB in
 *              conversation.playbookOverride (migration 0030). The scheduling handler
 *              in api/worker reads this to route confirmations and respect the model.
 *           4. Returns status: 'completed' — flow execution ends here.
 * Exports : startSchedulingProcessor
 */
import { db, conversations, eq, and } from '@lynkbot/db';
import type { PlaybookOverrideData } from '@lynkbot/db';
import type { FlowNode, ExecutionContext, StartSchedulingConfig } from '../types';
import type { NodeResult, ProcessorDeps } from './types';
import { saveOutboundMessage } from '../saveOutboundMessage';

export async function startSchedulingProcessor(
  node: FlowNode,
  ctx: ExecutionContext,
  deps: ProcessorDeps,
): Promise<NodeResult> {
  const config = node.config as StartSchedulingConfig;

  // Send optional intro message before handing off
  if (config.introMessage?.trim() && ctx.buyer.waPhone) {
    try {
      const meta = await deps.getMetaClient(ctx.tenantId);
      await meta.sendText({ to: ctx.buyer.waPhone, message: config.introMessage, isWithin24hrWindow: true });
      saveOutboundMessage(ctx.tenantId, ctx.buyerId, config.introMessage, 'text').catch(() => null);
    } catch (err) {
      console.warn('[startScheduling] Failed to send intro message:', err);
    }
  }

  // Prefer conversationId from trigger context; fall back to querying by tenantId+buyerId.
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
      console.warn('[startScheduling] Failed to resolve conversationId:', err);
    }
  }

  // Transition conversation state → SCHEDULING and store assigned staff, service,
  // and confirmation model in playbookOverride JSONB so the scheduling handler can
  // read all three. Override is written even when only serviceId or confirmationModel
  // is set (no explicit staffId required).
  if (conversationId) {
    try {
      const patch: Record<string, unknown> = { state: 'SCHEDULING' };

      if (config.assignedStaffId || config.serviceId || config.confirmationModel) {
        const override: PlaybookOverrideData = {
          type: 'staff',
          ...(config.assignedStaffId ? { staffId: config.assignedStaffId } : {}),
          ...(config.confirmationModel ? { confirmationModel: config.confirmationModel } : {}),
          ...(config.serviceId ? { serviceId: config.serviceId } : {}),
        };
        patch.playbookOverride = override;
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
      confirmationModel: config.confirmationModel,
    },
  });

  return { status: 'completed' };
}
