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
      const externalOsint = await runExternalOsint(
        searchName,
        inferredRegion,
        config.APIFY_API_KEY,
        config.SERPER_API_KEY,
        config.XAI_API_KEY,
        config.XAI_BASE_URL,
      );

      // ── LLM call ──────────────────────────────────────────────────────────
      const systemPrompt = `You are a master human intelligence analyst at the Pantheon "human whisperer" standard.
You receive structured data from five sources — in-system signals AND external profile scrapes — and produce a comprehensive JSON intelligence package.
Be concrete and specific to THIS person. No generic tropes. No hedging. No markdown outside string values.
Output ONLY valid JSON — no fences, no commentary.

═══ GENOME INFERENCE GUIDE ═══
All 18 genome parameters are scored 1–100. 50 = population baseline. Apply these mappings when external OSINT data is present:

CLUSTER A — OCEAN:
• openness (1=rigid/conventional, 100=highly creative/curious)
  LinkedIn: Creative industry role or multidisciplinary career → +15 to +25
  Instagram: Diverse content themes, travel, art, experimentation → +10 to +20
  Posts: Thought leadership on diverse topics, philosophical/intellectual content → +10

• conscientiousness (1=spontaneous/disorganised, 100=highly disciplined)
  LinkedIn: Long tenures (3+ yrs each role), consistent career progression → +15
  LinkedIn: Founder/CEO who scaled a company → +20
  Instagram: Consistent posting schedule (daily/weekly for 6+ months) → +10
  Absence of job-hopping (all roles 2+ yrs) → +15

• extraversion (1=introverted/reserved, 100=highly social)
  LinkedIn: 500+ connections → +20; 1000+ → +25
  LinkedIn: Frequent posts with high engagement → +15
  Instagram: 10K+ followers → +20; 100K+ → +30
  Instagram: Posting frequency daily/weekly → +15
  Private Instagram account → -20

• agreeableness (1=competitive/challenging, 100=cooperative/warm)
  Instagram: Family, community, collaboration content → +15
  LinkedIn: Volunteer work, mentoring, nonprofit → +10
  Posts: Confrontational/debate-seeking content → -15
  Posts: Supportive/appreciative language → +10

• neuroticism (1=emotionally stable, 100=anxious/reactive)
  Private Instagram (hidden from public) → +15
  Erratic posting frequency (bursts then silence) → +10
  Posts: Emotional venting, anxiety/stress content → +20
  LinkedIn: Frequent job changes (<1 yr each) → +10

CLUSTER B — BEHAVIORAL:
• communicationStyle (1=very informal/emoji-heavy, 100=very formal/corporate)
  LinkedIn: C-suite title, corporate career → +20
  LinkedIn: Posts in formal grammatically correct language → +15
  Instagram: Casual captions, heavy emoji → -20
  Instagram: Professional/brand account style → +15

• decisionMaking (1=impulsive/emotional, 100=analytical/methodical)
  LinkedIn: Engineering, finance, data, legal roles → +20
  LinkedIn: Long career stability, methodical progression → +15
  Instagram: Impulse purchases/lifestyle splurge content → -15
  Posts: Evidence-based, data-citing content → +20

• brandRelationship (1=price-driven/no loyalty, 100=premium brand loyalist)
  Instagram: Luxury brand tags, aspirational lifestyle → +20 to +30
  Instagram: Discount/promo content, budget lifestyle → -20
  Image analysis: Luxury setting, premium brands visible → +20
  Image analysis: Budget/mass-market setting → -10

• influenceSusceptibility (1=fully independent, 100=highly social-proof driven)
  Instagram: Heavy engagement with influencer content, many follows vs followers → +15
  Instagram: Posts referencing trends, viral content → +15
  LinkedIn: Follows thought leaders, engaged with trending topics → +10
  High follower count (they ARE the influencer) → -15

• emotionalExpression (1=stoic/unexpressive, 100=openly emotional)
  Instagram: Personal stories, vulnerable captions → +20
  Instagram: Celebration, life milestones shared publicly → +15
  LinkedIn: Clinical career-only posts, no personal content → -15
  Image analysis: Emotional tone "joyful" or "vulnerable" → +15

• conflictBehavior (1=avoidant/passive, 100=confrontational/assertive)
  LinkedIn: Debate-style posts, challenging industry norms → +20
  LinkedIn: Founder disrupting an industry → +15
  Instagram: No controversial content, peaceful aesthetic → -10
  Posts: Direct criticism of competitors/status quo → +20

• literacyArticulation (1=basic/simple communication, 100=highly articulate/eloquent)
  LinkedIn: Published articles, long-form posts → +20
  LinkedIn: Advanced degree (PhD, Master's) → +15
  Instagram: Captions with rich vocabulary, nuanced ideas → +15
  LinkedIn: One-liner posts, minimal engagement depth → -10

• socioeconomicFriction (1=premium buyer/no price concern, 100=extreme price sensitivity)
  Instagram: Luxury lifestyle, premium brands visible → -25
  Instagram: Budget brands, discount content → +20
  Image analysis: Luxury setting → -20; budget setting → +15
  LinkedIn: Senior executive compensation signals → -15
  Indonesian cultural prior baseline: +12 (already baked in)

CLUSTER C — HUMAN UNIQUENESS:
• identityFusion (1=flexible/context-adapting, 100=identity fused to brand/role/cause)
  LinkedIn: "I AM a founder" language, identity-first bio → +25
  Instagram: Personal brand built around a lifestyle/cause/role → +20
  Consistent aesthetic and theme across ALL posts → +15
  Career of 10+ years in same field → +15

• chronesthesiaCapacity (1=purely present-focused, 100=strong future orientation)
  LinkedIn: Vision-driven posts, long-term goals stated → +20
  LinkedIn: Active investor, mentor for next generation → +15
  Instagram: Goal-setting, aspirational future-state content → +15
  Posts: Reflective, narrative of personal growth → +10

• tomSelfAwareness (1=low self-awareness, 100=deep self-reflection)
  LinkedIn: Candid lessons-learned posts, admits failures → +20
  Instagram: Vulnerable personal growth content → +15
  Posts: Meta-commentary on own behavior/thinking → +20
  No reflective content anywhere → -10

• tomSocialModeling (1=struggles to read others, 100=expert social modeler)
  LinkedIn: 500+ connections + active networking → +15
  LinkedIn: Sales, consulting, coaching, leadership roles → +20
  Instagram: High engagement rate (likes/followers ratio >3%) → +15
  Content that demonstrates reading others' needs → +15

• executiveFlexibility (1=rigid/single-approach, 100=highly adaptive/multi-modal)
  LinkedIn: Career spanning multiple industries → +20
  LinkedIn: Pivoted roles successfully (e.g., engineer → CEO) → +20
  Instagram: Content style varies (education, entertainment, personal) → +10
  Evidence of handling complex, ambiguous situations → +15

═══ CITATION REQUIREMENT ═══
Every genomeAdjustments entry MUST include a "sources" array. Each source cites the EXACT data point:
Example: "sources": ["LinkedIn: headline 'Founder & CEO at TechCorp'", "Instagram: 14.2K followers", "Post image 3: luxury restaurant setting, Hermès bag visible"]
Sources must be specific — no vague citations like "LinkedIn profile" without detail.`;

      const userPrompt = `OSINT RESEARCH — BUYER INTELLIGENCE PACKAGE

=== SOURCE 1: IDENTITY ===
${identityFacts}

=== SOURCE 2: CONVERSATION CORPUS ===
${corpusFacts}

TRANSCRIPT (last 150 messages, oldest first):
${convTranscript}

=== SOURCE 3: COMMERCIAL HISTORY ===
${commerceFacts}

=== SOURCE 4: GENOME (scores 1–100, current state before OSINT) ===
${genomeFacts}

=== SOURCE 5: EXTERNAL PROFILE RESEARCH (LinkedIn + Instagram via Serper + Apify + xAI Vision) ===
${formatExternalOsintForPrompt(externalOsint)}

---

Return this exact JSON structure (no fences, no commentary — pure JSON):

{
  "informationInventory": {
    "knownFacts": ["bullet: every confirmed data point from all five sources — include LinkedIn headline/role/company and Instagram bio/follower count if found in Source 5"],
    "inferences": ["bullet: what can be reasonably inferred from the combined signals"],
    "gaps": ["bullet: what we do NOT know — honest blind spots that would sharpen the profile if known"],
    "dataQuality": "LOW | MEDIUM | HIGH — one sentence explaining the rating"
  },
  "osintReport": {
    "linkedinPersona": "2-3 sentences synthesising career arc, professional identity, and what the LinkedIn data reveals about this person's self-concept and professional values. Cite specific roles, tenures, and post themes.",
    "instagramPersona": "2-3 sentences synthesising lifestyle, values, and social identity from Instagram posts, follower count, posting frequency, and image analysis signals. Cite specific posts or images.",
    "synthesizedExternalPersona": "3-4 sentences merging LinkedIn + Instagram into a unified external-facing identity portrait. Where do the two platforms agree? Where do they reveal different facets? What does this person want the world to think about them?",
    "keyExternalSignals": ["bullet: the single most significant genome-relevant signal from each source — e.g. 'LinkedIn: CEO for 7 years → identityFusion HIGH', 'Instagram post 2: Rolex visible in gym photo → brandRelationship HIGH, socioeconomicFriction LOW'"]
  },
  "intelligenceBrief": {
    "section1_archetype": "Named archetype + 2-3 sentences mapping to genome scores and external profile signals",
    "section2_identity": "What they believe about themselves. Roles, values, self-concept. What the external profiles add to the WA conversation picture.",
    "section3_buyingPsychology": "Decision process. Primary YES triggers. Primary STOP triggers. Winning argument structure — calibrated to BOTH conversation signals AND external profile data.",
    "section4_communicationBlueprint": "Exact tone, pace, vocabulary, message length, formality. What to NEVER do. How does the external profile refine this?",
    "section5_trustArchitecture": "What builds trust. What destroys it. Proof elements that resonate with THIS person's identity (use external profile signals). Trust timeline.",
    "section6_resistanceMap": "Top 3-5 objections ranked by probability. Genome-tailored reframe for each — reference external data where relevant.",
    "section7_engagementPlaybook": "Concrete 3-step operator opening. First message. Target emotional state at offer moment. Reference specific angles from external profile."
  },
  "genomeAdjustments": [
    {
      "trait": "camelCase trait name (one of the 18 genome params)",
      "currentScore": 50,
      "suggestedScore": 68,
      "rationale": "One sentence — specific evidence from the sources that justifies this shift",
      "sources": ["exact citation 1 e.g. 'LinkedIn: headline Founder & CEO'", "exact citation 2 e.g. 'Instagram: 14.2K followers'"]
    }
  ]
}

Rules for genomeAdjustments:
- Only include traits where external OSINT evidence (Source 5) clearly supports ≥5 point change
- Do not adjust traits using only conversation data — that is handled by the refresh endpoint
- suggestedScore must be 1–100
- "sources" array must have ≥1 citation per adjustment — never empty
- Use the Genome Inference Guide in the system prompt to calibrate adjustment magnitude`;

      type LLMResult = {
        informationInventory: { knownFacts: string[]; inferences: string[]; gaps: string[]; dataQuality: string };
        osintReport: { linkedinPersona: string; instagramPersona: string; synthesizedExternalPersona: string; keyExternalSignals: string[] };
        intelligenceBrief: Record<string, string>;
        genomeAdjustments: Array<{ trait: string; currentScore: number; suggestedScore: number; rationale: string; sources: string[] }>;
      };

      let llmResult: LLMResult;
      try {
        const llm = getLLMClient();
        const res = await llm.chat(
          [{ role: 'user', content: userPrompt }],
          { system: systemPrompt, maxTokens: 5000, responseFormat: 'json_object' }
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
      const report = llmResult.osintReport ?? {} as LLMResult['osintReport'];
      const brief = llmResult.intelligenceBrief ?? {};
      const osintSummary = [
        `## Information Inventory`,
        `**Data Quality:** ${inv.dataQuality ?? 'Unknown'}`,
        (inv.knownFacts ?? []).length ? `\n**Known facts:**\n${(inv.knownFacts as string[]).map(f => `• ${f}`).join('\n')}` : '',
        (inv.inferences ?? []).length ? `\n**Inferences:**\n${(inv.inferences as string[]).map(f => `• ${f}`).join('\n')}` : '',
        (inv.gaps ?? []).length ? `\n**Blind spots:**\n${(inv.gaps as string[]).map(f => `• ${f}`).join('\n')}` : '',
        adjustments.length
          ? `\n**Genome adjustments from OSINT (${adjustments.length} traits):**\n${adjustments.map(a => `• ${a.trait} ${a.currentScore}→${a.suggestedScore} | ${a.rationale}${(a.sources ?? []).length ? ` [Sources: ${a.sources.join('; ')}]` : ''}`).join('\n')}`
          : '',
        report.linkedinPersona ? `\n## External Profile Report\n**LinkedIn:** ${report.linkedinPersona}` : '',
        report.instagramPersona ? `\n**Instagram:** ${report.instagramPersona}` : '',
        report.synthesizedExternalPersona ? `\n**Synthesized:** ${report.synthesizedExternalPersona}` : '',
        (report.keyExternalSignals ?? []).length
          ? `\n**Key external signals:**\n${(report.keyExternalSignals as string[]).map(s => `• ${s}`).join('\n')}`
          : '',
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
          evidenceSummary: `[OSINT] ${adj.rationale}${(adj.sources ?? []).length ? ` | Sources: ${adj.sources.join('; ')}` : ''}`,
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
            : `External OSINT: skipped (${externalOsint.linkedinError ?? 'no API key'})`,
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
        externalOsintReport: llmResult.osintReport ?? null,
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
