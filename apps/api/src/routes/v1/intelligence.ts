/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/routes/v1/intelligence.ts
 * Role    : Buyer intelligence profile routes — genome read/update, dialog recommendations.
 *           All routes require JWT auth. tenantId from JWT.
 * Exports : intelligenceRoutes (Fastify plugin)
 */
import type { FastifyPluginAsync } from 'fastify';
import { eq, and } from '@lynkbot/db';
import { db, buyers, buyerGenomes, genomeMutations, conversations, messages } from '@lynkbot/db';
import {
  extractSignals, deriveScores, scoreConfidence, applyConfidencePenalty,
  mergeScores, classifyMoment, selectDialog, computeRWI,
  buildDialogCache, buildFallbackCache,
  defaultGenome,
  type GenomeScores, type Genome, type MomentType,
} from '@lynkbot/pantheon';

// ─── Helper: row → Genome ─────────────────────────────────────────────────────

function rowToGenome(row: typeof buyerGenomes.$inferSelect): Genome {
  return {
    buyerId: row.buyerId,
    tenantId: row.tenantId,
    confidence: row.confidence,
    observationCount: row.observationCount,
    formationInvariants: (row.formationInvariants as string[]) ?? [],
    lastUpdatedAt: row.updatedAt,
    scores: {
      openness: row.openness,
      conscientiousness: row.conscientiousness,
      extraversion: row.extraversion,
      agreeableness: row.agreeableness,
      neuroticism: row.neuroticism,
      communicationStyle: row.communicationStyle,
      decisionMaking: row.decisionMaking,
      brandRelationship: row.brandRelationship,
      influenceSusceptibility: row.influenceSusceptibility,
      emotionalExpression: row.emotionalExpression,
      conflictBehavior: row.conflictBehavior,
      literacyArticulation: row.literacyArticulation,
      socioeconomicFriction: row.socioeconomicFriction,
      identityFusion: row.identityFusion,
      chronesthesiaCapacity: row.chronesthesiaCapacity,
      tomSelfAwareness: row.tomSelfAwareness,
      tomSocialModeling: row.tomSocialModeling,
      executiveFlexibility: row.executiveFlexibility,
    },
  };
}

