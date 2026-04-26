/**
 * @CLAUDE_CONTEXT
 * Package : packages/pantheon
 * File    : src/dialog/cacheBuilder.ts
 * Role    : Builds a 6-moment × 3-option dialog cache for a buyer using Grok LLM.
 *           Called once when a genome reaches MEDIUM/HIGH confidence (observationCount ≥ 5).
 *           Returns a DialogCache that the selector uses during live conversation.
 * Exports : buildDialogCache()
 */
import type OpenAI from 'openai';
import type { Genome, DialogCache, MomentType } from '../types';

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const OpenAIClass = require('openai').default as typeof OpenAI;
    _client = new OpenAIClass({
      apiKey: process.env.XAI_API_KEY!,
      baseURL: process.env.XAI_BASE_URL ?? 'https://api.x.ai/v1',
    });
  }
  return _client;
}

const MOMENT_DESCRIPTIONS: Record<MomentType, string> = {
  neutral_exploratory: 'buyer is browsing and asking general questions, no clear intent yet',
  price_resistant: 'buyer is pushing back on price, asking for discounts or negotiation',
  trust_building: 'buyer is asking for social proof, reviews, guarantees, or legitimacy',
  identity_aligned: 'buyer is connecting the product to their personal identity or values',
  high_engagement: 'buyer is deeply interested, asking detailed product questions',
  closing_ready: 'buyer is showing clear buy intent and is ready to commit',
};

