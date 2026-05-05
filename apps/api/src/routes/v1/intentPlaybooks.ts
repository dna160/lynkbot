/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/routes/v1/intentPlaybooks.ts
 * Role    : CRUD API for Intent Playbooks. All routes are tenant-scoped.
 *           GET    /v1/intent-playbooks          → list all for tenant
 *           POST   /v1/intent-playbooks          → create
 *           PUT    /v1/intent-playbooks/:id      → update
 *           DELETE /v1/intent-playbooks/:id      → delete
 *           PATCH  /v1/intent-playbooks/:id/toggle → toggle active
 * Exports : intentPlaybookRoutes (Fastify plugin)
 */
import type { FastifyPluginAsync } from 'fastify';
import { IntentPlaybookService } from '../../services/intentPlaybook.service';

const svc = new IntentPlaybookService();

const authOnly = (fastify: Parameters<FastifyPluginAsync>[0]) => [
  fastify.authenticate,
];

export const intentPlaybookRoutes: FastifyPluginAsync = async (fastify) => {
  /** GET /v1/intent-playbooks — list all for this tenant */
  fastify.get('/v1/intent-playbooks', { preHandler: authOnly(fastify) }, async (request, reply) => {
    const { tenantId } = request.user;
    const playbooks = await svc.listForTenant(tenantId);
    return reply.send({ playbooks });
  });

  /** POST /v1/intent-playbooks — create */
  fastify.post<{ Body: Record<string, unknown> }>(
    '/v1/intent-playbooks',
    { preHandler: authOnly(fastify) },
    async (request, reply) => {
      const { tenantId } = request.user;
      const body = request.body;

      if (!body.intentKey || !body.label) {
        return reply.status(400).send({ error: 'intentKey and label are required' });
      }

      const playbook = await svc.create(tenantId, {
        intentKey: body.intentKey as never,
        label: body.label as string,
        description: (body.description as string) ?? null,
        isActive: body.isActive !== false,
        priority: (body.priority as number) ?? 0,
        systemPromptAddition: (body.systemPromptAddition as string) ?? '',
        toneNote: (body.toneNote as string) ?? null,
        nextStepType: (body.nextStepType as never) ?? 'continue_conversation',
        nextStepConfig: (body.nextStepConfig as Record<string, unknown>) ?? null,
        detectionKeywords: (body.detectionKeywords as string[]) ?? null,
        fallbackMessage: (body.fallbackMessage as string) ?? null,
      });

      return reply.status(201).send({ playbook });
    },
  );

  /** PUT /v1/intent-playbooks/:id — update */
  fastify.put<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/v1/intent-playbooks/:id',
    { preHandler: authOnly(fastify) },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { id } = request.params;
      const body = request.body;

      const updated = await svc.update(id, tenantId, {
        ...(body.label !== undefined && { label: body.label as string }),
        ...(body.description !== undefined && { description: body.description as string }),
        ...(body.isActive !== undefined && { isActive: body.isActive as boolean }),
        ...(body.priority !== undefined && { priority: body.priority as number }),
        ...(body.systemPromptAddition !== undefined && { systemPromptAddition: body.systemPromptAddition as string }),
        ...(body.toneNote !== undefined && { toneNote: body.toneNote as string }),
        ...(body.nextStepType !== undefined && { nextStepType: body.nextStepType as never }),
        ...(body.nextStepConfig !== undefined && { nextStepConfig: body.nextStepConfig as Record<string, unknown> }),
        ...(body.detectionKeywords !== undefined && { detectionKeywords: body.detectionKeywords as string[] }),
        ...(body.fallbackMessage !== undefined && { fallbackMessage: body.fallbackMessage as string }),
      });

      if (!updated) return reply.status(404).send({ error: 'Playbook not found' });
      return reply.send({ playbook: updated });
    },
  );

  /** DELETE /v1/intent-playbooks/:id */
  fastify.delete<{ Params: { id: string } }>(
    '/v1/intent-playbooks/:id',
    { preHandler: authOnly(fastify) },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { id } = request.params;
      const deleted = await svc.delete(id, tenantId);
      if (!deleted) return reply.status(404).send({ error: 'Playbook not found' });
      return reply.send({ success: true });
    },
  );

  /** PATCH /v1/intent-playbooks/:id/toggle — toggle active */
  fastify.patch<{ Params: { id: string } }>(
    '/v1/intent-playbooks/:id/toggle',
    { preHandler: authOnly(fastify) },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { id } = request.params;
      const existing = await svc.getById(id, tenantId);
      if (!existing) return reply.status(404).send({ error: 'Playbook not found' });
      const updated = await svc.update(id, tenantId, { isActive: !existing.isActive });
      return reply.send({ playbook: updated });
    },
  );
};
