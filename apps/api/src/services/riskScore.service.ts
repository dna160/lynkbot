/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/services/riskScore.service.ts
 * Role    : Computes and caches tenant risk scores using PRD §8.1 formula.
 *           Score > 80 blocks activation/broadcast (non-overridable — PRD §17).
 *           Score > 60 adds a warning in the response.
 *           Recomputed synchronously if last compute is > 1 hour old.
 * Exports : RiskScoreService
 * DO NOT  : Use config.META_ACCESS_TOKEN. Per-tenant MetaClient only.
 */
import {
  db,
  tenants,
  tenantRiskScores,
  buyerBroadcastLog,
  flowTemplates,
  buyers,
  eq,
  and,
  gte,
  not,
  count,
} from '@lynkbot/db';
import { computeRiskScore } from '@lynkbot/flow-engine';
import type { RiskBreakdown } from '@lynkbot/flow-engine';

const ONE_HOUR_MS = 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface RiskScoreResult {
  score: number;
  breakdown: RiskBreakdown;
  computedAt: Date;
}

/**
 * Maps template status to a quality score proxy (0-1).
 * approved=1 (high quality), pending_review=0.5, rejected/disabled=0.
 */
function statusToQualityScore(status: string): number {
  switch (status) {
    case 'approved': return 1;
    case 'pending_review':
    case 'in_appeal': return 0.5;
    default: return 0;
  }
}

export class RiskScoreService {
  /**
   * Returns the tenant's current risk score.
   * If stored score is older than 1 hour, synchronously recomputes before returning.
   */
  async getForTenant(tenantId: string): Promise<RiskScoreResult> {
    const stored = await db.query.tenantRiskScores.findFirst({
      where: eq(tenantRiskScores.tenantId, tenantId),
      orderBy: (t, { desc }) => [desc(t.computedAt)],
    });

    const isStale =
      !stored || Date.now() - stored.computedAt.getTime() > ONE_HOUR_MS;

    if (isStale) {
      return this.computeAndStore(tenantId);
    }

    const factors = (stored.factors ?? {}) as Record<string, number>;
    const breakdown: RiskBreakdown = {
      broadcastFrequencyScore: factors['broadcastFrequencyScore'] ?? 0,
      templateQualityScore:    factors['templateQualityScore']    ?? 0,
      blockProxyScore:         factors['blockProxyScore']         ?? 0,
      optInConfidenceScore:    factors['optInConfidenceScore']    ?? 0,
      sendSpeedScore:          factors['sendSpeedScore']          ?? 0,
      total:                   stored.score,
    };

    return { score: stored.score, breakdown, computedAt: stored.computedAt };
  }

  /**
   * Queries live DB data, runs the PRD §8.1 formula, and stores the result.
   * Uses delete-then-insert since the table lacks a unique constraint on tenant_id.
   */
  async computeAndStore(tenantId: string): Promise<RiskScoreResult> {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - SEVEN_DAYS_MS);

    // ── 1. Broadcasts sent in last 7 days ─────────────────────────────────────
    const [broadcastRow] = await db
      .select({ cnt: count() })
      .from(buyerBroadcastLog)
      .where(
        and(
          eq(buyerBroadcastLog.tenantId, tenantId),
          gte(buyerBroadcastLog.sentAt, sevenDaysAgo),
        ),
      );
    const broadcastsSent7d = Number(broadcastRow?.cnt ?? 0);

    // ── 2. Total buyers ───────────────────────────────────────────────────────
    const [totalBuyersRow] = await db
      .select({ cnt: count() })
      .from(buyers)
      .where(eq(buyers.tenantId, tenantId));
    const totalBuyers = Number(totalBuyersRow?.cnt ?? 0);

    // ── 3. Buyers with order history = opted-in / inbound proxy ───────────────
    const [optInRow] = await db
      .select({ cnt: count() })
      .from(buyers)
      .where(
        and(
          eq(buyers.tenantId, tenantId),
          not(buyers.doNotContact),
          gte(buyers.totalOrders, 1),
        ),
      );
    const buyersWithInboundHistory = Number(optInRow?.cnt ?? 0);
    const uniqueOptedInBuyers = buyersWithInboundHistory;

    // ── 4. Average template quality (proxy from template status) ──────────────
    const tenantTemplates = await db.query.flowTemplates.findMany({
      where: eq(flowTemplates.tenantId, tenantId),
      columns: { status: true },
    });

    let averageTemplateQualityScore = 1; // default: no templates = no risk on this axis
    if (tenantTemplates.length > 0) {
      const qualitySum = tenantTemplates.reduce(
        (sum, t) => sum + statusToQualityScore(t.status),
        0,
      );
      averageTemplateQualityScore = qualitySum / tenantTemplates.length;
    }

    // ── 5. No-reply rate proxy: fraction of templates in bad states ───────────
    const badTemplates = tenantTemplates.filter(
      t => t.status === 'rejected' || t.status === 'disabled' || t.status === 'flagged',
    ).length;
    const noReplyRate7d =
      tenantTemplates.length > 0 ? badTemplates / tenantTemplates.length : 0;

    // ── 6. Average delay (500ms minimum safe — real flows would be parsed) ─────
    const averageDelayBetweenNodesMs = 500;

    const { score, breakdown } = computeRiskScore({
      broadcastsSent7d,
      uniqueOptedInBuyers,
      averageTemplateQualityScore,
      noReplyRate7d,
      buyersWithInboundHistory,
      totalBuyers,
      averageDelayBetweenNodesMs,
    });

    // ── Upsert: delete old row then insert new (no unique constraint on tenant_id) ─
    await db.delete(tenantRiskScores).where(eq(tenantRiskScores.tenantId, tenantId));
    await db.insert(tenantRiskScores).values({
      tenantId,
      score,
      factors: breakdown as unknown as Record<string, unknown>,
      computedAt: now,
    });

    // Stamp tenants.last_risk_score_at
    await db
      .update(tenants)
      .set({ lastRiskScoreAt: now })
      .where(eq(tenants.id, tenantId));

    return { score, breakdown, computedAt: now };
  }

  /**
   * Handles `phone_number_quality_update` webhook event from Meta.
   * Updates tenants.wabaQualityRating and triggers an async risk score recompute.
   */
  async handleQualityUpdate(change: {
    phone_number?: string;
    phone_number_id?: string;
    event?: string;
    current_limit?: string;
  }): Promise<void> {
    const phoneNumberId = change.phone_number_id;
    if (!phoneNumberId) return;

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.metaPhoneNumberId, phoneNumberId),
      columns: { id: true },
    });
    if (!tenant) return;

    // Derive quality rating from event string (e.g. "QUALITY_RATING_GREEN")
    const event = (change.event ?? '').toUpperCase();
    let rating: string | null = null;
    if (event.includes('GREEN')) rating = 'GREEN';
    else if (event.includes('YELLOW') || event.includes('MEDIUM')) rating = 'MEDIUM';
    else if (event.includes('RED')) rating = 'RED';

    if (rating) {
      await db
        .update(tenants)
        .set({ wabaQualityRating: rating })
        .where(eq(tenants.id, tenant.id));
    }

    // Async recompute — don't block webhook response
    this.computeAndStore(tenant.id).catch((err) =>
      console.error('[RiskScoreService] handleQualityUpdate recompute failed:', err),
    );
  }
}
