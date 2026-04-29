/**
 * @CLAUDE_CONTEXT
 * Package : packages/flow-engine
 * File    : src/nodeProcessors/sendTemplate.ts
 * Role    : SEND_TEMPLATE node — sends a Meta-approved template.
 *           Checks cooldown before sending; skips (does NOT abort) if blocked.
 *           Logs to buyer_broadcast_log on success.
 *           Enforces 500ms min between consecutive sends.
 * Exports : sendTemplateProcessor
 */
import { db, buyerBroadcastLog } from '@lynkbot/db';
import type { FlowNode, ExecutionContext, SendTemplateConfig } from '../types';
import type { NodeResult, ProcessorDeps } from './types';
import { sleep } from './types';
import { CooldownChecker } from '../cooldownChecker';
import { resolveVariables } from '../variableResolver';

const cooldownChecker = new CooldownChecker();

export async function sendTemplateProcessor(
  node: FlowNode,
  ctx: ExecutionContext,
  deps: ProcessorDeps,
): Promise<NodeResult> {
  const config = node.config as SendTemplateConfig;
  const { templateName, languageCode = 'id', components = [] } = config;

  if (!templateName) {
    return { nextNodeId: 'default', skipReason: 'missing_template_name' };
  }

  // 1. Cooldown check — blocked → skip, not abort
  const cooldown = await cooldownChecker.check(ctx.buyerId, templateName, ctx.tenantId);
  if (cooldown.blocked) {
    ctx.executionLog.push({
      nodeId: node.id,
      nodeType: node.type,
      timestamp: new Date().toISOString(),
      status: 'skipped',
      skipReason: cooldown.reason,
    });
    return { nextNodeId: 'default', skipReason: cooldown.reason };
  }

  // 2. Resolve variable templates in component parameters
  const resolvedComponents = components.map(comp => ({
    ...comp,
    parameters: comp.parameters?.map(param => ({
      ...param,
      text: param.text ? resolveVariables(param.text, ctx) : param.text,
    })),
  }));

  // 3. Send template via per-tenant MetaClient
  const metaClient = await deps.getMetaClient(ctx.tenantId);
  await metaClient.sendTemplate({
    to: ctx.buyer.waPhone,
    templateName,
    languageCode,
    components: resolvedComponents as Parameters<typeof metaClient.sendTemplate>[0]['components'],
  });

  // 4. Log to buyer_broadcast_log
  await db.insert(buyerBroadcastLog).values({
    tenantId: ctx.tenantId,
    buyerId: ctx.buyerId,
    templateName,
    flowId: ctx.flowId,
    sentAt: new Date(),
  });

  ctx.executionLog.push({
    nodeId: node.id,
    nodeType: node.type,
    timestamp: new Date().toISOString(),
    status: 'ok',
    meta: { templateName },
  });

  // 5. Enforce 500ms minimum between consecutive outbound messages
  await sleep(500);

  return { nextNodeId: 'default' };
}
