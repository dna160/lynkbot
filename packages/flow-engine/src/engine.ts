/**
 * @CLAUDE_CONTEXT
 * Package : packages/flow-engine
 * File    : src/engine.ts
 * Role    : FlowEngine — orchestrates flow execution lifecycle.
 *           Handles button-trigger routing, node-by-node execution, and WAIT_FOR_REPLY resume.
 *           All outbound sends go through per-tenant MetaClient (compliance §4).
 * Exports : FlowEngine
 * DO NOT  : Use config.META_ACCESS_TOKEN. Use getMetaClient() dep instead.
 */
import { Queue } from 'bullmq';
import {
  db,
  flowDefinitions,
  flowExecutions,
  buyers,
  tenants,
  buyerBroadcastLog,
  eq,
  and,
  or,
  not,
  sql,
  gte,
  lte,
  inArray,
} from '@lynkbot/db';
import type { MetaClient } from '@lynkbot/meta';
import { QUEUES } from '@lynkbot/shared';
import type {
  FlowDefinition,
  FlowNode,
  ExecutionContext,
  BuyerContext,
  TriggerConfig,
  TriggerContext,
  SegmentFilter,
} from './types';
import { processorRegistry } from './nodeProcessors/index';
import type { ProcessorDeps, RedisClientLike } from './nodeProcessors/types';

export interface FlowEngineOptions {
  getMetaClient: (tenantId: string) => Promise<MetaClient>;
  redisClient: RedisClientLike;
  /** BullMQ connection options */
  redisConnection: { host: string; port: number; password?: string };
}

export class FlowEngine {
  private getMetaClient: (tenantId: string) => Promise<MetaClient>;
  private redisClient: RedisClientLike;
  private queue: Queue;

  constructor(options: FlowEngineOptions) {
    this.getMetaClient = options.getMetaClient;
    this.redisClient = options.redisClient;
    this.queue = new Queue(QUEUES.FLOW_EXECUTION, {
      connection: options.redisConnection,
    });
  }

  private get processorDeps(): ProcessorDeps {
    return {
      db,
      getMetaClient: this.getMetaClient,
      queue: this.queue,
      redisClient: this.redisClient,
    };
  }

  /**
   * Route a WhatsApp button click to the appropriate flow.
   *
   * Button payload format: "flow:{flowId}:{buttonIndex}"
   */
  async handleButtonTrigger(
    tenantId: string,
    buyerId: string,
    buttonPayload: string,
    conversationId?: string,
  ): Promise<void> {
    // 1. Parse buttonPayload
    const parts = buttonPayload.split(':');
    if (parts.length < 3 || parts[0] !== 'flow') {
      throw new Error(`Invalid flow button payload format: ${buttonPayload}`);
    }
    const flowId = parts[1];

    // 2. Load active flow
    const flow = await db.query.flowDefinitions.findFirst({
      where: and(
        eq(flowDefinitions.id, flowId),
        eq(flowDefinitions.tenantId, tenantId),
        eq(flowDefinitions.status, 'active'),
      ),
    });

    if (!flow) {
      throw new Error(`No active flow found: flowId=${flowId} tenantId=${tenantId}`);
    }

    // 3. Check for existing running/waiting execution (idempotent)
    const existingExecution = await db.query.flowExecutions.findFirst({
      where: and(
        eq(flowExecutions.flowId, flowId),
        eq(flowExecutions.buyerId, buyerId),
        or(
          eq(flowExecutions.status, 'running'),
          eq(flowExecutions.status, 'waiting_reply'),
        ),
      ),
    });

    if (existingExecution) {
      // Idempotent — skip silently
      return;
    }

    // 4. Load buyer and check doNotContact
    const buyer = await db.query.buyers.findFirst({
      where: eq(buyers.id, buyerId),
    });

    if (!buyer) {
      throw new Error(`Buyer not found: ${buyerId}`);
    }

    if (buyer.doNotContact) {
      throw new Error(
        `[FlowEngine] COMPLIANCE: buyer ${buyerId} has doNotContact=true — skipping flow trigger`,
      );
    }

    // 5. Build ExecutionContext
    const buyerCtx: BuyerContext = {
      id: buyer.id,
      waPhone: buyer.waPhone,
      name: buyer.displayName ?? buyer.waPhone,
      totalOrders: buyer.totalOrders,
      tags: (buyer.tags as string[]) ?? [],
      lastOrderAt: buyer.lastOrderAt,
      doNotContact: buyer.doNotContact,
      preferredLanguage: buyer.preferredLanguage ?? 'id',
      notes: buyer.notes,
      displayName: buyer.displayName,
      activeFlowCount: buyer.activeFlowCount,
    };

    const triggerCtx: TriggerContext = {
      type: 'button_click',
      buttonPayload,
      conversationId,
    };

    // 6. Insert flow_executions row
    const [execution] = await db
      .insert(flowExecutions)
      .values({
        flowId,
        tenantId,
        buyerId,
        status: 'running',
        context: { buyer: buyerCtx, trigger: triggerCtx, variables: {} },
        startedAt: new Date(),
        lastStepAt: new Date(),
      })
      .returning({ id: flowExecutions.id });

    // 7. Increment buyers.active_flow_count
    await db
      .update(buyers)
      .set({ activeFlowCount: sql`${buyers.activeFlowCount} + 1` })
      .where(eq(buyers.id, buyerId));

    const ctx: ExecutionContext = {
      executionId: execution.id,
      flowId,
      tenantId,
      buyerId,
      buyer: buyerCtx,
      trigger: triggerCtx,
      variables: {},
      executionLog: [],
    };

    // 8. Find trigger node → follow edges to first real node
    const definition = flow.definition as unknown as FlowDefinition;
    const triggerNode = definition.nodes.find(n => n.type === 'TRIGGER');
    if (!triggerNode) {
      throw new Error(`Flow ${flowId} has no TRIGGER node`);
    }

    const firstEdge = definition.edges.find(
      e => e.source === triggerNode.id && (!e.sourcePort || e.sourcePort === 'default'),
    );

    if (!firstEdge) {
      // No edges from trigger — flow is empty, mark completed
      await this._markCompleted(ctx);
      return;
    }

    // 9. Begin execution
    await this.executeNode(execution.id, firstEdge.target, ctx);
  }

