/**
 * @CLAUDE_CONTEXT
 * Package : packages/flow-engine
 * File    : src/nodeProcessors/ifCondition.ts
 * Role    : IF_CONDITION node — evaluates a ConditionGroup and routes to 'true' or 'false' port.
 * Exports : ifConditionProcessor
 */
import type { FlowNode, ExecutionContext, IfConditionConfig } from '../types';
import type { NodeResult, ProcessorDeps } from './types';
import { evaluateConditionGroup } from '../conditionEvaluator';

export async function ifConditionProcessor(
  node: FlowNode,
  ctx: ExecutionContext,
  _deps: ProcessorDeps,
): Promise<NodeResult> {
  const config = node.config as IfConditionConfig;

  let result = false;
  if (config.conditions) {
    result = evaluateConditionGroup(config.conditions, ctx);
  }

  const port = result ? 'true' : 'false';

  ctx.executionLog.push({
    nodeId: node.id,
    nodeType: node.type,
    timestamp: new Date().toISOString(),
    status: 'ok',
    meta: { conditionResult: result, port },
  });

  return { nextNodeId: port };
}
