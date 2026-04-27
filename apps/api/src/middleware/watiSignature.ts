/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/middleware/watiSignature.ts
 * Role    : DEPRECATED — retained as stub. WATI webhook is no longer used.
 *           The route still exports this hook to avoid removing the import,
 *           but it always passes through (allow-all).
 * Exports : verifyWatiSignature() Fastify hook
 */
import type { FastifyRequest, FastifyReply } from 'fastify';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function verifyWatiSignature(
  _request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  // No-op — WATI webhook is deprecated. Meta webhook uses metaSignature.ts instead.
}
