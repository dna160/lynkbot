import type { FastifyPluginAsync } from 'fastify';
import { db, tenants } from '@lynkbot/db';
import { eq } from '@lynkbot/db';
import { OnboardingService } from '../../services/onboarding.service';

const svc = new OnboardingService();

export const onboardingRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /v1/onboarding/complete
   * Two-path WABA connection:
   *   { mode: 'pool' }                          — auto-assign from LynkBot pool
   *   { mode: 'manual', metaPhoneNumberId, wabaId, metaAccessToken } — BYO WABA
   */
  fastify.post(
    '/v1/onboarding/complete',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const tenantId = (request as any).user?.tenantId as string;
      const body = request.body as Record<string, unknown>;

      const mode = body.mode as string;
      if (mode !== 'pool' && mode !== 'manual') {
        return reply.status(400).send({ error: 'mode must be "pool" or "manual"' });
      }

      let input: Parameters<typeof svc.completeOnboarding>[1];
      if (mode === 'pool') {
        input = { mode: 'pool' };
      } else {
        const pid = body.metaPhoneNumberId as string | undefined;
        const wid = body.wabaId as string | undefined;
        const tok = body.metaAccessToken as string | undefined;
        if (!pid || !wid || !tok) {
          return reply.status(400).send({ error: 'metaPhoneNumberId, wabaId, and metaAccessToken are required for manual mode' });
        }
        input = { mode: 'manual', metaPhoneNumberId: pid, wabaId: wid, metaAccessToken: tok };
      }

      const result = await svc.completeOnboarding(tenantId, input);
      if (!result.success) {
        return reply.status(result.reason === 'invalid_credentials' ? 400 : 502).send({
          error: result.reason,
          message: result.message,
        });
      }

      return reply.send({ success: true, displayPhone: result.displayPhone });
    },
  );

  /**
   * GET /v1/onboarding/status
   * Returns whether this tenant has an active WABA connection.
   */
  fastify.get(
    '/v1/onboarding/status',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const tenantId = (request as any).user?.tenantId as string;
      const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
      if (!tenant) return reply.status(404).send({ error: 'Tenant not found' });

      const onboarded = tenant.watiAccountStatus === 'active' && !!tenant.metaPhoneNumberId;
      return reply.send({
        onboarded,
        displayPhone: tenant.displayPhoneNumber ?? null,
        watiStatus: tenant.watiAccountStatus,
      });
    },
  );
};
