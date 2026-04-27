/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/middleware/metaSignature.ts
 * Role    : Validates X-Hub-Signature-256 HMAC on every inbound Meta webhook POST.
 *           Uses META_APP_SECRET (your Meta App's App Secret, not access token).
 *           Rejects requests without a valid signature with 401.
 *           In development with no APP_SECRET set, logs a warning but allows through.
 * Exports : verifyMetaSignature() Fastify preHandler hook
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyWebhookSignature } from '@lynkbot/meta';
import { config } from '../config';

export async function verifyMetaSignature(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // Skip HMAC check if no app secret is configured (local dev without a live Meta app)
  if (!config.META_APP_SECRET) {
    if (config.NODE_ENV === 'production') {
      request.log.error('META_APP_SECRET is not set in production — rejecting webhook');
      return reply.status(401).send({ error: 'Webhook signature verification not configured' });
    }
    request.log.warn('META_APP_SECRET not set — skipping signature check (dev only)');
    return;
  }

  const signature = request.headers['x-hub-signature-256'];
  if (!signature || typeof signature !== 'string') {
    request.log.warn({ url: request.url }, 'Meta webhook missing X-Hub-Signature-256');
    return reply.status(401).send({ error: 'Missing webhook signature' });
  }

  // Fastify stores the raw body in request.rawBody when addContentTypeParser is configured.
  // Fall back to JSON.stringify of parsed body if raw is unavailable.
  const rawBody: Buffer | string = (request as unknown as { rawBody?: Buffer }).rawBody
    ?? Buffer.from(JSON.stringify(request.body));

  const valid = verifyWebhookSignature(rawBody, signature, config.META_APP_SECRET);
  if (!valid) {
    request.log.warn({ url: request.url }, 'Meta webhook signature mismatch — rejected');
    return reply.status(401).send({ error: 'Invalid webhook signature' });
  }
}
