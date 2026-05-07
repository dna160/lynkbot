/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/routes/internal/compliance.ts
 * Role    : Compliance & consent audit API. GDPR/privacy exports.
 *           Protected by tenant JWT (staff role).
 *           Admin endpoints use x-api-key + admin JWT.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db, consentAudit, tenants } from '@lynkbot/db';
import { eq, and, desc, gte, sql } from '@lynkbot/db';

export async function complianceRoutes(server: FastifyInstance): Promise<void> {
  // Get consent audit log for current tenant
  server.get('/api/compliance/consents', {
    preHandler: [server.authenticate],
    handler: async (req: FastifyRequest<{ Querystring: { limit?: string; search?: string; days?: string } }>, reply: FastifyReply) => {
      const tenantId = (req as any).user.tenantId;
      const limit = Math.min(parseInt(req.query.limit ?? '100'), 500);
      const days = parseInt(req.query.days ?? '30');
      const search = req.query.search?.trim();

      const since = new Date();
      since.setDate(since.getDate() - days);

      const conditions = [
        eq(consentAudit.tenantId, tenantId),
        gte(consentAudit.createdAt, since),
      ];

      if (search) {
        conditions.push(sql`EXISTS (SELECT 1 FROM buyers b WHERE b.id = ${consentAudit.buyerId} AND b.wa_id ILIKE ${`%${search}%`})`);
      }

      const rows = await db
        .select()
        .from(consentAudit)
        .where(and(...conditions))
        .orderBy(desc(consentAudit.createdAt))
        .limit(limit);

      return reply.send({ consents: rows });
    },
  });

  // Export consent audit as CSV
  server.get('/api/compliance/consents/export', {
    preHandler: [server.authenticate],
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (req as any).user.tenantId;

      const rows = await db
        .select()
        .from(consentAudit)
        .where(eq(consentAudit.tenantId, tenantId))
        .orderBy(desc(consentAudit.createdAt));

      const headers = ['ID', 'Buyer ID', 'Action', 'Channel', 'Created At', 'IP Address', 'User Agent'];
      const lines = rows.map(r => [
        r.id,
        r.buyerId ?? '',
        r.action,
        r.channel,
        r.createdAt.toISOString(),
        r.ipAddress ?? '',
        r.userAgent ?? '',
      ].map(escapeCsv).join(','));

      const csv = [headers.join(','), ...lines].join('\n');

      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', `attachment; filename="consent-export-${tenantId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.csv"`);
      return reply.send(csv);
    },
  });

  // Get privacy config for current tenant
  server.get('/api/compliance/config', {
    preHandler: [server.authenticate],
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (req as any).user.tenantId;
      const tenant = await db
        .select()
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);

      const t = tenant[0];

      return reply.send({
        privacyNoticeText: t?.privacyNoticeText ?? 'Your privacy is important. Reply STOP to opt out.',
        contactInfo: t?.contactInfo ?? 'support@example.com',
        optOutKeyword: t?.optOutKeyword ?? 'STOP',
        retentionDays: t?.retentionDays ?? 365,
      });
    },
  });

  // Update privacy config for current tenant
  server.post('/api/compliance/config', {
    preHandler: [server.authenticate],
    handler: async (req: FastifyRequest<{ Body: { privacyNoticeText: string; contactInfo: string; optOutKeyword: string; retentionDays: number } }>, reply: FastifyReply) => {
      const tenantId = (req as any).user.tenantId;
      const { privacyNoticeText, contactInfo, optOutKeyword, retentionDays } = req.body;

      await db
        .update(tenants)
        .set({
          privacyNoticeText: privacyNoticeText?.slice(0, 2000),
          contactInfo: contactInfo?.slice(0, 255),
          optOutKeyword: optOutKeyword?.slice(0, 50)?.toUpperCase(),
          retentionDays: Math.min(Math.max(retentionDays ?? 365, 1), 2555),
        })
        .where(eq(tenants.id, tenantId));

      return reply.send({ success: true });
    },
  });
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
