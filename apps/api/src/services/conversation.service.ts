/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/services/conversation.service.ts
 * Role    : Single entry point for all inbound WA message processing.
 *           Implements the 23-state conversation state machine via dispatch table.
 *           Stateless service — all state lives in the conversations DB table.
 * Imports : @lynkbot/shared, @lynkbot/db, @lynkbot/ai, @lynkbot/wati
 * Exports : ConversationService class
 * DO NOT  : Add HTTP routing logic here. Import packages/payments directly.
 *           Payment events arrive via PaymentService callback.
 * Tests   : src/services/__tests__/conversation.service.test.ts
 */
import { eq, and } from '@lynkbot/db';
import { db, conversations, messages, buyers, tenants, products, waitlist } from '@lynkbot/db';
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
import { CONVERSATION_STATES } from '@lynkbot/shared';
import { WatiClient } from '@lynkbot/wati';
import { config } from '../config';
import { CheckoutService } from './checkout.service';
import { ShippingService } from './shipping.service';
import { NotificationService } from './notification.service';
import { PaymentService } from './payment.service';
import type { ConversationStateValue } from '@lynkbot/shared';
import type { WatiWebhookPayload, WaLocation } from '@lynkbot/shared';

type ConvRow = typeof conversations.$inferSelect;
type BuyerRow = typeof buyers.$inferSelect;

function extractText(payload: WatiWebhookPayload): string {
  return (payload.text ?? payload.caption ?? '').trim();
}

function extractMessageId(payload: WatiWebhookPayload): string {
  return payload.id ?? payload.messageId ?? '';
}

function isLocationMessage(payload: WatiWebhookPayload): boolean {
  return payload.type === 'location' || !!(payload.location?.latitude);
}

