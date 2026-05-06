/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/plugins/metrics.ts
 * Role    : Prometheus-style metrics exposure via prom-client
 *           Exposes /metrics endpoint for scraping
 */
import type { FastifyPluginAsync } from 'fastify';

// Lazy-load prom-client to avoid hard dependency at startup
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  client = require('prom-client');
  client.collectDefaultMetrics();
} catch {
  console.warn('[metrics] prom-client not installed — metrics endpoint will return placeholder');
}

const webhookLatency = client
  ? new client.Histogram({
      name: 'webhook_latency_seconds',
      help: 'Meta webhook processing latency in seconds',
      labelNames: ['status'],
      buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5],
    })
  : null;

const messagesTotal = client
  ? new client.Counter({
      name: 'messages_total',
      help: 'Total messages processed',
      labelNames: ['direction', 'status'],
    })
  : null;

const flowExecutionsTotal = client
  ? new client.Counter({
      name: 'flow_executions_total',
      help: 'Total flow executions',
      labelNames: ['status'],
    })
  : null;

const llmRequestsTotal = client
  ? new client.Counter({
      name: 'llm_requests_total',
      help: 'Total LLM requests',
      labelNames: ['provider', 'status'],
    })
  : null;

const queueDepthGauge = client
  ? new client.Gauge({
      name: 'queue_depth',
      help: 'Current depth of BullMQ queues',
      labelNames: ['queue', 'status'],
    })
  : null;

export const metricsPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.get('/metrics', async (_request, reply) => {
    if (client) {
      const metrics = await client.register.metrics();
      return reply.type('text/plain').send(metrics);
    }
    return reply.type('text/plain').send('# Metrics unavailable — prom-client not installed\n');
  });
};

export function recordWebhookLatency(status: 'success' | 'failure', durationMs: number): void {
  webhookLatency?.observe({ status }, durationMs / 1000);
}

export function recordMessage(direction: 'inbound' | 'outbound', status: 'success' | 'failure'): void {
  messagesTotal?.inc({ direction, status });
}

export function recordFlowExecution(status: 'completed' | 'failed' | 'cancelled'): void {
  flowExecutionsTotal?.inc({ status });
}

export function recordLLMRequest(provider: string, status: 'success' | 'failure'): void {
  llmRequestsTotal?.inc({ provider, status });
}

export function recordQueueDepth(queue: string, status: 'waiting' | 'active' | 'completed' | 'failed', count: number): void {
  queueDepthGauge?.set({ queue, status }, count);
}
