/**
 * @CLAUDE_CONTEXT
 * Package : packages/pantheon
 * File    : src/genome/builder.ts
 * Role    : Builds a Genome from conversation signals. Rule-based scoring — no LLM.
 *           Mirrors Pantheon V2 GenomeBuilder._derive_scores_from_intake() logic
 *           but adapted for WhatsApp conversation patterns instead of intake forms.
 *           Initial genome is seeded from cultural priors (not flat 50s).
 *           Signal-based updates are INCREMENTAL — only new messages are processed.
 * Exports : deriveScores(), scoreConfidence(), applyConfidencePenalty(),
 *           defaultGenome(), mergeScores(), buildSeededGenome()
 */
import type { GenomeScores, Genome, ConversationSignals, ConfidenceLevel } from '../types';
import {
  buildSeededScores,
  inferRegionFromPhone,
  type RegionCode,
  type ReligiosityTier,
} from './culturalPriors';

const NEUTRAL: GenomeScores = {
  openness: 50, conscientiousness: 50, extraversion: 50,
  agreeableness: 50, neuroticism: 50,
  communicationStyle: 50, decisionMaking: 50, brandRelationship: 50,
  influenceSusceptibility: 50, emotionalExpression: 50,
  conflictBehavior: 50, literacyArticulation: 50, socioeconomicFriction: 50,
  identityFusion: 50, chronesthesiaCapacity: 50,
  tomSelfAwareness: 50, tomSocialModeling: 50, executiveFlexibility: 50,
};

function clamp(n: number): number { return Math.max(1, Math.min(100, Math.round(n))); }

/**
 * Build genome scores from conversation signals.
 * Returns a partial score object — only traits with enough signal are adjusted.
 */
export function deriveScores(signals: ConversationSignals): GenomeScores {
  const s = { ...NEUTRAL };

  // ── Cluster A: OCEAN ───────────────────────────────────────────────────────

  // Openness: lots of questions + long messages → curious/open
  s.openness = clamp(50
    + Math.min(signals.questionCount * 3, 20)
    + (signals.avgMessageLength > 100 ? 10 : signals.avgMessageLength < 30 ? -10 : 0));

  // Conscientiousness: formal language, polite, deliberate
  s.conscientiousness = clamp(50
    + (signals.formalLanguage ? 15 : -10)
    + Math.min(signals.politenessCount * 5, 20)
    + (signals.responseLatencyPattern === 'slow' ? 10 : signals.responseLatencyPattern === 'fast' ? -5 : 0));

  // Extraversion: emoji frequency, long messages, quick replies
  s.extraversion = clamp(50
    + Math.min(signals.emojiFrequency * 8, 25)
    + (signals.responseLatencyPattern === 'fast' ? 15 : signals.responseLatencyPattern === 'slow' ? -10 : 0)
    + (signals.avgMessageLength > 80 ? 10 : 0));

  // Agreeableness: polite, low objections, low conflict
  s.agreeableness = clamp(50
    + Math.min(signals.politenessCount * 8, 30)
    - Math.min(signals.objectionCount * 6, 20));

  // Neuroticism: urgency signals, high objections
  s.neuroticism = clamp(50
    + Math.min(signals.urgencyCount * 8, 25)
    + Math.min(signals.objectionCount * 5, 20));

  // ── Cluster B: Behavioral ──────────────────────────────────────────────────

  // Communication style: formal text + long → high (formal/verbose); emoji-heavy + short → low
  s.communicationStyle = clamp(50
    + (signals.formalLanguage ? 20 : -15)
    + (signals.avgMessageLength > 80 ? 10 : signals.avgMessageLength < 25 ? -10 : 0)
    - Math.min(signals.emojiFrequency * 5, 20));

  // Decision making: slow responders + many questions → deliberate (high)
  s.decisionMaking = clamp(50
    + (signals.responseLatencyPattern === 'slow' ? 20 : signals.responseLatencyPattern === 'fast' ? -15 : 0)
    + Math.min(signals.questionCount * 3, 15)
    - Math.min(signals.urgencyCount * 6, 20));

  // Brand relationship: brand mentions + positive engagement → loyal
  s.brandRelationship = clamp(50
    + Math.min(signals.brandMentionCount * 8, 25)
    - Math.min(signals.objectionCount * 5, 15));

  // Influence susceptibility: responds quickly + agreeable + polite → more susceptible
  s.influenceSusceptibility = clamp(50
    + (signals.responseLatencyPattern === 'fast' ? 15 : 0)
    + Math.min(signals.politenessCount * 5, 15)
    - Math.min(signals.objectionCount * 8, 25));

  // Emotional expression: emoji use + urgency words → more expressive
  s.emotionalExpression = clamp(50
    + Math.min(signals.emojiFrequency * 10, 30)
    + Math.min(signals.urgencyCount * 5, 15)
    - (signals.formalLanguage ? 10 : 0));

  // Conflict behavior: high objections + direct phrasing → confrontational
  s.conflictBehavior = clamp(50
    + Math.min(signals.objectionCount * 8, 30)
    - Math.min(signals.politenessCount * 5, 20));

  // Literacy/articulation: long formal messages → high
  s.literacyArticulation = clamp(50
    + (signals.avgMessageLength > 100 ? 20 : signals.avgMessageLength < 20 ? -15 : 0)
    + (signals.formalLanguage ? 15 : -10));

  // Socioeconomic friction: price questions → high sensitivity
  s.socioeconomicFriction = clamp(50
    + Math.min(signals.priceQuestionsCount * 12, 40)
    - Math.min(signals.brandMentionCount * 4, 15));

  // ── Cluster C: Human Uniqueness ────────────────────────────────────────────

  // Identity fusion: identity mentions → high
  s.identityFusion = clamp(50
    + Math.min(signals.expressedIdentity.length * 10, 30)
    + Math.min(signals.selfReferenceCount * 3, 15));

  // Chronesthesia: future-planning language, many questions → higher
  s.chronesthesiaCapacity = clamp(50
    + Math.min(signals.questionCount * 4, 20)
    + (signals.responseLatencyPattern === 'slow' ? 10 : 0));

  // ToM self-awareness: self-reference + polite
  s.tomSelfAwareness = clamp(50
    + Math.min(signals.selfReferenceCount * 4, 20)
    + (signals.formalLanguage ? 10 : 0));

  // ToM social modeling: quick replies + rapport signals
  s.tomSocialModeling = clamp(50
    + (signals.responseLatencyPattern === 'fast' ? 15 : 0)
    + Math.min(signals.politenessCount * 5, 20));

  // Executive flexibility: low objections + brand openness → more flexible
  s.executiveFlexibility = clamp(50
    - Math.min(signals.objectionCount * 6, 20)
    + Math.min(signals.brandMentionCount * 5, 15));

  return s;
}

