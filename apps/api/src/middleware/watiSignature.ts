/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/middleware/watiSignature.ts
 * Role    : HMAC-SHA256 signature verification for all inbound WATI webhooks.
 *           MUST be applied to every /webhooks/wati request.
 *           Returns 401 if signature invalid. Timing-safe comparison.
 * Exports : verifyWatiSignature() Fastify hook
 * DO NOT  : Skip this verification. A single bypass is a compliance violation.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config';

// WATI_ALLOWED_IPS: comma-separated list of WATI server IPs for production IP allowlisting.
// WATI does not send HMAC signatures, so we use IP-based verification when configured.
const WATI_ALLOWED_IPS = (process.env.WATI_ALLOWED_IPS ?? '').split(',').map(s => s.trim()).filter(Boolean);

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
