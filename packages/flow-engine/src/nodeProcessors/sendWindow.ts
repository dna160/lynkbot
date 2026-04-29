/**
 * @CLAUDE_CONTEXT
 * Package : packages/flow-engine
 * File    : src/nodeProcessors/sendWindow.ts
 * Role    : SEND_WINDOW node — time-of-day gate (Jakarta time, UTC+7).
 *           If current time is outside [startHour, endHour), routes to 'outside' port.
 * Exports : sendWindowProcessor
 */
import type { FlowNode, ExecutionContext, SendWindowConfig } from '../types';
import type { NodeResult, ProcessorDeps } from './types';

const JAKARTA_OFFSET_HOURS = 7;

export async function sendWindowProcessor(
  node: FlowNode,
  ctx: ExecutionContext,
  _deps: ProcessorDeps,
): Promise<NodeResult> {
  const config = node.config as SendWindowConfig;
  const { startHour, endHour } = config;

  if (startHour === undefined || endHour === undefined) {
    // No window configured — pass through
    return { nextNodeId: 'default' };
  }

  // Convert UTC now to Jakarta time (UTC+7)
  const nowUtcMs = Date.now();
  const jakartaMs = nowUtcMs + JAKARTA_OFFSET_HOURS * 60 * 60 * 1000;
  const jakartaDate = new Date(jakartaMs);
  const jakartaHour = jakartaDate.getUTCHours();

  const isInWindow = jakartaHour >= startHour && jakartaHour < endHour;

  ctx.executionLog.push({
    nodeId: node.id,
    nodeType: node.type,
    timestamp: new Date().toISOString(),
    status: isInWindow ? 'ok' : 'skipped',
    skipReason: isInWindow ? undefined : 'outside_send_window',
    meta: { jakartaHour, startHour, endHour, isInWindow },
  });

  if (!isInWindow) {
    return { nextNodeId: 'outside', skipReason: 'outside_send_window' };
  }

  return { nextNodeId: 'default' };
}