export async function buildDialogCache(
  genome: Genome,
  productName: string,
  storeName: string,
  language: 'id' | 'en' = 'id',
): Promise<DialogCache> {
  const { scores, confidence } = genome;
  const langInstr = language === 'id'
    ? 'All base_language and trigger_phrase MUST be in Indonesian (Bahasa Indonesia).'
    : 'All base_language and trigger_phrase must be in English.';

  const prompt = `You are Pantheon V2, a buyer psychology engine for WhatsApp commerce.

BUYER GENOME (confidence: ${confidence}):
- Personality: openness=${scores.openness}, conscientiousness=${scores.conscientiousness}, extraversion=${scores.extraversion}, agreeableness=${scores.agreeableness}, neuroticism=${scores.neuroticism}
- Behavioral: communicationStyle=${scores.communicationStyle}/100 (1=terse, 100=verbose), decisionMaking=${scores.decisionMaking}/100 (1=impulsive, 100=deliberate), socioeconomicFriction=${scores.socioeconomicFriction}/100 (price sensitivity), influenceSusceptibility=${scores.influenceSusceptibility}/100, emotionalExpression=${scores.emotionalExpression}/100
- Identity: identityFusion=${scores.identityFusion}/100, tomSocialModeling=${scores.tomSocialModeling}/100

PRODUCT: "${productName}" | STORE: "${storeName}"
${langInstr}

Generate a dialog cache: for each of the 6 conversation moment types, provide 3 dialog options (a/b/c) ranked by likelihood of success for THIS specific buyer genome.

Moment types:
1. neutral_exploratory — ${MOMENT_DESCRIPTIONS.neutral_exploratory}
2. price_resistant — ${MOMENT_DESCRIPTIONS.price_resistant}
3. trust_building — ${MOMENT_DESCRIPTIONS.trust_building}
4. identity_aligned — ${MOMENT_DESCRIPTIONS.identity_aligned}
5. high_engagement — ${MOMENT_DESCRIPTIONS.high_engagement}
6. closing_ready — ${MOMENT_DESCRIPTIONS.closing_ready}

For each option provide:
- core_approach: the strategic framing (10-20 words)
- base_language: specific message to send (2-4 sentences, WhatsApp friendly, warm and conversational)
- trigger_phrase: opening 3-5 words to start the message
- base_probability: 0-100 (how well this approach fits this genome)
- genome_rationale: why this suits this buyer specifically (1 sentence)

Respond with ONLY valid JSON matching this structure:
{
  "neutral_exploratory": { "option_a": {...}, "option_b": {...}, "option_c": {...} },
  "price_resistant": { "option_a": {...}, "option_b": {...}, "option_c": {...} },
  "trust_building": { "option_a": {...}, "option_b": {...}, "option_c": {...} },
  "identity_aligned": { "option_a": {...}, "option_b": {...}, "option_c": {...} },
  "high_engagement": { "option_a": {...}, "option_b": {...}, "option_c": {...} },
  "closing_ready": { "option_a": {...}, "option_b": {...}, "option_c": {...} }
}`;

  const model = process.env.LLM_MODEL ?? 'grok-3';
  const client = getClient();

  const res = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.4,
    max_tokens: 3000,
  });

  const raw = res.choices[0]?.message?.content ?? '';

  // Parse JSON, stripping markdown code fences if present
  const jsonStr = raw.replace(/```(?:json)?\n?/g, '').trim();
  try {
    const cache = JSON.parse(jsonStr) as DialogCache;
    return cache;
  } catch {
    throw new Error(`Failed to parse dialog cache JSON: ${jsonStr.slice(0, 200)}`);
  }
}

/** Fallback cache when LLM is unavailable or fails */
export function buildFallbackCache(_language: 'id' | 'en' = 'id'): DialogCache {
  const make = (approach: string, lang: string, trigger: string) => ({
    coreApproach: approach,
    baseLanguage: lang,
    triggerPhrase: trigger,
    baseProbability: 50,
    genomeRationale: 'Fallback option — genome not yet available',
  });

  const neutral = {
    option_a: make('Open with curiosity', 'Halo! Ada yang bisa saya bantu hari ini? 😊', 'Halo! Ada yang'),
    option_b: make('Direct value offer', 'Selamat datang! Mau tahu lebih tentang produk kami?', 'Selamat datang!'),
    option_c: make('Warm rapport first', 'Hai kak, sudah lama cari-cari ya? Saya siap bantu 😊', 'Hai kak,'),
  };

  return {
    neutral_exploratory: neutral,
    price_resistant: {
      option_a: make('Acknowledge price concern', 'Saya mengerti. Untuk kualitas yang ditawarkan, harganya sangat sepadan. Mau saya jelaskan apa yang kamu dapat?', 'Saya mengerti.'),
      option_b: make('Shift to value', 'Banyak pelanggan kami awalnya ragu, tapi setelah coba hasilnya luar biasa. Boleh saya ceritakan?', 'Banyak pelanggan'),
      option_c: make('Offer bundle or bonus', 'Ada bonus spesial yang bisa saya tawarkan. Mau dengar lebih lanjut?', 'Ada bonus spesial'),
    },
    trust_building: {
      option_a: make('Share social proof', 'Sudah ratusan pelanggan yang puas! Ini beberapa testimoni dari mereka 💬', 'Sudah ratusan pelanggan'),
      option_b: make('Offer guarantee', 'Kami memberikan garansi kepuasan. Kalau tidak cocok, kami siap bantu.', 'Kami memberikan garansi'),
      option_c: make('Transparency first', 'Boleh saya ceritakan detail produknya secara jujur? Tidak ada yang disembunyikan 😊', 'Boleh saya ceritakan'),
    },
    identity_aligned: {
      option_a: make('Mirror identity', 'Berdasarkan apa yang kamu ceritakan, produk ini sangat cocok dengan gaya hidupmu!', 'Berdasarkan apa yang'),
      option_b: make('Values connection', 'Banyak orang seperti kamu yang sudah merasakan manfaatnya. Ini bukan kebetulan!', 'Banyak orang seperti'),
      option_c: make('Aspiration bridge', 'Ini bukan sekadar produk — ini investasi untuk versi terbaik dirimu 🌟', 'Ini bukan sekadar'),
    },
    high_engagement: {
      option_a: make('Deep dive offer', 'Wah, pertanyaan bagus! Mari saya jelaskan secara lengkap...', 'Wah, pertanyaan bagus!'),
      option_b: make('Educational approach', 'Saya suka semangat belajarmu! Begini cara kerjanya...', 'Saya suka semangat'),
      option_c: make('Personalized answer', 'Untuk kebutuhan kamu khususnya, ini yang paling relevan...', 'Untuk kebutuhan kamu'),
    },
    closing_ready: {
      option_a: make('Smooth transition', 'Bagus! Mari kita lanjutkan proses pemesanannya. Saya guide step by step 😊', 'Bagus! Mari kita'),
      option_b: make('Confirm readiness', 'Siap ya? Kita proses sekarang supaya stok tidak habis!', 'Siap ya? Kita'),
      option_c: make('Reassurance close', 'Pilihan tepat! Ribuan pelanggan sudah puas. Langsung kita proses ya!', 'Pilihan tepat! Ribuan'),
    },
  };
}
