/**
 * @CLAUDE_CONTEXT
 * Package : packages/flow-engine
 * File    : src/nodeProcessors/segmentQualityGate.ts
 * Role    : SEGMENT_QUALITY_GATE node — checks buyer quality criteria.
 *           PRD §17: Required on all broadcast-triggered flows.
 *           Fails → 'excluded' port with 'quality_gate_failed' skipReason.
 * Exports : segmentQualityGateProcessor
 */
import { db, conversations, messages, eq, and, count } from '@lynkbot/db';
import type { FlowNode, ExecutionContext } from '../types';
import type { NodeResult, ProcessorDeps } from './types';

export async function segmentQualityGateProcessor(
  node: FlowNode,
  ctx: ExecutionContext,
  _deps: ProcessorDeps,
): Promise<NodeResult> {
  // Hard compliance check — doNotContact always blocks
  if (ctx.buyer.doNotContact) {
    ctx.executionLog.push({
      nodeId: node.id,
      nodeType: node.type,
      timestamp: new Date().toISOString(),
      status: 'skipped',
      skipReason: 'quality_gate_failed:do_not_contact',
    });
    return { nextNodeId: 'excluded', skipReason: 'quality_gate_failed' };
  }

  // Gate 1: buyer.totalOrders > 0 OR has inbound message history
  const hasOrders = ctx.buyer.totalOrders > 0;

  let hasInboundHistory = false;
  if (!hasOrders) {
    // Check conversations table for at least 1 inbound message
    const convRows = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.tenantId, ctx.tenantId),
          eq(conversations.buyerId, ctx.buyerId),
        ),
      )
      .limit(1);

    if (convRows.length > 0) {
      const inboundCount = await db
        .select({ cnt: count() })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, convRows[0].id),
            eq(messages.direction, 'inbound'),
          ),
        );
      hasInboundHistory = (inboundCount[0]?.cnt ?? 0) > 0;
    }
  }

  const passes = hasOrders || hasInboundHistory;

  ctx.executionLog.push({
    nodeId: node.id,
    nodeType: node.type,
    timestamp: new Date().toISOString(),
    status: passes ? 'ok' : 'skipped',
    skipReason: passes ? undefined : 'quality_gate_failed',
    meta: { hasOrders, hasInboundHistory, passes },
  });

  if (!passes) {
    return { nextNodeId: 'excluded', skipReason: 'quality_gate_failed' };
  }

  return { nextNodeId: 'default' };
}
