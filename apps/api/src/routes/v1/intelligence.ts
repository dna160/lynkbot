/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/routes/v1/intelligence.ts
 * Role    : Buyer intelligence profile routes — genome read/update, dialog recommendations.
 *           All routes require JWT auth. tenantId from JWT.
 * Exports : intelligenceRoutes (Fastify plugin)
 */
import type { FastifyPluginAsync } from 'fastify';
import { eq, and, gt } from '@lynkbot/db';
import { db, buyers, buyerGenomes, genomeMutations, conversations, messages } from '@lynkbot/db';
import {
  extractSignals, deriveScores, scoreConfidence, applyConfidencePenalty,
  mergeScores, classifyMoment, selectDialog, computeRWI,
  buildDialogCache, buildFallbackCache,
  defaultGenome, buildSeededGenome,
  type GenomeScores, type Genome, type MomentType,
} from '@lynkbot/pantheon';
import { getLLMClient } from '@lynkbot/ai';

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
   * Incremental refresh: only processes messages NEWER than lastSignalExtractedAt.
   * First-time call seeds from cultural priors, then layers in signal deltas.
   * If no new messages since last refresh, returns existing genome with updated: false.
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

      // Load existing genome to determine the signal cutoff timestamp
      const existing = await db.query.buyerGenomes.findFirst({
        where: and(eq(buyerGenomes.buyerId, id), eq(buyerGenomes.tenantId, tenantId)),
      });

      const cutoff: Date = existing?.lastSignalExtractedAt ?? new Date(0);
      const now = new Date();

      // Find most recent conversation
      const conv = await db.query.conversations.findFirst({
        where: and(eq(conversations.buyerId, id), eq(conversations.tenantId, tenantId)),
        orderBy: (c, { desc }) => desc(c.lastMessageAt),
      });

      // Only fetch inbound messages NEWER than the last extraction cutoff
      const newMessages = conv
        ? await db.query.messages.findMany({
            where: and(
              eq(messages.conversationId, conv.id),
              eq(messages.direction, 'inbound'),
              gt(messages.createdAt, cutoff),
            ),
            orderBy: (m, { asc }) => asc(m.createdAt),
            limit: 50,
          })
        : [];

      // No new messages since last refresh — return existing genome unchanged
      if (newMessages.length === 0 && existing) {
        return reply.send({
          genome: rowToGenome(existing),
          dialogCache: existing.dialogCache ?? null,
          updated: false,
          signalsSummary: { messagesAnalyzed: 0, note: 'No new messages since last refresh' },
        });
      }

      const msgTexts = newMessages.map(m => m.textContent ?? '').filter(Boolean);
      const msgTimestamps = newMessages.map(m => m.createdAt.getTime());
      const signals = extractSignals(msgTexts, msgTimestamps);
      const newScores = deriveScores(signals);
      const batchConfidence = scoreConfidence(signals.messageCount);
      const adjustedScores = applyConfidencePenalty(newScores, batchConfidence);

      let finalScores: GenomeScores;
      let observationCount: number;

      if (existing) {
        // Incremental: EMA-merge new signals on top of existing genome
        const existingGenome = rowToGenome(existing);
        finalScores = mergeScores(existingGenome.scores, adjustedScores);
        observationCount = existing.observationCount + signals.messageCount;

        // Record significant trait mutations (|delta| >= 5)
        for (const key of Object.keys(finalScores) as (keyof GenomeScores)[]) {
          const delta = finalScores[key] - existingGenome.scores[key];
          if (Math.abs(delta) >= 5) {
            await db.insert(genomeMutations).values({
              buyerId: id,
              tenantId,
              traitName: key,
              oldScore: existingGenome.scores[key],
              newScore: finalScores[key],
              delta,
              evidenceSummary: `+${signals.messageCount} msgs since last refresh. emoji=${signals.emojiFrequency.toFixed(2)}, priceQ=${signals.priceQuestionsCount}, polite=${signals.politenessCount}`,
              confidence: batchConfidence,
              conversationId: conv?.id ?? null,
              createdAt: now,
            });
          }
        }
      } else {
        // First time: seed from cultural priors, then layer in signal-derived scores
        const seeded = buildSeededGenome(id, tenantId, buyer.waPhone ?? undefined);
        finalScores = signals.messageCount > 0
          ? mergeScores(seeded.scores, adjustedScores)
          : seeded.scores;
        observationCount = signals.messageCount;
      }

      const finalConfidence = scoreConfidence(observationCount);

      // Upsert genome with updated lastSignalExtractedAt
      const [upserted] = await db
        .insert(buyerGenomes)
        .values({
          buyerId: id,
          tenantId,
          confidence: finalConfidence,
          observationCount,
          ...scoresToDbFields(finalScores),
          formationInvariants: [],
          lastSignalExtractedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [buyerGenomes.buyerId, buyerGenomes.tenantId],
          set: {
            confidence: finalConfidence,
            observationCount,
            ...scoresToDbFields(finalScores),
            lastSignalExtractedAt: now,
            updatedAt: now,
          },
        })
        .returning();

      // Build / rebuild dialog cache if confidence is MEDIUM or HIGH
      let dialogCache = existing?.dialogCache ?? null;
      if (finalConfidence !== 'LOW' && (!existing?.dialogCacheBuiltAt || observationCount % 10 === 0)) {
        try {
          const genome: Genome = { buyerId: id, tenantId, scores: finalScores, confidence: finalConfidence, formationInvariants: [], observationCount, lastUpdatedAt: now };
          dialogCache = await buildDialogCache(genome, 'your product', 'our store', 'id') as Record<string, unknown>;
          await db.update(buyerGenomes)
            .set({ dialogCache, dialogCacheBuiltAt: now })
            .where(eq(buyerGenomes.id, upserted.id));
        } catch (err) {
          fastify.log.warn({ err }, 'Dialog cache build failed — using fallback');
          dialogCache = buildFallbackCache('id') as unknown as Record<string, unknown>;
          await db.update(buyerGenomes)
            .set({ dialogCache, dialogCacheBuiltAt: now })
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
   * POST /v1/buyers/:id/osint
   * Run deep psychological intelligence research on a buyer to the Pantheon "human whisperer" standard.
   * Synthesises all conversation signals + genome scores into a structured intelligence brief:
   *   - Psychological archetype & core identity
   *   - Buying psychology & decision triggers
   *   - Communication blueprint
   *   - Trust mechanics & resistance patterns
   *   - Optimal engagement strategy
   * Result is saved to buyer_genomes.osint_summary and logged as a genome_mutation event.
   */
  fastify.post<{ Params: { id: string } }>(
    '/v1/buyers/:id/osint',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { id } = request.params;

      const buyer = await db.query.buyers.findFirst({
        where: and(eq(buyers.id, id), eq(buyers.tenantId, tenantId)),
      });
      if (!buyer) return reply.status(404).send({ error: 'Buyer not found' });

      // Load genome — must exist to run OSINT (need baseline scores)
      const genomeRow = await db.query.buyerGenomes.findFirst({
        where: and(eq(buyerGenomes.buyerId, id), eq(buyerGenomes.tenantId, tenantId)),
      });

      // Gather all conversations + recent messages as raw signal data
      const allConvs = await db.query.conversations.findMany({
        where: and(eq(conversations.buyerId, id), eq(conversations.tenantId, tenantId)),
        orderBy: (c, { desc }) => desc(c.lastMessageAt),
        limit: 5,
      });

      const convMessages: string[] = [];
      for (const conv of allConvs) {
        const msgs = await db.query.messages.findMany({
          where: eq(messages.conversationId, conv.id),
          orderBy: (m, { asc }) => asc(m.createdAt),
          limit: 60,
        });
        for (const m of msgs) {
          if (m.textContent && m.textContent.trim()) {
            const role = m.direction === 'inbound' ? 'BUYER' : 'BOT';
            convMessages.push(`[${role}] ${m.textContent.trim()}`);
          }
        }
      }

      const genome = genomeRow ? rowToGenome(genomeRow) : defaultGenome(id, tenantId, buyer.waPhone ?? undefined);
      const scores = genome.scores;

      // ── Build Pantheon-standard OSINT brief via LLM ────────────────────────
      const genomeContext = `
GENOME SCORES (1=low, 100=high):
Cluster A — OCEAN:
  Openness: ${scores.openness} | Conscientiousness: ${scores.conscientiousness} | Extraversion: ${scores.extraversion}
  Agreeableness: ${scores.agreeableness} | Neuroticism: ${scores.neuroticism}
Cluster B — Behavioral:
  Communication Style: ${scores.communicationStyle} (1=terse/emoji, 100=formal/verbose)
  Decision Making: ${scores.decisionMaking} (1=impulsive, 100=deliberate)
  Brand Relationship: ${scores.brandRelationship} (1=skeptical, 100=brand-loyal)
  Influence Susceptibility: ${scores.influenceSusceptibility} (1=immune, 100=highly influenced)
  Emotional Expression: ${scores.emotionalExpression} (1=flat, 100=expressive)
  Conflict Behavior: ${scores.conflictBehavior} (1=avoidant, 100=confrontational)
  Literacy / Articulation: ${scores.literacyArticulation} (1=simple, 100=sophisticated)
  Socioeconomic Friction: ${scores.socioeconomicFriction} (1=price-insensitive, 100=very price-sensitive)
Cluster C — Human Uniqueness:
  Identity Fusion: ${scores.identityFusion} (product identity alignment strength)
  Chronesthesia: ${scores.chronesthesiaCapacity} (future vs. present thinking)
  Self-Awareness (ToM): ${scores.tomSelfAwareness}
  Social Modeling (ToM): ${scores.tomSocialModeling}
  Executive Flexibility: ${scores.executiveFlexibility} (willingness to change mind)
Confidence: ${genome.confidence} | Observations: ${genome.observationCount} messages`.trim();

      const conversationContext = convMessages.length > 0
        ? convMessages.slice(-120).join('\n')
        : '(No conversation history available — profile based on genome priors only)';

      const buyerMeta = [
        buyer.displayName ? `Name: ${buyer.displayName}` : null,
        buyer.waPhone ? `Phone: +${buyer.waPhone}` : null,
        (buyer as any).preferredLanguage ? `Language: ${(buyer as any).preferredLanguage}` : null,
      ].filter(Boolean).join(' | ');

      const systemPrompt = `You are a master human intelligence analyst operating at the Pantheon "human whisperer" standard.
Your function is to synthesize psychological genome scores and raw conversation transcripts into a precise, actionable intelligence brief.
This is not a surface-level bio. It is a deep psychological map that enables a salesperson to establish instant resonance, navigate resistance, and guide this specific human toward a confident purchase decision.
Write in English. Be concrete. Be specific to THIS person — not generic personality tropes.
Structure your output EXACTLY as instructed. No disclaimers. No hedging. This is intelligence work.`;

      const userPrompt = `BUYER INTELLIGENCE BRIEF REQUEST

Buyer: ${buyerMeta || 'Unknown'}
${genomeContext}

CONVERSATION TRANSCRIPT:
${conversationContext}

Produce a structured Pantheon Intelligence Brief with EXACTLY these seven sections:

## 1. Psychological Archetype
State their core psychological archetype (1–2 sentences). Name the archetype. Explain what drives this person at their core — their fundamental motivation engine. Be precise about how this maps to their genome cluster scores.

## 2. Identity Signals & Self-Concept
What does this person believe about themselves? What roles, values, or identities have they revealed (explicitly or implicitly) through how they communicate? How do they want to be perceived? What does buying or NOT buying say about their identity?

## 3. Buying Psychology & Decision Triggers
How does this person make purchasing decisions? What internal process do they follow? What are their primary YES triggers (what makes them say yes fast) and their primary STOP triggers (what makes them freeze or walk away)? Be specific about what argument structure works for them.

## 4. Communication Blueprint
Precise instructions for HOW to communicate with this buyer: tone, pace, vocabulary level, message length, formality, use of data vs. emotion vs. story, and what to NEVER do. This is the operator's tactical guide.

## 5. Trust Architecture
What specifically builds trust with this person? What destroys it? What proof elements do they need (social proof, data, authority, relationship, guarantee)? What is their trust timeline — how many touchpoints before they feel safe?

## 6. Resistance Map
Map their likely objections in order of probability. For each, provide the exact reframe that works for their psychological profile. Do NOT give generic objection-handling — tailor to their genome.

## 7. Engagement Playbook
A concrete 3-step opening strategy for a human operator picking up this conversation. What to say first, how to position, and what outcome to aim for in the first 2 minutes. Include the specific emotional state you want them in when you make the offer.`;

      let osintSummary: string;
      try {
        const llm = getLLMClient();
        const res = await llm.chat(
          [{ role: 'user', content: userPrompt }],
          { system: systemPrompt, maxTokens: 1800 }
        );
        osintSummary = res.content;
      } catch (err) {
        fastify.log.error({ err }, 'OSINT LLM call failed');
        return reply.status(503).send({ error: 'Intelligence analysis service unavailable. Please retry.' });
      }

      const now = new Date();

      // Save OSINT summary to genome (upsert if genome doesn't exist yet)
      if (genomeRow) {
        await db.update(buyerGenomes)
          .set({ osintSummary, lastSignalExtractedAt: now, updatedAt: now })
          .where(and(eq(buyerGenomes.buyerId, id), eq(buyerGenomes.tenantId, tenantId)));
      } else {
        // No genome row yet — seed one with cultural priors + attach OSINT
        const seeded = buildSeededGenome(id, tenantId, buyer.waPhone ?? undefined);
        await db.insert(buyerGenomes).values({
          buyerId: id,
          tenantId,
          confidence: seeded.confidence,
          observationCount: seeded.observationCount,
          ...scoresToDbFields(seeded.scores),
          formationInvariants: [],
          osintSummary,
          lastSignalExtractedAt: now,
          updatedAt: now,
        }).onConflictDoUpdate({
          target: [buyerGenomes.buyerId, buyerGenomes.tenantId],
          set: { osintSummary, updatedAt: now },
        });
      }

      // Log OSINT completion to genome_mutations so it appears in the History tab
      // traitName = 'osint_research' — sentinel value; delta=0 means no score change, only enrichment
      await db.insert(genomeMutations).values({
        buyerId: id,
        tenantId,
        traitName: 'osint_research',
        oldScore: 0,
        newScore: 0,
        delta: 0,
        evidenceSummary: `OSINT intelligence brief generated. ${convMessages.length} conversation lines analyzed. Genome confidence: ${genome.confidence}.`,
        confidence: genome.confidence,
        conversationId: allConvs[0]?.id ?? null,
        createdAt: now,
      });

      // Return updated genome response (same shape as GET /genome)
      const updatedGenomeRow = await db.query.buyerGenomes.findFirst({
        where: and(eq(buyerGenomes.buyerId, id), eq(buyerGenomes.tenantId, tenantId)),
      });
      const updatedMutations = await db.query.genomeMutations.findMany({
        where: and(eq(genomeMutations.buyerId, id), eq(genomeMutations.tenantId, tenantId)),
      });

      return reply.send({
        genome: updatedGenomeRow ? rowToGenome(updatedGenomeRow) : genome,
        mutations: updatedMutations.map(m => ({
          traitName: m.traitName,
          oldScore: m.oldScore,
          newScore: m.newScore,
          delta: m.delta,
          evidenceSummary: m.evidenceSummary,
          createdAt: m.createdAt,
        })),
        dialogCache: updatedGenomeRow?.dialogCache ?? null,
        dialogCacheBuiltAt: updatedGenomeRow?.dialogCacheBuiltAt ?? null,
        osintSummary,
        hasPersisted: true,
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
