/**
 * @CLAUDE_CONTEXT
 * Package : packages/flow-engine
 * File    : src/cooldownChecker.ts
 * Role    : Compliance guard for marketing template sends.
 *           Checks buyer_broadcast_log against:
 *             - doNotContact flag
 *             - 7d same-template block
 *             - 24h any-marketing block
 *           Blocked sends are SKIPPED (flow continues) — not thrown.
 * Exports : CooldownChecker
 */
import { db, buyers, buyerBroadcastLog, eq, and, gte } from '@lynkbot/db';

export type CooldownBlockReason =
  | 'do_not_contact'
  | '7d_same_template'
  | '24h_any_marketing';

export interface CooldownResult {
  blocked: boolean;
  reason?: CooldownBlockReason;
}

export class CooldownChecker {
  /**
   * Check whether sending `templateName` to `buyerId` is blocked.
   *
   * @param buyerId     - UUID of the buyer
   * @param templateName - Meta template name
   * @param tenantId    - UUID of the tenant
   * @returns { blocked: false } when clear to send, or { blocked: true, reason }
   */
  async check(
    buyerId: string,
    templateName: string,
    tenantId: string,
  ): Promise<CooldownResult> {
    // 1. Check doNotContact flag
    const buyer = await db.query.buyers.findFirst({
      where: eq(buyers.id, buyerId),
      columns: { doNotContact: true },
    });

    if (buyer?.doNotContact) {
      return { blocked: true, reason: 'do_not_contact' };
    }

    const now = new Date();

    // 2. Check 7-day same-template cooldown
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const sameTemplateRecent = await db.query.buyerBroadcastLog.findFirst({
      where: and(
        eq(buyerBroadcastLog.buyerId, buyerId),
        eq(buyerBroadcastLog.templateName, templateName),
        gte(buyerBroadcastLog.sentAt, sevenDaysAgo),
      ),
      columns: { id: true },
    });

    if (sameTemplateRecent) {
      return { blocked: true, reason: '7d_same_template' };
    }

    // 3. Check 24-hour any-marketing cooldown (same tenant)
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const anyRecentMarketing = await db.query.buyerBroadcastLog.findFirst({
      where: and(
        eq(buyerBroadcastLog.buyerId, buyerId),
        eq(buyerBroadcastLog.tenantId, tenantId),
        gte(buyerBroadcastLog.sentAt, oneDayAgo),
      ),
      columns: { id: true },
    });

    if (anyRecentMarketing) {
      return { blocked: true, reason: '24h_any_marketing' };
    }

    return { blocked: false };
  }
}