  /**
   * Execute a single node within a flow execution.
   * Recursively follows edges until the flow completes, pauses, or delays.
   */
  async executeNode(
    executionId: string,
    nodeId: string,
    passedCtx?: ExecutionContext,
  ): Promise<void> {
    // 1. Load execution from DB (if context not already passed)
    let ctx: ExecutionContext;

    if (passedCtx) {
      ctx = passedCtx;
    } else {
      const execution = await db.query.flowExecutions.findFirst({
        where: eq(flowExecutions.id, executionId),
      });

      if (!execution) {
        throw new Error(`Execution not found: ${executionId}`);
      }

      if (execution.status === 'cancelled' || execution.status === 'completed') {
        return; // Already done
      }

      const flow = await db.query.flowDefinitions.findFirst({
        where: eq(flowDefinitions.id, execution.flowId),
      });

      if (!flow) {
        throw new Error(`Flow not found: ${execution.flowId}`);
      }

      const ctxData = execution.context as Record<string, unknown>;
      ctx = {
        executionId,
        flowId: execution.flowId,
        tenantId: execution.tenantId,
        buyerId: execution.buyerId,
        buyer: ctxData['buyer'] as BuyerContext,
        trigger: ctxData['trigger'] as TriggerContext,
        variables: (ctxData['variables'] as Record<string, unknown>) ?? {},
        executionLog: (ctxData['executionLog'] as ExecutionContext['executionLog']) ?? [],
      };
    }

    // 2. Get flow definition to find the node
    const flow = await db.query.flowDefinitions.findFirst({
      where: eq(flowDefinitions.id, ctx.flowId),
    });

    if (!flow) {
      throw new Error(`Flow not found: ${ctx.flowId}`);
    }

    const definition = flow.definition as unknown as FlowDefinition;
    const node = definition.nodes.find((n: FlowNode) => n.id === nodeId);

    if (!node) {
      throw new Error(`Node ${nodeId} not found in flow ${ctx.flowId}`);
    }

    // 3. Update current_node_id
    await db
      .update(flowExecutions)
      .set({ currentNodeId: nodeId, lastStepAt: new Date() })
      .where(eq(flowExecutions.id, executionId));

    // 4. Look up and call processor
    const processor = processorRegistry[node.type];

    if (!processor) {
      // Unknown node type — log and skip
      ctx.executionLog.push({
        nodeId: node.id,
        nodeType: node.type,
        timestamp: new Date().toISOString(),
        status: 'skipped',
        skipReason: `unknown_node_type:${node.type}`,
      });
      // Try to follow default edge
      await this._followEdge(ctx, definition, nodeId, 'default');
      return;
    }

    const result = await processor(node, ctx, this.processorDeps);

    // 5. Update execution log in DB
    await db
      .update(flowExecutions)
      .set({
        context: {
          buyer: ctx.buyer,
          trigger: ctx.trigger,
          variables: ctx.variables,
          executionLog: ctx.executionLog,
        },
        lastStepAt: new Date(),
      })
      .where(eq(flowExecutions.id, executionId));

    // 6. Handle status results
    if (result.status === 'completed') {
      await this._markCompleted(ctx);
      return;
    }

    if (result.status === 'delayed') {
      await db
        .update(flowExecutions)
        .set({ status: 'running', currentNodeId: nodeId, lastStepAt: new Date() })
        .where(eq(flowExecutions.id, executionId));
      return;
    }

    if (result.status === 'waiting_reply') {
      await db
        .update(flowExecutions)
        .set({
          status: 'waiting_reply',
          currentNodeId: nodeId,
          lastStepAt: new Date(),
        })
        .where(eq(flowExecutions.id, executionId));
      return;
    }

    // 7. Follow edge to next node
    const port = result.nextNodeId ?? 'default';
    await this._followEdge(ctx, definition, nodeId, port);
  }

