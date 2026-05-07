/**
 * @CLAUDE_CONTEXT
 * Package : apps/worker
 * File    : src/services/webhookMessage.processor.ts
 * Role    : Self-contained inbound message processor for the webhook queue.
 *           Duplicates core logic from apps/api webhook handler + ConversationService
 *           so the worker does not need to import from apps/*.
 */
import { createDecipheriv } from 'node:crypto';
import { db, buyers, conversations, messages, tenants, flowExecutions, staff, appointments, products, intentPlaybooks, eq, and, or, not, sql } from '@lynkbot/db';
import { MetaClient, extractFirstMessage, isStatusUpdate, extractText, extractMessageId } from '@lynkbot/meta';
import { FlowEngine } from '@lynkbot/flow-engine';
import { getLLMClient, query as ragQuery, formatWIBDatetime, classifyMessageIntent, buildSystemPrompt, STATE_PROMPTS } from '@lynkbot/ai';
import type { MessageIntent } from '@lynkbot/ai';
import { STAFF_CONFIRMATION_KEYWORDS, STAFF_REJECTION_KEYWORDS, BOOKING_INTENT_KEYWORDS } from '@lynkbot/shared';
import Redis from 'ioredis';

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
function getRedisConnection() {
  if (process.env.REDIS_URL) {
    const url = new URL(process.env.REDIS_URL);
    return { host: url.hostname, port: Number(url.port) || 6379, password: url.password || undefined };
  }
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD,
  };
}

const redisConn = getRedisConnection();
const redisClient = new Redis(redisConn);

const flowEngine = new FlowEngine({
  getMetaClient: getTenantMetaClient,
  redisClient,
  redisConnection: redisConn,
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

      // ACTIVATE_PLAYBOOK sets playbookOverride — send an immediate AI response
      // using that playbook for the buyer's message that just resumed the flow.
      const postFlowConv = await db.query.conversations.findFirst({
        where: and(
          eq(conversations.tenantId, tenantId),
          eq(conversations.buyerId, buyer.id),
          eq(conversations.isActive, true),
        ),
      });

      if (postFlowConv?.playbookOverride && !postFlowConv.playbookOverride.startsWith('staff:')) {
        const activatedKey = postFlowConv.playbookOverride as MessageIntent;
        // Transition conv state to the activated intent so subsequent messages route correctly
        await db.update(conversations)
          .set({ state: activatedKey as any, playbookOverride: null })
          .where(eq(conversations.id, postFlowConv.id));
        await sendAiResponse(tenantId, { ...postFlowConv, state: activatedKey as any, playbookOverride: null }, buyer, inboundText, undefined, activatedKey)
          .catch(err => console.error('[webhookProcessor] ACTIVATE_PLAYBOOK AI response failed:', err));
        return;
      }
    }
  } catch {
    // Fall through
  }

  // Keyword trigger
  let keywordTriggered = false;
  if (inboundText && !resumedByFlowEngine) {
    try {
      keywordTriggered = await flowEngine.handleKeywordTrigger(tenantId, buyer.id, inboundText);
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
      await sendText(tenantId, buyer.waPhone, 'Kamu telah berhenti. Untuk mulai lagi, chat kami kapan saja.');
    }
    return;
  }

  if (containsAny(text, AGENT_KEYWORDS)) {
    await db.update(conversations).set({ state: 'ESCALATED', lastMessageAt: new Date() }).where(eq(conversations.id, conv.id));
    if (isWithin24HourWindow(conv.lastMessageAt)) {
      await sendText(tenantId, buyer.waPhone, 'Menghubungkan ke tim kami... ⏳');
    }
    return;
  }

  if (opts.skipAI) return;

  // ── State routing with intent classification & playbook injection ───────────

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

  // Booking / scheduling intent detection
  const isBookingKeyword = detectBookingIntent(text);
  if (isBookingKeyword || classifiedIntent === 'SCHEDULING') {
    const wasAlreadyScheduling = conv.state === 'SCHEDULING';
    await db.update(conversations).set({ state: 'SCHEDULING', lastMessageAt: new Date() }).where(eq(conversations.id, conv.id));

    // Playbook activates ONLY after buyer has already provided a time/date
    // (i.e. conversation was already in SCHEDULING state). On the first
    // scheduling message we collect the date/time without the playbook so
    // staff confirmation later includes the actual slot.
    const intentForPlaybook = wasAlreadyScheduling ? ('SCHEDULING' as MessageIntent) : undefined;
    console.log(`[webhookProcessor] buyer=${buyer.id} scheduling detected wasAlreadyScheduling=${wasAlreadyScheduling} intentForPlaybook=${intentForPlaybook ?? 'none'}`);
    await sendAiResponse(tenantId, { ...conv, state: 'SCHEDULING' }, buyer, text, ragContext || undefined, intentForPlaybook);
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
    await db.update(appointments).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(appointments.id, appointmentId));
    await meta.sendText({
      to: buyer.waPhone,
      message: '😔 Maaf, dokter tidak dapat menerima appointment ini. Ingin coba jadwal lain? Balas dengan kata kunci booking untuk mulai ulang.',
      isWithin24hrWindow: true,
    }).catch(() => null);
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

async function sendText(tenantId: string, to: string, message: string): Promise<void> {
  try {
    const meta = await getTenantMetaClient(tenantId);
    await meta.sendText({ to, message, isWithin24hrWindow: true });
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
  const flowPlaybookKey = conv.playbookOverride && !conv.playbookOverride.startsWith('staff:')
    ? conv.playbookOverride as MessageIntent : undefined;
  const playbookLookupKey = flowPlaybookKey ?? intentOverride ?? conv.state;
  const playbookResult = await getPlaybookBlock(tenantId, playbookLookupKey).catch(() => ({ block: '', nextStepType: 'continue_conversation' as const, nextStepConfig: null, fallbackMessage: null }));
  console.log(`[webhookProcessor] buyer=${buyer.id} playbookLookup=${playbookLookupKey} blockLen=${playbookResult.block.length} nextStep=${playbookResult.nextStepType}`);

  const systemPrompt = buildSystemPrompt({
    storeName: tenant?.storeName ?? 'LynkBot Store',
    productName: product?.name,
    bookPersonaPrompt: product?.bookPersonaPrompt,
    language: (conv.language as 'id' | 'en') ?? 'id',
    playbookContext: playbookResult.block || undefined,
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
