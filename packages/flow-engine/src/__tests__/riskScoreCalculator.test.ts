import { describe, it, expect } from 'vitest';
import { computeRiskScore } from '../riskScoreCalculator';
import type { RiskScoreInputs } from '../riskScoreCalculator';

const baseInputs: RiskScoreInputs = {
  broadcastsSent7d: 0,
  uniqueOptedInBuyers: 100,
  averageTemplateQualityScore: 1.0, // HIGH quality
  noReplyRate7d: 0,
  buyersWithInboundHistory: 100,
  totalBuyers: 100,
  averageDelayBetweenNodesMs: 500,
};

describe('computeRiskScore', () => {
  it('returns a score for all-zero inputs without throwing', () => {
    const zeroInputs: RiskScoreInputs = {
      broadcastsSent7d: 0,
      uniqueOptedInBuyers: 0,
      averageTemplateQualityScore: 0,
      noReplyRate7d: 0,
      buyersWithInboundHistory: 0,
      totalBuyers: 0,
      averageDelayBetweenNodesMs: 0,
    };
    const { score } = computeRiskScore(zeroInputs);
    expect(score).toBeGreaterThanOrEqual(1);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('score is always in [1, 100] range for typical inputs', () => {
    const { score } = computeRiskScore(baseInputs);
    expect(score).toBeGreaterThanOrEqual(1);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('high broadcast frequency raises score', () => {
    const lowFreq = computeRiskScore({ ...baseInputs, broadcastsSent7d: 0 });
    const highFreq = computeRiskScore({ ...baseInputs, broadcastsSent7d: 700 }); // 100/day
    expect(highFreq.score).toBeGreaterThan(lowFreq.score);
  });

  it('bad template quality raises score', () => {
    const goodQuality = computeRiskScore({ ...baseInputs, averageTemplateQualityScore: 1.0 });
    const badQuality = computeRiskScore({ ...baseInputs, averageTemplateQualityScore: 0.0 });
    expect(badQuality.score).toBeGreaterThan(goodQuality.score);
  });

  it('high no-reply rate raises score', () => {
    const lowBlock = computeRiskScore({ ...baseInputs, noReplyRate7d: 0 });
    const highBlock = computeRiskScore({ ...baseInputs, noReplyRate7d: 1.0 });
    expect(highBlock.score).toBeGreaterThan(lowBlock.score);
  });

  it('low opt-in confidence (no inbound history) raises score', () => {
    const highConfidence = computeRiskScore({
      ...baseInputs,
      buyersWithInboundHistory: 100,
      totalBuyers: 100,
    });
    const lowConfidence = computeRiskScore({
      ...baseInputs,
      buyersWithInboundHistory: 0,
      totalBuyers: 100,
    });
    expect(lowConfidence.score).toBeGreaterThan(highConfidence.score);
  });

  it('zero delay between nodes raises score vs 500ms', () => {
    const safePace = computeRiskScore({ ...baseInputs, averageDelayBetweenNodesMs: 500 });
    const noPause = computeRiskScore({ ...baseInputs, averageDelayBetweenNodesMs: 0 });
    expect(noPause.score).toBeGreaterThan(safePace.score);
  });

  it('all worst-case inputs produce score near 100', () => {
    const worst: RiskScoreInputs = {
      broadcastsSent7d: 10000, // extreme
      uniqueOptedInBuyers: 0,
      averageTemplateQualityScore: 0,
      noReplyRate7d: 1.0,
      buyersWithInboundHistory: 0,
      totalBuyers: 100,
      averageDelayBetweenNodesMs: 0,
    };
    const { score } = computeRiskScore(worst);
    expect(score).toBeGreaterThanOrEqual(90);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('all best-case inputs produce low score', () => {
    const best: RiskScoreInputs = {
      broadcastsSent7d: 0,
      uniqueOptedInBuyers: 1000,
      averageTemplateQualityScore: 1.0,
      noReplyRate7d: 0,
      buyersWithInboundHistory: 1000,
      totalBuyers: 1000,
      averageDelayBetweenNodesMs: 1000,
    };
    const { score } = computeRiskScore(best);
    expect(score).toBeLessThanOrEqual(20);
  });

  it('breakdown components sum correctly', () => {
    const { score, breakdown } = computeRiskScore(baseInputs);
    const componentSum =
      breakdown.broadcastFrequencyScore +
      breakdown.templateQualityScore +
      breakdown.blockProxyScore +
      breakdown.optInConfidenceScore +
      breakdown.sendSpeedScore;
    // Component sum * 100 should equal score (approximately, due to clamping)
    expect(Math.abs(Math.round(componentSum * 100) - score)).toBeLessThanOrEqual(1);
  });

  it('returns breakdown object with all required fields', () => {
    const { breakdown } = computeRiskScore(baseInputs);
    expect(typeof breakdown.broadcastFrequencyScore).toBe('number');
    expect(typeof breakdown.templateQualityScore).toBe('number');
    expect(typeof breakdown.blockProxyScore).toBe('number');
    expect(typeof breakdown.optInConfidenceScore).toBe('number');
    expect(typeof breakdown.sendSpeedScore).toBe('number');
    expect(typeof breakdown.total).toBe('number');
  });
});
