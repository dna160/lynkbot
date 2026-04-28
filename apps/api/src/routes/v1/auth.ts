/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/routes/v1/auth.ts
 * Role    : Lynk.id SSO passthrough stub.
 *           TODO: Replace mock JWT with actual Lynk.id SSO token exchange.
 *           Returns a mocked JWT for development. Production requires Lynk.id integration.
 * Exports : authRoutes (Fastify plugin)
 * DO NOT  : Use in production without Lynk.id SSO integration
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db, tenants } from '@lynkbot/db';
import { eq } from '@lynkbot/db';

const loginBodySchema = z.object({
  lynkUserId: z.string().min(1),
});

const refreshBodySchema = z.object({
  token: z.string().min(1),
});

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  // TODO: Replace with actual Lynk.id SSO integration
  fastify.post('/v1/auth/login', async (request, reply) => {
    const parsed = loginBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'lynkUserId required' });
    }
    const { lynkUserId } = parsed.data;

    try {
      // Look up or auto-create tenant so JWT carries the real UUID
      let tenant = await db.query.tenants.findFirst({
        where: eq(tenants.lynkUserId, lynkUserId),
      });
      if (!tenant) {
        const [created] = await db.insert(tenants).values({
          lynkUserId,
          storeName: lynkUserId,
        }).returning();
        tenant = created;
      }

      const token = fastify.jwt.sign(
        { tenantId: tenant!.id, lynkUserId },
        { expiresIn: '7d' }
      );

      return reply.send({
        token,
        expiresIn: 7 * 24 * 60 * 60,
        tokenType: 'Bearer',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      fastify.log.error({ err }, 'Login error');
      return reply.status(500).send({ error: msg, statusCode: 500 });
    }
  });

  fastify.get(
    '/v1/auth/me',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      return reply.send({
        tenantId: request.user.tenantId,
        lynkUserId: request.user.lynkUserId,
      });
    }
  );

  fastify.post('/v1/auth/refresh', async (request, reply) => {
    const parsed = refreshBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'token required' });
    }
    try {
      const decoded = fastify.jwt.verify(parsed.data.token) as {
        tenantId: string;
        lynkUserId: string;
      };
      const newToken = fastify.jwt.sign(
        { tenantId: decoded.tenantId, lynkUserId: decoded.lynkUserId },
        { expiresIn: '7d' }
      );
      return reply.send({
        token: newToken,
        expiresIn: 7 * 24 * 60 * 60,
        tokenType: 'Bearer',
      });
    } catch {
      return reply.status(401).send({ error: 'Invalid or expired token' });
    }
  });

  fastify.post('/v1/auth/logout', { preHandler: fastify.authenticate }, async (_request, reply) => {
    // Stateless JWT — client discards token
    // TODO: Add token blacklist if needed in production
    return reply.send({ message: 'Logged out successfully' });
  });
};
