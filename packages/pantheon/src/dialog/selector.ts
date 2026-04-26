/**
 * @CLAUDE_CONTEXT
 * Package : packages/pantheon
 * File    : src/dialog/selector.ts
 * Role    : Selects the best dialog option from the cache for the current moment.
 *           Adjusts probabilities based on genome confidence and RWI.
 *           Returns a SelectionResult with the recommended message text.
 *           Runs synchronously — no LLM, <5ms.
 * Exports : selectDialog(), computeRWI()
 */
import type { Genome, DialogCache, MomentType, SelectionResult, RWISnapshot, MomentCache } from '../types';

/**
 * Compute a simplified RWI for WhatsApp context.
 * No audio, no real-time paralinguistics — uses message frequency + sentiment proxy.
 */
export function computeRWI(
  messageCount: number,
  recentMomentTypes: MomentType[],
  lastActivityMs: number,
): RWISnapshot {
  // Engagement velocity: recent message count (last 5 messages)
  const engagementVelocity = Math.min(messageCount / 10 * 40, 40);

  // Sentiment momentum: trending toward closing
  const closingCount = recentMomentTypes.filter(m => m === 'closing_ready' || m === 'high_engagement').length;
  const resistantCount = recentMomentTypes.filter(m => m === 'price_resistant').length;
  const sentimentMomentum = Math.min(closingCount * 15 - resistantCount * 10 + 30, 40);

  // Decision proximity: based on moment type trend
  const decisionProximity = closingCount > 0 ? Math.min(closingCount * 20, 40) : 10;

  // Friction: recent price resistance
  const frictionLevel = Math.max(0, resistantCount * 15);

  const score = Math.max(0, Math.min(100,
    engagementVelocity + Math.max(0, sentimentMomentum) + decisionProximity - frictionLevel,
  ));

  let windowStatus: RWISnapshot['windowStatus'];
  if (score >= 75) windowStatus = 'peak';
  else if (score >= 55) windowStatus = 'open';
  else if (score >= 35) windowStatus = 'narrowing';
  else windowStatus = 'closed';

  return {
    score,
    windowStatus,
    components: { engagementVelocity, sentimentMomentum, decisionProximity, frictionLevel },
  };
}

/**
 * Adjust option probabilities based on genome and RWI.
 * Mirrors Pantheon V2 ProbabilityEngine.adjust()
 */
function adjustProbabilities(cache: MomentCache, genome: Genome, momentType: MomentType, rwi: RWISnapshot): MomentCache {
  const { scores, confidence } = genome;
  const compressionFactor = confidence === 'LOW' ? 0.5 : confidence === 'MEDIUM' ? 0.7 : 1.0;

  function adj(base: number, bonus: number): number {
    const adjusted = 50 + (base - 50) * compressionFactor + bonus;
    return Math.max(10, Math.min(90, Math.round(adjusted)));
  }

  // Genome-specific adjustments per moment type (mirrors Pantheon V2 probability_engine.py)
  const deltas = { a: 0, b: 0, c: 0 };

  if (momentType === 'price_resistant') {
    // High agreeableness → option_a (acknowledge) works better
    deltas.a += (scores.agreeableness - 50) * 0.2;
    // High decision making → option_c (offer bundle) works better
    deltas.c += (scores.decisionMaking - 50) * 0.15;
  }
  if (momentType === 'closing_ready') {
    // High extraversion → option_b (confirm readiness) works
    deltas.b += (scores.extraversion - 50) * 0.15;
    // High identity fusion → option_c (reassurance close) works
    deltas.c += (scores.identityFusion - 50) * 0.2;
    // RWI peak → boost all closing options
    if (rwi.windowStatus === 'peak') { deltas.a += 5; deltas.b += 5; deltas.c += 5; }
  }
  if (momentType === 'trust_building') {
    // High neuroticism → option_a (social proof) reassures
    deltas.a += (scores.neuroticism - 50) * 0.2;
    // High conscientiousness → option_b (guarantee) appeals
    deltas.b += (scores.conscientiousness - 50) * 0.15;
  }
  if (momentType === 'identity_aligned') {
    // High identity fusion → option_a (mirror identity) works
    deltas.a += (scores.identityFusion - 50) * 0.25;
    // High tom social modeling → option_b (community)
    deltas.b += (scores.tomSocialModeling - 50) * 0.15;
  }
  if (momentType === 'high_engagement') {
    // High literacy → option_a (deep dive) preferred
    deltas.a += (scores.literacyArticulation - 50) * 0.2;
    // High openness → option_b (educational)
    deltas.b += (scores.openness - 50) * 0.15;
  }

  return {
    option_a: { ...cache.option_a, baseProbability: adj(cache.option_a.baseProbability, deltas.a) },
    option_b: { ...cache.option_b, baseProbability: adj(cache.option_b.baseProbability, deltas.b) },
    option_c: { ...cache.option_c, baseProbability: adj(cache.option_c.baseProbability, deltas.c) },
  };
}

export function selectDialog(
  cache: DialogCache,
  momentType: MomentType,
  genome: Genome,
  rwi: RWISnapshot,
): SelectionResult {
  const momentCache = cache[momentType] ?? cache['neutral_exploratory'];
  const adjusted = adjustProbabilities(momentCache, genome, momentType, rwi);

  // Pick option with highest probability
  const options = [
    { key: 'a' as const, prob: adjusted.option_a.baseProbability },
    { key: 'b' as const, prob: adjusted.option_b.baseProbability },
    { key: 'c' as const, prob: adjusted.option_c.baseProbability },
  ];
  options.sort((a, b) => b.prob - a.prob);
  const best = options[0].key;

  const bestOption = best === 'a' ? adjusted.option_a : best === 'b' ? adjusted.option_b : adjusted.option_c;

  const reasoning = `Moment: ${momentType}. Best option ${best.toUpperCase()} (p=${bestOption.baseProbability}). `
    + `RWI: ${rwi.score}/100 (${rwi.windowStatus}). `
    + `Genome confidence: ${genome.confidence}. `
    + bestOption.genomeRationale;

  return {
    momentType,
    options: adjusted,
    bestOption: best,
    recommendedText: bestOption.baseLanguage,
    reasoning,
    rwi,
  };
}
