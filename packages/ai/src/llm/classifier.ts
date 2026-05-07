/**
 * @CLAUDE_CONTEXT
 * Package : packages/ai
 * File    : src/llm/classifier.ts
 * Role    : LLM-based message intent classifier for the conversation state machine.
 *           Replaces brittle keyword scanning for nuanced intent distinctions —
 *           e.g. "What is Storytellers?" (brand/GENERAL_INQUIRY) vs
 *                "What is Aria?" (product/PRODUCT_INQUIRY).
 *
 *           Design choices:
 *           - maxTokens: 50, temperature: 0 → deterministic single-label response
 *           - Loads tenant name + product name from DB so the LLM has named context
 *           - Called in parallel with ragQuery → zero additional wall-clock latency
 *           - Hard keyword checks (BOOKING, BUY) still handled upstream; this
 *             classifier only runs when those checks pass without a match.
 *           - Optional lastBotMessage: injected as prior assistant turn so the LLM
 *             can recognise time/date replies as SCHEDULING even without keywords
 *             (e.g. "Selasa jam 14:00" replying to a consultation offer).
 *
 * Exports : classifyMessageIntent(), MessageIntent
 * DO NOT  : Import from apps/*, wati, payments
 */
import { db, tenants, products, eq, and } from '@lynkbot/db';
import { getLLMClient } from './factory';

export type MessageIntent =
  | 'PRODUCT_INQUIRY'     // question about the product: content, benefits, how it works, price
  | 'GENERAL_INQUIRY'     // question about the brand/store/company itself
  | 'OBJECTION_HANDLING'  // price concern, hesitation, "nanti", "mahal", "pikir dulu"
  | 'CHECKOUT_INTENT'     // explicit purchase signal missed by keyword scan
  | 'WANTS_CONSULTATION'  // explicitly asking to book/meet/consult but no date given yet
  | 'SCHEDULING'          // confirming or proposing a specific date/time for an appointment
  | 'BROWSING';           // greeting, casual, unclear, or unrelated

const VALID_INTENTS = new Set<MessageIntent>([
  'PRODUCT_INQUIRY',
  'GENERAL_INQUIRY',
  'OBJECTION_HANDLING',
  'CHECKOUT_INTENT',
  'WANTS_CONSULTATION',
  'SCHEDULING',
  'BROWSING',
]);

function parseLabel(raw: string): MessageIntent {
  const upper = raw.trim().toUpperCase().replace(/[^A-Z_]/g, '') as MessageIntent;
  return VALID_INTENTS.has(upper) ? upper : 'BROWSING';
}

/**
 * Classify the buyer's message intent using a fast LLM call.
 *
 * @param text           - Raw buyer message text
 * @param tenantId       - Used to load store name + active product name for context
 * @param lastBotMessage - The bot's immediately preceding message (optional).
 *                         When provided, it is injected as a prior assistant turn so the
 *                         LLM can recognise context-dependent replies — e.g. a bare
 *                         "Selasa jam 14:00" is SCHEDULING only because the bot just
 *                         offered a consultation slot.
 * @returns              - One of the MessageIntent labels
 */
export async function classifyMessageIntent(
  text: string,
  tenantId: string,
  lastBotMessage?: string,
): Promise<MessageIntent> {
  if (!text.trim()) return 'BROWSING';

  // Load naming context — lets the classifier distinguish brand vs product
  const [tenant, product] = await Promise.all([
    db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: { storeName: true },
    }),
    db.query.products.findFirst({
      where: and(eq(products.tenantId, tenantId), eq(products.isActive, true)),
      columns: { name: true },
      orderBy: (p, { desc }) => desc(p.updatedAt),
    }),
  ]);

  const storeName = tenant?.storeName ?? 'the store';
  const productName = product?.name ?? null;

  const systemPrompt = [
    `You are an intent classifier for a WhatsApp sales bot.`,
    `Store name: "${storeName}"`,
    productName ? `Product being sold: "${productName}"` : null,
    ``,
    `Classify the user message into EXACTLY ONE label:`,
    `PRODUCT_INQUIRY    — asking about the product: its content, benefits, features, how it works, or price`,
    `GENERAL_INQUIRY    — asking about the brand, store, or company itself (not the product)`,
    `OBJECTION_HANDLING — expressing price concern, hesitation, doubt, or reluctance to buy`,
    `CHECKOUT_INTENT    — explicitly wanting to purchase or order`,
    `WANTS_CONSULTATION — explicitly asking to meet, consult, book, or schedule, but has NOT yet given a specific date or time`,
    `SCHEDULING         — providing or confirming a specific date, time, or day for an appointment (e.g. "Selasa jam 14:00", "besok pagi", "Jumat sore")`,
    `BROWSING           — greeting, casual small talk, unclear intent, or anything else`,
    ``,
    `IMPORTANT DISTINCTION:`,
    `- "Saya ingin konsultasi" / "bisa meeting?" / "mau jadwalkan" → WANTS_CONSULTATION (desire to book, no date yet)`,
    `- "Selasa jam 2" / "besok pagi" / "Jumat jam 15:00" → SCHEDULING (specific date/time given)`,
    `- If the bot's previous message asked when the buyer is available and the buyer replies with a day or time → SCHEDULING`,
    ``,
    `Reply with ONLY the label. No explanation, no punctuation.`,
  ].filter(Boolean).join('\n');

  // Build chat messages. When we have the prior bot turn, inject it as an assistant
  // message so the model has full conversational context for ambiguous replies.
  const chatMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  if (lastBotMessage) {
    chatMessages.push({ role: 'assistant', content: lastBotMessage });
  }
  chatMessages.push({ role: 'user', content: text });

  const llm = getLLMClient();
  const res = await llm.chat(
    chatMessages,
    {
      system: systemPrompt,
      // Use the fast/fallback model — reasoning models are overkill for a
      // single-label classification and don't accept temperature=0.
      model: process.env.LLM_FALLBACK_MODEL ?? 'grok-3',
      maxTokens: 50,   // enough for one label + any trailing whitespace
      temperature: 0,  // deterministic — same input always → same label
    },
  );

  return parseLabel(res.content);
}
