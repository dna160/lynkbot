/**
 * @CLAUDE_CONTEXT
 * Package : apps/worker
 * File    : src/services/webhookMessage.processor.ts
 * Role    : Self-contained inbound message processor for the webhook queue.
 *           Duplicates core logic from apps/api webhook handler + ConversationService
 *           so the worker does not need to import from apps/*.
 */
import { createDecipheriv } from 'node:crypto';
import { db, buyers, conversations, messages, tenants, flowExecutions, staff, appointments, products, intentPlaybooks, services, serviceStaff, staffAvailability, eq, and, or, not, sql } from '@lynkbot/db';
import type { PlaybookOverrideData } from '@lynkbot/db';
import { MetaClient, extractFirstMessage, isStatusUpdate, extractText, extractMessageId } from '@lynkbot/meta';
import { FlowEngine } from '@lynkbot/flow-engine';
import { getLLMClient, query as ragQuery, formatWIBDatetime, classifyMessageIntent, buildSystemPrompt, STATE_PROMPTS, SCHEDULING_SYSTEM_PROMPT, parseSchedulingEnvelope } from '@lynkbot/ai';
import type { MessageIntent } from '@lynkbot/ai';
import { STAFF_CONFIRMATION_KEYWORDS, STAFF_REJECTION_KEYWORDS, BOOKING_INTENT_KEYWORDS } from '@lynkbot/shared';
import { redisConnection, makeRedisClient } from '../redis';

// ── AES-256-GCM decrypt (inline copy) ─────────────────────────────────────────
const ALGORITHM = 'aes-256-gcm' as const;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

function decryptToken(bundled: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== KEY_BYTES) throw new Error(`decrypt: key must be ${KEY_BYTES} bytes`);
  const buf = Buffer.from(bundled, 'base64');
  if (buf.length < IV_BYTES + TAG_BYTES) throw new Error('decrypt: ciphertext too short');
  const iv = buf.subarray(0, IV_BYTES);
  const authTag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

async function getTenantMetaClient(tenantId: string): Promise<MetaClient> {
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  if (!tenant?.metaAccessToken || !tenant?.metaPhoneNumberId) {
    throw new Error(`Tenant ${tenantId} has no active WABA credentials`);
  }
  const encKey = process.env.WABA_POOL_ENCRYPTION_KEY ?? '';
  const accessToken = encKey ? decryptToken(tenant.metaAccessToken, encKey) : tenant.metaAccessToken;
  return MetaClient.fromTenant({ metaAccessToken: accessToken, metaPhoneNumberId: tenant.metaPhoneNumberId });
}

// ── Redis / FlowEngine ────────────────────────────────────────────────────────
const redisClient = makeRedisClient();

const flowEngine = new FlowEngine({
  getMetaClient: getTenantMetaClient,
  redisClient,
  redisConnection,
});

// ── Keyword helpers ───────────────────────────────────────────────────────────
function containsAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some(kw => lower.includes(kw.toLowerCase()));
}

const STOP_KEYWORDS = ['stop', 'berhenti', 'henti', 'unsubscribe', 'jangan kirim', 'tidak mau'];
const AGENT_KEYWORDS = ['agent', 'human', 'orang', 'cs', 'customer service', 'bantuan'];

function isWithin24HourWindow(lastMessageAt: Date): boolean {
  return Date.now() - lastMessageAt.getTime() < 24 * 60 * 60 * 1000;
}

// ── Scheduling constants (mirrors scheduling.service.ts) ─────────────────────
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const SLOT_LOOKAHEAD_DAYS = parseInt(process.env.BOOKING_SLOT_LOOKAHEAD_DAYS ?? '14', 10);
const MIN_LEAD_TIME_HOURS = parseInt(process.env.BOOKING_MIN_LEAD_TIME_HOURS ?? '1', 10);

function parseHHMM(hhmm: string): [number, number] {
  const [h, m] = hhmm.split(':').map(Number);
  return [h ?? 0, m ?? 0];
}

function wibDateString(utcDate: Date): string {
  const wib = new Date(utcDate.getTime() + WIB_OFFSET_MS);
  return wib.toISOString().slice(0, 10);
}

async function isSlotAvailable(staffId: string, start: Date, end: Date): Promise<boolean> {
  const conflicts = await db
    .select({ id: appointments.id })
    .from(appointments)
    .where(
      and(
        eq(appointments.staffId, staffId),
        or(eq(appointments.status, 'pending_doctor'), eq(appointments.status, 'confirmed')),
        sql`${appointments.startTime} < ${end.toISOString()}::timestamptz`,
        sql`${appointments.endTime} > ${start.toISOString()}::timestamptz`,
      ),
    )
    .limit(1);
  return conflicts.length === 0;
}

interface AvailableSlot {
  start: Date;
  end: Date;
  staffId: string;
  staffName: string;
  serviceId: string;
  durationMinutes: number;
}

