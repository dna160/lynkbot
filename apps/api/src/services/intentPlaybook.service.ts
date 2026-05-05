/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/services/intentPlaybook.service.ts
 * Role    : CRUD + lookup for Intent Playbooks.
 *           getPlaybookBlock() is called by ConversationService to inject
 *           per-intent system prompt additions into the AI call.
 * Exports : IntentPlaybookService
 * DO NOT  : Call Meta, payment, or flow-engine APIs from here
 */
import { db, intentPlaybooks, eq, and } from '@lynkbot/db';

export type IntentKey =
  | 'GREETING' | 'BROWSING' | 'PRODUCT_INQUIRY' | 'OBJECTION_HANDLING'
  | 'CHECKOUT_INTENT' | 'OUT_OF_STOCK' | 'WANTS_CONSULTATION' | 'GENERAL_INQUIRY';

export type NextStepType =
  | 'continue_conversation' | 'checkout' | 'schedule_consultation'
  | 'human_handoff' | 'collect_info';

export interface PlaybookRow {
  id: string;
  tenantId: string;
  intentKey: IntentKey;
  label: string;
  description: string | null;
  isActive: boolean;
  priority: number;
  systemPromptAddition: string;
  toneNote: string | null;
  nextStepType: NextStepType;
  nextStepConfig: Record<string, unknown> | null;
  detectionKeywords: string[] | null;
  fallbackMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class IntentPlaybookService {
  /** Get all playbooks for a tenant, ordered by priority desc */
  async listForTenant(tenantId: string): Promise<PlaybookRow[]> {
    const rows = await db.query.intentPlaybooks.findMany({
      where: eq(intentPlaybooks.tenantId, tenantId),
      orderBy: (t, { desc }) => desc(t.priority),
    });
    return rows as unknown as PlaybookRow[];
  }

  /** Get a single playbook by id (tenant-scoped) */
  async getById(id: string, tenantId: string): Promise<PlaybookRow | null> {
    const row = await db.query.intentPlaybooks.findFirst({
      where: and(eq(intentPlaybooks.id, id), eq(intentPlaybooks.tenantId, tenantId)),
    });
    return (row as unknown as PlaybookRow) ?? null;
  }

  /** Create a new playbook */
  async create(tenantId: string, data: Omit<PlaybookRow, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>): Promise<PlaybookRow> {
    const [row] = await db.insert(intentPlaybooks).values({
      tenantId,
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();
    return row as unknown as PlaybookRow;
  }

  /** Update an existing playbook (tenant-scoped) */
  async update(id: string, tenantId: string, data: Partial<Omit<PlaybookRow, 'id' | 'tenantId' | 'createdAt'>>): Promise<PlaybookRow | null> {
    const [row] = await db
      .update(intentPlaybooks)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(intentPlaybooks.id, id), eq(intentPlaybooks.tenantId, tenantId)))
      .returning();
    return (row as unknown as PlaybookRow) ?? null;
  }

  /** Delete a playbook (tenant-scoped) */
  async delete(id: string, tenantId: string): Promise<boolean> {
    const [row] = await db
      .delete(intentPlaybooks)
      .where(and(eq(intentPlaybooks.id, id), eq(intentPlaybooks.tenantId, tenantId)))
      .returning({ id: intentPlaybooks.id });
    return !!row;
  }

  /**
   * Get the system prompt block to inject for a given conversation state.
   * Returns '' if no active playbook matches.
   * Conversation states map 1:1 to intent keys (same naming).
   * Falls back to GENERAL_INQUIRY if no specific match.
   */
  async getPlaybookBlock(tenantId: string, conversationState: string): Promise<{
    block: string;
    nextStepType: NextStepType;
    nextStepConfig: Record<string, unknown> | null;
    fallbackMessage: string | null;
  }> {
    const empty = { block: '', nextStepType: 'continue_conversation' as NextStepType, nextStepConfig: null, fallbackMessage: null };

    try {
      // Try exact state match first (e.g. BROWSING → BROWSING playbook)
      let playbook = await db.query.intentPlaybooks.findFirst({
        where: and(
          eq(intentPlaybooks.tenantId, tenantId),
          eq(intentPlaybooks.intentKey, conversationState as IntentKey),
          eq(intentPlaybooks.isActive, true),
        ),
        orderBy: (t, { desc }) => desc(t.priority),
      }) as unknown as PlaybookRow | undefined;

      // Fall back to GENERAL_INQUIRY if no specific match
      if (!playbook) {
        playbook = await db.query.intentPlaybooks.findFirst({
          where: and(
            eq(intentPlaybooks.tenantId, tenantId),
            eq(intentPlaybooks.intentKey, 'GENERAL_INQUIRY'),
            eq(intentPlaybooks.isActive, true),
          ),
          orderBy: (t, { desc }) => desc(t.priority),
        }) as unknown as PlaybookRow | undefined;
      }

      if (!playbook || !playbook.systemPromptAddition) return empty;

      const parts: string[] = [];
      parts.push(`\n\nINTENT PLAYBOOK — ${playbook.label}:`);
      parts.push(playbook.systemPromptAddition);
      if (playbook.toneNote) parts.push(`Tone note: ${playbook.toneNote}`);
      if (playbook.nextStepType !== 'continue_conversation') {
        parts.push(`Next step direction: ${playbook.nextStepType.replace(/_/g, ' ').toUpperCase()}`);
        if (playbook.nextStepType === 'schedule_consultation') {
          const cfg = playbook.nextStepConfig ?? {};
          parts.push(`Guide the buyer toward scheduling a consultation. ${cfg.consultationType ? `Consultation type: ${cfg.consultationType}.` : ''} ${cfg.cta ? `Use this call-to-action: "${cfg.cta}"` : 'Ask them to reply with SCHEDULE or their preferred time.'}`);
        } else if (playbook.nextStepType === 'checkout') {
          parts.push('Naturally guide toward purchase. If buyer shows intent, transition to checkout flow.');
        } else if (playbook.nextStepType === 'human_handoff') {
          parts.push('At the right moment, offer to connect the buyer with a human agent. They can type AGENT to escalate.');
        } else if (playbook.nextStepType === 'collect_info') {
          const cfg = playbook.nextStepConfig ?? {};
          parts.push(`Collect the following from the buyer: ${cfg.infoToCollect ?? 'relevant information'}.`);
        }
      }

      return {
        block: parts.join('\n'),
        nextStepType: playbook.nextStepType,
        nextStepConfig: playbook.nextStepConfig,
        fallbackMessage: playbook.fallbackMessage,
      };
    } catch {
      return empty;
    }
  }
}
