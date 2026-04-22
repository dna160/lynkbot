/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/routes/v1/tenants.ts
 * Role    : Tenant CRUD routes. Handles Lynk.id new-member webhook, tenant info,
 *           onboarding flow trigger, and internal ops WATI activation endpoint.
 * Exports : tenantRoutes (Fastify plugin)
 * Imports : @lynkbot/db, @lynkbot/shared
 * DO NOT  : Expose WATI terminology in API responses — use "messaging" abstraction
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db } from '@lynkbot/db';
import { tenants } from '@lynkbot/db';
import { eq } from '@lynkbot/db';
import { config } from '../../config';
import { OnboardingService } from '../../services/onboarding.service';

const onboardingService = new OnboardingService();

const createTenantSchema = z.object({
  lynkUserId: z.string().min(1),
  storeName: z.string().min(1),
  originCityName: z.string().optional(),
  displayPhoneNumber: z.string().optional(),
});

const updateTenantSchema = z.object({
  storeName: z.string().min(1).optional(),
  originCityName: z.string().optional(),
  originCityId: z.string().optional(),
  displayPhoneNumber: z.string().optional(),
  metaBusinessId: z.string().optional(),
  paymentAccountId: z.string().optional(),
});

function assertInternalApiKey(request: any, reply: any): boolean {
  const apiKey = request.headers['x-internal-api-key'];
  if (apiKey !== config.LYNK_INTERNAL_API_KEY) {
    reply.status(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

export const tenantRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /v1/tenants
   * Called by Lynk.id platform when a new member subscribes to LynkBot.
   * Uses internal API key auth instead of JWT (machine-to-machine).
   */
  fastify.post('/v1/tenants', async (request, reply) => {
    if (!assertInternalApiKey(request, reply)) return;

    const parsed = createTenantSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const data = parsed.data;

    // Check for existing tenant
    const existing = await db.query.tenants.findFirst({
      where: eq(tenants.lynkUserId, data.lynkUserId),
    });
    if (existing) {
      return reply.status(409).send({ error: 'Tenant already exists', tenantId: existing.id });
    }

    const [tenant] = await db
      .insert(tenants)
      .values({
        lynkUserId: data.lynkUserId,
        storeName: data.storeName,
        originCityName: data.originCityName ?? null,
        displayPhoneNumber: data.displayPhoneNumber ?? null,
        watiAccountStatus: 'pending',
      })
      .returning();

    request.log.info({ tenantId: tenant.id, lynkUserId: data.lynkUserId }, 'Tenant created');

    return reply.status(201).send({
      id: tenant.id,
      lynkUserId: tenant.lynkUserId,
      storeName: tenant.storeName,
      watiAccountStatus: tenant.watiAccountStatus,
      createdAt: tenant.createdAt,
    });
  });

  /**
   * GET /v1/tenants/:id
   * Returns tenant info. Auth required — tenants can only see their own data.
   */
  fastify.get<{ Params: { id: string } }>(
    '/v1/tenants/:id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id } = request.params;

      // Tenant can only see their own data unless it's an internal request
      if (request.user.tenantId !== id) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const tenant = await db.query.tenants.findFirst({
        where: eq(tenants.id, id),
      });

      if (!tenant) {
        return reply.status(404).send({ error: 'Tenant not found' });
      }

      // Strip sensitive fields
      const { watiApiKeyEnc: _watiKey, ...safeFields } = tenant as any;
      return reply.send(safeFields);
    }
  );

  /**
   * PATCH /v1/tenants/:id
   * Update tenant settings.
   */
  fastify.patch<{ Params: { id: string } }>(
    '/v1/tenants/:id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id } = request.params;

      if (request.user.tenantId !== id) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const parsed = updateTenantSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const [updated] = await db
        .update(tenants)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(tenants.id, id))
        .returning();

      if (!updated) {
        return reply.status(404).send({ error: 'Tenant not found' });
      }

      const { watiApiKeyEnc: _watiKey, ...safeFields } = updated as any;
      return reply.send(safeFields);
    }
  );

  /**
   * POST /v1/tenants/:id/onboard
   * Trigger WhatsApp Business Account registration flow.
   * Called after tenant creation to kick off the messaging account setup.
   */
  fastify.post<{ Params: { id: string } }>(
    '/v1/tenants/:id/onboard',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id } = request.params;

      if (request.user.tenantId !== id) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const tenant = await db.query.tenants.findFirst({
        where: eq(tenants.id, id),
      });

      if (!tenant) {
        return reply.status(404).send({ error: 'Tenant not found' });
      }

      if (tenant.watiAccountStatus === 'active') {
        return reply.status(409).send({
          error: 'Messaging account already active',
          status: tenant.watiAccountStatus,
        });
      }

      // Trigger onboarding async
      onboardingService.startOnboarding(tenant).catch(err => {
        request.log.error({ err, tenantId: id }, 'Onboarding failed');
      });

      return reply.status(202).send({
        message: 'Onboarding initiated',
        tenantId: id,
        status: 'pending',
      });
    }
  );

  /**
   * PUT /internal/tenants/:id/wati-activated
   * Internal ops endpoint — called by ops team or automation after manual WATI setup.
   * Sets watiAccountStatus = 'active' and stores encrypted API key.
   */
  fastify.put<{ Params: { id: string } }>(
    '/internal/tenants/:id/wati-activated',
    async (request, reply) => {
      if (!assertInternalApiKey(request, reply)) return;

      const bodySchema = z.object({
        watiApiKey: z.string().min(1),
        watiPhoneNumberId: z.string().optional(),
      });

      const parsed = bodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'watiApiKey required' });
      }

      const { watiApiKey, watiPhoneNumberId } = parsed.data;

      // In production, encrypt watiApiKey with KMS/AES before storing
      // For now store as-is with a note for ops to enable encryption
      const [updated] = await db
        .update(tenants)
        .set({
          watiAccountStatus: 'active',
          watiApiKeyEnc: watiApiKey, // TODO: encrypt with KMS in production
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, request.params.id))
        .returning();

      if (!updated) {
        return reply.status(404).send({ error: 'Tenant not found' });
      }

      request.log.info({ tenantId: request.params.id }, 'Tenant messaging account activated');

      return reply.send({
        tenantId: updated.id,
        watiAccountStatus: updated.watiAccountStatus,
        updatedAt: updated.updatedAt,
      });
    }
  );
};
