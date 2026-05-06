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
 *           - maxTokens: 15, temperature: 0 → deterministic single-label response
 *           - Loads tenant name + product name from DB so the LLM has named context
 *           - Called in parallel with ragQuery → zero additional wall-clock latency
 *           - Hard keyword checks (BOOKING, BUY) still handled upstream; this
 *             classifier only runs when those checks pass without a match.
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
  | 'BROWSING';           // greeting, casual, unclear, or unrelated

const VALID_INTENTS = new Set<MessageIntent>([
  'PRODUCT_INQUIRY',
  'GENERAL_INQUIRY',
  'OBJECTION_HANDLING',
  'CHECKOUT_INTENT',
  'BROWSING',
]);

function parseLabel(raw: string): MessageIntent {
  const upper = raw.trim().toUpperCase().replace(/[^A-Z_]/g, '') as MessageIntent;
  return VALID_INTENTS.has(upper) ? upper : 'BROWSING';
}

/**
 * Classify the buyer's message intent using a fast LLM call.
 *
 * @param text      - Raw buyer message text
 * @param tenantId  - Used to load store name + active product name for context
 * @returns         - One of the MessageIntent labels
 */
export async function classifyMessageIntent(
  text: string,
  tenantId: string,
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
    `PRODUCT_INQUIRY   — asking about the product: its content, benefits, features, how it works, or price`,
    `GENERAL_INQUIRY   — asking about the brand, store, or company itself (not the product)`,
    `OBJECTION_HANDLING — expressing price concern, hesitation, doubt, or reluctance to buy`,
    `CHECKOUT_INTENT   — explicitly wanting to purchase or order`,
    `BROWSING          — greeting, casual small talk, unclear intent, or anything else`,
    ``,
    `Reply with ONLY the label. No explanation, no punctuation.`,
  ].filter(Boolean).join('\n');

  const llm = getLLMClient();
  const res = await llm.chat(
    [{ role: 'user', content: text }],
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
