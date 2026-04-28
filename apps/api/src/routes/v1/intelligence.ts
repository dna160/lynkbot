/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/routes/v1/intelligence.ts
 * Role    : Buyer intelligence profile routes — genome read/update, dialog recommendations.
 *           All routes require JWT auth. tenantId from JWT.
 * Exports : intelligenceRoutes (Fastify plugin)
 */
import type { FastifyPluginAsync } from 'fastify';
import { eq, and, gt, desc } from '@lynkbot/db';
import { db, buyers, buyerGenomes, genomeMutations, conversations, messages, orders, products } from '@lynkbot/db';
import {
  extractSignals, deriveScores, scoreConfidence, applyConfidencePenalty,
  mergeScores, classifyMoment, selectDialog, computeRWI,
  buildDialogCache, buildFallbackCache,
  defaultGenome, buildSeededGenome,
  type GenomeScores, type Genome, type MomentType,
} from '@lynkbot/pantheon';
import { getLLMClient } from '@lynkbot/ai';
import { config } from '../../config';
import { runExternalOsint, formatExternalOsintForPrompt } from '../../services/osint.service';

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
   * Deep intelligence research — Pantheon "human whisperer" standard.
   *
   * DATA SOURCES (all in-system):
   *   1. Identity   — WA display name, phone (country→region), language, tags, notes, first seen
   *   2. Corpus     — ALL conversations × ALL messages; latency, emoji, price/objection signals
   *   3. Commerce   — full order history, product names, spend, LTV tier
   *   4. Genome     — 18-parameter scores, confidence, observation count
   *
   * LLM returns structured JSON:
   *   informationInventory — explicit known facts, inferences, blind spots, data quality rating
   *   intelligenceBrief   — 7-section Pantheon brief
   *   genomeAdjustments   — per-trait score revisions supported by evidence (≥5pt change only)
   *
   * Post-LLM: adjustments become real genome mutations. OSINT run logged as sentinel entry.
   */
  fastify.post<{ Params: { id: string }; Body: { nameOverride?: string } }>(
    '/v1/buyers/:id/osint',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { id } = request.params;
      const { nameOverride } = request.body ?? {};

      const buyer = await db.query.buyers.findFirst({
        where: and(eq(buyers.id, id), eq(buyers.tenantId, tenantId)),
      });
      if (!buyer) return reply.status(404).send({ error: 'Buyer not found' });

      // ── Source 1: Identity ────────────────────────────────────────────────
      const regionMap: Record<string, string> = {
        '62': 'Indonesia', '1': 'USA/Canada', '44': 'UK', '65': 'Singapore',
        '60': 'Malaysia', '61': 'Australia', '91': 'India', '971': 'UAE',
        '966': 'Saudi Arabia', '855': 'Cambodia', '66': 'Thailand',
      };
      const phone = buyer.waPhone ?? '';
      const inferredRegion = Object.entries(regionMap).find(([code]) => phone.startsWith(code))?.[1] ?? 'Unknown';
      const bTags = Array.isArray(buyer.tags) && (buyer.tags as string[]).length
        ? (buyer.tags as string[]).join(', ') : '(none)';

      const identityFacts = [
        `WA Display Name: ${buyer.displayName ?? '(not set)'}`,
        `Phone: +${phone} → Inferred Region: ${inferredRegion}`,
        `Preferred Language: ${(buyer as Record<string, unknown>).preferredLanguage ?? 'unknown'}`,
        `Tags: ${bTags}`,
        `Operator Notes: ${buyer.notes ?? '(none)'}`,
        `First seen: ${buyer.createdAt?.toISOString().split('T')[0] ?? 'unknown'}`,
        `Last order date: ${buyer.lastOrderAt ? buyer.lastOrderAt.toISOString().split('T')[0] : '(no orders yet)'}`,
      ].join('\n');

      // ── Source 2: Full conversation corpus ────────────────────────────────
      const allConvs = await db.query.conversations.findMany({
        where: and(eq(conversations.buyerId, id), eq(conversations.tenantId, tenantId)),
        orderBy: (c, { desc: d }) => d(c.lastMessageAt),
      });

      type MsgRow = { direction: string; textContent: string | null; createdAt: Date };
      const allMessages: MsgRow[] = [];
      for (const conv of allConvs) {
        const msgs = await db.query.messages.findMany({
          where: eq(messages.conversationId, conv.id),
          orderBy: (m, { asc }) => asc(m.createdAt),
          limit: 80,
        }) as unknown as MsgRow[];
        allMessages.push(...msgs);
      }

      const inboundTexts = allMessages
        .filter(m => m.direction === 'inbound' && m.textContent?.trim())
        .map(m => m.textContent!.trim());

      const inboundTs = allMessages
        .filter(m => m.direction === 'inbound')
        .map(m => m.createdAt.getTime());
      let avgLatencyMs = 0;
      if (inboundTs.length >= 2) {
        const gaps = inboundTs.slice(1).map((t, i) => t - inboundTs[i]);
        avgLatencyMs = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      }
      const latencyLabel = avgLatencyMs < 30_000 ? 'Fast (<30s avg)'
        : avgLatencyMs < 300_000 ? 'Medium (<5min avg)'
        : avgLatencyMs > 0 ? 'Slow (>5min avg)' : 'Unknown';

      const allText = inboundTexts.join(' ');
      const emojiCount = (allText.match(/[\u{1F300}-\u{1FFFF}\u{2600}-\u{27BF}]/gu) ?? []).length;
      const priceMsgs = inboundTexts.filter(t => /harga|berapa|price|cost|murah|mahal|diskon|promo|cashback/i.test(t)).length;
      const objectionMsgs = inboundTexts.filter(t => /tapi|but|ragu|tidak yakin|belum|nanti|mikir|expensive/i.test(t)).length;
      const urgencyMsgs = inboundTexts.filter(t => /sekarang|buruan|cepat|urgent|asap|today|hari ini/i.test(t)).length;
      const expressedName = allText.match(/(?:nama saya|my name is|i'm|panggil saya)\s+([A-Za-z]+)/i)?.[1] ?? null;

      const corpusFacts = [
        `Total conversations: ${allConvs.length}`,
        `Total messages: ${allMessages.length} (${inboundTexts.length} inbound from buyer, ${allMessages.length - inboundTexts.length} outbound from bot)`,
        `Response latency: ${latencyLabel}`,
        `Emoji usage: ${emojiCount} emojis total across all buyer messages`,
        `Price/cost-related messages: ${priceMsgs}`,
        `Objection/hesitation signals: ${objectionMsgs} messages`,
        `Urgency signals: ${urgencyMsgs} messages`,
        `Buyer expressed their name in chat: ${expressedName ?? '(not detected)'}`,
        `Average buyer message length: ${inboundTexts.length ? Math.round(inboundTexts.reduce((s, t) => s + t.length, 0) / inboundTexts.length) : 0} chars`,
      ].join('\n');

      const convTranscript = allMessages
        .filter(m => m.textContent?.trim())
        .slice(-150)
        .map(m => `[${m.direction === 'inbound' ? 'BUYER' : 'BOT'}] ${m.textContent!.trim()}`)
        .join('\n') || '(No conversation history)';

      // ── Source 3: Order / commercial history ──────────────────────────────
      const buyerOrders = await db.query.orders.findMany({
        where: and(eq(orders.buyerId, id), eq(orders.tenantId, tenantId)),
        orderBy: (o, { desc: d }) => d(o.createdAt),
        limit: 20,
      });

      const productIds = [...new Set(buyerOrders.map(o => o.productId))];
      const productRows = productIds.length
        ? await db.query.products.findMany({ where: (p, { inArray }) => inArray(p.id, productIds) })
        : [];
      const productMap = Object.fromEntries(productRows.map(p => [p.id, p.name]));

      const confirmedSpend = buyerOrders
        .filter(o => ['payment_confirmed', 'processing', 'shipped', 'delivered'].includes(o.status))
        .reduce((sum, o) => sum + o.totalAmountIdr, 0);
      const ltvTier = confirmedSpend >= 5_000_000 ? 'HIGH (≥IDR 5jt)'
        : confirmedSpend >= 1_000_000 ? 'MEDIUM (IDR 1–5jt)'
        : confirmedSpend > 0 ? 'LOW (<IDR 1jt)' : 'ZERO (no confirmed spend)';

      const commerceFacts = [
        `Total orders placed: ${buyerOrders.length}`,
        `Delivered: ${buyerOrders.filter(o => o.status === 'delivered').length} | Shipped: ${buyerOrders.filter(o => o.status === 'shipped').length} | Cancelled: ${buyerOrders.filter(o => o.status === 'cancelled').length}`,
        `Total confirmed spend: IDR ${confirmedSpend.toLocaleString('id-ID')}`,
        `Lifetime value tier: ${ltvTier}`,
        `Products purchased: ${buyerOrders.length ? buyerOrders.map(o => productMap[o.productId] ?? 'Unknown').join(', ') : '(none)'}`,
        `Latest order: ${buyerOrders[0] ? `${buyerOrders[0].status} — ${productMap[buyerOrders[0].productId] ?? 'Unknown'} (${buyerOrders[0].createdAt.toISOString().split('T')[0]})` : '(no orders)'}`,
      ].join('\n');

      // ── Source 4: Genome ──────────────────────────────────────────────────
      const genomeRow = await db.query.buyerGenomes.findFirst({
        where: and(eq(buyerGenomes.buyerId, id), eq(buyerGenomes.tenantId, tenantId)),
      });
      const genome = genomeRow ? rowToGenome(genomeRow) : defaultGenome(id, tenantId, buyer.waPhone ?? undefined);
      const scores = genome.scores;

      const genomeFacts = `Confidence: ${genome.confidence} | Observations: ${genome.observationCount} messages
A — OCEAN: openness=${scores.openness} conscientiousness=${scores.conscientiousness} extraversion=${scores.extraversion} agreeableness=${scores.agreeableness} neuroticism=${scores.neuroticism}
B — Behavioral: communicationStyle=${scores.communicationStyle} decisionMaking=${scores.decisionMaking} brandRelationship=${scores.brandRelationship} influenceSusceptibility=${scores.influenceSusceptibility} emotionalExpression=${scores.emotionalExpression} conflictBehavior=${scores.conflictBehavior} literacyArticulation=${scores.literacyArticulation} socioeconomicFriction=${scores.socioeconomicFriction}
C — Human Uniqueness: identityFusion=${scores.identityFusion} chronesthesiaCapacity=${scores.chronesthesiaCapacity} tomSelfAwareness=${scores.tomSelfAwareness} tomSocialModeling=${scores.tomSocialModeling} executiveFlexibility=${scores.executiveFlexibility}`;

      // ── Source 5: External OSINT (LinkedIn + Instagram via Apify) ───────────
      // Name cascade: operator override → WA profile name → name expressed in chat
      const searchName = nameOverride?.trim() || buyer.displayName || expressedName || null;
      const externalOsint = await runExternalOsint(searchName, inferredRegion, config.APIFY_API_KEY);

      // ── LLM call ──────────────────────────────────────────────────────────
      const systemPrompt = `You are a master human intelligence analyst at the Pantheon "human whisperer" standard.
You receive structured data from four in-system sources and produce a JSON intelligence package.
Be concrete and specific to THIS person. No generic tropes. No hedging. No markdown outside string values.
Output ONLY valid JSON — no fences, no commentary.`;

      const userPrompt = `OSINT RESEARCH — BUYER INTELLIGENCE PACKAGE

=== SOURCE 1: IDENTITY ===
${identityFacts}

=== SOURCE 2: CONVERSATION CORPUS ===
${corpusFacts}

TRANSCRIPT (last 150 messages, oldest first):
${convTranscript}

=== SOURCE 3: COMMERCIAL HISTORY ===
${commerceFacts}

=== SOURCE 4: GENOME (scores 1–100) ===
${genomeFacts}

=== SOURCE 5: EXTERNAL PROFILE RESEARCH (LinkedIn + Instagram via Apify) ===
${formatExternalOsintForPrompt(externalOsint)}

---

Return this exact JSON structure:

{
  "informationInventory": {
    "knownFacts": ["bullet: every confirmed data point from all five sources — include LinkedIn headline/role/company and Instagram bio/follower count if found in Source 5"],
    "inferences": ["bullet: what can be reasonably inferred from the signals"],
    "gaps": ["bullet: what we do NOT know — honest blind spots that would sharpen the profile if known"],
    "dataQuality": "LOW | MEDIUM | HIGH — one sentence explaining the rating"
  },
  "intelligenceBrief": {
    "section1_archetype": "Named archetype + 2-3 sentences mapping to genome scores",
    "section2_identity": "What they believe about themselves. Roles, values, self-concept. What buying/not-buying signals about identity.",
    "section3_buyingPsychology": "Decision process. Primary YES triggers. Primary STOP triggers. Winning argument structure.",
    "section4_communicationBlueprint": "Exact tone, pace, vocabulary, message length, formality. What to NEVER do.",
    "section5_trustArchitecture": "What builds trust. What destroys it. Proof elements. Trust timeline.",
    "section6_resistanceMap": "Top 3-5 objections ranked by probability. Genome-tailored reframe for each.",
    "section7_engagementPlaybook": "Concrete 3-step operator opening. First message. Target emotional state at offer moment."
  },
  "genomeAdjustments": [
    {
      "trait": "camelCase trait name (one of the 18 genome params)",
      "currentScore": 50,
      "suggestedScore": 68,
      "rationale": "One sentence — specific evidence from the sources that justifies this shift"
    }
  ]
}

Rules for genomeAdjustments:
- Only include traits where evidence clearly supports ≥5 point change
- Do not adjust traits without specific evidence — omit them entirely
- suggestedScore must be 1–100`;

      type LLMResult = {
        informationInventory: { knownFacts: string[]; inferences: string[]; gaps: string[]; dataQuality: string };
        intelligenceBrief: Record<string, string>;
        genomeAdjustments: Array<{ trait: string; currentScore: number; suggestedScore: number; rationale: string }>;
      };

      let llmResult: LLMResult;
      try {
        const llm = getLLMClient();
        const res = await llm.chat(
          [{ role: 'user', content: userPrompt }],
          { system: systemPrompt, maxTokens: 3000, responseFormat: 'json_object' }
        );
        llmResult = JSON.parse(res.content) as LLMResult;
      } catch (err) {
        fastify.log.error({ err }, 'OSINT LLM call failed');
        return reply.status(503).send({ error: 'Intelligence analysis service unavailable. Please retry.' });
      }

      const now = new Date();

      // ── Apply genome adjustments ──────────────────────────────────────────
      const validTraits = new Set([
        'openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism',
        'communicationStyle', 'decisionMaking', 'brandRelationship', 'influenceSusceptibility',
        'emotionalExpression', 'conflictBehavior', 'literacyArticulation', 'socioeconomicFriction',
        'identityFusion', 'chronesthesiaCapacity', 'tomSelfAwareness', 'tomSocialModeling', 'executiveFlexibility',
      ]);

      const adjustments = (llmResult.genomeAdjustments ?? []).filter(
        a => validTraits.has(a.trait) && Math.abs(a.suggestedScore - a.currentScore) >= 5
      );

      const adjustedScores = { ...scores };
      for (const adj of adjustments) {
        (adjustedScores as unknown as Record<string, number>)[adj.trait] = Math.max(1, Math.min(100, Math.round(adj.suggestedScore)));
      }

      // ── Format osint_summary from structured output ───────────────────────
      const inv = llmResult.informationInventory ?? {} as LLMResult['informationInventory'];
      const brief = llmResult.intelligenceBrief ?? {};
      const osintSummary = [
        `## Information Inventory`,
        `**Data Quality:** ${inv.dataQuality ?? 'Unknown'}`,
        (inv.knownFacts ?? []).length ? `\n**Known facts:**\n${(inv.knownFacts as string[]).map(f => `• ${f}`).join('\n')}` : '',
        (inv.inferences ?? []).length ? `\n**Inferences:**\n${(inv.inferences as string[]).map(f => `• ${f}`).join('\n')}` : '',
        (inv.gaps ?? []).length ? `\n**Blind spots:**\n${(inv.gaps as string[]).map(f => `• ${f}`).join('\n')}` : '',
        adjustments.length ? `\n**Genome adjustments from OSINT:** ${adjustments.map(a => `${a.trait} ${a.currentScore}→${a.suggestedScore}`).join(' | ')}` : '',
        `\n## 1. Psychological Archetype\n${brief.section1_archetype ?? ''}`,
        `\n## 2. Identity Signals & Self-Concept\n${brief.section2_identity ?? ''}`,
        `\n## 3. Buying Psychology & Decision Triggers\n${brief.section3_buyingPsychology ?? ''}`,
        `\n## 4. Communication Blueprint\n${brief.section4_communicationBlueprint ?? ''}`,
        `\n## 5. Trust Architecture\n${brief.section5_trustArchitecture ?? ''}`,
        `\n## 6. Resistance Map\n${brief.section6_resistanceMap ?? ''}`,
        `\n## 7. Engagement Playbook\n${brief.section7_engagementPlaybook ?? ''}`,
      ].filter(Boolean).join('\n');

      // ── Persist genome with adjusted scores ───────────────────────────────
      if (genomeRow) {
        await db.update(buyerGenomes)
          .set({ ...scoresToDbFields(adjustedScores), osintSummary, lastSignalExtractedAt: now, updatedAt: now })
          .where(and(eq(buyerGenomes.buyerId, id), eq(buyerGenomes.tenantId, tenantId)));
      } else {
        const seeded = buildSeededGenome(id, tenantId, buyer.waPhone ?? undefined);
        await db.insert(buyerGenomes).values({
          buyerId: id, tenantId,
          confidence: seeded.confidence, observationCount: seeded.observationCount,
          ...scoresToDbFields(adjustedScores), formationInvariants: [],
          osintSummary, lastSignalExtractedAt: now, updatedAt: now,
        }).onConflictDoUpdate({
          target: [buyerGenomes.buyerId, buyerGenomes.tenantId],
          set: { ...scoresToDbFields(adjustedScores), osintSummary, updatedAt: now },
        });
      }

      // ── Log each genome adjustment as a real trait mutation ───────────────
      for (const adj of adjustments) {
        const key = adj.trait as keyof GenomeScores;
        const oldScore = (scores as unknown as Record<string, number>)[adj.trait] ?? 50;
        const newScore = (adjustedScores as unknown as Record<string, number>)[adj.trait];
        await db.insert(genomeMutations).values({
          buyerId: id, tenantId,
          traitName: key, oldScore, newScore, delta: newScore - oldScore,
          evidenceSummary: `[OSINT] ${adj.rationale}`,
          confidence: genome.confidence,
          conversationId: allConvs[0]?.id ?? null,
          createdAt: now,
        });
      }

      // ── Log OSINT run as sentinel entry ───────────────────────────────────
      await db.insert(genomeMutations).values({
        buyerId: id, tenantId,
        traitName: 'osint_research', oldScore: 0, newScore: 0, delta: 0,
        evidenceSummary: [
          `Sources: ${allMessages.length} msgs across ${allConvs.length} convs`,
          `${buyerOrders.length} orders (IDR ${confirmedSpend.toLocaleString('id-ID')} confirmed)`,
          externalOsint.searched
            ? `LinkedIn: ${externalOsint.linkedin ? externalOsint.linkedin.profileUrl : 'not found'} | Instagram: ${externalOsint.instagram ? externalOsint.instagram.profileUrl : 'not found'}`
            : `External OSINT: skipped (${externalOsint.linkedinSearchError ?? 'no API key'})`,
          `${adjustments.length} genome traits adjusted`,
          `Data quality: ${inv.dataQuality ?? 'unknown'}`,
        ].join(' · '),
        confidence: genome.confidence,
        conversationId: allConvs[0]?.id ?? null,
        createdAt: now,
      });

      // ── Return ────────────────────────────────────────────────────────────
      const updatedGenomeRow = await db.query.buyerGenomes.findFirst({
        where: and(eq(buyerGenomes.buyerId, id), eq(buyerGenomes.tenantId, tenantId)),
      });
      const updatedMutations = await db.query.genomeMutations.findMany({
        where: and(eq(genomeMutations.buyerId, id), eq(genomeMutations.tenantId, tenantId)),
        orderBy: (m, { desc: d }) => d(m.createdAt),
      });

      return reply.send({
        genome: updatedGenomeRow ? rowToGenome(updatedGenomeRow) : genome,
        mutations: updatedMutations.map(m => ({
          traitName: m.traitName, oldScore: m.oldScore, newScore: m.newScore,
          delta: m.delta, evidenceSummary: m.evidenceSummary, createdAt: m.createdAt,
        })),
        dialogCache: updatedGenomeRow?.dialogCache ?? null,
        dialogCacheBuiltAt: updatedGenomeRow?.dialogCacheBuiltAt ?? null,
        osintSummary, hasPersisted: true,
        externalOsintSearched: externalOsint.searched,
        externalOsintName: externalOsint.nameSearched,
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
