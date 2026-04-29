/**
 * @CLAUDE_CONTEXT
 * Package : packages/flow-engine
 * File    : src/nodeProcessors/keywordRouter.ts
 * Role    : KEYWORD_ROUTER node — routes based on inbound message keywords.
 *           Case-insensitive trimmed comparison. Returns keyword index string or 'default'.
 * Exports : keywordRouterProcessor
 */
import type { FlowNode, ExecutionContext, KeywordRouterConfig } from '../types';
import type { NodeResult, ProcessorDeps } from './types';

export async function keywordRouterProcessor(
  node: FlowNode,
  ctx: ExecutionContext,
  _deps: ProcessorDeps,
): Promise<NodeResult> {
  const config = node.config as KeywordRouterConfig;
  const keywords = config.keywords ?? [];
  const messageText = (ctx.trigger.messageText ?? '').trim().toLowerCase();

  let matchedPort = 'default';

  for (let i = 0; i < keywords.length; i++) {
    const kw = keywords[i].trim().toLowerCase();
    if (kw && messageText === kw) {
      matchedPort = String(i);
      break;
    }
  }

  ctx.executionLog.push({
    nodeId: node.id,
    nodeType: node.type,
    timestamp: new Date().toISOString(),
    status: 'ok',
    meta: { messageText, matchedPort, keywordCount: keywords.length },
  });

  return { nextNodeId: matchedPort };
}
