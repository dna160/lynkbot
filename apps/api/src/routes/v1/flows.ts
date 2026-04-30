/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/routes/v1/flows.ts
 * Role    : Flow Builder CRUD routes (PRD §11.1).
 *           All routes require authentication + flow_builder feature flag.
 *           PATCH /v1/flows/:id/status enforces risk score gate (>80 blocks activation).
 * Exports : flowRoutes (Fastify plugin)
 */
import type { FastifyPluginAsync } from 'fastify';
import { db, flowDefinitions, flowExecutions, eq, and, desc, sql, count } from '@lynkbot/db';
import { requireFeature } from '../../middleware/featureGate';
import { RiskScoreService } from '../../services/riskScore.service';

const riskScoreService = new RiskScoreService();

const authAndFeature = (fastify: Parameters<FastifyPluginAsync>[0]) => [
  fastify.authenticate,
  requireFeature('flow_builder'),
];

export const flowRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /v1/flows
   * Paginated list of flow definitions for the authenticated tenant.
   * Query: status, page=1, limit=20
   */
  fastify.get<{
    Querystring: { status?: string; page?: string; limit?: string };
  }>(
    '/v1/flows',
    { preHandler: authAndFeature(fastify) },
    async (request, reply) => {
      const { tenantId } = request.user;
      const page = Math.max(1, parseInt(request.query.page ?? '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt(request.query.limit ?? '20', 10)));
      const offset = (page - 1) * limit;

      const conditions: ReturnType<typeof eq>[] = [
        eq(flowDefinitions.tenantId, tenantId),
      ];
      if (request.query.status) {
        conditions.push(
          eq(flowDefinitions.status, request.query.status as typeof flowDefinitions.status._.data),
        );
      }

      const whereClause = and(...conditions);

      const [rows, countResult] = await Promise.all([
        db
          .select()
          .from(flowDefinitions)
          .where(whereClause)
          .orderBy(desc(flowDefinitions.updatedAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ cnt: count() })
          .from(flowDefinitions)
          .where(whereClause),
      ]);

      return reply.send({
        items: rows,
        total: Number(countResult[0]?.cnt ?? 0),
        page,
        limit,
      });
    },
  );

  /**
   * POST /v1/flows
   * Create a new flow definition (always starts as 'draft').
   */
  fastify.post<{
    Body: {
      name: string;
      description?: string;
      triggerType: string;
      triggerConfig?: Record<string, unknown>;
      definition: Record<string, unknown>;
    };
  }>(
    '/v1/flows',
    { preHandler: authAndFeature(fastify) },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { name, description, triggerType, triggerConfig = {}, definition } = request.body;

      if (!name || !triggerType || !definition) {
        return reply.status(400).send({ error: 'name, triggerType, and definition are required' });
      }

      const [flow] = await db
        .insert(flowDefinitions)
        .values({
          tenantId,
          name,
          description,
          triggerType,
          triggerConfig,
          definition,
          status: 'draft', // Always draft on creation
          version: 1,
        })
        .returning();

      return reply.status(201).send(flow);
    },
  );

  /**
   * GET /v1/flows/:id
   * Get a single flow definition.
   */
  fastify.get<{ Params: { id: string } }>(
    '/v1/flows/:id',
    { preHandler: authAndFeature(fastify) },
    async (request, reply) => {
      const { tenantId } = request.user;
      const flow = await db.query.flowDefinitions.findFirst({
        where: and(
          eq(flowDefinitions.id, request.params.id),
          eq(flowDefinitions.tenantId, tenantId),
        ),
      });

      if (!flow) {
        return reply.status(404).send({ error: 'Flow not found' });
      }

      return reply.send(flow);
    },
  );

  /**
   * PUT /v1/flows/:id
   * Replace flow definition. Blocked if status='active' and definition is invalid.
   */
  fastify.put<{
    Params: { id: string };
    Body: {
      name?: string;
      description?: string;
      triggerType?: string;
      triggerConfig?: Record<string, unknown>;
      definition?: Record<string, unknown>;
    };
  }>(
    '/v1/flows/:id',
    { preHandler: authAndFeature(fastify) },
    async (request, reply) => {
      const { tenantId } = request.user;

      const existing = await db.query.flowDefinitions.findFirst({
        where: and(
          eq(flowDefinitions.id, request.params.id),
          eq(flowDefinitions.tenantId, tenantId),
        ),
      });

      if (!existing) {
        return reply.status(404).send({ error: 'Flow not found' });
      }

      if (existing.status === 'archived') {
        return reply.status(409).send({ error: 'Cannot edit an archived flow' });
      }

      const { name, description, triggerType, triggerConfig, definition } = request.body;

      const [updated] = await db
        .update(flowDefinitions)
        .set({
          name: name ?? existing.name,
          description: description ?? existing.description,
          triggerType: triggerType ?? existing.triggerType,
          triggerConfig: triggerConfig ?? existing.triggerConfig,
          definition: definition ?? existing.definition,
          version: existing.version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(flowDefinitions.id, request.params.id),
            eq(flowDefinitions.tenantId, tenantId),
          ),
        )
        .returning();

      return reply.send(updated);
    },
  );

  /**
   * PATCH /v1/flows/:id/status
   * Transition flow status: 'active' | 'paused' | 'archived'
   * Risk score > 80 blocks activation (non-overridable).
   * Risk score > 60 adds warning field to response.
   */
  fastify.patch<{
    Params: { id: string };
    Body: { status: 'active' | 'draft' | 'archived' };
  }>(
    '/v1/flows/:id/status',
    { preHandler: authAndFeature(fastify) },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { status } = request.body;

      if (!['active', 'draft', 'archived'].includes(status)) {
        return reply.status(400).send({ error: 'status must be active, draft, or archived' });
      }

      const existing = await db.query.flowDefinitions.findFirst({
        where: and(
          eq(flowDefinitions.id, request.params.id),
          eq(flowDefinitions.tenantId, tenantId),
        ),
      });

      if (!existing) {
        return reply.status(404).send({ error: 'Flow not found' });
      }

      // Risk score gate for activation (PRD §8.2 — non-overridable)
      let warning: string | undefined;
      if (status === 'active') {
        const { score, breakdown } = await riskScoreService.getForTenant(tenantId);

        if (score > 80) {
          return reply.status(422).send({
            error: 'risk_score_too_high',
            score,
            breakdown,
            message: `Flow activation blocked: risk score ${score} exceeds threshold of 80. Reduce broadcast frequency or improve template quality.`,
          });
        }

        if (score > 60) {
          warning = `Risk score is ${score}/100 (Caution). Consider reducing broadcast frequency or improving template quality.`;
        }
      }

      const setPayload: {
        status: 'active' | 'draft' | 'archived';
        updatedAt: Date;
        activatedAt?: Date;
        archivedAt?: Date;
      } = { status, updatedAt: new Date() };
      if (status === 'active') setPayload.activatedAt = new Date();
      if (status === 'archived') setPayload.archivedAt = new Date();

      const [updated] = await db
        .update(flowDefinitions)
        .set(setPayload)
        .where(
          and(
            eq(flowDefinitions.id, request.params.id),
            eq(flowDefinitions.tenantId, tenantId),
          ),
        )
        .returning();

      const response: Record<string, unknown> = { ...updated };
      if (warning) {
        response['warning'] = warning;
      }

      return reply.send(response);
    },
  );

  /**
   * DELETE /v1/flows/:id
   * Soft-delete: set status='archived'.
   */
  fastify.delete<{ Params: { id: string } }>(
    '/v1/flows/:id',
    { preHandler: authAndFeature(fastify) },
    async (request, reply) => {
      const { tenantId } = request.user;

      const existing = await db.query.flowDefinitions.findFirst({
        where: and(
          eq(flowDefinitions.id, request.params.id),
          eq(flowDefinitions.tenantId, tenantId),
        ),
        columns: { id: true },
      });

      if (!existing) {
        return reply.status(404).send({ error: 'Flow not found' });
      }

      await db
        .update(flowDefinitions)
        .set({ status: 'archived', archivedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(flowDefinitions.id, request.params.id),
            eq(flowDefinitions.tenantId, tenantId),
          ),
        );

      return reply.status(204).send();
    },
  );

  /**
   * GET /v1/flows/:id/executions
   * List executions for a flow.
   * Query: status, buyerId, page, limit
   */
  fastify.get<{
    Params: { id: string };
    Querystring: { status?: string; buyerId?: string; page?: string; limit?: string };
  }>(
    '/v1/flows/:id/executions',
    { preHandler: authAndFeature(fastify) },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { id: flowId } = request.params;
      const page = Math.max(1, parseInt(request.query.page ?? '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt(request.query.limit ?? '20', 10)));
      const offset = (page - 1) * limit;

      // Verify tenant owns this flow
      const flow = await db.query.flowDefinitions.findFirst({
        where: and(
          eq(flowDefinitions.id, flowId),
          eq(flowDefinitions.tenantId, tenantId),
        ),
        columns: { id: true },
      });

      if (!flow) {
        return reply.status(404).send({ error: 'Flow not found' });
      }

      const conditions: ReturnType<typeof eq>[] = [
        eq(flowExecutions.flowId, flowId),
        eq(flowExecutions.tenantId, tenantId),
      ];

      if (request.query.status) {
        conditions.push(
          eq(
            flowExecutions.status,
            request.query.status as typeof flowExecutions.status._.data,
          ),
        );
      }

      if (request.query.buyerId) {
        conditions.push(eq(flowExecutions.buyerId, request.query.buyerId));
      }

      const whereClause = and(...conditions);

      const [rows, countResult] = await Promise.all([
        db
          .select()
          .from(flowExecutions)
          .where(whereClause)
          .orderBy(desc(flowExecutions.startedAt))
          .limit(limit)
          .offset(offset),
        db.select({ cnt: count() }).from(flowExecutions).where(whereClause),
      ]);

      return reply.send({
        items: rows,
        total: Number(countResult[0]?.cnt ?? 0),
        page,
        limit,
      });
    },
  );

  /**
   * GET /v1/flows/:id/risk-score
   * Returns { score, breakdown } for this flow's tenant.
   * Phase 4 will compute real inputs; for now returns stub values.
   */
  fastify.get<{ Params: { id: string } }>(
    '/v1/flows/:id/risk-score',
    { preHandler: authAndFeature(fastify) },
    async (request, reply) => {
      const { tenantId } = request.user;

      const flow = await db.query.flowDefinitions.findFirst({
        where: and(
          eq(flowDefinitions.id, request.params.id),
          eq(flowDefinitions.tenantId, tenantId),
        ),
        columns: { id: true },
      });

      if (!flow) {
        return reply.status(404).send({ error: 'Flow not found' });
      }

      const result = await riskScoreService.getForTenant(tenantId);
      return reply.send(result);
    },
  );

  /**
   * POST /v1/flows/:id/test
   * Dry-run: returns the flow's first 3 nodes without sending anything.
   */
  fastify.post<{ Params: { id: string } }>(
    '/v1/flows/:id/test',
    { preHandler: authAndFeature(fastify) },
    async (request, reply) => {
      const { tenantId } = request.user;

      const flow = await db.query.flowDefinitions.findFirst({
        where: and(
          eq(flowDefinitions.id, request.params.id),
          eq(flowDefinitions.tenantId, tenantId),
        ),
      });

      if (!flow) {
        return reply.status(404).send({ error: 'Flow not found' });
      }

      const definition = flow.definition as { nodes?: unknown[]; edges?: unknown[] };
      const nodes = definition.nodes ?? [];

      return reply.send({
        dryRun: true,
        flowId: flow.id,
        name: flow.name,
        status: flow.status,
        previewNodes: nodes.slice(0, 3),
        totalNodes: nodes.length,
      });
    },
  );
};