  /**
   * Resume a waiting_reply execution after the buyer sends a message.
   */
  async resumeExecution(executionId: string, inboundMessage: string): Promise<void> {
    const execution = await db.query.flowExecutions.findFirst({
      where: eq(flowExecutions.id, executionId),
    });

    if (!execution) {
      throw new Error(`Execution not found: ${executionId}`);
    }

    const ctxData = execution.context as Record<string, unknown>;
    const ctx: ExecutionContext = {
      executionId,
      flowId: execution.flowId,
      tenantId: execution.tenantId,
      buyerId: execution.buyerId,
      buyer: ctxData['buyer'] as BuyerContext,
      trigger: {
        ...(ctxData['trigger'] as TriggerContext),
        messageText: inboundMessage,
      },
      variables: (ctxData['variables'] as Record<string, unknown>) ?? {},
      executionLog: (ctxData['executionLog'] as ExecutionContext['executionLog']) ?? [],
    };

    // Update context with the new message text
    await db
      .update(flowExecutions)
      .set({
        status: 'running',
        context: {
          buyer: ctx.buyer,
          trigger: ctx.trigger,
          variables: ctx.variables,
          executionLog: ctx.executionLog,
        },
        lastStepAt: new Date(),
      })
      .where(eq(flowExecutions.id, executionId));

    // Follow edges from the WAIT_FOR_REPLY node (current_node_id) via 'default' port
    const currentNodeId = execution.currentNodeId;
    if (!currentNodeId) {
      throw new Error(`Execution ${executionId} has no currentNodeId`);
    }

    const flow = await db.query.flowDefinitions.findFirst({
      where: eq(flowDefinitions.id, execution.flowId),
    });

    if (!flow) {
      throw new Error(`Flow not found: ${execution.flowId}`);
    }

    const definition = flow.definition as unknown as FlowDefinition;
    await this._followEdge(ctx, definition, currentNodeId, 'default');
  }

  /**
   * Evaluates time-based triggers for all active flows (or one tenant's flows).
   * Called every 15 minutes by the `flow.check_time_triggers` BullMQ cron job.
   *
   * For each active flow with triggerType='time_based':
   *  1. Read segmentFilter from triggerConfig
   *  2. Find eligible buyers (matching filter, not doNotContact, no running execution)
   *  3. Enqueue one flow.start_execution job per buyer
   */
  async evaluateTimeTriggers(tenantId?: string): Promise<void> {
    // Load all active time-based flows (optionally scoped to one tenant)
    const activeFlows = await db.query.flowDefinitions.findMany({
      where: and(
        eq(flowDefinitions.status, 'active'),
        eq(flowDefinitions.triggerType, 'time_based'),
        ...(tenantId ? [eq(flowDefinitions.tenantId, tenantId)] : []),
      ),
      columns: {
        id: true,
        tenantId: true,
        triggerConfig: true,
        definition: true,
      },
    });

    for (const flow of activeFlows) {
      try {
        const triggerCfg = (flow.triggerConfig ?? {}) as TriggerConfig;
        const segmentFilter = triggerCfg.segmentFilter ?? {};
        await this.broadcastToSegment(flow.tenantId, flow.id, segmentFilter);
      } catch (err) {
        console.error(
          `[FlowEngine] evaluateTimeTriggers failed for flow=${flow.id}:`,
          err,
        );
      }
    }
  }

