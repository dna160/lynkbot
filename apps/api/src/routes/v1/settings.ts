/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/routes/v1/settings.ts
 * Role    : Tenant settings routes. Currently owns bot persona (PRD §1.6).
 *           All routes are tenant-scoped via fastify.authenticate.
 * Exports : settingsRoutes (Fastify plugin)
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db, tenants, eq } from '@lynkbot/db';

const BOT_TONE_VALUES = ['friendly', 'formal', 'playful'] as const;
const LANGUAGE_VALUES = ['id', 'en'] as const;

const patchPersonaSchema = z.object({
  botName: z.string().max(100).nullable().optional(),
  botTone: z.enum(BOT_TONE_VALUES).nullable().optional(),
  botDefaultLanguage: z.enum(LANGUAGE_VALUES).nullable().optional(),
  botGreetingStyle: z.string().max(500).nullable().optional(),
  botAvatarEmoji: z.string().max(10).nullable().optional(),
  botCustomInstructions: z.string().max(2000).nullable().optional(),
}).strict();

const PERSONA_COLUMNS = [
  'botName', 'botTone', 'botDefaultLanguage', 'botGreetingStyle',
  'botAvatarEmoji', 'botCustomInstructions',
] as const;

export const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /v1/settings/persona
   * Returns the tenant's bot persona configuration.
   */
  fastify.get('/v1/settings/persona', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: {
        botName: true,
        botTone: true,
        botDefaultLanguage: true,
        botGreetingStyle: true,
        botAvatarEmoji: true,
        botCustomInstructions: true,
      },
    });

    if (!tenant) return reply.status(404).send({ error: 'Tenant not found' });

    return reply.send({
      botName: tenant.botName,
      botTone: tenant.botTone,
      botDefaultLanguage: tenant.botDefaultLanguage,
      botGreetingStyle: tenant.botGreetingStyle,
      botAvatarEmoji: tenant.botAvatarEmoji,
      botCustomInstructions: tenant.botCustomInstructions,
    });
  });

  /**
   * PATCH /v1/settings/persona
   * Updates one or more bot persona fields. Only provided fields are written.
   */
  fastify.patch('/v1/settings/persona', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { tenantId } = (request as any).user;

    const parsed = patchPersonaSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const patch = parsed.data;
    if (Object.keys(patch).length === 0) {
      return reply.status(400).send({ error: 'No fields provided' });
    }

    await db.update(tenants).set(patch).where(eq(tenants.id, tenantId));

    const updated = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: {
        botName: true,
        botTone: true,
        botDefaultLanguage: true,
        botGreetingStyle: true,
        botAvatarEmoji: true,
        botCustomInstructions: true,
      },
    });

    return reply.send(updated);
  });
};
