/**
 * @CLAUDE_CONTEXT
 * Package : packages/flow-engine
 * File    : src/nodeProcessors/updateBuyer.ts
 * Role    : UPDATE_BUYER node — updates allowed buyer fields (displayName, notes, preferredLanguage).
 *           Resolves variables in value before setting.
 * Exports : updateBuyerProcessor
 */
import { db, buyers, eq } from '@lynkbot/db';
import type { FlowNode, ExecutionContext, UpdateBuyerConfig } from '../types';
import type { NodeResult, ProcessorDeps } from './types';
import { resolveVariables } from '../variableResolver';

const ALLOWED_FIELDS = ['displayName', 'notes', 'preferredLanguage'] as const;
type AllowedField = typeof ALLOWED_FIELDS[number];

export async function updateBuyerProcessor(
  node: FlowNode,
  ctx: ExecutionContext,
  _deps: ProcessorDeps,
): Promise<NodeResult> {
  const config = node.config as UpdateBuyerConfig;
  const { field, value } = config;

  if (!field || !ALLOWED_FIELDS.includes(field as AllowedField)) {
    return { nextNodeId: 'default', skipReason: `invalid_field:${field}` };
  }

  const resolvedValue = resolveVariables(value ?? '', ctx);

  const updatePayload: Partial<Record<AllowedField, string>> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };
  updatePayload[field as AllowedField] = resolvedValue;

  await db
    .update(buyers)
    .set(updatePayload)
    .where(eq(buyers.id, ctx.buyerId));

  // Update local context
  if (field === 'displayName') ctx.buyer.displayName = resolvedValue;
  if (field === 'notes') ctx.buyer.notes = resolvedValue;
  if (field === 'preferredLanguage') ctx.buyer.preferredLanguage = resolvedValue;

  ctx.executionLog.push({
    nodeId: node.id,
    nodeType: node.type,
    timestamp: new Date().toISOString(),
    status: 'ok',
    meta: { field, resolvedValue },
  });

  return { nextNodeId: 'default' };
}
