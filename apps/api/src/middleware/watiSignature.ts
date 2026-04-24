/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/middleware/watiSignature.ts
 * Role    : Inbound WATI webhook request gating.
 *           WATI does NOT send HMAC signatures — IP allowlisting is the optional
 *           production-hardening path (set WATI_ALLOWED_IPS env var).
 *           In development / when WATI_ALLOWED_IPS is unset, all sources are accepted.
 * Exports : verifyWatiSignature() Fastify hook
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config';

const WATI_ALLOWED_IPS = config.WATI_ALLOWED_IPS
  ? config.WATI_ALLOWED_IPS.split(',').map(s => s.trim()).filter(Boolean)
  : [];

export async function verifyWatiSignature(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // If IP allowlist is configured, enforce it in production
  if (config.NODE_ENV === 'production' && WATI_ALLOWED_IPS.length > 0) {
    const clientIp = request.ip;
    if (!WATI_ALLOWED_IPS.includes(clientIp)) {
      request.log.warn({ ip: clientIp, url: request.url }, 'WATI webhook rejected: IP not in allowlist');
      return reply.status(401).send({ error: 'Unauthorized webhook source' });
    }
  }
  // No HMAC check — WATI does not send signatures
}
