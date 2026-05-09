/**
 * @CLAUDE_CONTEXT
 * Package : packages/flow-engine
 * File    : src/nodeProcessors/notifyStaff.ts
 * Role    : NOTIFY_STAFF node — sends a WhatsApp text to a specific staff member.
 *           Looks up the staff member by staffId, renders the message template with
 *           buyer variables, sends via MetaClient, then continues to the next node.
 *           Failures are logged but do NOT stop the flow (fire-and-forget semantics).
 * Exports : notifyStaffProcessor
 */
import { db, staff, eq, and } from '@lynkbot/db';
import type { FlowNode, ExecutionContext, NotifyStaffConfig } from '../types';
import type { NodeResult, ProcessorDeps } from './types';
import { resolveVariables } from '../variableResolver';

export async function notifyStaffProcessor(
  node: FlowNode,
  ctx: ExecutionContext,
  deps: ProcessorDeps,
): Promise<NodeResult> {
  const config = node.config as NotifyStaffConfig;

  if (!config.staffId || !config.message?.trim()) {
    ctx.executionLog.push({
      nodeId: node.id, nodeType: node.type, timestamp: new Date().toISOString(),
      status: 'skipped', skipReason: 'missing_staff_or_message',
    });
    return { nextNodeId: 'default' };
  }

  const staffRow = await db.query.staff.findFirst({
    where: and(eq(staff.id, config.staffId), eq(staff.tenantId, ctx.tenantId), eq(staff.isActive, true)),
  });

  if (!staffRow) {
    ctx.executionLog.push({
      nodeId: node.id, nodeType: node.type, timestamp: new Date().toISOString(),
      status: 'skipped', skipReason: `staff_not_found:${config.staffId}`,
    });
    return { nextNodeId: 'default' };
  }

  const message = resolveVariables(config.message, ctx);

  const meta = await deps.getMetaClient(ctx.tenantId);
  await meta.sendText({ to: staffRow.phoneNumber, message, isWithin24hrWindow: true }).catch((err: unknown) => {
    ctx.executionLog.push({
      nodeId: node.id, nodeType: node.type, timestamp: new Date().toISOString(),
      status: 'error', error: String(err),
    });
  });

  ctx.executionLog.push({
    nodeId: node.id, nodeType: node.type, timestamp: new Date().toISOString(),
    status: 'ok', meta: { staffId: config.staffId, staffName: staffRow.name },
  });

  return { nextNodeId: 'default' };
}