async function getAvailableSlots(
  tenantId: string,
  serviceName: string,
  requestedDatetime?: string,
  count = 3,
): Promise<AvailableSlot[]> {
  let service = await db.query.services.findFirst({
    where: and(
      eq(services.tenantId, tenantId),
      sql`lower(${services.name}) = lower(${serviceName})`,
      eq(services.isActive, true),
    ),
  });

  if (!service) {
    service = await db.query.services.findFirst({
      where: and(
        eq(services.tenantId, tenantId),
        sql`lower(${services.name}) like lower(${'%' + serviceName + '%'}) or lower(${serviceName}) like lower(${'%' + services.name + '%'})`,
        eq(services.isActive, true),
      ),
    });
  }

  if (!service) {
    const available = await db.query.services.findMany({
      where: and(eq(services.tenantId, tenantId), eq(services.isActive, true)),
    });
    const names = available.map(s => `"${s.name}"`).join(', ');
    throw new Error(`Service "${serviceName}" not found. Available: ${names || 'none'}.`);
  }

  const staffLinks = await db
    .select({ staffId: serviceStaff.staffId })
    .from(serviceStaff)
    .innerJoin(staff, eq(staff.id, serviceStaff.staffId))
    .where(and(eq(serviceStaff.serviceId, service.id), eq(staff.isActive, true)));

  if (staffLinks.length === 0) {
    throw new Error(`No active staff assigned to service "${serviceName}".`);
  }

  const staffIds = staffLinks.map(l => l.staffId);
  const staffRows = await db.query.staff.findMany({
    where: and(
      eq(staff.tenantId, tenantId),
      eq(staff.isActive, true),
      sql`${staff.id} = ANY(ARRAY[${sql.join(staffIds.map(id => sql`${id}::uuid`), sql`, `)}])`,
    ),
  });
  const availRows = await db.query.staffAvailability.findMany({
    where: sql`${staffAvailability.staffId} = ANY(ARRAY[${sql.join(staffIds.map(id => sql`${id}::uuid`), sql`, `)}])`,
  });

  const now = new Date();
  const minStart = new Date(now.getTime() + MIN_LEAD_TIME_HOURS * 3600 * 1000);
  const maxEnd = new Date(now.getTime() + SLOT_LOOKAHEAD_DAYS * 86400 * 1000);
  const durationMs = service.durationMinutes * 60 * 1000;

  const freeSlots: AvailableSlot[] = [];

  for (const staffRow of staffRows.sort((a, b) => a.name.localeCompare(b.name))) {
    const myAvail = availRows.filter(r => r.staffId === staffRow.id);
    const cursor = new Date(minStart);
    cursor.setUTCHours(0, 0, 0, 0);

    while (cursor <= maxEnd) {
      const wibDay = new Date(cursor.getTime() + WIB_OFFSET_MS);
      const dayOfWeek = wibDay.getUTCDay();
      const dayAvail = myAvail.filter(a => a.dayOfWeek === dayOfWeek);

      for (const avail of dayAvail) {
        const [sh, sm] = parseHHMM(avail.startTime);
        const [eh, em] = parseHHMM(avail.endTime);

        let slotStart = new Date(Date.UTC(
          wibDay.getUTCFullYear(), wibDay.getUTCMonth(), wibDay.getUTCDate(),
          sh - 7, sm,
        ));
        const dayEndUTC = new Date(Date.UTC(
          wibDay.getUTCFullYear(), wibDay.getUTCMonth(), wibDay.getUTCDate(),
          eh - 7, em,
        ));

        while (slotStart < dayEndUTC) {
          const slotEnd = new Date(slotStart.getTime() + durationMs);
          if (slotEnd > dayEndUTC) break;
          if (slotStart >= minStart) {
            const available = await isSlotAvailable(staffRow.id, slotStart, slotEnd);
            if (available) {
              freeSlots.push({
                start: new Date(slotStart),
                end: new Date(slotEnd),
                staffId: staffRow.id,
                staffName: staffRow.name,
                serviceId: service.id,
                durationMinutes: service.durationMinutes,
              });
            }
          }
          slotStart = new Date(slotStart.getTime() + durationMs);
        }
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  freeSlots.sort((a, b) => a.start.getTime() - b.start.getTime());

  if (requestedDatetime) {
    const reqDate = new Date(requestedDatetime);
    const exact = freeSlots.find(s => s.start.getTime() === reqDate.getTime());
    if (exact) return [exact];
    freeSlots.sort((a, b) =>
      Math.abs(a.start.getTime() - reqDate.getTime()) - Math.abs(b.start.getTime() - reqDate.getTime())
    );
    return freeSlots.slice(0, 1);
  }

  const result: AvailableSlot[] = [];
  const seenDates = new Set<string>();
  for (const slot of freeSlots) {
    const dateStr = wibDateString(slot.start);
    if (!seenDates.has(dateStr)) {
      seenDates.add(dateStr);
      result.push(slot);
      if (result.length >= count) break;
    }
  }
  return result;
}

function detectBookingIntent(text: string): boolean {
  const allKeywords = [...BOOKING_INTENT_KEYWORDS.id, ...BOOKING_INTENT_KEYWORDS.en];
  return containsAny(text, allKeywords);
}

type NextStepType = 'continue_conversation' | 'checkout' | 'schedule_consultation' | 'human_handoff' | 'collect_info';

/**
 * Inline replica of IntentPlaybookService.getPlaybookBlock().
 * Looks up an active playbook for the given intent key and builds the prompt block.
 */
async function getPlaybookBlock(tenantId: string, conversationState: string): Promise<{
  block: string;
  nextStepType: NextStepType;
  nextStepConfig: Record<string, unknown> | null;
  fallbackMessage: string | null;
}> {
  const empty = { block: '', nextStepType: 'continue_conversation' as NextStepType, nextStepConfig: null, fallbackMessage: null };

  try {
    let playbook = await db.query.intentPlaybooks.findFirst({
      where: and(
        eq(intentPlaybooks.tenantId, tenantId),
        eq(intentPlaybooks.intentKey, conversationState as any),
        eq(intentPlaybooks.isActive, true),
      ),
      orderBy: (t, { desc }) => desc(t.priority),
    });

    if (!playbook) {
      playbook = await db.query.intentPlaybooks.findFirst({
        where: and(
          eq(intentPlaybooks.tenantId, tenantId),
          eq(intentPlaybooks.intentKey, 'GENERAL_INQUIRY'),
          eq(intentPlaybooks.isActive, true),
        ),
        orderBy: (t, { desc }) => desc(t.priority),
      });
    }

    if (!playbook || !playbook.systemPromptAddition) return empty;

    const parts: string[] = [];
    parts.push(`\n\nINTENT PLAYBOOK — ${playbook.label}:`);
    parts.push(playbook.systemPromptAddition);
    if (playbook.toneNote) parts.push(`Tone note: ${playbook.toneNote}`);
    if (playbook.nextStepType !== 'continue_conversation') {
      parts.push(`Next step direction: ${playbook.nextStepType.replace(/_/g, ' ').toUpperCase()}`);
      if (playbook.nextStepType === 'schedule_consultation') {
        const cfg = (playbook.nextStepConfig as Record<string, unknown>) ?? {};
        parts.push(`Guide the buyer toward scheduling a consultation. ${cfg.consultationType ? `Consultation type: ${cfg.consultationType}.` : ''} ${cfg.cta ? `Use this call-to-action: "${cfg.cta}"` : 'Ask them to reply with SCHEDULE or their preferred time.'}`);
      } else if (playbook.nextStepType === 'checkout') {
        parts.push('Naturally guide toward purchase. If buyer shows intent, transition to checkout flow.');
      } else if (playbook.nextStepType === 'human_handoff') {
        parts.push('At the right moment, offer to connect the buyer with a human agent. They can type AGENT to escalate.');
      } else if (playbook.nextStepType === 'collect_info') {
        const cfg = (playbook.nextStepConfig as Record<string, unknown>) ?? {};
        parts.push(`Collect the following from the buyer: ${cfg.infoToCollect ?? 'relevant information'}.`);
      }
    }

    return {
      block: parts.join('\n'),
      nextStepType: playbook.nextStepType as NextStepType,
      nextStepConfig: playbook.nextStepConfig as Record<string, unknown> | null,
      fallbackMessage: playbook.fallbackMessage,
    };
  } catch {
    return empty;
  }
}

// ── Main processor ────────────────────────────────────────────────────────────

export async function processWebhookPayload(payload: Record<string, unknown>): Promise<void> {
  // Skip status updates
  if (isStatusUpdate(payload)) return;

  const normalized = extractFirstMessage(payload);
  if (!normalized) return;

  const tenantId = await resolveTenantByPhoneNumberId(normalized.phoneNumberId);
  if (!tenantId) {
    console.warn(`[webhookProcessor] No tenant for phoneNumberId=${normalized.phoneNumberId}`);
    return;
  }

  // Staff intercept
  const inboundText = normalized.text ?? (normalized.raw as any)?.text?.body ?? '';
  const staffMember = await db.query.staff.findFirst({
    where: and(eq(staff.tenantId, tenantId), eq(staff.phoneNumber, normalized.waId)),
    columns: { id: true, phoneNumber: true },
  });

  if (staffMember) {
    console.log(`[webhookProcessor] Staff intercept: staffId=${staffMember.id}`);

    const buttonPayload =
      normalized.messageType === 'interactive'
        ? (normalized.raw as any)?.interactive?.button_reply?.id
        : normalized.messageType === 'button'
        ? (normalized.raw as any)?.button?.payload
        : undefined;

    if (typeof buttonPayload === 'string' && buttonPayload.startsWith('appt:')) {
      const [, appointmentId, action] = buttonPayload.split(':');
      await handleStaffButtonReply(tenantId, appointmentId, action === 'confirm').catch(err =>
        console.error('[webhookProcessor] Staff button reply failed:', err)
      );
    } else if (typeof buttonPayload === 'string' && buttonPayload.startsWith('appt_reschedule_')) {
      const isApprove = buttonPayload.startsWith('appt_reschedule_approve:');
      const appointmentId = buttonPayload.split(':')[1];
      await handleStaffRescheduleApproval(appointmentId, tenantId, isApprove).catch(err =>
        console.error('[webhookProcessor] Staff reschedule approval failed:', err)
      );
    } else if (inboundText) {
      await handleStaffKeywordReply(tenantId, staffMember.id, normalized.waId, inboundText).catch(err =>
        console.error('[webhookProcessor] Staff keyword reply failed:', err)
      );
    }

    return;
  }

  // Find/create buyer
  let buyer = await db.query.buyers.findFirst({
    where: and(eq(buyers.waPhone, normalized.waId), eq(buyers.tenantId, tenantId)),
  });

  if (!buyer) {
    const [created] = await db.insert(buyers).values({
      tenantId,
      waPhone: normalized.waId,
      displayName: normalized.name ?? null,
      preferredLanguage: 'id',
      createdAt: new Date(),
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [buyers.waPhone, buyers.tenantId],
      set: { updatedAt: sql`now()` },
    }).returning({ id: buyers.id });
    buyer = await db.query.buyers.findFirst({ where: eq(buyers.id, created.id) });
  }

  if (!buyer) throw new Error('Failed to create or load buyer');
  if (buyer.doNotContact) return;

  // Ensure active conversation exists and save the inbound message BEFORE any flow
  // trigger fires. This gives the inbound row a timestamp that predates the bot's
  // outbound response, so the dashboard shows the correct chronological order.
  const messageId = extractMessageId(normalized);
  await ensureActiveConversation(tenantId, buyer.id);
  await saveInboundMessage(tenantId, buyer.id, messageId, normalized);

  // Flow button trigger
  const interactiveButtonId =
    normalized.messageType === 'interactive'
      ? (normalized.raw as any)?.interactive?.button_reply?.id ?? (normalized.raw as any)?.interactive?.list_reply?.id
      : normalized.messageType === 'button'
      ? (normalized.raw as any)?.button?.payload
      : undefined;

  if (typeof interactiveButtonId === 'string' && interactiveButtonId.startsWith('flow:')) {
    await flowEngine.handleButtonTrigger(tenantId, buyer.id, interactiveButtonId);
    return;
  }

  // Flow resume
  let resumedByFlowEngine = false;
  let activatedPlaybookKey: string | null = null;
  let postFlowConvId: string | null = null;

  try {
    const activeExecution = await db.query.flowExecutions.findFirst({
      where: and(
        eq(flowExecutions.tenantId, tenantId),
        eq(flowExecutions.buyerId, buyer.id),
        eq(flowExecutions.status, 'waiting_reply'),
      ),
      columns: { id: true },
    });

    if (activeExecution) {
      await flowEngine.resumeExecution(activeExecution.id, inboundText);
      resumedByFlowEngine = true;

      const postFlowConv = await db.query.conversations.findFirst({
        where: and(
          eq(conversations.tenantId, tenantId),
          eq(conversations.buyerId, buyer.id),
          eq(conversations.isActive, true),
        ),
      });

      const postOverride = postFlowConv?.playbookOverride as PlaybookOverrideData | null;
      console.log(`[webhookProcessor] post-resume conv=${postFlowConv?.id} playbookOverride=${JSON.stringify(postOverride ?? null)}`);

      if (postOverride?.type === 'playbook') {
        activatedPlaybookKey = postOverride.intentKey;
        postFlowConvId = postFlowConv!.id;
      }
    }
  } catch (err) {
    console.error('[webhookProcessor] Flow resume error:', err);
  }

  // ACTIVATE_PLAYBOOK ran — send AI response outside the swallowed try/catch
  if (activatedPlaybookKey && postFlowConvId) {
    console.log(`[webhookProcessor] ACTIVATE_PLAYBOOK detected key=${activatedPlaybookKey} — sending AI response`);
    try {
      await db.update(conversations)
        .set({ state: activatedPlaybookKey as any, playbookOverride: null })
        .where(eq(conversations.id, postFlowConvId));
    } catch (err) {
      console.error('[webhookProcessor] Failed to update conv state after ACTIVATE_PLAYBOOK:', err);
    }
    const freshConv = await db.query.conversations.findFirst({
      where: eq(conversations.id, postFlowConvId),
    });
    if (freshConv) {
      await sendAiResponse(tenantId, freshConv, buyer, inboundText, undefined, activatedPlaybookKey as MessageIntent)
        .catch(err => console.error('[webhookProcessor] ACTIVATE_PLAYBOOK sendAiResponse failed:', err));
    }
    return;
  }

  // Keyword trigger — pass conversationId so flow node processors can update the conversation
  let keywordTriggered = false;
  if (inboundText && !resumedByFlowEngine) {
    try {
      const activeConvForFlow = await db.query.conversations.findFirst({
        where: and(
          eq(conversations.tenantId, tenantId),
          eq(conversations.buyerId, buyer.id),
          eq(conversations.isActive, true),
        ),
        columns: { id: true },
      });
      keywordTriggered = await flowEngine.handleKeywordTrigger(tenantId, buyer.id, inboundText, activeConvForFlow?.id);
    } catch {
      // Fall through
    }
  }

  const skipAI = keywordTriggered || resumedByFlowEngine;
  console.log(`[webhookProcessor] buyer=${buyer.id} keywordTriggered=${keywordTriggered} resumedByFlow=${resumedByFlowEngine} skipAI=${skipAI}`);

  // Core conversation handling
  await handleInboundConversation(tenantId, normalized, buyer, { skipAI });
}

async function resolveTenantByPhoneNumberId(phoneNumberId: string): Promise<string | null> {
  const fullyConfigured = await db.query.tenants.findFirst({
    where: (t, { eq, and, isNotNull }) => and(eq(t.metaPhoneNumberId, phoneNumberId), isNotNull(t.wabaId)),
  });
  if (fullyConfigured) return fullyConfigured.id;

  const anyMatch = await db.query.tenants.findFirst({
    where: (t, { eq }) => eq(t.metaPhoneNumberId, phoneNumberId),
  });
  return anyMatch?.id ?? null;
}

async function saveInboundMessage(tenantId: string, buyerId: string, messageId: string | undefined, payload: any): Promise<void> {
  if (!messageId) return;
  try {
    const conv = await db.query.conversations.findFirst({
      where: and(eq(conversations.tenantId, tenantId), eq(conversations.buyerId, buyerId), eq(conversations.isActive, true)),
      columns: { id: true },
    });
    if (!conv) return;

    await db.insert(messages).values({
      conversationId: conv.id,
      tenantId,
      watiMessageId: messageId,
      direction: 'inbound',
      messageType: payload.messageType ?? 'text',
      textContent: extractText(payload) || null,
      locationLat: payload.location?.latitude?.toString() ?? null,
      locationLng: payload.location?.longitude?.toString() ?? null,
      rawPayload: payload as unknown as Record<string, unknown>,
      createdAt: new Date(),
    }).onConflictDoNothing();

    await db.update(conversations).set({ lastMessageAt: new Date() }).where(eq(conversations.id, conv.id));
  } catch (err) {
    console.warn('[webhookProcessor] Failed to save inbound message early:', err);
  }
}

async function ensureActiveConversation(tenantId: string, buyerId: string): Promise<void> {
  const existing = await db.query.conversations.findFirst({
    where: and(eq(conversations.tenantId, tenantId), eq(conversations.buyerId, buyerId), eq(conversations.isActive, true)),
    columns: { id: true },
  });
  if (existing) return;

  await db.insert(conversations).values({
    tenantId,
    buyerId,
    productId: null,
    state: 'INIT',
    language: 'id',
    messageCount: 0,
    isActive: true,
    startedAt: new Date(),
    lastMessageAt: new Date(),
  }).onConflictDoNothing();
}

// ── Simplified conversation handler (core logic from ConversationService) ─────

async function handleInboundConversation(
  tenantId: string,
  payload: any,
  buyer: any,
  opts: { skipAI?: boolean } = {},
): Promise<void> {
  const messageId = extractMessageId(payload);
  const waId = payload.waId;
  if (!waId) return;

  // Get or create active conversation
  let conv = await db.query.conversations.findFirst({
    where: and(eq(conversations.tenantId, tenantId), eq(conversations.buyerId, buyer.id), eq(conversations.isActive, true)),
  });

  if (!conv) {
    const [created] = await db.insert(conversations).values({
      tenantId,
      buyerId: buyer.id,
      productId: null,
      state: 'INIT',
      language: 'id',
      messageCount: 0,
      isActive: true,
      startedAt: new Date(),
      lastMessageAt: new Date(),
    }).returning();
    conv = created;
  }

  // Save inbound message
  if (messageId) {
    await db.insert(messages).values({
      conversationId: conv.id,
      tenantId,
      watiMessageId: messageId,
      direction: 'inbound',
      messageType: payload.messageType ?? 'text',
      textContent: extractText(payload) || null,
      locationLat: payload.location?.latitude?.toString() ?? null,
      locationLng: payload.location?.longitude?.toString() ?? null,
      rawPayload: payload as unknown as Record<string, unknown>,
      createdAt: new Date(),
    }).onConflictDoNothing();
  }

  const newCount = (conv.messageCount ?? 0) + 1;
  await db.update(conversations).set({ messageCount: newCount, lastMessageAt: new Date() }).where(eq(conversations.id, conv.id));
  conv = { ...conv, messageCount: newCount };

  const text = extractText(payload);
  if (!text) return;

  // Global commands
  if (containsAny(text, STOP_KEYWORDS)) {
    await db.update(buyers).set({ doNotContact: true, updatedAt: new Date() }).where(eq(buyers.id, buyer.id));
    await db.update(conversations).set({ state: 'CLOSED_LOST', isActive: false, resolvedAt: new Date(), lastMessageAt: new Date() }).where(eq(conversations.id, conv.id));
    if (isWithin24HourWindow(conv.lastMessageAt)) {
      await sendText(tenantId, buyer.waPhone, 'Kamu telah berhenti. Untuk mulai lagi, chat kami kapan saja.', conv.id);
    }
    return;
  }

  if (containsAny(text, AGENT_KEYWORDS)) {
    await db.update(conversations).set({ state: 'ESCALATED', lastMessageAt: new Date() }).where(eq(conversations.id, conv.id));
    if (isWithin24HourWindow(conv.lastMessageAt)) {
      await sendText(tenantId, buyer.waPhone, 'Menghubungkan ke tim kami... ⏳', conv.id);
    }
    return;
  }

  if (opts.skipAI) return;

  // ── State routing with intent classification & playbook injection ───────────

  // Already in scheduling flow — bypass intent classification entirely
  if (conv.state === 'SCHEDULING' || conv.state === 'SCHEDULING_CONFIRMED') {
    await handleSchedulingBuyerMessage(tenantId, conv, buyer, text);
    return;
  }

  if (conv.state === 'INIT') {
    await db.update(conversations).set({ state: 'GREETING' }).where(eq(conversations.id, conv.id));
    conv = { ...conv, state: 'GREETING' };
  }

  if (conv.state === 'GREETING') {
    await sendAiResponse(tenantId, conv, buyer, text);
    await db.update(conversations).set({ state: 'BROWSING' }).where(eq(conversations.id, conv.id));
    return;
  }

  // For BROWSING and beyond: classify intent + RAG in parallel
  const lastBotMsg = await db.query.messages.findFirst({
    where: and(eq(messages.conversationId, conv.id), eq(messages.direction, 'outbound')),
    orderBy: (m, { desc }) => desc(m.createdAt),
  });
  const lastBotMessage = lastBotMsg?.textContent ?? undefined;

  const [ragContext, classifiedIntent] = await Promise.all([
    ragQuery(tenantId, text).catch((): string => ''),
    classifyMessageIntent(text, tenantId, lastBotMessage).catch((): MessageIntent => 'BROWSING'),
  ]);

  console.log(`[webhookProcessor] buyer=${buyer.id} conv=${conv.id} state=${conv.state} intent=${classifiedIntent} ragLen=${ragContext.length}`);

  // Booking / scheduling intent — transition to SCHEDULING and use the proper scheduling system
  const isBookingKeyword = detectBookingIntent(text);
  if (isBookingKeyword || classifiedIntent === 'SCHEDULING') {
    await db.update(conversations).set({ state: 'SCHEDULING', lastMessageAt: new Date() }).where(eq(conversations.id, conv.id));
    console.log(`[webhookProcessor] buyer=${buyer.id} scheduling detected — transitioning to SCHEDULING`);
    await handleSchedulingBuyerMessage(tenantId, { ...conv, state: 'SCHEDULING' }, buyer, text);
    return;
  }

  // State transitions based on classified intent
  if (classifiedIntent === 'PRODUCT_INQUIRY') {
    await db.update(conversations).set({ state: 'PRODUCT_INQUIRY', lastMessageAt: new Date() }).where(eq(conversations.id, conv.id));
  } else if (classifiedIntent === 'CHECKOUT_INTENT') {
    await db.update(conversations).set({ state: 'CHECKOUT_INTENT', lastMessageAt: new Date() }).where(eq(conversations.id, conv.id));
  } else if (classifiedIntent === 'OBJECTION_HANDLING') {
    await db.update(conversations).set({ state: 'OBJECTION_HANDLING', lastMessageAt: new Date() }).where(eq(conversations.id, conv.id));
  } else if (classifiedIntent === 'GENERAL_INQUIRY' || classifiedIntent === 'BROWSING') {
    await db.update(conversations).set({ state: 'BROWSING', lastMessageAt: new Date() }).where(eq(conversations.id, conv.id));
  }

  await sendAiResponse(tenantId, conv, buyer, text, ragContext || undefined, classifiedIntent);
}

// ── Staff scheduling handlers (mirrors SchedulingService, no apps/api import) ──

async function handleStaffButtonReply(tenantId: string, appointmentId: string, isConfirm: boolean): Promise<void> {
  const appt = await db.query.appointments.findFirst({
    where: and(eq(appointments.id, appointmentId), eq(appointments.tenantId, tenantId)),
  });
  if (!appt || appt.status !== 'pending_doctor') return;

  const buyer = await db.query.buyers.findFirst({ where: eq(buyers.id, appt.buyerId) });
  if (!buyer) return;

  const meta = await getTenantMetaClient(tenantId);

  if (isConfirm) {
    await db.update(appointments).set({ status: 'confirmed', updatedAt: new Date() }).where(eq(appointments.id, appointmentId));
    const timeDisplay = formatWIBDatetime(appt.startTime, appt.endTime);
    await meta.sendText({
      to: buyer.waPhone,
      message: `✅ Appointment kamu *dikonfirmasi*!\n\n📅 ${timeDisplay}\n\nSampai jumpa! Hubungi kami jika ada perubahan.`,
      isWithin24hrWindow: true,
    }).catch(() => null);
  } else {
    // Cancel the declined appointment
    await db.update(appointments).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(appointments.id, appointmentId));

    // Reset conversation state back to SCHEDULING so the buyer can pick a new slot
    // without having to restart the flow with a booking keyword.
    const buyerConv = await db.query.conversations.findFirst({
      where: and(eq(conversations.tenantId, tenantId), eq(conversations.buyerId, appt.buyerId), eq(conversations.isActive, true)),
      columns: { id: true },
    });
    if (buyerConv) {
      await db.update(conversations)
        .set({ state: 'SCHEDULING', lastMessageAt: new Date() })
        .where(eq(conversations.id, buyerConv.id));
    }

    // Re-present available slots for the same service
    let declineMsg: string;
    try {
      const serviceRow = await db.query.services.findFirst({ where: eq(services.id, appt.serviceId) });
      const slots = serviceRow ? await getAvailableSlots(tenantId, serviceRow.name, undefined, 3) : [];

      if (slots.length > 0) {
        const lines = slots.map((s, i) => {
          const label = ['1️⃣', '2️⃣', '3️⃣'][i] ?? `${i + 1}.`;
          return `${label} *${formatWIBDatetime(s.start, s.end)}* — ${s.staffName}`;
        });
        declineMsg = `😔 Maaf, jadwal yang dipilih tidak bisa dikonfirmasi.\n\nBerikut jadwal lain yang tersedia:\n\n${lines.join('\n')}\n\nPilih nomor berapa, Kak? 😊`;
      } else {
        declineMsg = `😔 Maaf, jadwal yang dipilih tidak bisa dikonfirmasi dan saat ini tidak ada jadwal lain yang tersedia. Silakan hubungi kami langsung.`;
      }
    } catch {
      declineMsg = `😔 Maaf, jadwal tidak bisa dikonfirmasi. Balas *booking* untuk mencoba jadwal lain.`;
    }

    await meta.sendText({ to: buyer.waPhone, message: declineMsg, isWithin24hrWindow: true }).catch(() => null);
  }
}

async function handleStaffRescheduleApproval(newAppointmentId: string, tenantId: string, isApprove: boolean): Promise<void> {
  const newAppt = await db.query.appointments.findFirst({
    where: and(eq(appointments.id, newAppointmentId), eq(appointments.tenantId, tenantId)),
  });
  if (!newAppt || newAppt.status !== 'rescheduling_requested' || !newAppt.previousAppointmentId) return;

  const oldAppt = await db.query.appointments.findFirst({ where: eq(appointments.id, newAppt.previousAppointmentId) });
  const buyer = await db.query.buyers.findFirst({ where: eq(buyers.id, newAppt.buyerId) });
  if (!buyer) return;

  const meta = await getTenantMetaClient(tenantId);

  if (isApprove) {
    await db.update(appointments).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(appointments.id, newAppt.previousAppointmentId));
    await db.update(appointments).set({ status: 'pending_doctor', updatedAt: new Date() }).where(eq(appointments.id, newAppointmentId));
    const newTimeDisplay = formatWIBDatetime(newAppt.startTime, newAppt.endTime);
    await meta.sendText({
      to: buyer.waPhone,
      message: `✅ Permintaan reschedule kamu *disetujui*!\n\n📅 Jadwal baru: ${newTimeDisplay}\n\nTunggu konfirmasi dari staf ya! 🙏`,
      isWithin24hrWindow: true,
    }).catch(() => null);
  } else {
    await db.update(appointments).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(appointments.id, newAppointmentId));
    const rejectMsg = `😔 Maaf, perubahan jadwal tidak bisa disetujui. Jadwal awal kamu tetap berlaku: ${oldAppt ? formatWIBDatetime(oldAppt.startTime, oldAppt.endTime) : 'N/A'}\n\nHubungi kami jika ada pertanyaan.`;
    await meta.sendText({ to: buyer.waPhone, message: rejectMsg, isWithin24hrWindow: true }).catch(() => null);
  }
}

