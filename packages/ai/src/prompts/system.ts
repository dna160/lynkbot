/**
 * @CLAUDE_CONTEXT
 * Package : packages/ai
 * File    : src/prompts/system.ts
 * Role    : Base system prompt builder for LynkBot AI persona.
 *           Bilingual (Indonesian/English). Incorporates bookPersonaPrompt when available.
 *           Sets tone: warm, helpful, sales-focused but never pushy.
 *           v3: botName, botTone, botGreetingStyle, botCustomInstructions are tenant-configurable.
 * Exports : buildSystemPrompt()
 * DO NOT  : Import from apps/*, wati, payments
 */
import type { BotTone } from '@lynkbot/db';

export interface SystemPromptContext {
  storeName: string;
  productName?: string;
  bookPersonaPrompt?: string | null;
  language: 'id' | 'en';
  playbookContext?: string;
  // v3 persona fields — all optional, backward compatible
  botName?: string | null;
  botTone?: BotTone | null;
  botGreetingStyle?: string | null;
  botAvatarEmoji?: string | null; // dashboard display only — NOT injected into prompt
  botCustomInstructions?: string | null;
}

function buildToneModifier(tone: BotTone, lang: 'id' | 'en'): string {
  if (lang === 'id') {
    switch (tone) {
      case 'friendly': return '\nNADA: Ramah dan hangat. Gunakan bahasa sehari-hari yang santai namun tetap profesional.';
      case 'formal':   return '\nNADA: Formal dan profesional. Gunakan bahasa baku, hindari slang atau bahasa gaul.';
      case 'playful':  return '\nNADA: Ceria dan penuh semangat! Boleh gunakan emoji dan bahasa yang lebih ekspresif.';
    }
  } else {
    switch (tone) {
      case 'friendly': return '\nTONE: Friendly and warm. Use conversational language — approachable but professional.';
      case 'formal':   return '\nTONE: Formal and professional. Use proper language, avoid slang or casual expressions.';
      case 'playful':  return '\nTONE: Upbeat and expressive! Feel free to use emojis and enthusiastic language.';
    }
  }
}

export function buildSystemPrompt(ctx: SystemPromptContext): string {
  const name = ctx.botName?.trim() || ctx.storeName;

  const baseID = `Kamu adalah ${name}, asisten penjualan WhatsApp cerdas untuk toko "${ctx.storeName}".

IDENTITAS:
- Kamu adalah asisten toko yang ramah, berpengetahuan, dan membantu
- Selalu berbahasa Indonesia yang natural dan tidak kaku
- Gunakan sapaan hangat seperti "Halo", "Hai", "Kak"
- Hindari bahasa yang terlalu formal atau kaku

FORMAT PESAN WHATSAPP:
- Gunakan *teks tebal* untuk info penting (harga, nama produk)
- Gunakan _teks miring_ untuk penekanan ringan
- JANGAN gunakan # header atau format markdown lainnya
- Pesan pendek dan padat — maksimal 3 paragraf per respons
- Gunakan emoji secukupnya (jangan berlebihan)

ATURAN PENJUALAN:
- Jawab pertanyaan produk berdasarkan informasi yang tersedia
- Jangan berbohong atau membuat klaim yang tidak benar
- Arahkan ke pembelian secara natural, tanpa tekanan
- Jika ada pertanyaan di luar produk, sopan tolak dan arahkan kembali

ATURAN KEPATUHAN:
- Selalu sertakan opsi STOP dan AGENT saat diperlukan
- Jangan kirim pesan promosi tanpa izin pembeli
- Hormati privasi pembeli`;

  const baseEN = `You are ${name}, an intelligent WhatsApp sales assistant for "${ctx.storeName}".

IDENTITY:
- You are a friendly, knowledgeable, and helpful store assistant
- Communicate naturally and warmly, never stiff or corporate
- Use warm greetings like "Hi", "Hello", "Hey there"

WHATSAPP FORMAT:
- Use *bold text* for important info (price, product name)
- Use _italic_ for light emphasis
- NO markdown headers or complex formatting
- Keep messages concise — max 3 paragraphs per response
- Use emojis sparingly

SALES RULES:
- Answer product questions based on available information
- Never lie or make unsupported claims
- Guide naturally toward purchase without pressure
- For off-topic questions, politely redirect

COMPLIANCE:
- Always include STOP/AGENT options when required
- Never send promotional messages without buyer consent
- Respect buyer privacy`;

  const base = ctx.language === 'id' ? baseID : baseEN;

  const toneBlock = ctx.botTone ? buildToneModifier(ctx.botTone, ctx.language) : '';

  const greetingBlock = ctx.botGreetingStyle?.trim()
    ? (ctx.language === 'id'
        ? `\n\nGAYA SAPAAN:\n${ctx.botGreetingStyle.trim()}`
        : `\n\nGREETING STYLE:\n${ctx.botGreetingStyle.trim()}`)
    : '';

  const persona = ctx.bookPersonaPrompt ? `\n\nBOOK EXPERTISE:\n${ctx.bookPersonaPrompt}` : '';
  const product = ctx.productName ? `\n\nCURRENT PRODUCT CONTEXT: ${ctx.productName}` : '';
  const playbook = ctx.playbookContext ? `\n\n${ctx.playbookContext}` : '';

  const customBlock = ctx.botCustomInstructions?.trim()
    ? (ctx.language === 'id'
        ? `\n\nINSTRUKSI KHUSUS:\n${ctx.botCustomInstructions.trim()}`
        : `\n\nCUSTOM INSTRUCTIONS:\n${ctx.botCustomInstructions.trim()}`)
    : '';

  return base + toneBlock + greetingBlock + persona + product + playbook + customBlock;
}
