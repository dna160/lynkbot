/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/plugins/auth.ts
 * Role    : JWT validation Fastify plugin. Verifies JWT_SECRET. Extracts tenantId
 *           from JWT claims and attaches to request. Decorates fastify instance
 *           with authenticate preHandler and request.user.
 * Exports : authPlugin (Fastify plugin)
 * DO NOT  : Implement business logic here — only authentication/decoration
 */
import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user: {
      tenantId: string;
      lynkUserId: string;
      iat?: number;
      exp?: number;
    };
  }
}

const authPluginImpl: FastifyPluginAsync = async (fastify) => {
  await fastify.register(fastifyJwt, {
    secret: config.JWT_SECRET,
  });

  fastify.decorate(
    'authenticate',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      try {
        await request.jwtVerify();
        const payload = request.user as {
          tenantId?: string;
          lynkUserId?: string;
        };
        if (!payload.tenantId) {
          return reply.status(401).send({ error: 'Invalid token: missing tenantId claim' });
        }
      } catch (err) {
        reply.status(401).send({ error: 'Unauthorized' });
      }
    }
  );
};

export const authPlugin = fp(authPluginImpl, {
  name: 'auth',
  fastify: '4.x',
});