async function handleStaffKeywordReply(tenantId: string, staffId: string, staffPhone: string, messageText: string): Promise<void> {
  const lower = messageText.toLowerCase().trim();
  const isConfirm = (STAFF_CONFIRMATION_KEYWORDS as readonly string[]).some(kw => lower === kw);
  const isDecline = (STAFF_REJECTION_KEYWORDS as readonly string[]).some(kw => lower === kw);

  if (!isConfirm && !isDecline) {
    const meta = await getTenantMetaClient(tenantId);
    await meta.sendText({
      to: staffPhone,
      message: 'Balas *[Konfirmasi]* untuk menyetujui atau *[Tolak]* untuk menolak appointment.',
      isWithin24hrWindow: true,
    }).catch(() => null);
    return;
  }

  const pending = await db.query.appointments.findFirst({
    where: and(eq(appointments.tenantId, tenantId), eq(appointments.staffId, staffId), eq(appointments.status, 'pending_doctor')),
    orderBy: (t, { desc }) => desc(t.createdAt),
  });

  if (!pending) return;
  await handleStaffButtonReply(tenantId, pending.id, isConfirm);
}

// ── Scheduling envelope executor (mirrors SchedulingService.handleLLMEnvelope) ─

async function executeSchedulingEnvelope(
  tenantId: string,
  conv: any,
  buyer: any,
  envelope: { action: string; service_name?: string; requested_datetime?: string; staff_id?: string; service_id?: string; start_time?: string; previous_appointment_id?: string },
): Promise<string> {
  if (envelope.action === 'check_availability') {
    try {
      const slots = await getAvailableSlots(tenantId, envelope.service_name ?? '', envelope.requested_datetime);
      if (slots.length === 0) {
        return 'Maaf, tidak ada jadwal yang tersedia dalam 14 hari ke depan untuk layanan ini. Coba hubungi kami langsung ya.';
      }
      const lines = slots.map((s, i) => {
        const label = ['1️⃣', '2️⃣', '3️⃣'][i] ?? `${i + 1}.`;
        return `${label} *${formatWIBDatetime(s.start, s.end)}* — ${s.staffName}`;
      });
      return `Berikut jadwal yang tersedia:\n\n${lines.join('\n')}\n\nPilih nomor berapa, Kak? 😊`;
    } catch (err: any) {
      return err?.message ?? 'Maaf, gagal cek jadwal. Coba lagi ya.';
    }
  }

  if (envelope.action === 'confirm_booking') {
    if (!envelope.staff_id || !envelope.service_id || !envelope.start_time) {
      return 'Terjadi kesalahan saat memproses booking. Coba ulangi pilihan jadwal kamu.';
    }

    const startTime = new Date(envelope.start_time);
    const serviceRow = await db.query.services.findFirst({ where: eq(services.id, envelope.service_id) });
    const durationMs = (serviceRow?.durationMinutes ?? 60) * 60 * 1000;
    const endTime = new Date(startTime.getTime() + durationMs);

    const [appt] = await db.insert(appointments).values({
      tenantId,
      buyerId: buyer.id,
      staffId: envelope.staff_id,
      serviceId: envelope.service_id,
      startTime,
      endTime,
      status: 'pending_doctor',
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();

    const slotStaff = await db.query.staff.findFirst({ where: eq(staff.id, envelope.staff_id) });
    let notifyStaff = slotStaff;

    // playbookOverride JSONB { type:'staff', staffId } routes confirmation to configured staff member.
    const bookingOverride = conv.playbookOverride as PlaybookOverrideData | null;
    if (bookingOverride?.type === 'staff' && bookingOverride.staffId) {
      const overrideStaff = await db.query.staff.findFirst({
        where: and(eq(staff.id, bookingOverride.staffId), eq(staff.tenantId, tenantId)),
      });
      if (overrideStaff) notifyStaff = overrideStaff;
    }

    if (notifyStaff && serviceRow && appt) {
      const timeDisplay = formatWIBDatetime(appt.startTime, appt.endTime);
      const staffMsg = `📅 Ada permintaan appointment baru!\n\n*Pasien:* ${buyer.displayName ?? 'Pelanggan'}\n*Layanan:* ${serviceRow.name}\n*Waktu:* ${timeDisplay}\n\nBalas *Konfirmasi* untuk menerima atau *Tolak* untuk menolak.`;
      await sendText(tenantId, notifyStaff.phoneNumber, staffMsg).catch(() => null);
    }

    await db.update(conversations)
      .set({ state: 'SCHEDULING_CONFIRMED' as any, lastMessageAt: new Date() })
      .where(eq(conversations.id, conv.id));

    return `Baik, permintaan appointment *${serviceRow?.name ?? ''}* sudah kami kirim ke ${notifyStaff?.name ?? 'staf'}. Tunggu konfirmasinya ya, Kak 🙏\n\nKamu akan dapat notifikasi begitu dikonfirmasi.`;
  }

  if (envelope.action === 'reschedule_booking') {
    if (!envelope.previous_appointment_id || !envelope.requested_datetime) {
      return 'Terjadi kesalahan saat memproses perubahan jadwal. Coba ulangi ya.';
    }

    const oldAppt = await db.query.appointments.findFirst({
      where: and(eq(appointments.id, envelope.previous_appointment_id), eq(appointments.tenantId, tenantId)),
    });
    if (!oldAppt) return 'Appointment tidak ditemukan. Silakan mulai booking baru.';

    const newStartTime = new Date(envelope.requested_datetime);
    const serviceRow = await db.query.services.findFirst({ where: eq(services.id, oldAppt.serviceId) });
    const durationMs = (serviceRow?.durationMinutes ?? 60) * 60 * 1000;
    const newEndTime = new Date(newStartTime.getTime() + durationMs);

    const [newAppt] = await db.insert(appointments).values({
      tenantId,
      buyerId: buyer.id,
      staffId: oldAppt.staffId,
      serviceId: oldAppt.serviceId,
      startTime: newStartTime,
      endTime: newEndTime,
      status: 'rescheduling_requested' as any,
      previousAppointmentId: oldAppt.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();

    const slotStaff = await db.query.staff.findFirst({ where: eq(staff.id, oldAppt.staffId) });
    let notifyStaff = slotStaff;
    const reschedOverride = conv.playbookOverride as PlaybookOverrideData | null;
    if (reschedOverride?.type === 'staff' && reschedOverride.staffId) {
      const overrideStaff = await db.query.staff.findFirst({
        where: and(eq(staff.id, reschedOverride.staffId), eq(staff.tenantId, tenantId)),
      });
      if (overrideStaff) notifyStaff = overrideStaff;
    }

    if (notifyStaff && newAppt) {
      const oldTimeDisplay = formatWIBDatetime(oldAppt.startTime, oldAppt.endTime);
      const newTimeDisplay = formatWIBDatetime(newAppt.startTime, newAppt.endTime);
      const staffMsg = `🔄 Permintaan reschedule!\n\n*Pasien:* ${buyer.displayName ?? 'Pelanggan'}\n*Layanan:* ${serviceRow?.name ?? ''}\n*Dari:* ${oldTimeDisplay}\n*Ke:* ${newTimeDisplay}\n\nBalas *Konfirmasi* untuk menyetujui atau *Tolak* untuk menolak.`;
      await sendText(tenantId, notifyStaff.phoneNumber, staffMsg).catch(() => null);
    }

    return `Permintaan reschedule sudah dikirim! Dari ${formatWIBDatetime(oldAppt.startTime)} ke ${formatWIBDatetime(newStartTime, newEndTime)}. Tunggu konfirmasi dari staf ya 🙏`;
  }

  return 'Maaf, terjadi kesalahan. Coba lagi ya.';
}

// ── Proper scheduling handler (replaces sendAiResponse for SCHEDULING state) ──

async function handleSchedulingBuyerMessage(
  tenantId: string,
  conv: any,
  buyer: any,
  text: string,
): Promise<void> {
  if (!isWithin24HourWindow(conv.lastMessageAt)) return;

  const llm = getLLMClient();

  // Build conversation history (last 10 messages, oldest first)
  const recentMessages = await db.query.messages.findMany({
    where: eq(messages.conversationId, conv.id),
    orderBy: (m, { desc }) => [desc(m.createdAt)],
    limit: 10,
  });

  const history = recentMessages
    .reverse()
    .map(m => ({
      role: m.direction === 'inbound' ? ('user' as const) : ('assistant' as const),
      content: m.textContent ?? '',
    }))
    .filter(m => m.content.length > 0);

  if (!history.length || history[history.length - 1].role !== 'user') {
    history.push({ role: 'user', content: text });
  }

  // Fetch active services so LLM uses exact names in service_name field
  const activeServices = await db.query.services.findMany({
    where: and(eq(services.tenantId, tenantId), eq(services.isActive, true)),
  });

  if (activeServices.length === 0) {
    await sendText(tenantId, buyer.waPhone, 'Maaf, saat ini sistem booking belum tersedia. Silakan hubungi kami langsung untuk membuat janji. 🙏', conv.id);
    return;
  }

  const serviceList = activeServices.map(s => `- ${s.name}`).join('\n');
  const systemPrompt = `${SCHEDULING_SYSTEM_PROMPT}\n\nLAYANAN TERSEDIA (gunakan nama persis ini di service_name):\n${serviceList}`;

  let responseText: string;
  try {
    const llmResponse = await llm.chat([
      { role: 'system', content: systemPrompt },
      ...history,
    ]);
    responseText = llmResponse.content.trim();
  } catch (err) {
    console.error('[webhookProcessor] Scheduling LLM call failed:', err);
    await sendText(tenantId, buyer.waPhone, 'Maaf, ada gangguan teknis. Silakan coba lagi atau hubungi kami langsung.', conv.id);
    return;
  }

  const envelope = parseSchedulingEnvelope(responseText);
  let replyText: string;

  if (envelope) {
    console.log(`[webhookProcessor] scheduling envelope action=${envelope.action} conv=${conv.id}`);
    replyText = await executeSchedulingEnvelope(tenantId, conv, buyer, envelope);
  } else {
    replyText = responseText;
  }

  // Send reply to buyer
  try {
    const meta = await getTenantMetaClient(tenantId);
    await meta.sendText({ to: buyer.waPhone, message: replyText, isWithin24hrWindow: true });
  } catch (err) {
    console.error('[webhookProcessor] handleSchedulingBuyerMessage send failed:', err);
    return;
  }

  // Persist outbound message
  try {
    await db.insert(messages).values({
      conversationId: conv.id,
      tenantId,
      direction: 'outbound',
      messageType: 'text',
      textContent: replyText,
      createdAt: new Date(),
    });
    await db.update(conversations).set({ lastMessageAt: new Date() }).where(eq(conversations.id, conv.id));
  } catch (err) {
    console.error('[webhookProcessor] handleSchedulingBuyerMessage persist failed:', err);
  }
}

async function sendText(tenantId: string, to: string, message: string, convId?: string): Promise<void> {
  try {
    const meta = await getTenantMetaClient(tenantId);
    await meta.sendText({ to, message, isWithin24hrWindow: true });

    // Persist outbound message to dashboard conversation thread when convId is provided
    if (convId) {
      await db.insert(messages).values({
        conversationId: convId,
        tenantId,
        direction: 'outbound',
        messageType: 'text',
        textContent: message,
        createdAt: new Date(),
      }).onConflictDoNothing().catch(() => null);
      await db.update(conversations).set({ lastMessageAt: new Date() }).where(eq(conversations.id, convId)).catch(() => null);
    }
  } catch (err) {
    console.error(`[webhookProcessor] sendText failed:`, err);
  }
}

async function sendAiResponse(
  tenantId: string,
  conv: any,
  buyer: any,
  userMessage: string,
  additionalContext?: string,
  intentOverride?: MessageIntent,
): Promise<void> {
  if (!isWithin24HourWindow(conv.lastMessageAt)) return;

  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  const product = conv.productId
    ? await db.query.products.findFirst({ where: eq(products.id, conv.productId) })
    : null;

  let ragContext = additionalContext ?? '';
  if (!ragContext) {
    try {
      ragContext = await ragQuery(tenantId, userMessage);
    } catch {
      // Ignore RAG failure
    }
  }

  // Load intent playbook — use LLM-classified intent when available so the right
  // playbook fires even if conv.state hasn't transitioned yet.
  const aiOverride = conv.playbookOverride as PlaybookOverrideData | null;
  const flowPlaybookKey = aiOverride?.type === 'playbook' ? aiOverride.intentKey as MessageIntent : undefined;
  const playbookLookupKey = flowPlaybookKey ?? intentOverride ?? conv.state;
  const playbookResult = await getPlaybookBlock(tenantId, playbookLookupKey).catch(() => ({ block: '', nextStepType: 'continue_conversation' as const, nextStepConfig: null, fallbackMessage: null }));
  console.log(`[webhookProcessor] buyer=${buyer.id} playbookLookup=${playbookLookupKey} blockLen=${playbookResult.block.length} nextStep=${playbookResult.nextStepType}`);

  const systemPrompt = buildSystemPrompt({
    storeName: tenant?.storeName ?? '',
    productName: product?.name,
    bookPersonaPrompt: product?.bookPersonaPrompt,
    language: (conv.language as 'id' | 'en') ?? 'id',
    playbookContext: playbookResult.block || undefined,
    botName: tenant?.botName,
    botTone: tenant?.botTone as import('@lynkbot/db').BotTone | null | undefined,
    botGreetingStyle: tenant?.botGreetingStyle,
    botCustomInstructions: tenant?.botCustomInstructions,
  });

  const stateOverlay = (STATE_PROMPTS as Record<string, string>)[conv.state] ?? '';
  const contextBlock = ragContext
    ? `\n\nPRODUCT KNOWLEDGE (retrieved from training material — use this to answer questions accurately; do NOT say you don't have information if the answer is in this context):\n${ragContext}`
    : '';
  const finalSystemPrompt = systemPrompt + stateOverlay + contextBlock;

  const llm = getLLMClient();
  const start = Date.now();
  let aiText = '';

  try {
    const response = await llm.chat([{ role: 'user', content: userMessage }], { system: finalSystemPrompt });
    aiText = response.content;
  } catch {
    aiText = conv.language === 'id'
      ? 'Maaf, ada gangguan sebentar. Bisa coba lagi? 🙏'
      : 'Sorry, I encountered a brief issue. Please try again 🙏';
  }

  const latencyMs = Date.now() - start;

  try {
    const meta = await getTenantMetaClient(tenantId);
    await meta.sendText({ to: buyer.waPhone, message: aiText, isWithin24hrWindow: true });
  } catch (err) {
    console.error(`[webhookProcessor] Failed to send AI response:`, err);
    return;
  }

  try {
    await db.insert(messages).values({
      conversationId: conv.id,
      tenantId,
      direction: 'outbound',
      messageType: 'text',
      textContent: aiText,
      latencyMs,
      createdAt: new Date(),
    });
    await db.update(conversations).set({ lastMessageAt: new Date() }).where(eq(conversations.id, conv.id));
  } catch (err) {
    console.error(`[webhookProcessor] Failed to persist outbound message:`, err);
  }
}
