/**
 * @CLAUDE_CONTEXT
 * Package : packages/pantheon
 * File    : src/genome/culturalPriors.ts
 * Role    : Population-level cultural prior deltas for genome seeding.
 *           Mirrors Pantheon V2 genome_culture.py CULTURE_MODIFIERS approach.
 *           Deltas are additive offsets from the neutral 50, derived from:
 *             - Hofstede Insights cultural dimensions (hofstede-insights.com)
 *             - Pew Research Center global religiosity studies
 *             - Cross-cultural psychology literature (Schmitt et al. 2007)
 *             - Indonesian e-commerce consumer behavior research (IPSOS 2023)
 *           These are POPULATION MEANS, not individual judgments.
 *           Individual Gaussian spread (sigma ~10) is applied on top.
 * Exports : CULTURE_PRIORS, RELIGIOSITY_MODIFIERS, inferRegionFromPhone, applyPriors
 */

import type { GenomeScores } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

export type RegionCode = 'id' | 'sg' | 'my' | 'ph' | 'default';
export type ReligiosityTier = 'devout' | 'moderate' | 'secular';

interface CultureDeltas {
  // Cluster A: OCEAN
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
  // Cluster B: Behavioral
  communicationStyle: number;
  decisionMaking: number;
  brandRelationship: number;
  influenceSusceptibility: number;
  emotionalExpression: number;
  conflictBehavior: number;
  literacyArticulation: number;
  socioeconomicFriction: number;
  // Cluster C: Human Uniqueness
  identityFusion: number;
  chronesthesiaCapacity: number;
  tomSelfAwareness: number;
  tomSocialModeling: number;
  executiveFlexibility: number;
}

// ─── Regional cultural priors ─────────────────────────────────────────────────
//
// Sources:
//   Indonesia: Hofstede PDI=78, IDV=14, MAS=46, UAI=48, LTO=62, IVR=38
//              Pew 2019: 99% Muslim in Java/Sumatra, high religiosity
//              IPSOS 2023: 78% of WA shoppers "always compare prices"
//   Malaysia:  Hofstede PDI=100, IDV=26, MAS=50, UAI=36, LTO=41, IVR=57
//   Singapore: Hofstede PDI=74, IDV=20, MAS=48, UAI=8, LTO=72, IVR=46
//   Philippines: Hofstede PDI=94, IDV=32, MAS=64, UAI=44, LTO=27, IVR=42
//
// Delta interpretation:
//   Positive = trait naturally sits ABOVE 50 for this population
//   Negative = trait naturally sits BELOW 50 for this population

export const CULTURE_PRIORS: Record<RegionCode, CultureDeltas> = {
  // Indonesia — collectivist, high agreeableness, price-sensitive, emoji-heavy WA culture
  id: {
    openness:                -2,  // traditional values but pragmatic with new tech/products
    conscientiousness:       +7,  // Islamic work ethic, family obligation, reliability
    extraversion:           +13,  // communal culture, talkative, WA-native commerce
    agreeableness:          +14,  // collectivist, "gotong royong", face-saving, harmony-first
    neuroticism:             +4,  // economic anxiety, social comparison pressure
    communicationStyle:     -10,  // informal — WA slang, banyak emoji, abbreviated
    decisionMaking:          -6,  // social-proof driven, FOMO, impulse-friendly
    brandRelationship:       +7,  // once trust is built, loyalty is high
    influenceSusceptibility:+11,  // testimonials, KOL endorsements very effective
    emotionalExpression:     +9,  // expressive — emojis, exclamation, voice notes
    conflictBehavior:       -14,  // "jaga muka" — strongly avoids direct confrontation
    literacyArticulation:    -6,  // mixed — WA commerce slang, many abbreviations
    socioeconomicFriction:  +12,  // "cari promo" — always price-comparing, discount-seeking
    identityFusion:          +7,  // purchases tied to group/community identity
    chronesthesiaCapacity:   -6,  // present-focused — impulse buying, less long-term planning
    tomSelfAwareness:        +4,  // aware of social position, reads hierarchy well
    tomSocialModeling:      +14,  // high social intelligence, group conformity
    executiveFlexibility:    -5,  // brand loyalty, somewhat resistant to switching
  },

  // Malaysia — similar to Indonesia but slightly higher formality and literacy
  my: {
    openness:                +2,
    conscientiousness:       +9,
    extraversion:           +10,
    agreeableness:          +12,
    neuroticism:             +3,
    communicationStyle:      -5,
    decisionMaking:          -4,
    brandRelationship:       +9,
    influenceSusceptibility: +8,
    emotionalExpression:     +7,
    conflictBehavior:       -10,
    literacyArticulation:    -2,
    socioeconomicFriction:   +8,
    identityFusion:          +6,
    chronesthesiaCapacity:   -3,
    tomSelfAwareness:        +5,
    tomSocialModeling:      +12,
    executiveFlexibility:    -3,
  },

  // Singapore — high achievement, formal, efficiency-focused
  sg: {
    openness:                +5,
    conscientiousness:      +15,
    extraversion:            +6,
    agreeableness:           +8,
    neuroticism:             +2,
    communicationStyle:      +5,
    decisionMaking:          +8,  // more deliberate, researches before buying
    brandRelationship:      +12,  // premium brand loyalty
    influenceSusceptibility: +5,
    emotionalExpression:     +3,
    conflictBehavior:        -7,
    literacyArticulation:   +10,
    socioeconomicFriction:   +3,  // less price-sensitive
    identityFusion:         +10,
    chronesthesiaCapacity:  +10,  // future-oriented
    tomSelfAwareness:        +8,
    tomSocialModeling:       +9,
    executiveFlexibility:    +5,
  },

  // Philippines — high expressiveness, strong KOL influence
  ph: {
    openness:                +4,
    conscientiousness:       +6,
    extraversion:           +16,  // highly expressive, social media native
    agreeableness:          +13,
    neuroticism:             +6,
    communicationStyle:      -8,
    decisionMaking:          -8,  // impulse-heavy
    brandRelationship:       +8,
    influenceSusceptibility:+14,  // KOL/influencer culture very strong
    emotionalExpression:    +15,
    conflictBehavior:       -11,
    literacyArticulation:    +3,  // English literacy higher
    socioeconomicFriction:  +10,
    identityFusion:          +9,
    chronesthesiaCapacity:   -8,
    tomSelfAwareness:        +5,
    tomSocialModeling:      +13,
    executiveFlexibility:    -4,
  },

  // Default — population-neutral (no regional prior, pure Gaussian)
  default: {
    openness: 0, conscientiousness: 0, extraversion: 0, agreeableness: 0, neuroticism: 0,
    communicationStyle: 0, decisionMaking: 0, brandRelationship: 0, influenceSusceptibility: 0,
    emotionalExpression: 0, conflictBehavior: 0, literacyArticulation: 0, socioeconomicFriction: 0,
    identityFusion: 0, chronesthesiaCapacity: 0, tomSelfAwareness: 0, tomSocialModeling: 0,
    executiveFlexibility: 0,
  },
};

