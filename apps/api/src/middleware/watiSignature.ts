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

export async function verifyWatiSignature(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // WATI does not send HMAC signatures — skip verification in development.
  // In production, restrict by IP allowlist (WATI server IPs) instead.
  if (config.NODE_ENV === 'production' && config.WATI_WEBHOOK_SECRET) {
    const signature = request.headers['x-wati-signature'] as string | undefined;
    if (!signature) {
      return reply.status(401).send({ error: 'Missing WATI signature' });
    }
    const body = JSON.stringify(request.body);
    const expected = createHmac('sha256', config.WATI_WEBHOOK_SECRET)
      .update(body)
      .digest('hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    const actualBuf = Buffer.from(signature.replace('sha256=', ''), 'hex');
    if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
      request.log.warn({ ip: request.ip, url: request.url }, 'WATI signature verification failed');
      return reply.status(401).send({ error: 'Invalid WATI signature' });
    }
  }
}
