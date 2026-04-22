/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/middleware/paymentSignature.ts
 * Role    : Signature verification for Midtrans and Xendit webhooks.
 *           Midtrans: SHA512(orderId + statusCode + grossAmount + serverKey)
 *           Xendit: Verify x-callback-token header matches XENDIT_WEBHOOK_TOKEN
 * Exports : verifyMidtransSignature(), verifyXenditSignature()
 * DO NOT  : Skip verification — every unverified webhook is a fraud vector
 */
import { createHash, timingSafeEqual } from 'crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config';

interface MidtransWebhookBody {
  order_id: string;
  status_code: string;
  gross_amount: string;
  signature_key: string;
}

/**
 * Midtrans signature: SHA512(order_id + status_code + gross_amount + server_key)
 */
export async function verifyMidtransSignature(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const body = request.body as MidtransWebhookBody;

  if (!body || !body.order_id || !body.status_code || !body.gross_amount || !body.signature_key) {
    request.log.warn({ ip: request.ip }, 'Midtrans webhook missing required fields');
    return reply.status(400).send({ error: 'Missing required webhook fields' });
  }

  const serverKey = config.MIDTRANS_SERVER_KEY;
  if (!serverKey) {
    request.log.error('MIDTRANS_SERVER_KEY not configured');
    return reply.status(500).send({ error: 'Payment provider not configured' });
  }

  const rawSignature = `${body.order_id}${body.status_code}${body.gross_amount}${serverKey}`;
  const expected = createHash('sha512').update(rawSignature).digest('hex');

  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = Buffer.from(body.signature_key, 'hex');

  if (
    expectedBuf.length !== actualBuf.length ||
    !timingSafeEqual(expectedBuf, actualBuf)
  ) {
    request.log.warn(
      { ip: request.ip, orderId: body.order_id },
      'Midtrans signature verification failed'
    );
    return reply.status(401).send({ error: 'Invalid Midtrans signature' });
  }
}

/**
 * Xendit signature: compare x-callback-token header against XENDIT_WEBHOOK_TOKEN
 * Timing-safe comparison to prevent timing attacks.
 */
export async function verifyXenditSignature(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const token = request.headers['x-callback-token'] as string | undefined;

  if (!token) {
    request.log.warn({ ip: request.ip }, 'Xendit webhook missing x-callback-token header');
    return reply.status(401).send({ error: 'Missing x-callback-token header' });
  }

  const webhookToken = config.XENDIT_WEBHOOK_TOKEN;
  if (!webhookToken) {
    request.log.error('XENDIT_WEBHOOK_TOKEN not configured');
    return reply.status(500).send({ error: 'Payment provider not configured' });
  }

  // Pad to equal length for timingSafeEqual
  const expectedBuf = Buffer.from(webhookToken, 'utf8');
  const actualBuf = Buffer.from(token, 'utf8');

  if (expectedBuf.length !== actualBuf.length) {
    request.log.warn({ ip: request.ip }, 'Xendit callback token length mismatch');
    return reply.status(401).send({ error: 'Invalid callback token' });
  }

  if (!timingSafeEqual(expectedBuf, actualBuf)) {
    request.log.warn({ ip: request.ip }, 'Xendit callback token verification failed');
    return reply.status(401).send({ error: 'Invalid callback token' });
  }
}