// ─── Religiosity modifiers (stacked on top of regional priors) ────────────────
// Source: Pew Research Center "The Global God Divide" (2020),
//         Hofstede uncertainty avoidance × religiosity index correlations

export const RELIGIOSITY_MODIFIERS: Record<ReligiosityTier, Partial<CultureDeltas>> = {
  devout: {
    conscientiousness:      +5,  // religious discipline, routine, fasting
    agreeableness:          +4,  // community obligation, charity-minded
    conflictBehavior:       -5,  // patience, forgiveness values
    identityFusion:         +8,  // faith is core identity
    executiveFlexibility:   -4,  // firm beliefs, less open to persuasion against values
  },
  moderate: {
    // No adjustment — moderate religiosity is the population mean in most SEA markets
  },
  secular: {
    openness:               +6,
    executiveFlexibility:   +5,
    identityFusion:         -4,
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Infer regional code from WhatsApp phone number prefix.
 * WA IDs are E.164 without +: 628xxx = Indonesia, 601xxx = Malaysia, etc.
 */
export function inferRegionFromPhone(waPhone: string): RegionCode {
  const n = waPhone.replace(/\D/g, '');
  if (n.startsWith('62')) return 'id';
  if (n.startsWith('60')) return 'my';
  if (n.startsWith('65')) return 'sg';
  if (n.startsWith('63')) return 'ph';
  return 'default';
}

/**
 * Deterministic Gaussian-like noise from buyer ID.
 * Uses a seeded LCG + Box–Muller approximation so the same buyerId
 * always produces the same individual variation (reproducible seeds).
 * sigma ~10 matches Pantheon V2 generate_base_genome() spread.
 */
function deterministicNormal(seed: number, sigma: number): number {
  // LCG: constants from Numerical Recipes
  let s = (seed * 1664525 + 1013904223) & 0xffffffff;
  const u1 = ((s >>> 0) / 0xffffffff);
  s = (s * 1664525 + 1013904223) & 0xffffffff;
  const u2 = ((s >>> 0) / 0xffffffff);
  // Box–Muller (real part only)
  const z = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2);
  return z * sigma;
}

function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h;
}

function clamp(v: number): number {
  return Math.max(1, Math.min(100, Math.round(v)));
}

/**
 * Build a culturally-seeded genome for a new buyer.
 * Pipeline: cultural mean (50 + delta) → individual Gaussian spread → clamp [1,100]
 * This is deterministic per buyerId so seeds are stable across multiple calls.
 */
export function buildSeededScores(
  buyerId: string,
  region: RegionCode = 'id',
  religiosity: ReligiosityTier = 'moderate',
  sigma = 10,
): GenomeScores {
  const priors = CULTURE_PRIORS[region] ?? CULTURE_PRIORS.default;
  const relMod = RELIGIOSITY_MODIFIERS[religiosity] ?? {};
  const baseHash = hashString(buyerId);
  const keys = Object.keys(priors) as (keyof CultureDeltas)[];

  const scores = {} as GenomeScores;
  keys.forEach((key, i) => {
    const culturalMean = 50 + (priors[key] ?? 0) + (relMod[key] ?? 0);
    const noise = deterministicNormal(baseHash + i * 31337, sigma);
    scores[key] = clamp(culturalMean + noise);
  });

  return scores;
}
