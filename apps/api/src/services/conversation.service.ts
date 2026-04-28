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
import { db, conversations, messages, buyers, tenants, products, waitlist, buyerGenomes } from '@lynkbot/db';
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
} from '@lynkbot/ai';
import {
  MetaClient,
  extractText,
  extractMessageId,
  isLocationMessage,
  type MetaNormalizedPayload,
} from '@lynkbot/meta';
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
import { config } from '../config';
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

function detectProductQuestion(text: string): boolean {
  const indicators = ['apa', 'bagaimana', 'gimana', 'cara', 'isi', 'manfaat', 'benefit', '?', 'what', 'how', 'does', 'can'];
  return containsAny(text, indicators);
}

export class ConversationService {
  private checkoutService = new CheckoutService();
  private shippingService = new ShippingService();
  private notificationService = new NotificationService();
  private paymentService = new PaymentService();

  private getMetaClient(): MetaClient {
    return new MetaClient(config.META_ACCESS_TOKEN, config.META_PHONE_NUMBER_ID);
  }

  /**
   * Look up which tenant owns a given Meta phone_number_id.
   * The Meta webhook doesn't include a tenantId path param (unlike the old WATI
   * per-tenant webhook URL), so we look it up from the tenants table.
   */
  async resolveTenantByPhoneNumberId(phoneNumberId: string): Promise<string | null> {
    // Primary: find tenant with matching metaPhoneNumberId
    const tenant = await db.query.tenants.findFirst({
      where: (t, { eq }) => eq(t.metaPhoneNumberId, phoneNumberId),
    });
    if (tenant) return tenant.id;

    // Fallback: if incoming phoneNumberId matches the configured META_PHONE_NUMBER_ID,
    // find the first tenant without a phone number and stamp it (handles first-login case)
    if (config.META_PHONE_NUMBER_ID && phoneNumberId === config.META_PHONE_NUMBER_ID) {
      const unlinked = await db.query.tenants.findFirst({
        where: (t, { isNull }) => isNull(t.metaPhoneNumberId),
      });
      if (unlinked) {
        await db.update(tenants).set({
          metaPhoneNumberId: phoneNumberId,
          displayPhoneNumber: `+${phoneNumberId}`,
        }).where(eq(tenants.id, unlinked.id));
        return unlinked.id;
      }
    }

    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Public entry point
  // ─────────────────────────────────────────────────────────────────────────────

  async handleInbound(tenantId: string, payload: MetaNormalizedPayload): Promise<void> {
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
      // Existing conversation without a product — try to assign one now (handles pre-fix conversations)
      const defaultProduct = await db.query.products.findFirst({
        where: and(eq(products.tenantId, tenantId), eq(products.isActive, true), eq(products.knowledgeStatus, 'ready')),
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

    // Route to state handler
    await this.routeByState(conv, buyer, payload);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Global commands
  // ─────────────────────────────────────────────────────────────────────────────

  async handleGlobalCommands(conv: ConvRow, buyer: BuyerRow, payload: MetaNormalizedPayload): Promise<boolean> {
    const text = extractText(payload);
    if (!text) return false;

    // STOP detection
    if (containsAny(text, STOP_KEYWORDS)) {
      await db.update(buyers)
        .set({ doNotContact: true, updatedAt: new Date() })
        .where(eq(buyers.id, buyer.id));

      await db.update(conversations)
        .set({ state: 'CLOSED_LOST', isActive: false, resolvedAt: new Date(), lastMessageAt: new Date() })
        .where(eq(conversations.id, conv.id));

      const within24h = isWithin24HourWindow(conv.lastMessageAt);
      if (within24h) {
        const meta = this.getMetaClient();
        await meta.sendText({
          to: buyer.waPhone,
          message: 'Kamu telah berhenti. Untuk mulai lagi, chat kami kapan saja.',
          isWithin24hrWindow: true,
        }).catch(() => null);
      }
      return true;
    }

    // AGENT detection
    if (containsAny(text, AGENT_KEYWORDS)) {
      // Store previous state in metadata (conversations.metadata if present, else skip)
      await db.update(conversations)
        .set({ state: 'ESCALATED', lastMessageAt: new Date() })
        .where(eq(conversations.id, conv.id));

      const meta = this.getMetaClient();
      const within24h = isWithin24HourWindow(conv.lastMessageAt);
      if (within24h) {
        await meta.sendText({
          to: buyer.waPhone,
          message: 'Menghubungkan ke tim kami... ⏳',
          isWithin24hrWindow: true,
        }).catch(() => null);
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
    const validStates: ConversationStateValue[] = ['ADDRESS_COLLECTION', 'CHECKOUT_INTENT', 'LOCATION_RECEIVED'];
    if (!validStates.includes(conv.state as ConversationStateValue)) return;

    const result = await this.shippingService.processLocationShare(conv.id, location);

    const meta = this.getMetaClient();
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
        await meta.sendText({
          to: (await db.query.buyers.findFirst({ where: eq(buyers.id, conv.buyerId) }))?.waPhone ?? '',
          message:
            `Lokasi diterima! Tapi nama kota *${result.rawAddress ?? ''}* tidak ditemukan di database ongkir. ` +
            'Bisa konfirmasi nama kota / kabupaten kamu? (contoh: Jakarta Selatan, Bandung)',
          isWithin24hrWindow: true,
        }).catch(() => null);
      }
    } else {
      // geocode_failed
      if (within24h) {
        const buyerRow = await db.query.buyers.findFirst({ where: eq(buyers.id, conv.buyerId) });
        await meta.sendText({
          to: buyerRow?.waPhone ?? '',
          message: 'Maaf, tidak bisa membaca lokasi kamu. Bisa ketik alamat lengkap? (nama jalan, kelurahan, kota)',
          isWithin24hrWindow: true,
        }).catch(() => null);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // State dispatch table
  // ─────────────────────────────────────────────────────────────────────────────

  async routeByState(conv: ConvRow, buyer: BuyerRow, payload: MetaNormalizedPayload): Promise<void> {
    const handlers: Record<ConversationStateValue, () => Promise<void>> = {
      INIT:                  () => this.handleInit(conv, buyer, payload),
      GREETING:              () => this.handleGreeting(conv, buyer, payload),
      BROWSING:              () => this.handleBrowsing(conv, buyer, payload),
      PRODUCT_INQUIRY:       () => this.handleProductInquiry(conv, buyer, payload),
      OBJECTION_HANDLING:    () => this.handleObjection(conv, buyer, payload),
      CHECKOUT_INTENT:       () => this.checkoutService.beginCheckout(conv, buyer),
      STOCK_CHECK:           () => this.checkoutService.beginCheckout(conv, buyer),
      ADDRESS_COLLECTION:    () => this.checkoutService.collectAddress(conv, buyer, payload),
      LOCATION_RECEIVED:     () => this.checkoutService.collectAddress(conv, buyer, payload),
      SHIPPING_CALC:         () => this.checkoutService.presentShippingOptions(conv, buyer),
      PAYMENT_METHOD_SELECT: () => this.handlePaymentMethodSelect(conv, buyer, payload),
      INVOICE_GENERATION:    () => Promise.resolve(),
      AWAITING_PAYMENT:      () => this.handleAwaitingPayment(conv, buyer, payload),
      PAYMENT_EXPIRED:       () => this.handlePaymentExpired(conv, buyer, payload),
      PAYMENT_CONFIRMED:     () => Promise.resolve(),
      ORDER_PROCESSING:      () => this.handleOrderProcessing(conv, buyer, payload),
      OUT_OF_STOCK:          () => this.handleOutOfStock(conv, buyer, payload),
      SHIPPED:               () => Promise.resolve(),
      TRACKING:              () => Promise.resolve(),
      DELIVERED:             () => Promise.resolve(),
      COMPLETED:             () => Promise.resolve(),
      ESCALATED:             () => Promise.resolve(), // AI is silent — human has taken over
      CLOSED_LOST:           () => Promise.resolve(), // ignore all messages
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

    if (detectBuyIntent(text, conv.language as 'id' | 'en')) {
      await this.transitionState(conv.id, 'CHECKOUT_INTENT');
      await this.checkoutService.beginCheckout({ ...conv, state: 'CHECKOUT_INTENT' }, buyer);
      return;
    }

    // RAG context in BROWSING too — product questions land here before state transitions to PRODUCT_INQUIRY
    let ragContext = '';
    if (conv.productId) {
      try {
        ragContext = await ragQuery(conv.productId, conv.tenantId, text);
      } catch {
        // RAG unavailable — fall through to base AI
      }
    }

    await this.sendAiResponse(conv, buyer, text, ragContext || undefined);

    if (detectProductQuestion(text)) {
      await this.transitionState(conv.id, 'PRODUCT_INQUIRY');
    }
  }

  private async handleProductInquiry(conv: ConvRow, buyer: BuyerRow, payload: MetaNormalizedPayload): Promise<void> {
    const text = extractText(payload);

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

    // RAG context if product is set
    let ragContext = '';
    if (conv.productId) {
      try {
        ragContext = await ragQuery(conv.productId, conv.tenantId, text);
      } catch {
        // RAG unavailable — fall through to base AI
      }
    }

    await this.sendAiResponse(conv, buyer, text, ragContext || undefined);
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

      const meta = this.getMetaClient();
      const within24h = isWithin24HourWindow(conv.lastMessageAt);
      if (within24h) {
        await meta.sendText({
          to: buyer.waPhone,
          message: 'Oke, sudah masuk waitlist! Kami akan langsung kabari kalau stok sudah tersedia 😊',
          isWithin24hrWindow: true,
        }).catch(() => null);
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
  ): Promise<void> {
    const within24h = isWithin24HourWindow(conv.lastMessageAt);
    if (!within24h) return; // Can't send freeform outside window

    // Load tenant + product for context
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, conv.tenantId) });
    const product = conv.productId
      ? await db.query.products.findFirst({ where: eq(products.id, conv.productId) })
      : null;

    const systemPrompt = buildSystemPrompt({
      storeName: tenant?.storeName ?? 'LynkBot Store',
      productName: product?.name,
      bookPersonaPrompt: product?.bookPersonaPrompt,
      language: (conv.language as 'id' | 'en') ?? 'id',
    });

    const stateOverlay = STATE_PROMPTS[conv.state as ConversationStateValue] ?? '';
    const contextBlock = additionalContext
      ? `\n\nRELEVANT CONTEXT:\n${additionalContext}`
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

    const meta = this.getMetaClient();
    await meta.sendText({
      to: buyer.waPhone,
      message: aiText,
      isWithin24hrWindow: true,
    });

    // Record outbound message
    await db.insert(messages).values({
      conversationId: conv.id,
      tenantId: conv.tenantId,
      direction: 'outbound',
      messageType: 'text',
      textContent: aiText,
      latencyMs,
      createdAt: new Date(),
    }).catch(() => null);
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