function scoresToDbFields(scores: GenomeScores) {
  return {
    openness: scores.openness,
    conscientiousness: scores.conscientiousness,
    extraversion: scores.extraversion,
    agreeableness: scores.agreeableness,
    neuroticism: scores.neuroticism,
    communicationStyle: scores.communicationStyle,
    decisionMaking: scores.decisionMaking,
    brandRelationship: scores.brandRelationship,
    influenceSusceptibility: scores.influenceSusceptibility,
    emotionalExpression: scores.emotionalExpression,
    conflictBehavior: scores.conflictBehavior,
    literacyArticulation: scores.literacyArticulation,
    socioeconomicFriction: scores.socioeconomicFriction,
    identityFusion: scores.identityFusion,
    chronesthesiaCapacity: scores.chronesthesiaCapacity,
    tomSelfAwareness: scores.tomSelfAwareness,
    tomSocialModeling: scores.tomSocialModeling,
    executiveFlexibility: scores.executiveFlexibility,
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export const intelligenceRoutes: FastifyPluginAsync = async (fastify) => {

  /**
   * GET /v1/buyers/:id/genome
   * Returns the buyer's intelligence profile (genome + mutation history + dialog cache).
   */
  fastify.get<{ Params: { id: string } }>(
    '/v1/buyers/:id/genome',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { id } = request.params;

      const buyer = await db.query.buyers.findFirst({
        where: and(eq(buyers.id, id), eq(buyers.tenantId, tenantId)),
      });
      if (!buyer) return reply.status(404).send({ error: 'Buyer not found' });

      const genome = await db.query.buyerGenomes.findFirst({
        where: and(eq(buyerGenomes.buyerId, id), eq(buyerGenomes.tenantId, tenantId)),
      });

      const mutations = await db.query.genomeMutations.findMany({
        where: and(eq(genomeMutations.buyerId, id), eq(genomeMutations.tenantId, tenantId)),
      });

      if (!genome) {
        // Return default genome stub (not yet saved)
        const stub = defaultGenome(id, tenantId);
        return reply.send({
          genome: stub,
          mutations: [],
          dialogCache: null,
          hasPersisted: false,
        });
      }

      return reply.send({
        genome: rowToGenome(genome),
        mutations: mutations.map(m => ({
          traitName: m.traitName,
          oldScore: m.oldScore,
          newScore: m.newScore,
          delta: m.delta,
          evidenceSummary: m.evidenceSummary,
          createdAt: m.createdAt,
        })),
        dialogCache: genome.dialogCache ?? null,
        dialogCacheBuiltAt: genome.dialogCacheBuiltAt ?? null,
        osintSummary: genome.osintSummary ?? null,
        hasPersisted: true,
      });
    },
  );

  /**
   * POST /v1/buyers/:id/genome/refresh
   * Re-runs signal extraction from recent conversation messages and updates genome.
   * Also rebuilds dialog cache if confidence >= MEDIUM.
   */
  fastify.post<{ Params: { id: string } }>(
    '/v1/buyers/:id/genome/refresh',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { id } = request.params;

      const buyer = await db.query.buyers.findFirst({
        where: and(eq(buyers.id, id), eq(buyers.tenantId, tenantId)),
      });
      if (!buyer) return reply.status(404).send({ error: 'Buyer not found' });

      // Load last 50 inbound messages from buyer
      const conv = await db.query.conversations.findFirst({
        where: and(eq(conversations.buyerId, id), eq(conversations.tenantId, tenantId)),
        orderBy: (c, { desc }) => desc(c.lastMessageAt),
      });

      const recentMessages = conv
        ? await db.query.messages.findMany({
            where: and(
              eq(messages.conversationId, conv.id),
              eq(messages.direction, 'inbound'),
            ),
            orderBy: (m, { asc }) => asc(m.createdAt),
            limit: 50,
          })
        : [];

      const msgTexts = recentMessages.map(m => m.textContent ?? '').filter(Boolean);
      const msgTimestamps = recentMessages.map(m => m.createdAt.getTime());

      const signals = extractSignals(msgTexts, msgTimestamps);
      const newScores = deriveScores(signals);
      const confidence = scoreConfidence(signals.messageCount);
      const adjustedScores = applyConfidencePenalty(newScores, confidence);

      // Get or create genome row
      const existing = await db.query.buyerGenomes.findFirst({
        where: and(eq(buyerGenomes.buyerId, id), eq(buyerGenomes.tenantId, tenantId)),
      });

      let finalScores: GenomeScores;
      let observationCount: number;

      if (existing) {
        const existingGenome = rowToGenome(existing);
        finalScores = mergeScores(existingGenome.scores, adjustedScores);
        observationCount = existing.observationCount + signals.messageCount;

        // Record significant mutations (delta > 5)
        for (const key of Object.keys(finalScores) as (keyof GenomeScores)[]) {
          const delta = Math.abs(finalScores[key] - existingGenome.scores[key]);
          if (delta >= 5) {
            await db.insert(genomeMutations).values({
              buyerId: id,
              tenantId,
              traitName: key,
              oldScore: existingGenome.scores[key],
              newScore: finalScores[key],
              delta: finalScores[key] - existingGenome.scores[key],
              evidenceSummary: `Updated from ${signals.messageCount} messages. Signal: ${JSON.stringify({ emojiFreq: signals.emojiFrequency, priceQ: signals.priceQuestionsCount, polite: signals.politenessCount })}`,
              confidence,
              conversationId: conv?.id ?? null,
              createdAt: new Date(),
            });
          }
        }
      } else {
        finalScores = adjustedScores;
        observationCount = signals.messageCount;
      }

      const finalConfidence = scoreConfidence(observationCount);

      // Upsert genome
      const [upserted] = await db
        .insert(buyerGenomes)
        .values({
          buyerId: id,
          tenantId,
          confidence: finalConfidence,
          observationCount,
          ...scoresToDbFields(finalScores),
          formationInvariants: [],
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [buyerGenomes.buyerId, buyerGenomes.tenantId],
          set: {
            confidence: finalConfidence,
            observationCount,
            ...scoresToDbFields(finalScores),
            updatedAt: new Date(),
          },
        })
        .returning();

      // Build / rebuild dialog cache if confidence is MEDIUM or HIGH
      let dialogCache = existing?.dialogCache ?? null;
      if (finalConfidence !== 'LOW' && (!existing?.dialogCacheBuiltAt || observationCount % 10 === 0)) {
        try {
          const genome: Genome = { buyerId: id, tenantId, scores: finalScores, confidence: finalConfidence, formationInvariants: [], observationCount, lastUpdatedAt: new Date() };
          dialogCache = await buildDialogCache(genome, 'your product', 'our store', 'id') as Record<string, unknown>;
          await db.update(buyerGenomes)
            .set({ dialogCache, dialogCacheBuiltAt: new Date() })
            .where(eq(buyerGenomes.id, upserted.id));
        } catch (err) {
          fastify.log.warn({ err }, 'Dialog cache build failed — using fallback');
          dialogCache = buildFallbackCache('id') as unknown as Record<string, unknown>;
          await db.update(buyerGenomes)
            .set({ dialogCache, dialogCacheBuiltAt: new Date() })
            .where(eq(buyerGenomes.id, upserted.id));
        }
      }

      return reply.send({
        genome: rowToGenome(upserted),
        dialogCache,
        updated: true,
        signalsSummary: {
          messagesAnalyzed: signals.messageCount,
          emojiFrequency: signals.emojiFrequency,
          priceQuestionsCount: signals.priceQuestionsCount,
          expressedName: signals.expressedName,
        },
      });
    },
  );

  /**
   * POST /v1/buyers/:id/dialog-recommend
   * Given a buyer message, classify the moment and return the best dialog recommendation.
   * Used by human operators taking over a conversation.
   */
  fastify.post<{ Params: { id: string }; Body: { message: string; recentMessages?: string[] } }>(
    '/v1/buyers/:id/dialog-recommend',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { id } = request.params;
      const { message, recentMessages = [] } = request.body;

      if (!message) return reply.status(400).send({ error: 'message is required' });

      const genomeRow = await db.query.buyerGenomes.findFirst({
        where: and(eq(buyerGenomes.buyerId, id), eq(buyerGenomes.tenantId, tenantId)),
      });

      const genome = genomeRow ? rowToGenome(genomeRow) : defaultGenome(id, tenantId);
      const cache = (genomeRow?.dialogCache as Parameters<typeof selectDialog>[0]) ?? buildFallbackCache('id');
      const classification = classifyMoment(message, recentMessages);
      const rwi = computeRWI(recentMessages.length + 1, [classification.momentType], Date.now());
      const selection = selectDialog(cache, classification.momentType, genome, rwi);

      return reply.send({
        classification,
        selection,
        genomeConfidence: genome.confidence,
      });
    },
  );
};
