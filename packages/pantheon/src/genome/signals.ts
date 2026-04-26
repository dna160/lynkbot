/**
 * @CLAUDE_CONTEXT
 * Package : packages/pantheon
 * File    : src/genome/signals.ts
 * Role    : Extract ConversationSignals from raw WhatsApp message text + metadata.
 *           Bilingual (EN + ID). No LLM — pure text analysis.
 * Exports : extractSignals(), extractName()
 */
import type { ConversationSignals } from '../types';

const PRICE_KEYWORDS = ['berapa', 'harga', 'price', 'diskon', 'discount', 'promo', 'murah', 'mahal',
  'bayar', 'biaya', 'cost', 'cashback', 'gratis', 'free', 'potongan', 'budget'];
const URGENCY_KEYWORDS = ['sekarang', 'buruan', 'cepat', 'urgent', 'segera', 'asap', 'now', 'quickly',
  'today', 'hari ini', 'malam ini', 'tonight', 'langsung'];
const POLITE_KEYWORDS = ['tolong', 'mohon', 'maaf', 'terima kasih', 'makasih', 'please', 'thanks',
  'thank you', 'sorry', 'permisi', 'excuse', 'kakak', 'kak', 'mas', 'mbak'];
const OBJECTION_KEYWORDS = ['tapi', 'but', 'however', 'mahal', 'expensive', 'ragu', 'doubt', 'tidak yakin',
  'not sure', 'mikir dulu', 'belum', 'not yet', 'wait', 'nanti', 'later'];
const SELF_REFERENCE_ID = ['saya', 'aku', 'gue', 'gw'];
const SELF_REFERENCE_EN = ['i ', "i'm", "i've", "i'd", 'my ', 'me '];
const IDENTITY_SIGNALS = ['ibu', 'bapak', 'pak', 'bu', 'dokter', 'guru', 'manager', 'direktur', 'owner',
  'entrepreneur', 'mahasiswa', 'student', 'freelancer', 'karyawan', 'pegawai', 'teacher', 'doctor'];
const FORMAL_PRONOUNS = ['saya', 'anda', 'beliau', 'bapak', 'ibu', 'i ', 'you ', 'dear', 'kepada'];

/** Count occurrences of any keyword in text (case-insensitive) */
function countKeywords(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  return keywords.reduce((acc, kw) => acc + (lower.split(kw.toLowerCase()).length - 1), 0);
}

/** Count emojis in text */
function countEmojis(text: string): number {
  const emojiRegex = /[\u{1F300}-\u{1FFFF}\u{2600}-\u{27BF}]/gu;
  return (text.match(emojiRegex) ?? []).length;
}

/** Extract a name if buyer introduced themselves */
export function extractName(messages: string[]): string | null {
  const namePatterns = [
    /(?:nama (?:saya|aku|gue|gw)\s+(?:adalah\s+)?|my name is\s+|i(?:'m| am)\s+|panggil\s+(?:aku|saya)\s+|call me\s+)([A-Z][a-zA-Z]{2,20})/gi,
    /(?:halo|hai|hi|hello)[,.]?\s+(?:saya|aku|i(?:'m| am)\s+)?([A-Z][a-zA-Z]{2,20})/gi,
  ];
  for (const msg of messages) {
    for (const pattern of namePatterns) {
      const match = pattern.exec(msg);
      if (match?.[1]) return match[1];
    }
  }
  return null;
}

/** Extract identity signals (profession, roles) */
function extractIdentitySignals(text: string): string[] {
  const lower = text.toLowerCase();
  return IDENTITY_SIGNALS.filter(sig => lower.includes(sig));
}

/**
 * Build ConversationSignals from a batch of messages.
 * @param messages - array of raw buyer message texts
 * @param timestamps - matching timestamps (ms) for latency calculation
 */
export function extractSignals(
  messages: string[],
  timestamps?: number[],
): ConversationSignals {
  if (messages.length === 0) {
    return {
      messageCount: 0, avgMessageLength: 0, emojiFrequency: 0,
      questionCount: 0, priceQuestionsCount: 0, urgencyCount: 0,
      politenessCount: 0, selfReferenceCount: 0, brandMentionCount: 0,
      objectionCount: 0, formalLanguage: false,
      expressedName: null, expressedIdentity: [],
      responseLatencyPattern: 'medium',
    };
  }

  const fullText = messages.join(' ');
  const totalLength = messages.reduce((acc, m) => acc + m.length, 0);

  // Latency pattern
  let latencyPattern: 'fast' | 'medium' | 'slow' = 'medium';
  if (timestamps && timestamps.length >= 2) {
    const gaps: number[] = [];
    for (let i = 1; i < timestamps.length; i++) {
      gaps.push(timestamps[i] - timestamps[i - 1]);
    }
    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    latencyPattern = avgGap < 30_000 ? 'fast' : avgGap > 300_000 ? 'slow' : 'medium';
  }

  // Formal language check: any formal pronouns present?
  const lower = fullText.toLowerCase();
  const formalCount = FORMAL_PRONOUNS.reduce((acc, p) => acc + (lower.includes(p) ? 1 : 0), 0);

  const totalEmojis = messages.reduce((acc, m) => acc + countEmojis(m), 0);

  return {
    messageCount: messages.length,
    avgMessageLength: Math.round(totalLength / messages.length),
    emojiFrequency: Math.round((totalEmojis / messages.length) * 10) / 10,
    questionCount: (fullText.match(/\?/g) ?? []).length,
    priceQuestionsCount: countKeywords(fullText, PRICE_KEYWORDS),
    urgencyCount: countKeywords(fullText, URGENCY_KEYWORDS),
    politenessCount: countKeywords(fullText, POLITE_KEYWORDS),
    selfReferenceCount: countKeywords(fullText, [...SELF_REFERENCE_ID, ...SELF_REFERENCE_EN]),
    brandMentionCount: 0, // populated externally with product name
    objectionCount: countKeywords(fullText, OBJECTION_KEYWORDS),
    formalLanguage: formalCount >= 2,
    expressedName: extractName(messages),
    expressedIdentity: [...new Set(extractIdentitySignals(fullText))],
    responseLatencyPattern: latencyPattern,
  };
}