  /**
   * Broadcasts a flow to a segment of buyers.
   * - Applies segmentFilter (tags, order counts, recency)
   * - Excludes doNotContact=true buyers
   * - Excludes buyers with an already-running execution for this flow
   * - Honors global 1000/hour marketing cap via Redis counter
   * - Enqueues one flow.start_execution job per eligible buyer
   *
   * Rate limit: Redis counter `ratelimit:waba:{wabaId}:marketing:{YYYY-MM-DD-HH}`
   */
  async broadcastToSegment(
    tenantId: string,
    flowId: string,
    segmentFilter: SegmentFilter | Record<string, unknown>,
  ): Promise<void> {
    const sf = segmentFilter as SegmentFilter;

    // Resolve tenant for WABA rate-limit key
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: { wabaId: true },
    });
    const wabaId = tenant?.wabaId ?? tenantId;

    // ── Global 1000/hour rate-limit check ────────────────────────────────────
    const now = new Date();
    const hourKey = `ratelimit:waba:${wabaId}:marketing:${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}-${String(now.getUTCHours()).padStart(2, '0')}`;
    const currentCount = parseInt(
      (await this.redisClient.get(hourKey)) ?? '0',
      10,
    );

    if (currentCount >= 1000) {
      console.warn(
        `[FlowEngine] broadcastToSegment: 1000/hour cap reached for wabaId=${wabaId}. Skipping flow=${flowId}.`,
      );
      return;
    }

    // ── Build buyer query with segment filters ────────────────────────────────
    const conditions = [
      eq(buyers.tenantId, tenantId),
      not(buyers.doNotContact),
    ];

    if (sf.tags && sf.tags.length > 0) {
      // Match buyers whose tags JSON array contains any of the specified tags
      conditions.push(
        sql`${buyers.tags} ?| ARRAY[${sql.raw(sf.tags.map(t => `'${t.replace(/'/g, "''")}'`).join(','))}]::text[]`,
      );
    }

    if (typeof sf.minTotalOrders === 'number') {
      conditions.push(gte(buyers.totalOrders, sf.minTotalOrders));
    }

    if (typeof sf.maxTotalOrders === 'number') {
      conditions.push(lte(buyers.totalOrders, sf.maxTotalOrders));
    }

    if (typeof sf.lastOrderWithinDays === 'number') {
      const cutoff = new Date(Date.now() - sf.lastOrderWithinDays * 24 * 60 * 60 * 1000);
      conditions.push(gte(buyers.lastOrderAt, cutoff));
    }

    if (sf.preferredLanguage) {
      conditions.push(eq(buyers.preferredLanguage, sf.preferredLanguage));
    }

    const eligibleBuyers = await db.query.buyers.findMany({
      where: and(...(conditions as Parameters<typeof and>)),
      columns: { id: true },
    });

    if (eligibleBuyers.length === 0) return;

    // Exclude buyers with a running execution for this flow
    const runningExecutions = await db.query.flowExecutions.findMany({
      where: and(
        eq(flowExecutions.flowId, flowId),
        or(
          eq(flowExecutions.status, 'running'),
          eq(flowExecutions.status, 'waiting_reply'),
        ),
      ),
      columns: { buyerId: true },
    });
    const runningBuyerIds = new Set(runningExecutions.map(e => e.buyerId));

    const targetBuyers = eligibleBuyers.filter(b => !runningBuyerIds.has(b.id));
    if (targetBuyers.length === 0) return;

    // Respect the remaining hourly cap
    const remaining = Math.max(0, 1000 - currentCount);
    const toEnqueue = targetBuyers.slice(0, remaining);

    // Enqueue one job per buyer (BullMQ handles rate limiting via concurrency)
    for (const buyer of toEnqueue) {
      await this.queue.add(
        'flow.start_execution',
        { tenantId, flowId, buyerId: buyer.id, triggerType: 'broadcast' },
        { removeOnComplete: 100, removeOnFail: 200 },
      );
    }

    // Increment Redis counter (TTL: 2 hours to cover the full window)
    await this.redisClient.incrby(hourKey, toEnqueue.length);
    await this.redisClient.expire(hourKey, 7200);

    console.log(
      `[FlowEngine] broadcastToSegment: enqueued ${toEnqueue.length} jobs for flow=${flowId} tenant=${tenantId}`,
    );
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async _followEdge(
    ctx: ExecutionContext,
    definition: FlowDefinition,
    fromNodeId: string,
    port: string,
  ): Promise<void> {
    const edge = definition.edges.find(
      e =>
        e.source === fromNodeId &&
        (e.sourcePort === port || (port === 'default' && (!e.sourcePort || e.sourcePort === 'default'))),
    );

    if (!edge) {
      // No edge found — auto-complete
      await this._markCompleted(ctx);
      return;
    }

    await this.executeNode(ctx.executionId, edge.target, ctx);
  }

  private async _markCompleted(ctx: ExecutionContext): Promise<void> {
    await db
      .update(flowExecutions)
      .set({
        status: 'completed',
        completedAt: new Date(),
        lastStepAt: new Date(),
      })
      .where(eq(flowExecutions.id, ctx.executionId));

    // Decrement buyers.active_flow_count (minimum 0)
    await db
      .update(buyers)
      .set({
        activeFlowCount: sql`GREATEST(0, ${buyers.activeFlowCount} - 1)`,
      })
      .where(eq(buyers.id, ctx.buyerId));
  }
}
