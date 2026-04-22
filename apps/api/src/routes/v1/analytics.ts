/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/routes/v1/analytics.ts
 * Role    : Reporting endpoints — dashboard KPIs, funnel, orders over time, top products.
 *           All routes require JWT auth. Raw SQL for aggregations (Drizzle ORM limitation).
 * Exports : analyticsRoutes (Fastify plugin)
 */
import type { FastifyPluginAsync } from 'fastify';
import { pgClient } from '@lynkbot/db';

export const analyticsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /v1/analytics/dashboard
   * Returns key KPIs for the last 30 days.
   */
  fastify.get(
    '/v1/analytics/dashboard',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;

      const [kpis] = await pgClient`
        SELECT
          COUNT(o.id) FILTER (WHERE o.status NOT IN ('pending_payment', 'cancelled'))::int AS total_orders,
          COALESCE(SUM(o.total_amount_idr) FILTER (WHERE o.status NOT IN ('pending_payment', 'cancelled')), 0)::bigint AS revenue,
          COUNT(DISTINCT c.id) FILTER (WHERE c.state != 'INIT')::int AS total_conversations,
          COUNT(DISTINCT c.id) FILTER (WHERE c.state IN ('DELIVERED', 'COMPLETED'))::int AS converted_conversations,
          ROUND(
            CASE WHEN COUNT(DISTINCT c.id) FILTER (WHERE c.state != 'INIT') > 0
              THEN COUNT(DISTINCT c.id) FILTER (WHERE c.state IN ('DELIVERED', 'COMPLETED'))::numeric
                / COUNT(DISTINCT c.id) FILTER (WHERE c.state != 'INIT') * 100
              ELSE 0
            END, 2
          )::float AS conversion_rate,
          ROUND(
            COALESCE(AVG(
              EXTRACT(EPOCH FROM (m_out.created_at - m_in.created_at))
            ), 0)
          , 0)::int AS avg_response_time_sec
        FROM conversations c
        LEFT JOIN orders o ON o.conversation_id = c.id AND o.created_at >= NOW() - INTERVAL '30 days'
        LEFT JOIN LATERAL (
          SELECT created_at FROM messages
          WHERE conversation_id = c.id AND direction = 'inbound'
          ORDER BY created_at ASC LIMIT 1
        ) m_in ON true
        LEFT JOIN LATERAL (
          SELECT created_at FROM messages
          WHERE conversation_id = c.id AND direction = 'outbound'
          ORDER BY created_at ASC LIMIT 1
        ) m_out ON true
        WHERE c.tenant_id = ${tenantId}
          AND c.started_at >= NOW() - INTERVAL '30 days'
      `;

      return reply.send({
        totalOrders: kpis?.total_orders ?? 0,
        revenue: kpis?.revenue ?? 0,
        conversionRate: kpis?.conversion_rate ?? 0,
        avgResponseTimeSec: kpis?.avg_response_time_sec ?? 0,
      });
    },
  );

  /**
   * GET /v1/analytics/funnel
   * Per-state conversation counts for funnel analysis.
   */
  fastify.get(
    '/v1/analytics/funnel',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;

      const rows = await pgClient`
        SELECT
          state,
          COUNT(*)::int AS count
        FROM conversations
        WHERE tenant_id = ${tenantId}
          AND started_at >= NOW() - INTERVAL '30 days'
        GROUP BY state
        ORDER BY count DESC
      `;

      const funnel = rows.map(r => ({ state: r.state, count: r.count }));
      return reply.send(funnel);
    },
  );

  /**
   * GET /v1/analytics/orders-over-time
   * Daily order count and revenue for the last N days (default 30).
   */
  fastify.get<{ Querystring: { days?: string } }>(
    '/v1/analytics/orders-over-time',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;
      const days = Math.min(365, Math.max(1, parseInt(request.query.days ?? '30', 10)));

      const rows = await pgClient`
        SELECT
          DATE_TRUNC('day', created_at)::date AS date,
          COUNT(*)::int AS count,
          COALESCE(SUM(total_amount_idr), 0)::bigint AS revenue
        FROM orders
        WHERE tenant_id = ${tenantId}
          AND status NOT IN ('pending_payment', 'cancelled')
          AND created_at >= NOW() - (${days} || ' days')::interval
        GROUP BY DATE_TRUNC('day', created_at)
        ORDER BY date ASC
      `;

      return reply.send(rows.map(r => ({
        date: r.date,
        count: r.count,
        revenue: r.revenue,
      })));
    },
  );

  /**
   * GET /v1/analytics/top-products
   * Top products by units sold, revenue, and conversion rate.
   */
  fastify.get(
    '/v1/analytics/top-products',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;

      const rows = await pgClient`
        SELECT
          p.id AS product_id,
          p.name,
          COALESCE(SUM(o.quantity) FILTER (WHERE o.status NOT IN ('pending_payment', 'cancelled')), 0)::int AS units_sold,
          COALESCE(SUM(o.total_amount_idr) FILTER (WHERE o.status NOT IN ('pending_payment', 'cancelled')), 0)::bigint AS revenue,
          COUNT(DISTINCT c.id) FILTER (WHERE c.state != 'INIT')::int AS total_convs,
          COUNT(DISTINCT c.id) FILTER (WHERE c.state IN ('DELIVERED', 'COMPLETED'))::int AS converted_convs,
          ROUND(
            CASE WHEN COUNT(DISTINCT c.id) FILTER (WHERE c.state != 'INIT') > 0
              THEN COUNT(DISTINCT c.id) FILTER (WHERE c.state IN ('DELIVERED', 'COMPLETED'))::numeric
                / COUNT(DISTINCT c.id) FILTER (WHERE c.state != 'INIT') * 100
              ELSE 0
            END, 2
          )::float AS conversion_rate
        FROM products p
        LEFT JOIN orders o ON o.product_id = p.id AND o.tenant_id = ${tenantId}
        LEFT JOIN conversations c ON c.product_id = p.id AND c.tenant_id = ${tenantId}
        WHERE p.tenant_id = ${tenantId}
          AND p.is_active = true
        GROUP BY p.id, p.name
        ORDER BY revenue DESC
        LIMIT 20
      `;

      return reply.send(rows.map(r => ({
        productId: r.product_id,
        name: r.name,
        unitsSold: r.units_sold,
        revenue: r.revenue,
        conversionRate: r.conversion_rate,
      })));
    },
  );
};