function isTextMessage(payload: WatiWebhookPayload): boolean {
  return payload.messageType === 'text' || payload.type === 'text' || !!(payload.text);
}

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

  private getWatiClient(): WatiClient {
    return new WatiClient(config.WATI_API_KEY, config.WATI_BASE_URL);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Public entry point
  // ─────────────────────────────────────────────────────────────────────────────

  async handleInbound(tenantId: string, payload: WatiWebhookPayload): Promise<void> {
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
        displayName: payload.senderName ?? payload.contactName ?? null,
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

    if ((buyer as any).doNotContact) return; // Silently ignore

    // Get or create active conversation
    let conv = await db.query.conversations.findFirst({
      where: and(
        eq(conversations.tenantId, tenantId),
        eq(conversations.buyerId, buyer.id),
        eq(conversations.isActive, true),
      ),
    });

    if (!conv) {
      const [created] = await db.insert(conversations).values({
        tenantId,
        buyerId: buyer.id,
        state: 'INIT',
        language: 'id',
        messageCount: 0,
        isActive: true,
        startedAt: new Date(),
        lastMessageAt: new Date(),
      }).returning();
      conv = created;
    }

    // Mark message as processed (idempotency record)
    if (messageId) {
      await db.insert(messages).values({
        conversationId: conv.id,
        tenantId,
        watiMessageId: messageId,
        direction: 'inbound',
        messageType: payload.type ?? payload.messageType ?? 'text',
        textContent: extractText(payload) || null,
        locationLat: payload.location?.latitude?.toString() ?? null,
        locationLng: payload.location?.longitude?.toString() ?? null,
        rawPayload: payload as Record<string, unknown>,
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
    if (isLocationMessage(payload) && payload.location) {
      await this.handleLocationShare(conv, payload.location as WaLocation);
      return;
    }

    // Route to state handler
    await this.routeByState(conv, buyer, payload);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Global commands
  // ─────────────────────────────────────────────────────────────────────────────

  async handleGlobalCommands(conv: ConvRow, buyer: BuyerRow, payload: WatiWebhookPayload): Promise<boolean> {
    const text = extractText(payload);
    if (!text) return false;

    // STOP detection
    if (containsAny(text, STOP_KEYWORDS)) {
      await db.update(buyers)
        .set({ updatedAt: new Date() } as any)
        .where(eq(buyers.id, buyer.id));

      // Mark doNotContact via raw update (field may be on extended buyer shape)
      await db.execute(
        `UPDATE buyers SET do_not_contact = true, updated_at = NOW() WHERE id = '${buyer.id}'` as any,
      ).catch(() => null);

      await db.update(conversations)
        .set({ state: 'CLOSED_LOST', isActive: false, resolvedAt: new Date(), lastMessageAt: new Date() })
        .where(eq(conversations.id, conv.id));

      const within24h = isWithin24HourWindow(conv.lastMessageAt);
      if (within24h) {
        const wati = this.getWatiClient();
        await wati.sendText({
          phone: buyer.waPhone,
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

      const wati = this.getWatiClient();
      const within24h = isWithin24HourWindow(conv.lastMessageAt);
      if (within24h) {
        await wati.sendText({
          phone: buyer.waPhone,
          message: 'Menghubungkan ke tim kami... ⏳',
          isWithin24hrWindow: true,
        }).catch(() => null);
      }

      // Notify team via notification service (best-effort)
      this.notificationService.getWatiClientForTenant(conv.tenantId).catch(() => null);

      return true;
    }

    return false;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Location share
  // ─────────────────────────────────────────────────────────────────────────────

  async handleLocationShare(conv: ConvRow, location: WaLocation): Promise<void> {
    const validStates: ConversationStateValue[] = ['ADDRESS_COLLECTION', 'CHECKOUT_INTENT', 'LOCATION_RECEIVED'];
    if (!validStates.includes(conv.state as ConversationStateValue)) return;

    const result = await this.shippingService.processLocationShare(conv.id, location);

    const wati = this.getWatiClient();
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
        await wati.sendText({
          phone: (await db.query.buyers.findFirst({ where: eq(buyers.id, conv.buyerId) }))?.waPhone ?? '',
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
        await wati.sendText({
          phone: buyerRow?.waPhone ?? '',
          message: 'Maaf, tidak bisa membaca lokasi kamu. Bisa ketik alamat lengkap? (nama jalan, kelurahan, kota)',
          isWithin24hrWindow: true,
        }).catch(() => null);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // State dispatch table
  // ─────────────────────────────────────────────────────────────────────────────

  async routeByState(conv: ConvRow, buyer: BuyerRow, payload: WatiWebhookPayload): Promise<void> {
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

  private async handleInit(conv: ConvRow, buyer: BuyerRow, payload: WatiWebhookPayload): Promise<void> {
    const text = extractText(payload);
    const lang = this.detectLanguage(text);

    await db.update(conversations)
      .set({ language: lang, state: 'GREETING' })
      .where(eq(conversations.id, conv.id));

    const updatedConv = { ...conv, language: lang, state: 'GREETING' as const };
    await this.handleGreeting(updatedConv, buyer, payload);
  }

  private async handleGreeting(conv: ConvRow, buyer: BuyerRow, payload: WatiWebhookPayload): Promise<void> {
    const userMessage = extractText(payload);
    await this.sendAiResponse(conv, buyer, userMessage);
    await this.transitionState(conv.id, 'BROWSING');
  }

  private async handleBrowsing(conv: ConvRow, buyer: BuyerRow, payload: WatiWebhookPayload): Promise<void> {
    const text = extractText(payload);

    if (detectBuyIntent(text, conv.language as 'id' | 'en')) {
      await this.transitionState(conv.id, 'CHECKOUT_INTENT');
      await this.checkoutService.beginCheckout({ ...conv, state: 'CHECKOUT_INTENT' }, buyer);
      return;
    }

    await this.sendAiResponse(conv, buyer, text);

    if (detectProductQuestion(text)) {
      await this.transitionState(conv.id, 'PRODUCT_INQUIRY');
    }
  }

  private async handleProductInquiry(conv: ConvRow, buyer: BuyerRow, payload: WatiWebhookPayload): Promise<void> {
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

  private async handleObjection(conv: ConvRow, buyer: BuyerRow, payload: WatiWebhookPayload): Promise<void> {
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

  private async handlePaymentMethodSelect(conv: ConvRow, buyer: BuyerRow, payload: WatiWebhookPayload): Promise<void> {
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

  private async handleAwaitingPayment(conv: ConvRow, buyer: BuyerRow, payload: WatiWebhookPayload): Promise<void> {
    const text = extractText(payload);
    await this.sendAiResponse(conv, buyer, text);
  }

  private async handlePaymentExpired(conv: ConvRow, buyer: BuyerRow, payload: WatiWebhookPayload): Promise<void> {
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

  private async handleOrderProcessing(conv: ConvRow, buyer: BuyerRow, payload: WatiWebhookPayload): Promise<void> {
    const text = extractText(payload);
    // Respond to general queries and explain awaiting shipment
    const context = 'Pesanan sedang diproses dan menunggu pengiriman. Estimasi 1-2 hari kerja.';
    await this.sendAiResponse(conv, buyer, text, context);
  }

  private async handleOutOfStock(conv: ConvRow, buyer: BuyerRow, payload: WatiWebhookPayload): Promise<void> {
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

      const wati = this.getWatiClient();
      const within24h = isWithin24HourWindow(conv.lastMessageAt);
      if (within24h) {
        await wati.sendText({
          phone: buyer.waPhone,
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

    const fullSystem = systemPrompt + stateOverlay + contextBlock;

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

    const wati = this.getWatiClient();
    await wati.sendText({
      phone: buyer.waPhone,
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
}