/**
 * Score confidence based on how many observations we have.
 * <5 messages → LOW, 5–20 → MEDIUM, 20+ → HIGH
 */
export function scoreConfidence(observationCount: number): ConfidenceLevel {
  if (observationCount >= 20) return 'HIGH';
  if (observationCount >= 5) return 'MEDIUM';
  return 'LOW';
}

/**
 * Apply confidence penalty: compress scores toward 50.
 * LOW → ±25 compression, MEDIUM → ±15, HIGH → no change.
 */
export function applyConfidencePenalty(scores: GenomeScores, confidence: ConfidenceLevel): GenomeScores {
  const compression = confidence === 'LOW' ? 0.5 : confidence === 'MEDIUM' ? 0.7 : 1.0;
  const result = {} as GenomeScores;
  for (const key of Object.keys(scores) as (keyof GenomeScores)[]) {
    result[key] = clamp(50 + (scores[key] - 50) * compression);
  }
  return result;
}

/**
 * Build a culturally-seeded genome for a new buyer.
 * Uses regional cultural priors + individual Gaussian spread (sigma=10).
 * The seed is deterministic per buyerId — stable across multiple calls.
 * This is the Formation layer: scores are set once and protected by
 * formation invariants; subsequent updates are incremental deltas only.
 */
export function buildSeededGenome(
  buyerId: string,
  tenantId: string,
  waPhone?: string,
  region?: RegionCode,
  religiosity?: ReligiosityTier,
): Genome {
  const detectedRegion = region ?? (waPhone ? inferRegionFromPhone(waPhone) : 'id');
  const scores = buildSeededScores(buyerId, detectedRegion, religiosity ?? 'moderate');
  // Apply LOW confidence compression — scores are priors, not observed
  const compressed = applyConfidencePenalty(scores, 'LOW');
  return {
    buyerId,
    tenantId,
    scores: compressed,
    confidence: 'LOW',
    formationInvariants: [],
    observationCount: 0,
    lastUpdatedAt: new Date(),
  };
}

/**
 * Default genome stub for display when no genome exists yet.
 * Uses cultural seeding (not flat 50s).
 */
export function defaultGenome(buyerId: string, tenantId: string, waPhone?: string): Genome {
  return buildSeededGenome(buyerId, tenantId, waPhone);
}

/**
 * Merge new signal-derived scores with an existing genome using exponential moving average.
 * Weight = 0.3 for new signals (don't over-correct on a single conversation batch).
 */
export function mergeScores(existing: GenomeScores, newScores: GenomeScores, weight = 0.3): GenomeScores {
  const result = {} as GenomeScores;
  for (const key of Object.keys(existing) as (keyof GenomeScores)[]) {
    result[key] = clamp(existing[key] * (1 - weight) + newScores[key] * weight);
  }
  return result;
}
