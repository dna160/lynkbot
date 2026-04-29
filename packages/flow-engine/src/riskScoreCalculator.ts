/**
 * @CLAUDE_CONTEXT
 * Package : packages/flow-engine
 * File    : src/riskScoreCalculator.ts
 * Role    : Computes tenant risk score using PRD §8.1 formula.
 *           Score > 80 blocks activation/broadcast (non-overridable).
 *           Score > 60 shows warning.
 * Exports : RiskScoreInputs, computeRiskScore
 */
import type { RiskBreakdown } from './types';

export interface RiskScoreInputs {
  /** Number of broadcasts sent in last 7 days */
  broadcastsSent7d: number;
  /** Number of unique opted-in buyers */
  uniqueOptedInBuyers: number;
  /** Average template quality score 0-1: HIGH=1, MEDIUM=0.5, LOW/DISABLED=0 */
  averageTemplateQualityScore: number;
  /** Fraction of messages that got no reply (0-1) */
  noReplyRate7d: number;
  /** Number of buyers with at least 1 inbound message (inbound history) */
  buyersWithInboundHistory: number;
  /** Total buyers in tenant */
  totalBuyers: number;
  /** Average time between consecutive outbound messages in ms */
  averageDelayBetweenNodesMs: number;
}

/**
 * Clamps a value to [min, max].
 */
function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

/**
 * Computes the tenant risk score using PRD §8.1 formula.
 *
 * Weights:
 *   broadcastFreq    × 0.30
 *   (1-templateQual) × 0.25
 *   blockProxy       × 0.20
 *   (1-optInConf)    × 0.15
 *   (1-sendSpeed)    × 0.10
 *
 * Score is in [1, 100].
 */
export function computeRiskScore(data: RiskScoreInputs): { score: number; breakdown: RiskBreakdown } {
  // 1. Broadcast frequency score (0-1)
  // Normalise: 0 broadcasts = 0, 50+ per day (350 per 7d) = 1
  const dailyRate = data.broadcastsSent7d / 7;
  const broadcastFreqRaw = clamp(dailyRate / 50, 0, 1);

  // 2. Template quality score (0-1) — higher quality = lower risk component
  const templateQualityRaw = clamp(data.averageTemplateQualityScore, 0, 1);

  // 3. Block proxy score (0-1) — no-reply rate as proxy for blocks
  const blockProxyRaw = clamp(data.noReplyRate7d, 0, 1);

  // 4. Opt-in confidence score (0-1) — fraction of buyers with inbound history
  const optInConfidenceRaw =
    data.totalBuyers > 0
      ? clamp(data.buyersWithInboundHistory / data.totalBuyers, 0, 1)
      : 0;

  // 5. Send speed score (0-1) — avg delay >= 500ms = 1 (good); 0ms = 0 (risky)
  const MIN_SAFE_DELAY_MS = 500;
  const sendSpeedRaw = clamp(data.averageDelayBetweenNodesMs / MIN_SAFE_DELAY_MS, 0, 1);

  // Weighted component scores (each 0-1, risk-oriented = higher is riskier)
  const broadcastFrequencyScore = broadcastFreqRaw * 0.30;
  const templateQualityScore = (1 - templateQualityRaw) * 0.25;
  const blockProxyScore = blockProxyRaw * 0.20;
  const optInConfidenceScore = (1 - optInConfidenceRaw) * 0.15;
  const sendSpeedScore = (1 - sendSpeedRaw) * 0.10;

  const rawTotal =
    broadcastFrequencyScore +
    templateQualityScore +
    blockProxyScore +
    optInConfidenceScore +
    sendSpeedScore;

  // Scale 0-1 range → 1-100
  const score = clamp(Math.round(rawTotal * 100), 1, 100);

  const breakdown: RiskBreakdown = {
    broadcastFrequencyScore,
    templateQualityScore,
    blockProxyScore,
    optInConfidenceScore,
    sendSpeedScore,
    total: score,
  };

  return { score, breakdown };
}
