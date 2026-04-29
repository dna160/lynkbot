/**
 * @CLAUDE_CONTEXT
 * Package : packages/flow-engine
 * File    : src/nodeProcessors/tagBuyer.ts
 * Role    : TAG_BUYER node — adds or removes a tag from buyers.tags JSONB array.
 * Exports : tagBuyerProcessor
 */
import { db, buyers, sql, eq } from '@lynkbot/db';
import type { FlowNode, ExecutionContext, TagBuyerConfig } from '../types';
import type { NodeResult, ProcessorDeps } from './types';

export async function tagBuyerProcessor(
  node: FlowNode,
  ctx: ExecutionContext,
  _deps: ProcessorDeps,
): Promise<NodeResult> {
  const config = node.config as TagBuyerConfig;
  const { action, tag } = config;

  if (!tag) {
    return { nextNodeId: 'default', skipReason: 'missing_tag' };
  }

  if (action === 'add') {
    // Add tag if not already present
    await db
      .update(buyers)
      .set({
        // Append to JSONB array, avoiding duplicates
        tags: sql`
          CASE
            WHEN tags IS NULL THEN ${JSON.stringify([tag])}::jsonb
            WHEN NOT (tags @> ${JSON.stringify([tag])}::jsonb) THEN tags || ${JSON.stringify([tag])}::jsonb
            ELSE tags
          END
        `,
        updatedAt: new Date(),
      })
      .where(eq(buyers.id, ctx.buyerId));

    // Update local context
    if (!ctx.buyer.tags.includes(tag)) {
      ctx.buyer.tags = [...ctx.buyer.tags, tag];
    }
  } else if (action === 'remove') {
    // Remove tag using JSONB minus operator
    await db
      .update(buyers)
      .set({
        tags: sql`
          COALESCE(
            (
              SELECT jsonb_agg(elem)
              FROM jsonb_array_elements_text(COALESCE(tags, '[]'::jsonb)) AS elem
              WHERE elem != ${tag}
            ),
            '[]'::jsonb
          )
        `,
        updatedAt: new Date(),
      })
      .where(eq(buyers.id, ctx.buyerId));

    // Update local context
    ctx.buyer.tags = ctx.buyer.tags.filter(t => t !== tag);
  }

  ctx.executionLog.push({
    nodeId: node.id,
    nodeType: node.type,
    timestamp: new Date().toISOString(),
    status: 'ok',
    meta: { action, tag },
  });

  return { nextNodeId: 'default' };
}
