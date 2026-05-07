/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/services/conversation.service.ts
 * Role    : Single entry point for all inbound WA message processing.
 *           Implements the 23-state conversation state machine via dispatch table.
 *           Stateless service — all state lives in the conversations DB table.
 * Imports : @lynkbot/shared, @lynkbot/db, @lynkbot/ai, @lynkbot/meta
 * Exports : ConversationService class
 * DO NOT  : Add HTTP routing logic here. Import packages/payments directly.
 *           Payment events arrive via PaymentService callback.
 * Tests   : src/services/__tests__/conversation.service.test.ts
 */
import { eq, and, gt } from '@lynkbot/db';
import { db, conversations, messages, buyers, tenants, products, waitlist, buyerGenomes, consentAudit } from '@lynkbot/db';
import {
  BUY_INTENT_KEYWORDS,
  OBJECTION_KEYWORDS,
  DISENGAGEMENT_KEYWORDS,
  STOP_KEYWORDS,
  AGENT_KEYWORDS,
  STATE_PROMPTS,
  getLLMClient,
  buildSystemPrompt,
  query as ragQuery,
  classifyMessageIntent,
  SCHEDULING_SYSTEM_PROMPT,
  parseSchedulingEnvelope,
  formatWIBDatetime,
} from '@lynkbot/ai';
import type { MessageIntent } from '@lynkbot/ai';
import { BOOKING_INTENT_KEYWORDS } from '@lynkbot/shared';
import { IntentPlaybookService } from './intentPlaybook.service';
import { SchedulingService } from './scheduling.service';
import {
  extractText,
  extractMessageId,
  isLocationMessage,
  type MetaClient,
  type MetaNormalizedPayload,
} from '@lynkbot/meta';
import { getTenantMetaClient } from './_meta.helper';
import {
  extractSignals,
  extractName,
  deriveScores,
  scoreConfidence,
  applyConfidencePenalty,
  mergeScores,
  defaultGenome,
  buildSeededGenome,
  classifyMoment,
  selectDialog,
  computeRWI,
  buildFallbackCache,
  type GenomeScores,
} from '@lynkbot/pantheon';
import { CheckoutService } from './checkout.service';
import { ShippingService } from './shipping.service';
import { NotificationService } from './notification.service';
import { PaymentService } from './payment.service';
import type { ConversationStateValue } from '@lynkbot/shared';

type ConvRow = typeof conversations.$inferSelect;
type BuyerRow = typeof buyers.$inferSelect;

function isWithin24HourWindow(lastMessageAt: Date): boolean {
  return Date.now() - lastMessageAt.getTime() < 24 * 60 * 60 * 1000;
}

function containsAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some(kw => lower.includes(kw.toLowerCase()));
}

function detectBuyIntent(text: string, lang: 'id' | 'en' = 'id'): boolean {
  const keywords = [...BUY_INTENT_KEYWORDS.id, ...BUY_INTENT_KEYWORDS.en];
  return containsAny(text, keywords);
}

function detectObjection(text: string): boolean {
  const keywords = [...OBJECTION_KEYWORDS.id, ...OBJECTION_KEYWORDS.en];
  return containsAny(text, keywords);
}

function detectDisengagement(text: string): boolean {
  const keywords = [...DISENGAGEMENT_KEYWORDS.id, ...DISENGAGEMENT_KEYWORDS.en];
  return containsAny(text, keywords);
}

/** O(1) keyword scan — triggers SCHEDULING state transition before LLM classification */
function detectBookingIntent(text: string): boolean {
  const allKeywords = [...BOOKING_INTENT_KEYWORDS.id, ...BOOKING_INTENT_KEYWORDS.en];
  return containsAny(text, allKeywords);
}

export class ConversationService {
  private checkoutService = new CheckoutService();
  private shippingService = new ShippingService();
  private notificationService = new NotificationService();
  private paymentService = new PaymentService();
  private schedulingService = new SchedulingService();

  private getMetaClient(tenantId: string): Promise<MetaClient> {
    return getTenantMetaClient(tenantId);
  }

