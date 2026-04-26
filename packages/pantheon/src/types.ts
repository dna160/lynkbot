/**
 * @CLAUDE_CONTEXT
 * Package : packages/pantheon
 * File    : src/types.ts
 * Role    : All Pantheon V2-inspired type definitions adapted for WhatsApp B2C commerce.
 *           Genome = psychological profile of a buyer built from conversation signals.
 *           Six moment types adapted from B2B (Pantheon V2) → B2C WhatsApp context.
 * Exports : GenomeScores, Genome, MomentType, DialogOption, DialogCache, SelectionResult, etc.
 */

// ─── Genome Parameters ────────────────────────────────────────────────────────

/** All 18 genome parameters (1–100). Mirrors Pantheon V2 schema. */
export interface GenomeScores {
  // Cluster A: OCEAN personality
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
  // Cluster B: Behavioral
  communicationStyle: number;   // 1=terse/emoji, 100=verbose/formal
  decisionMaking: number;       // 1=impulsive, 100=deliberate
  brandRelationship: number;    // 1=skeptical, 100=brand-loyal
  influenceSusceptibility: number; // 1=immune, 100=highly influenced
  emotionalExpression: number;  // 1=flat, 100=expressive
  conflictBehavior: number;     // 1=avoidant, 100=confrontational
  literacyArticulation: number; // 1=simple, 100=sophisticated
  socioeconomicFriction: number;// 1=price-insensitive, 100=very price-sensitive
  // Cluster C: Human Uniqueness (V2 addition)
  identityFusion: number;       // strength of identity tied to purchases
  chronesthesiaCapacity: number;// future-thinking vs present-focused
  tomSelfAwareness: number;     // self-awareness in conversation
  tomSocialModeling: number;    // reading social cues / rapport-seeking
  executiveFlexibility: number; // willingness to change mind mid-conversation
}

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface Genome {
  buyerId: string;
  tenantId: string;
  scores: GenomeScores;
  confidence: ConfidenceLevel;
  /** Immutable traits detected with high certainty — won't be mutated */
  formationInvariants: string[];
  observationCount: number;    // number of messages used to build/update this genome
  lastUpdatedAt: Date;
}

// ─── Conversation Signals ─────────────────────────────────────────────────────

/** Extracted from WhatsApp conversation text */
export interface ConversationSignals {
  messageCount: number;
  avgMessageLength: number;
  emojiFrequency: number;         // emojis per message
  questionCount: number;
  priceQuestionsCount: number;    // "berapa", "harga", "diskon", "promo"
  urgencyCount: number;           // "sekarang", "buruan", "cepat", "urgent"
  politenessCount: number;        // "tolong", "mohon", "maaf", "terima kasih"
  selfReferenceCount: number;     // "saya", "aku", "I"
  brandMentionCount: number;      // product/brand name mentions
  objectionCount: number;         // doubt/hesitation keywords
  formalLanguage: boolean;        // uses formal pronouns/grammar
  expressedName: string | null;   // if buyer said their name
  expressedIdentity: string[];    // profession, role, family role mentions
  responseLatencyPattern: 'fast' | 'medium' | 'slow'; // <30s / <5m / >5m
}

// ─── RWI (Receptivity Window Index) ──────────────────────────────────────────

export type WindowStatus = 'closed' | 'narrowing' | 'open' | 'peak';

export interface RWISnapshot {
  score: number;          // 0–100
  windowStatus: WindowStatus;
  components: {
    engagementVelocity: number;   // message frequency trend
    sentimentMomentum: number;    // positive/negative shift
    decisionProximity: number;    // closeness to purchase decision
    frictionLevel: number;        // objections raised recently
  };
}

// ─── Moment Types (WhatsApp B2C adapted from Pantheon V2 B2B) ─────────────────

export type MomentType =
  | 'neutral_exploratory'     // browsing, asking general questions
  | 'price_resistant'         // pushing back on price, asking discounts
  | 'trust_building'          // asking about credibility, reviews, proof
  | 'identity_aligned'        // connecting product to buyer's identity/values
  | 'high_engagement'         // highly interested, asking detailed questions
  | 'closing_ready';          // showing buy intent, ready to commit

// ─── Dialog Cache ─────────────────────────────────────────────────────────────

export interface DialogOption {
  coreApproach: string;      // strategic framing
  baseLanguage: string;      // suggested message text (in buyer's language)
  triggerPhrase: string;     // opening words
  baseProbability: number;   // 0–100, adjusted by genome
  genomeRationale: string;   // why this suits this specific buyer
}

export interface MomentCache {
  option_a: DialogOption;
  option_b: DialogOption;
  option_c: DialogOption;
}

export type DialogCache = Record<MomentType, MomentCache>;

// ─── Classification & Selection ───────────────────────────────────────────────

export interface ClassificationResult {
  momentType: MomentType;
  confidence: number;         // 0–1
  keywords: string[];         // which keywords triggered this classification
}

export interface SelectionResult {
  momentType: MomentType;
  options: MomentCache;
  bestOption: 'a' | 'b' | 'c';
  /** The specific language to use, potentially adapted from base_language */
  recommendedText: string;
  reasoning: string;
  rwi: RWISnapshot;
}

// ─── Mutation (genome update) ─────────────────────────────────────────────────

export interface MutationCandidate {
  traitName: keyof GenomeScores;
  oldScore: number;
  newScore: number;
  delta: number;
  evidenceSummary: string;
  confidence: ConfidenceLevel;
}
