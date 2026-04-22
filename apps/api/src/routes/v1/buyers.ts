/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/routes/v1/buyers.ts
 * Role    : Contact list management — list, import from CSV/XLSX, delete.
 *           Import accepts multipart file upload; upserts by wa_phone+tenantId.
 * Exports : buyerRoutes (Fastify plugin)
 */
import type { FastifyPluginAsync } from 'fastify';
import { eq, and, ilike, desc, or, sql } from '@lynkbot/db';
import { db, buyers } from '@lynkbot/db';
import * as XLSX from 'xlsx';

function normalisePhone(raw: string): string {
  // Strip spaces, dashes, parentheses, leading +
  let p = String(raw).replace(/[\s\-().+]/g, '');
  // If starts with 0 (Indonesian local), replace with 62
  if (p.startsWith('0')) p = '62' + p.slice(1);
  return p;
}

export const buyerRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /v1/buyers
   * Paginated contact list with optional search.
   */
  fastify.get<{
    Querystring: { search?: string; page?: string; limit?: string; tag?: string }
  }>(
    '/v1/buyers',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;
      const page = Math.max(1, parseInt(request.query.page ?? '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt(request.query.limit ?? '50', 10)));
      const offset = (page - 1) * limit;
      const search = request.query.search?.trim();

      const conditions: any[] = [eq(buyers.tenantId, tenantId)];
      if (search) {
        conditions.push(
          or(
            ilike(buyers.displayName, `%${search}%`),
            ilike(buyers.waPhone, `%${search}%`),
          )!,
        );
      }

      const [rows, countResult] = await Promise.all([
        db.select().from(buyers)
          .where(and(...conditions))
          .orderBy(desc(buyers.updatedAt))
          .limit(limit)
          .offset(offset),
        db.select({ count: sql<number>`count(*)::int` }).from(buyers)
          .where(and(...conditions)),
      ]);

      return reply.send({
        items: rows,
        total: countResult[0]?.count ?? 0,
        page,
        limit,
      });
    },
  );

  /**
   * POST /v1/buyers/import
   * Upload CSV or XLSX file, parse contacts, upsert into buyers table.
   * Expected columns (case-insensitive): phone/wa_phone, name/display_name,
   *   language, tags (comma-separated), notes.
   */
  fastify.post(
    '/v1/buyers/import',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;

      const data = await request.file();
      if (!data) return reply.status(400).send({ error: 'No file uploaded' });

      const buf = await data.toBuffer();
      const filename = data.filename?.toLowerCase() ?? '';

      let rows: Record<string, string>[] = [];

      if (filename.endsWith('.csv')) {
        const wb = XLSX.read(buf, { type: 'buffer', raw: false });
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(ws, { defval: '' }) as Record<string, string>[];
      } else if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
        const wb = XLSX.read(buf, { type: 'buffer' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(ws, { defval: '' }) as Record<string, string>[];
      } else {
        return reply.status(400).send({ error: 'Only .csv, .xlsx, or .xls files are supported' });
      }

      if (rows.length === 0) {
        return reply.status(400).send({ error: 'File is empty or has no data rows' });
      }

      // Normalise column names (lowercase, strip spaces)
      const normaliseKey = (k: string) => k.toLowerCase().replace(/[\s_-]/g, '');

      let imported = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (let i = 0; i < rows.length; i++) {
        const raw = rows[i];
        const row: Record<string, string> = {};
        for (const [k, v] of Object.entries(raw)) {
          row[normaliseKey(k)] = String(v ?? '').trim();
        }

        // Find phone column
        const phone = normalisePhone(
          row['waphone'] || row['phone'] || row['nomorwa'] || row['whatsapp'] || row['nomor'] || '',
        );
        if (!phone || phone.length < 7) {
          skipped++;
          continue;
        }

        // Find name column
        const displayName =
          row['name'] || row['displayname'] || row['nama'] || row['fullname'] || null;

        // Language
        const preferredLanguage = (row['language'] || row['lang'] || row['bahasa'] || 'id')
          .toLowerCase()
          .slice(0, 5);

        // Tags (comma-separated string → array)
        const tagsRaw = row['tags'] || row['tag'] || '';
        const tags = tagsRaw
          ? tagsRaw.split(',').map((t: string) => t.trim()).filter(Boolean)
          : null;

        const notes = row['notes'] || row['note'] || row['catatan'] || null;

        try {
          await db.insert(buyers).values({
            tenantId,
            waPhone: phone,
            displayName: displayName || null,
            preferredLanguage,
            tags: tags as any,
            notes,
            updatedAt: new Date(),
          }).onConflictDoUpdate({
            target: [buyers.waPhone, buyers.tenantId],
            set: {
              displayName: sql`COALESCE(EXCLUDED.display_name, buyers.display_name)`,
              preferredLanguage: sql`EXCLUDED.preferred_language`,
              tags: sql`COALESCE(EXCLUDED.tags, buyers.tags)`,
              notes: sql`COALESCE(EXCLUDED.notes, buyers.notes)`,
              updatedAt: new Date(),
            },
          });
          imported++;
        } catch (err: any) {
          errors.push(`Row ${i + 2}: ${err?.message ?? 'unknown error'}`);
          skipped++;
        }
      }

      return reply.send({
        imported,
        skipped,
        total: rows.length,
        errors: errors.slice(0, 10),
      });
    },
  );

  /**
   * DELETE /v1/buyers/:id
   */
  fastify.delete<{ Params: { id: string } }>(
    '/v1/buyers/:id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { id } = request.params;

      const result = await db.delete(buyers)
        .where(and(eq(buyers.id, id), eq(buyers.tenantId, tenantId)))
        .returning({ id: buyers.id });

      if (!result.length) return reply.status(404).send({ error: 'Contact not found' });
      return reply.send({ deleted: true });
    },
  );

  /**
   * PATCH /v1/buyers/:id
   * Update displayName, notes, tags, doNotContact.
   */
  fastify.patch<{
    Params: { id: string };
    Body: { displayName?: string; notes?: string; tags?: string[]; doNotContact?: boolean }
  }>(
    '/v1/buyers/:id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { id } = request.params;
      const body = request.body ?? {};

      const updates: any = { updatedAt: new Date() };
      if ('displayName' in body) updates.displayName = body.displayName;
      if ('notes' in body) updates.notes = body.notes;
      if ('tags' in body) updates.tags = body.tags;
      if ('doNotContact' in body) updates.doNotContact = body.doNotContact;

      const [updated] = await db.update(buyers)
        .set(updates)
        .where(and(eq(buyers.id, id), eq(buyers.tenantId, tenantId)))
        .returning();

      if (!updated) return reply.status(404).send({ error: 'Contact not found' });
      return reply.send(updated);
    },
  );
};