  /**
   * Look up which tenant owns a given Meta phone_number_id.
   * The Meta webhook doesn't include a tenantId path param (unlike the old WATI
   * per-tenant webhook URL), so we look it up from the tenants table.
   */
  async resolveTenantByPhoneNumberId(phoneNumberId: string): Promise<string | null> {
    // Prefer a fully-configured tenant (has both metaPhoneNumberId AND wabaId set via
    // the Settings page). This avoids accidentally routing to a tenant whose phone
    // number was auto-stamped from a stale global env var rather than intentionally
    // set through the onboarding flow.
    const fullyConfigured = await db.query.tenants.findFirst({
      where: (t, { eq, and, isNotNull }) => and(
        eq(t.metaPhoneNumberId, phoneNumberId),
        isNotNull(t.wabaId),
      ),
    });
    if (fullyConfigured) return fullyConfigured.id;

    // Fallback: any tenant with a matching metaPhoneNumberId (covers tenants that
    // connected before wabaId was a required field).
    const anyMatch = await db.query.tenants.findFirst({
      where: (t, { eq }) => eq(t.metaPhoneNumberId, phoneNumberId),
    });
    if (anyMatch) return anyMatch.id;

    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Public entry point
  // ─────────────────────────────────────────────────────────────────────────────

  async handleInbound(tenantId: string, payload: MetaNormalizedPayload, opts: { skipAI?: boolean } = {}): Promise<void> {
    const messageId = extractMessageId(payload);
    const waId = payload.waId;

    if (!waId) return; // Malformed payload

    // Idempotency check
    if (messageId && await this.isDuplicate(messageId)) return;

    // Get or create buyer
    let buyer = await db.query.buyers.findFirst({
      where: and(eq(buyers.waPhone, waId), eq(buyers.tenantId, tenantId)),
    });

    if (!buyer) {
      const [created] = await db.insert(buyers).values({
        tenantId,
        waPhone: waId,
        displayName: payload.name ?? null,
        preferredLanguage: 'id',
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();
      buyer = created;

      // Consent audit: log first inbound message as opt-in
      await db.insert(consentAudit).values({
        buyerId: buyer.id,
        tenantId,
        action: 'opt_in',
        channel: 'whatsapp',
        createdAt: new Date(),
      });
    } else {
      await db.update(buyers)
        .set({ updatedAt: new Date() })
        .where(eq(buyers.id, buyer.id));
    }

    if (buyer.doNotContact) return; // Silently ignore opted-out buyers

    // Pantheon: try to extract buyer name from message if not yet known
    if (!buyer.displayName) {
      const rawText = extractText(payload);
      if (rawText) {
        const detectedName = extractName([rawText]);
        if (detectedName) {
          await db.update(buyers)
            .set({ displayName: detectedName, updatedAt: new Date() })
            .where(eq(buyers.id, buyer.id));
          buyer = { ...buyer, displayName: detectedName };
        }
      }
    }

    // Get or create active conversation
    let conv = await db.query.conversations.findFirst({
      where: and(
        eq(conversations.tenantId, tenantId),
        eq(conversations.buyerId, buyer.id),
        eq(conversations.isActive, true),
      ),
    });

    if (!conv) {
      // Auto-assign the tenant's first active + ready product so the AI has product context from message 1
      const defaultProduct = await db.query.products.findFirst({
        where: and(eq(products.tenantId, tenantId), eq(products.isActive, true), eq(products.knowledgeStatus, 'ready')),
        orderBy: (p, { desc }) => desc(p.updatedAt),
      });

      const [created] = await db.insert(conversations).values({
        tenantId,
        buyerId: buyer.id,
        productId: defaultProduct?.id ?? null,
        state: 'INIT',
        language: 'id',
        messageCount: 0,
        isActive: true,
        startedAt: new Date(),
        lastMessageAt: new Date(),
      }).returning();
      conv = created;
    } else if (!conv.productId) {
      // Existing conversation without a product — try to assign one now
      const defaultProduct = await db.query.products.findFirst({
        where: and(eq(products.tenantId, tenantId), eq(products.isActive, true), eq(products.knowledgeStatus, 'ready')),
        orderBy: (p, { desc }) => desc(p.updatedAt),
      });
      if (defaultProduct) {
        await db.update(conversations).set({ productId: defaultProduct.id }).where(eq(conversations.id, conv.id));
        conv = { ...conv, productId: defaultProduct.id };
      }
    }

    // Mark message as processed (idempotency record)
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

    // Increment message count
    const newCount = (conv.messageCount ?? 0) + 1;
    await db.update(conversations)
      .set({ messageCount: newCount, lastMessageAt: new Date() })
      .where(eq(conversations.id, conv.id));

    conv = { ...conv, messageCount: newCount };

    // Handle global commands before state routing
    const handled = await this.handleGlobalCommands(conv, buyer, payload);
    if (handled) return;

    // Location message — route separately
    // Coerce lat/lng to number: Meta SDK types them as number but compiled dist may be stale
    if (isLocationMessage(payload) && payload.location) {
      const loc = payload.location;
      await this.handleLocationShare(conv, {
        latitude: Number(loc.latitude),
        longitude: Number(loc.longitude),
        name: loc.name,
        address: loc.address,
      });
      return;
    }

    // Pantheon: async genome update (fire-and-forget — never blocks the response)
    this.updateGenomeAsync(buyer.id, conv.tenantId, conv.id).catch(() => null);

    // Route to state handler — skip if a Flow Engine execution handled this message
    if (!opts.skipAI) {
      await this.routeByState(conv, buyer, payload);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Global commands
  // ─────────────────────────────────────────────────────────────────────────────

  async handleGlobalCommands(conv: ConvRow, buyer: BuyerRow, payload: MetaNormalizedPayload): Promise<boolean> {
    const text = extractText(payload);
    if (!text) return false;

    // STOP detection
    if (containsAny(text, STOP_KEYWORDS)) {
      // Consent audit: log opt-out BEFORE setting doNotContact
      await db.insert(consentAudit).values({
        buyerId: buyer.id,
        tenantId: conv.tenantId,
        action: 'opt_out',
        channel: 'whatsapp',
        createdAt: new Date(),
      });

      await db.update(buyers)
        .set({ doNotContact: true, updatedAt: new Date() })
        .where(eq(buyers.id, buyer.id));

      await db.update(conversations)
        .set({ state: 'CLOSED_LOST', isActive: false, resolvedAt: new Date(), lastMessageAt: new Date() })
        .where(eq(conversations.id, conv.id));

      if (isWithin24HourWindow(conv.lastMessageAt)) {
        await this.sendAndRecord(conv, buyer.waPhone, 'Kamu telah berhenti. Untuk mulai lagi, chat kami kapan saja.');
      }
      return true;
    }

    // AGENT detection
    if (containsAny(text, AGENT_KEYWORDS)) {
      // Store previous state in metadata (conversations.metadata if present, else skip)
      await db.update(conversations)
        .set({ state: 'ESCALATED', lastMessageAt: new Date() })
        .where(eq(conversations.id, conv.id));

      if (isWithin24HourWindow(conv.lastMessageAt)) {
        await this.sendAndRecord(conv, buyer.waPhone, 'Menghubungkan ke tim kami... ⏳');
      }

      // Operator dashboard shows ESCALATED conversations — no additional push notification configured yet

      return true;
    }

    return false;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Location share
  // ─────────────────────────────────────────────────────────────────────────────

  async handleLocationShare(conv: ConvRow, location: { latitude: number; longitude: number; name?: string; address?: string } | undefined): Promise<void> {
    if (!location) return;
    if (!conv.buyerId) return; // buyer was deleted; can't look up or message them
    const validStates: ConversationStateValue[] = ['ADDRESS_COLLECTION', 'CHECKOUT_INTENT', 'LOCATION_RECEIVED'];
    if (!validStates.includes(conv.state as ConversationStateValue)) return;

    const result = await this.shippingService.processLocationShare(conv.id, location);

    const within24h = isWithin24HourWindow(conv.lastMessageAt);

    if (result.status === 'success') {
      await this.transitionState(conv.id, 'SHIPPING_CALC');
      const refreshed = await db.query.conversations.findFirst({ where: eq(conversations.id, conv.id) });
      const buyer = await db.query.buyers.findFirst({ where: eq(buyers.id, conv.buyerId) });
      if (refreshed && buyer) {
        await this.checkoutService.presentShippingOptions(refreshed, buyer);
      }
    } else if (result.status === 'city_not_found') {
      await this.transitionState(conv.id, 'LOCATION_RECEIVED');
      if (within24h) {
        const buyerRow = await db.query.buyers.findFirst({ where: eq(buyers.id, conv.buyerId) });
        if (buyerRow) {
          await this.sendAndRecord(
            conv,
            buyerRow.waPhone,
            `Lokasi diterima! Tapi nama kota *${result.rawAddress ?? ''}* tidak ditemukan di database ongkir. ` +
            'Bisa konfirmasi nama kota / kabupaten kamu? (contoh: Jakarta Selatan, Bandung)',
          );
        }
      }
    } else {
      // geocode_failed
      if (within24h) {
        const buyerRow = await db.query.buyers.findFirst({ where: eq(buyers.id, conv.buyerId) });
        if (buyerRow) {
          await this.sendAndRecord(conv, buyerRow.waPhone, 'Maaf, tidak bisa membaca lokasi kamu. Bisa ketik alamat lengkap? (nama jalan, kelurahan, kota)');
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // State dispatch table
  // ─────────────────────────────────────────────────────────────────────────────

  async routeByState(conv: ConvRow, buyer: BuyerRow, payload: MetaNormalizedPayload): Promise<void> {
    const handlers: Record<ConversationStateValue, () => Promise<void>> = {
      INIT:                   () => this.handleInit(conv, buyer, payload),
      GREETING:               () => this.handleGreeting(conv, buyer, payload),
      BROWSING:               () => this.handleBrowsing(conv, buyer, payload),
      PRODUCT_INQUIRY:        () => this.handleProductInquiry(conv, buyer, payload),
      OBJECTION_HANDLING:     () => this.handleObjection(conv, buyer, payload),
      CHECKOUT_INTENT:        () => this.checkoutService.beginCheckout(conv, buyer),
      STOCK_CHECK:            () => this.checkoutService.beginCheckout(conv, buyer),
      ADDRESS_COLLECTION:     () => this.checkoutService.collectAddress(conv, buyer, payload),
      LOCATION_RECEIVED:      () => this.checkoutService.collectAddress(conv, buyer, payload),
      SHIPPING_CALC:          () => this.checkoutService.presentShippingOptions(conv, buyer),
      PAYMENT_METHOD_SELECT:  () => this.handlePaymentMethodSelect(conv, buyer, payload),
      INVOICE_GENERATION:     () => Promise.resolve(),
      AWAITING_PAYMENT:       () => this.handleAwaitingPayment(conv, buyer, payload),
      PAYMENT_EXPIRED:        () => this.handlePaymentExpired(conv, buyer, payload),
      PAYMENT_CONFIRMED:      () => Promise.resolve(),
      ORDER_PROCESSING:       () => this.handleOrderProcessing(conv, buyer, payload),
      OUT_OF_STOCK:           () => this.handleOutOfStock(conv, buyer, payload),
      SHIPPED:                () => Promise.resolve(),
      TRACKING:               () => Promise.resolve(),
      DELIVERED:              () => Promise.resolve(),
      COMPLETED:              () => Promise.resolve(),
      ESCALATED:              () => Promise.resolve(), // AI is silent — human has taken over
      CLOSED_LOST:            () => Promise.resolve(), // ignore all messages
      // Scheduling states
      SCHEDULING:             () => this.handleScheduling(conv, buyer, payload),
      SCHEDULING_CONFIRMED:   () => Promise.resolve(), // staff confirmation pending
      SCHEDULING_CANCELLED:   () => this.handleBrowsing(conv, buyer, payload), // allow re-booking
    };

    const handler = handlers[conv.state as ConversationStateValue];
    if (handler) await handler();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Individual state handlers
  // ─────────────────────────────────────────────────────────────────────────────

  private async handleInit(conv: ConvRow, buyer: BuyerRow, payload: MetaNormalizedPayload): Promise<void> {
    const text = extractText(payload);
    const lang = this.detectLanguage(text);

    await db.update(conversations)
      .set({ language: lang, state: 'GREETING' })
      .where(eq(conversations.id, conv.id));

    const updatedConv = { ...conv, language: lang, state: 'GREETING' as const };
    await this.handleGreeting(updatedConv, buyer, payload);
  }

  private async handleGreeting(conv: ConvRow, buyer: BuyerRow, payload: MetaNormalizedPayload): Promise<void> {
    const userMessage = extractText(payload);
    await this.sendAiResponse(conv, buyer, userMessage);
    await this.transitionState(conv.id, 'BROWSING');
  }

  private async handleBrowsing(conv: ConvRow, buyer: BuyerRow, payload: MetaNormalizedPayload): Promise<void> {
    const text = extractText(payload);

    // Booking intent check before buy intent — scheduling takes priority
    if (text && detectBookingIntent(text)) {
      await this.transitionState(conv.id, 'SCHEDULING');
      await this.handleScheduling({ ...conv, state: 'SCHEDULING' }, buyer, payload);
      return;
    }

    if (detectBuyIntent(text, conv.language as 'id' | 'en')) {
      await this.transitionState(conv.id, 'CHECKOUT_INTENT');
      await this.checkoutService.beginCheckout({ ...conv, state: 'CHECKOUT_INTENT' }, buyer);
      return;
    }

    // Load the bot's last message so the classifier can recognise context-dependent
    // scheduling replies (e.g. "Selasa jam 14:00" after the bot offered a consultation).
    const lastBotMsg = await db.query.messages.findFirst({
      where: and(eq(messages.conversationId, conv.id), eq(messages.direction, 'outbound')),
      orderBy: (m, { desc }) => desc(m.createdAt),
    });
    const lastBotMessage = lastBotMsg?.textContent ?? undefined;

    // RAG + LLM intent classification run in parallel — classification adds zero latency.
    // classifyMessageIntent loads store/product name from DB so it can correctly
    // distinguish brand questions ("What is Storytellers?") from product questions ("What is Aria?").
    const [ragContext, classifiedIntent] = await Promise.all([
      ragQuery(conv.tenantId, text).catch((): string => ''),
      classifyMessageIntent(text, conv.tenantId, lastBotMessage).catch((): MessageIntent => 'BROWSING'),
    ]);

    // Scheduling intent: skip RAG response entirely — route straight to the
    // scheduling handler so the SCHEDULING_SYSTEM_PROMPT is used (no Glow Pro
    // contamination from unrelated RAG chunks).
    if (classifiedIntent === 'SCHEDULING') {
      await this.transitionState(conv.id, 'SCHEDULING');
      await this.handleScheduling({ ...conv, state: 'SCHEDULING' }, buyer, payload);
      return;
    }

    // Transition state before responding so the correct state overlay is included
    if (classifiedIntent === 'PRODUCT_INQUIRY') {
      await this.transitionState(conv.id, 'PRODUCT_INQUIRY');
    }

    // Pass classified intent as override so sendAiResponse injects the right playbook block
    // (e.g. GENERAL_INQUIRY gets its own playbook even though state stays BROWSING)
    await this.sendAiResponse(conv, buyer, text, ragContext || undefined, classifiedIntent);
  }

  private async handleProductInquiry(conv: ConvRow, buyer: BuyerRow, payload: MetaNormalizedPayload): Promise<void> {
    const text = extractText(payload);

    // Booking intent intercept — also fires from product inquiry
    if (text && detectBookingIntent(text)) {
      await this.transitionState(conv.id, 'SCHEDULING');
      await this.handleScheduling({ ...conv, state: 'SCHEDULING' }, buyer, payload);
      return;
    }

    if (detectBuyIntent(text)) {
      await this.transitionState(conv.id, 'CHECKOUT_INTENT');
      await this.checkoutService.beginCheckout({ ...conv, state: 'CHECKOUT_INTENT' }, buyer);
      return;
    }

    if (detectObjection(text)) {
      await this.transitionState(conv.id, 'OBJECTION_HANDLING');
      await this.handleObjection({ ...conv, state: 'OBJECTION_HANDLING' }, buyer, payload);
      return;
    }

    // Load the bot's last message for scheduling context detection
    const lastBotMsg = await db.query.messages.findFirst({
      where: and(eq(messages.conversationId, conv.id), eq(messages.direction, 'outbound')),
      orderBy: (m, { desc }) => desc(m.createdAt),
    });
    const lastBotMessage = lastBotMsg?.textContent ?? undefined;

    // RAG + classification in parallel
    const [ragContext, classifiedIntent] = await Promise.all([
      ragQuery(conv.tenantId, text).catch((): string => ''),
      classifyMessageIntent(text, conv.tenantId, lastBotMessage).catch((): MessageIntent => 'PRODUCT_INQUIRY'),
    ]);

    // Scheduling reply from product inquiry: same bypass — route to scheduling handler
    // so SCHEDULING_SYSTEM_PROMPT is used exclusively (no RAG contamination).
    if (classifiedIntent === 'SCHEDULING') {
      await this.transitionState(conv.id, 'SCHEDULING');
      await this.handleScheduling({ ...conv, state: 'SCHEDULING' }, buyer, payload);
      return;
    }

    // If the user has moved away from a product question (e.g. asking about the
    // brand or making small talk), transition back to BROWSING so the state label
    // and future routing stay accurate.
    if (classifiedIntent === 'GENERAL_INQUIRY' || classifiedIntent === 'BROWSING') {
      await this.transitionState(conv.id, 'BROWSING');
    }

    await this.sendAiResponse(conv, buyer, text, ragContext || undefined, classifiedIntent);
  }

  private async handleObjection(conv: ConvRow, buyer: BuyerRow, payload: MetaNormalizedPayload): Promise<void> {
    const text = extractText(payload);

    if (detectBuyIntent(text)) {
      await this.transitionState(conv.id, 'CHECKOUT_INTENT');
      await this.checkoutService.beginCheckout({ ...conv, state: 'CHECKOUT_INTENT' }, buyer);
      return;
    }

    if (detectDisengagement(text)) {
      await this.transitionState(conv.id, 'CLOSED_LOST');
      await db.update(conversations)
        .set({ isActive: false, resolvedAt: new Date() })
        .where(eq(conversations.id, conv.id));
      return;
    }

    await this.sendAiResponse(conv, buyer, text);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SCHEDULING state handler
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Handles the SCHEDULING conversation state.
   *
   * Conversation flow:
   *   1. Buyer sends booking intent keyword → state transitions to SCHEDULING
   *   2. This handler sends the buyer message to the LLM with SCHEDULING_SYSTEM_PROMPT
   *   3. LLM either replies with plain text (asks clarifying questions) OR a JSON envelope
   *   4. If JSON envelope: handleLLMEnvelope executes it (availability check / booking)
   *   5. On confirm_booking: state transitions to SCHEDULING_CONFIRMED
   *
   * The LLM is capped at MAX_SCHEDULING_ROUNDS negotiation rounds per PRD §3.5.
   */
  private async handleScheduling(conv: ConvRow, buyer: BuyerRow, payload: MetaNormalizedPayload): Promise<void> {
    const text = extractText(payload) ?? '';
    const llm = getLLMClient();

    // Build conversation history for the scheduling LLM (last 10 messages for context)
    const recentMessages = await db.query.messages.findMany({
      where: and(
        eq(messages.conversationId, conv.id),
      ),
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

    // Append the current user message if not already in history
    if (!history.length || history[history.length - 1].role !== 'user') {
      history.push({ role: 'user', content: text });
    }

    // Fetch the SCHEDULING playbook config — may contain assignedStaffId for confirmation routing
    const intentSvc = new IntentPlaybookService();
    const schedulingPlaybook = await intentSvc.getPlaybookBlock(conv.tenantId, 'SCHEDULING').catch(() => ({ nextStepConfig: null }));
    const assignedStaffId = (schedulingPlaybook.nextStepConfig as Record<string, string> | null)?.assignedStaffId ?? undefined;

    // Fetch active services so the LLM uses exact names instead of guessing
    const allServices = await this.schedulingService.listServices(conv.tenantId);
    const activeServices = allServices.filter(s => s.isActive);

    if (activeServices.length === 0) {
      await this.sendAndRecord(conv, buyer.waPhone,
        'Maaf, saat ini sistem booking belum tersedia. Silakan hubungi kami langsung untuk membuat janji. 🙏',
      );
      return;
    }

    const serviceList = activeServices.map(s => `- ${s.name}`).join('\n');
    const systemPrompt = `${SCHEDULING_SYSTEM_PROMPT}\n\nLAYANAN TERSEDIA (gunakan nama persis ini di service_name):\n${serviceList}`;

    try {
      const llmResponse = await llm.chat([
        { role: 'system', content: systemPrompt },
        ...history,
      ]);

      const responseText = llmResponse.content.trim();

      // Try parsing as envelope first
      const envelope = parseSchedulingEnvelope(responseText);
      if (envelope) {
        const replyText = await this.schedulingService.handleLLMEnvelope(
          conv.tenantId,
          { id: conv.id, state: conv.state },
          { id: buyer.id, displayName: buyer.displayName, waPhone: buyer.waPhone },
          envelope,
          assignedStaffId,
        );

        // Send the human-readable result to the buyer
        await this.sendAndRecord(conv, buyer.waPhone, replyText);

        // Transition to SCHEDULING_CONFIRMED after a confirm_booking envelope
        if (envelope.action === 'confirm_booking') {
          await this.transitionState(conv.id, 'SCHEDULING_CONFIRMED');
        }
      } else {
        // Plain text — send directly
        await this.sendAndRecord(conv, buyer.waPhone, responseText);
      }
    } catch (err) {
      // LLM failed — send graceful fallback
      await this.sendAndRecord(
        conv,
        buyer.waPhone,
        'Maaf, ada gangguan teknis. Silakan coba lagi atau hubungi kami langsung.',
      );
      throw err; // Re-throw so the outer error handler can log it
    }
  }

  private async handlePaymentMethodSelect(conv: ConvRow, buyer: BuyerRow, payload: MetaNormalizedPayload): Promise<void> {
    const selected = await this.checkoutService.selectPaymentMethod(conv, buyer, payload);
    if (selected && conv.productId) {
      // Trigger invoice creation via PaymentService
      const product = await db.query.products.findFirst({ where: eq(products.id, conv.productId) });
      const refreshedConv = await db.query.conversations.findFirst({ where: eq(conversations.id, conv.id) });
      if (product && refreshedConv?.selectedCourier) {
        await this.paymentService.createInvoice(
          refreshedConv,
          buyer,
          product,
          refreshedConv.selectedCourier,
        );
      }
    }
  }

  private async handleAwaitingPayment(conv: ConvRow, buyer: BuyerRow, payload: MetaNormalizedPayload): Promise<void> {
    const text = extractText(payload);
    await this.sendAiResponse(conv, buyer, text);
  }

  private async handlePaymentExpired(conv: ConvRow, buyer: BuyerRow, payload: MetaNormalizedPayload): Promise<void> {
    const text = extractText(payload).toLowerCase();

    const yesKeywords = ['ya', 'yes', 'iya', 'ok', 'oke', 'yep', 'yup', 'mau'];
    const noKeywords = ['tidak', 'no', 'nggak', 'gak', 'ga', 'gak jadi', 'ga jadi', 'cancel', 'batal'];

    if (containsAny(text, yesKeywords)) {
      // Re-enqueue invoice creation
      await this.transitionState(conv.id, 'INVOICE_GENERATION');
      if (conv.productId) {
        const product = await db.query.products.findFirst({ where: eq(products.id, conv.productId) });
        if (product && conv.selectedCourier) {
          await this.paymentService.createInvoice(conv, buyer, product, conv.selectedCourier);
        }
      }
    } else if (containsAny(text, noKeywords)) {
      await this.transitionState(conv.id, 'CLOSED_LOST');
      await db.update(conversations)
        .set({ isActive: false, resolvedAt: new Date() })
        .where(eq(conversations.id, conv.id));
    }
    // Otherwise: no response needed — template already sent
  }

  private async handleOrderProcessing(conv: ConvRow, buyer: BuyerRow, payload: MetaNormalizedPayload): Promise<void> {
    const text = extractText(payload);
    // Respond to general queries and explain awaiting shipment
    const context = 'Pesanan sedang diproses dan menunggu pengiriman. Estimasi 1-2 hari kerja.';
    await this.sendAiResponse(conv, buyer, text, context);
  }

  private async handleOutOfStock(conv: ConvRow, buyer: BuyerRow, payload: MetaNormalizedPayload): Promise<void> {
    const text = extractText(payload).toLowerCase();
    const yesKeywords = ['ya', 'yes', 'iya', 'ok', 'oke', 'mau', 'daftar', 'waitlist'];

    if (containsAny(text, yesKeywords) && conv.productId) {
      // Create waitlist entry
      await db.insert(waitlist).values({
        productId: conv.productId,
        tenantId: conv.tenantId,
        buyerId: buyer.id,
        waPhone: buyer.waPhone,
        buyerName: buyer.displayName,
        quantityRequested: 1,
        isNotified: false,
        createdAt: new Date(),
      }).onConflictDoNothing();

      if (isWithin24HourWindow(conv.lastMessageAt)) {
        await this.sendAndRecord(conv, buyer.waPhone, 'Oke, sudah masuk waitlist! Kami akan langsung kabari kalau stok sudah tersedia 😊');
      }
    } else {
      await this.sendAiResponse(conv, buyer, text);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // AI response helper
  // ─────────────────────────────────────────────────────────────────────────────

  async sendAiResponse(
    conv: ConvRow,
    buyer: BuyerRow,
    userMessage: string,
    additionalContext?: string,
    /** LLM-classified intent — overrides conv.state for playbook lookup when provided */
    intentOverride?: MessageIntent,
  ): Promise<void> {
    const within24h = isWithin24HourWindow(conv.lastMessageAt);
    if (!within24h) return; // Can't send freeform outside window

    // Load tenant + product for context
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, conv.tenantId) });
    const product = conv.productId
      ? await db.query.products.findFirst({ where: eq(products.id, conv.productId) })
      : null;

    // Load intent playbook — use LLM-classified intent when available so the right
    // playbook fires even if conv.state hasn't transitioned yet (e.g. GENERAL_INQUIRY
    // playbook loads while state is still BROWSING).
    const intentSvc = new IntentPlaybookService();
    const playbookLookupKey = intentOverride ?? conv.state;
    const playbookResult = await intentSvc.getPlaybookBlock(conv.tenantId, playbookLookupKey).catch(() => ({ block: '', nextStepType: 'continue_conversation' as const, nextStepConfig: null, fallbackMessage: null }));

    const systemPrompt = buildSystemPrompt({
      storeName: tenant?.storeName ?? 'LynkBot Store',
      productName: product?.name,
      bookPersonaPrompt: product?.bookPersonaPrompt,
      language: (conv.language as 'id' | 'en') ?? 'id',
      playbookContext: playbookResult.block || undefined,
    });

    const stateOverlay = STATE_PROMPTS[conv.state as ConversationStateValue] ?? '';
    const contextBlock = additionalContext
      ? `\n\nPRODUCT KNOWLEDGE (retrieved from training material — use this to answer questions accurately; do NOT say you don't have information if the answer is in this context):\n${additionalContext}`
      : '';

    // ── Pantheon V2: classify moment + inject dialog recommendation ────────────
    let pantheonBlock = '';
    try {
      const genomeRow = await db.query.buyerGenomes.findFirst({
        where: and(eq(buyerGenomes.buyerId, buyer.id), eq(buyerGenomes.tenantId, conv.tenantId)),
      });

      const genome = genomeRow
        ? {
            buyerId: buyer.id,
            tenantId: conv.tenantId,
            confidence: genomeRow.confidence as 'HIGH' | 'MEDIUM' | 'LOW',
            observationCount: genomeRow.observationCount,
            formationInvariants: (genomeRow.formationInvariants as string[]) ?? [],
            lastUpdatedAt: genomeRow.updatedAt,
            scores: {
              openness: genomeRow.openness,
              conscientiousness: genomeRow.conscientiousness,
              extraversion: genomeRow.extraversion,
              agreeableness: genomeRow.agreeableness,
              neuroticism: genomeRow.neuroticism,
              communicationStyle: genomeRow.communicationStyle,
              decisionMaking: genomeRow.decisionMaking,
              brandRelationship: genomeRow.brandRelationship,
              influenceSusceptibility: genomeRow.influenceSusceptibility,
              emotionalExpression: genomeRow.emotionalExpression,
              conflictBehavior: genomeRow.conflictBehavior,
              literacyArticulation: genomeRow.literacyArticulation,
              socioeconomicFriction: genomeRow.socioeconomicFriction,
              identityFusion: genomeRow.identityFusion,
              chronesthesiaCapacity: genomeRow.chronesthesiaCapacity,
              tomSelfAwareness: genomeRow.tomSelfAwareness,
              tomSocialModeling: genomeRow.tomSocialModeling,
              executiveFlexibility: genomeRow.executiveFlexibility,
            },
          }
        : defaultGenome(buyer.id, conv.tenantId);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cache = (genomeRow?.dialogCache as any) ?? buildFallbackCache((conv.language ?? 'id') as 'id' | 'en');

      // Last 5 inbound messages for moment context
      const recentMsgs = await db.query.messages.findMany({
        where: and(eq(messages.conversationId, conv.id), eq(messages.direction, 'inbound')),
        orderBy: (m, { desc }) => desc(m.createdAt),
        limit: 5,
      });
      const recentTexts = recentMsgs.map(m => m.textContent ?? '').filter(Boolean).reverse();

      const classification = classifyMoment(userMessage, recentTexts);
      const rwi = computeRWI(conv.messageCount ?? 1, [classification.momentType], Date.now());
      const selection = selectDialog(cache, classification.momentType, genome, rwi);

      pantheonBlock =
        `\n\nPANTHEON V2 DIALOG RECOMMENDATION:\n` +
        `Moment type: ${classification.momentType} (confidence: ${Math.round(classification.confidence * 100)}%)\n` +
        `Recommended approach: "${selection.recommendedText}"\n` +
        `Reasoning: ${selection.reasoning}\n` +
        `RWI: ${rwi.score}/100 (window: ${rwi.windowStatus})\n` +
        `Buyer intelligence confidence: ${genome.confidence}\n` +
        `IMPORTANT: Use this recommendation as inspiration. Adapt naturally — do not quote verbatim.`;
    } catch {
      // Pantheon unavailable — proceed without recommendation
    }
    // ────────────────────────────────────────────────────────────────────────────

    const fullSystem = systemPrompt + stateOverlay + contextBlock + pantheonBlock;

    const llm = getLLMClient();
    const start = Date.now();

    let aiText = '';
    try {
      const response = await llm.chat(
        [{ role: 'user', content: userMessage }],
        { system: fullSystem },
      );
      aiText = response.content;
    } catch (err) {
      aiText = conv.language === 'id'
        ? 'Maaf, ada gangguan sebentar. Bisa coba lagi? 🙏'
        : 'Sorry, I encountered a brief issue. Please try again 🙏';
    }

    const latencyMs = Date.now() - start;

    // Append escape hint every 3rd message
    if (conv.messageCount % 3 === 0) {
      aiText += conv.language === 'id'
        ? '\n\n_(Ketik STOP untuk berhenti, atau AGENT untuk bicara dengan tim kami)_'
        : '\n\n_(Type STOP to unsubscribe, or AGENT to talk to our team)_';
    }

    const meta = await this.getMetaClient(conv.tenantId);
    await meta.sendText({
      to: buyer.waPhone,
      message: aiText,
      isWithin24hrWindow: true,
    });

    // Record outbound message + bump lastMessageAt so the conversation surfaces
    // at the top of the dashboard list after the bot replies.
    try {
      await db.insert(messages).values({
        conversationId: conv.id,
        tenantId: conv.tenantId,
        direction: 'outbound',
        messageType: 'text',
        textContent: aiText,
        latencyMs,
        createdAt: new Date(),
      });
      await db.update(conversations)
        .set({ lastMessageAt: new Date() })
        .where(eq(conversations.id, conv.id));
    } catch (saveErr) {
      // Non-fatal — message was sent to WA; log so Railway surfaces any schema issues.
      console.error('[sendAiResponse] Failed to persist outbound message to DB:', saveErr);
    }

    // If the active playbook step expects the buyer to pick a schedule next,
    // pre-transition to SCHEDULING so the buyer's NEXT message (e.g. "Selasa jam 14:00")
    // lands directly in handleScheduling rather than going through BROWSING/RAG.
    if (playbookResult.nextStepType === 'schedule_consultation') {
      await this.transitionState(conv.id, 'SCHEDULING');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Send + persist helper — use this instead of bare meta.sendText() so every
  // outbound message appears in the dashboard conversation thread.
  // ─────────────────────────────────────────────────────────────────────────────

  private async sendAndRecord(
    conv: ConvRow,
    waPhone: string,
    text: string,
  ): Promise<void> {
    const meta = await this.getMetaClient(conv.tenantId).catch(() => null);
    if (!meta) return;
    await meta.sendText({ to: waPhone, message: text, isWithin24hrWindow: true }).catch(() => null);
    try {
      await db.insert(messages).values({
        conversationId: conv.id,
        tenantId: conv.tenantId,
        direction: 'outbound',
        messageType: 'text',
        textContent: text,
        createdAt: new Date(),
      });
      await db.update(conversations)
        .set({ lastMessageAt: new Date() })
        .where(eq(conversations.id, conv.id));
    } catch (err) {
      console.error('[sendAndRecord] Failed to persist outbound message:', err);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  detectLanguage(text: string): 'id' | 'en' {
    const indonesianIndicators = [
      'halo', 'hai', 'apa', 'yang', 'ini', 'itu', 'dan', 'atau', 'saya',
      'aku', 'kamu', 'bisa', 'mau', 'ada', 'tidak', 'ya', 'dong', 'kak',
      'gimana', 'bagaimana', 'berapa', 'siapa', 'kapan', 'dimana',
    ];
    const lower = text.toLowerCase();
    const matches = indonesianIndicators.filter(kw => lower.includes(kw));
    return matches.length >= 1 ? 'id' : 'en';
  }

  async transitionState(convId: string, newState: ConversationStateValue): Promise<void> {
    await db.update(conversations)
      .set({ state: newState, lastMessageAt: new Date() })
      .where(eq(conversations.id, convId));
  }

  async isDuplicate(messageId: string): Promise<boolean> {
    if (!messageId) return false;
    const existing = await db.query.messages.findFirst({
      where: eq(messages.watiMessageId, messageId),
    });
    return !!existing;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Pantheon: background genome update (fire-and-forget)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Fire-and-forget genome updater. Incremental — only processes messages
   * newer than lastSignalExtractedAt. First-time call seeds from cultural priors.
   */
  private async updateGenomeAsync(buyerId: string, tenantId: string, conversationId: string): Promise<void> {
    // Load existing genome to get the cutoff timestamp
    const existing = await db.query.buyerGenomes.findFirst({
      where: and(eq(buyerGenomes.buyerId, buyerId), eq(buyerGenomes.tenantId, tenantId)),
    });

    const cutoff: Date = existing?.lastSignalExtractedAt ?? new Date(0);
    const now = new Date();

    // Only fetch inbound messages NEWER than the last extraction
    const newMsgs = await db.query.messages.findMany({
      where: and(
        eq(messages.conversationId, conversationId),
        eq(messages.direction, 'inbound'),
        gt(messages.createdAt, cutoff),
      ),
      orderBy: (m, { asc }) => asc(m.createdAt),
      limit: 50,
    });

    // Nothing new since last run — leave genome unchanged
    if (newMsgs.length === 0) return;

    const msgTexts = newMsgs.map(m => m.textContent ?? '').filter(Boolean);
    if (msgTexts.length === 0) return;

    const msgTimestamps = newMsgs.map(m => m.createdAt.getTime());
    const signals = extractSignals(msgTexts, msgTimestamps);
    if (signals.messageCount === 0) return;

    const newScores = deriveScores(signals);
    const batchConfidence = scoreConfidence(signals.messageCount);
    const adjustedScores = applyConfidencePenalty(newScores, batchConfidence);

    let finalScores: GenomeScores;
    let observationCount: number;

    if (existing) {
      // Incremental: EMA-merge new signal deltas on top of current genome
      const existingScores: GenomeScores = {
        openness: existing.openness,
        conscientiousness: existing.conscientiousness,
        extraversion: existing.extraversion,
        agreeableness: existing.agreeableness,
        neuroticism: existing.neuroticism,
        communicationStyle: existing.communicationStyle,
        decisionMaking: existing.decisionMaking,
        brandRelationship: existing.brandRelationship,
        influenceSusceptibility: existing.influenceSusceptibility,
        emotionalExpression: existing.emotionalExpression,
        conflictBehavior: existing.conflictBehavior,
        literacyArticulation: existing.literacyArticulation,
        socioeconomicFriction: existing.socioeconomicFriction,
        identityFusion: existing.identityFusion,
        chronesthesiaCapacity: existing.chronesthesiaCapacity,
        tomSelfAwareness: existing.tomSelfAwareness,
        tomSocialModeling: existing.tomSocialModeling,
        executiveFlexibility: existing.executiveFlexibility,
      };
      finalScores = mergeScores(existingScores, adjustedScores);
      observationCount = existing.observationCount + signals.messageCount;
    } else {
      // First message(s) ever: seed culturally, then layer signal deltas
      const buyer = await db.query.buyers.findFirst({ where: eq(buyers.id, buyerId) });
      const seeded = buildSeededGenome(buyerId, tenantId, buyer?.waPhone ?? undefined);
      finalScores = mergeScores(seeded.scores, adjustedScores);
      observationCount = signals.messageCount;
    }

    const finalConfidence = scoreConfidence(observationCount);

    await db.insert(buyerGenomes).values({
      buyerId,
      tenantId,
      confidence: finalConfidence,
      observationCount,
      openness: finalScores.openness,
      conscientiousness: finalScores.conscientiousness,
      extraversion: finalScores.extraversion,
      agreeableness: finalScores.agreeableness,
      neuroticism: finalScores.neuroticism,
      communicationStyle: finalScores.communicationStyle,
      decisionMaking: finalScores.decisionMaking,
      brandRelationship: finalScores.brandRelationship,
      influenceSusceptibility: finalScores.influenceSusceptibility,
      emotionalExpression: finalScores.emotionalExpression,
      conflictBehavior: finalScores.conflictBehavior,
      literacyArticulation: finalScores.literacyArticulation,
      socioeconomicFriction: finalScores.socioeconomicFriction,
      identityFusion: finalScores.identityFusion,
      chronesthesiaCapacity: finalScores.chronesthesiaCapacity,
      tomSelfAwareness: finalScores.tomSelfAwareness,
      tomSocialModeling: finalScores.tomSocialModeling,
      executiveFlexibility: finalScores.executiveFlexibility,
      formationInvariants: [],
      lastSignalExtractedAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [buyerGenomes.buyerId, buyerGenomes.tenantId],
      set: {
        confidence: finalConfidence,
        observationCount,
        openness: finalScores.openness,
        conscientiousness: finalScores.conscientiousness,
        extraversion: finalScores.extraversion,
        agreeableness: finalScores.agreeableness,
        neuroticism: finalScores.neuroticism,
        communicationStyle: finalScores.communicationStyle,
        decisionMaking: finalScores.decisionMaking,
        brandRelationship: finalScores.brandRelationship,
        influenceSusceptibility: finalScores.influenceSusceptibility,
        emotionalExpression: finalScores.emotionalExpression,
        conflictBehavior: finalScores.conflictBehavior,
        literacyArticulation: finalScores.literacyArticulation,
        socioeconomicFriction: finalScores.socioeconomicFriction,
        identityFusion: finalScores.identityFusion,
        chronesthesiaCapacity: finalScores.chronesthesiaCapacity,
        tomSelfAwareness: finalScores.tomSelfAwareness,
        tomSocialModeling: finalScores.tomSocialModeling,
        executiveFlexibility: finalScores.executiveFlexibility,
        lastSignalExtractedAt: now,
        updatedAt: now,
      },
    });
  }
}
