/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/types.d.ts
 * Role    : Fastify TypeScript augmentation — extends FastifyRequest.user
 *           so JWT payload fields (tenantId, lynkUserId) are typed.
 */
import '@fastify/jwt';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      tenantId: string;
      lynkUserId: string;
      iat?: number;
      exp?: number;
    };
    user: {
      tenantId: string;
      lynkUserId: string;
      iat?: number;
      exp?: number;
    };
  }
}
