/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/routes/v1/flowTemplates.ts
 * Role    : Template Studio REST routes (PRD §11.2).
 *           All routes require auth + template_studio feature flag.
 *           DELETE is blocked if template is referenced by an active flow.
 *           POST /:id/appeal is blocked if appealCount >= 2.
 * Exports : flowTemplateRoutes (Fastify plugin)
 */
import type { FastifyPluginAsync } from 'fastify';
import { db, flowTemplates, flowDefinitions, eq, and, desc, count, sql } from '@lynkbot/db';
import { requireFeature } from '../../middleware/featureGate';
import { TemplateStudioService } from '../../services/templateStudio.service';
import type { MetaTemplateComponent } from '../../services/templateStudio.service';

const svc = new TemplateStudioService();

const authAndFeature = (fastify: Parameters<FastifyPluginAsync>[0]) => [
  fastify.authenticate,
  requireFeature('template_studio'),
];

export const flowTemplateRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /v1/flow-templates
   * Paginated list of templates for the authenticated tenant.
   * Query: status, category, page=1, limit=20
   */
  fastify.get<{
    Querystring: { status?: string; category?: string; page?: string; limit?: string };
  }>(
    '/v1/flow-templates',
    { preHandler: authAndFeature(fastify) },
    async (request, reply) => {
      const { tenantId } = request.user;
      const page = Math.max(1, parseInt(request.query.page ?? '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt(request.query.limit ?? '20', 10)));
      const offset = (page - 1) * limit;

      const conditions = [eq(flowTemplates.tenantId, tenantId)];

      if (request.query.status) {
        conditions.push(
          eq(flowTemplates.status, request.query.status as typeof flowTemplates.status._.data),
        );
      }
      if (request.query.category) {
        conditions.push(
          eq(flowTemplates.category, request.query.category),
        );
      }

      const whereClause = and(...conditions);

      const [rows, countResult] = await Promise.all([
        db
          .select()
          .from(flowTemplates)
          .where(whereClause)
          .orderBy(desc(flowTemplates.updatedAt))
          .limit(limit)
          .offset(offset),
        db.select({ cnt: count() }).from(flowTemplates).where(whereClause),
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
   * POST /v1/flow-templates
   * Create a draft template (local only — not submitted to Meta).
   */
  fastify.post<{
    Body: {
      name: string;
      displayName?: string;
      category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
      language?: string;
      components: MetaTemplateComponent[];
      variableLabels?: Record<string, string>;
    };
  }>(
    '/v1/flow-templates',
    { preHandler: authAndFeature(fastify) },
    async (request, reply) => {
      const { tenantId } = request.user;
      const template = await svc.createDraft(tenantId, request.body);
      return reply.status(201).send(template);
    },
  );

  /**
   * GET /v1/flow-templates/:id
   * Get a single template.
   */
  fastify.get<{ Params: { id: string } }>(
    '/v1/flow-templates/:id',
    { preHandler: authAndFeature(fastify) },
    async (request, reply) => {
      const { tenantId } = request.user;
      const template = await db.query.flowTemplates.findFirst({
        where: and(
          eq(flowTemplates.id, request.params.id),
          eq(flowTemplates.tenantId, tenantId),
        ),
      });
      if (!template) return reply.status(404).send({ error: 'Template not found' });
      return reply.send(template);
    },
  );

  /**
   * PUT /v1/flow-templates/:id
   * Update a draft or rejected template.
   */
  fastify.put<{
    Params: { id: string };
    Body: {
      name?: string;
      displayName?: string;
      category?: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
      language?: string;
      components?: MetaTemplateComponent[];
      variableLabels?: Record<string, string>;
    };
  }>(
    '/v1/flow-templates/:id',
    { preHandler: authAndFeature(fastify) },
    async (request, reply) => {
      const { tenantId } = request.user;
      const template = await svc.updateDraft(tenantId, request.params.id, request.body);
      return reply.send(template);
    },
  );

  /**
   * POST /v1/flow-templates/:id/submit
   * Submit template to Meta Graph API for review.
   */
  fastify.post<{ Params: { id: string } }>(
    '/v1/flow-templates/:id/submit',
    { preHandler: authAndFeature(fastify) },
    async (request, reply) => {
      const { tenantId } = request.user;
      const template = await svc.submit(tenantId, request.params.id);
      return reply.send(template);
    },
  );

  /**
   * POST /v1/flow-templates/:id/appeal
   * Resubmit a rejected template (blocked if appealCount >= 2).
   */
  fastify.post<{ Params: { id: string } }>(
    '/v1/flow-templates/:id/appeal',
    { preHandler: authAndFeature(fastify) },
    async (request, reply) => {
      const { tenantId } = request.user;

      // Load template to check appeal count before delegating to service
      const existing = await db.query.flowTemplates.findFirst({
        where: and(
          eq(flowTemplates.id, request.params.id),
          eq(flowTemplates.tenantId, tenantId),
        ),
      });

      if (!existing) return reply.status(404).send({ error: 'Template not found' });

      if (existing.appealCount >= 2) {
        return reply.status(422).send({
          error: 'appeal_limit_reached',
          message: 'Max 2 appeals per template. Contact Meta support directly.',
        });
      }

      const template = await svc.appeal(tenantId, request.params.id);
      return reply.send(template);
    },
  );

  /**
   * POST /v1/flow-templates/:id/pause
   * Pause an approved template (local only).
   */
  fastify.post<{ Params: { id: string } }>(
    '/v1/flow-templates/:id/pause',
    { preHandler: authAndFeature(fastify) },
    async (request, reply) => {
      const { tenantId } = request.user;
      await svc.pause(tenantId, request.params.id);
      return reply.send({ success: true });
    },
  );

  /**
   * DELETE /v1/flow-templates/:id
   * Delete a template. Blocked (409) if referenced by any active flow.
   */
  fastify.delete<{ Params: { id: string } }>(
    '/v1/flow-templates/:id',
    { preHandler: authAndFeature(fastify) },
    async (request, reply) => {
      const { tenantId } = request.user;

      const template = await db.query.flowTemplates.findFirst({
        where: and(
          eq(flowTemplates.id, request.params.id),
          eq(flowTemplates.tenantId, tenantId),
        ),
      });

      if (!template) return reply.status(404).send({ error: 'Template not found' });

      // Compliance §4: block delete if any active flow references this template
      const [activeRef] = await db
        .select({ id: flowDefinitions.id })
        .from(flowDefinitions)
        .where(
          and(
            eq(flowDefinitions.tenantId, tenantId),
            eq(flowDefinitions.status, 'active'),
            sql`${flowDefinitions.definition}::text ILIKE ${'%' + template.name + '%'}`,
          ),
        )
        .limit(1);

      if (activeRef) {
        return reply.status(409).send({
          error: 'template_in_use',
          message: 'Template is referenced by an active flow.',
        });
      }

      await db
        .delete(flowTemplates)
        .where(and(eq(flowTemplates.id, request.params.id), eq(flowTemplates.tenantId, tenantId)));

      return reply.status(204).send();
    },
  );
};
