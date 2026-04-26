/**
 * @CLAUDE_CONTEXT
 * Package : packages/pantheon
 * File    : src/dialog/momentClassifier.ts
 * Role    : Classifies a buyer's latest WhatsApp message into one of 6 MomentTypes.
 *           Rule-based keyword matching — no LLM, runs synchronously in <5ms.
 *           Bilingual EN + ID.
 * Exports : classifyMoment()
 */
import type { MomentType, ClassificationResult } from '../types';

interface MomentRule {
  type: MomentType;
  keywords: string[];
  weight: number;
}

const MOMENT_RULES: MomentRule[] = [
  {
    type: 'closing_ready',
    weight: 3,
    keywords: [
      'beli', 'mau beli', 'order', 'pesan', 'checkout', 'bayar', 'transfer',
      'mau', 'iya mau', 'ok deal', 'deal', 'fix', 'lanjut', 'proceed',
      'buy', 'purchase', 'ready', 'let\'s do', 'i\'ll take', 'sold',
    ],
  },
  {
    type: 'price_resistant',
    weight: 2.5,
    keywords: [
      'mahal', 'expensive', 'diskon', 'discount', 'promo', 'murah', 'price',
      'harga berapa', 'ada promo', 'bisa lebih murah', 'can you lower', 'nego',
      'negotiable', 'coupon', 'voucher', 'cashback', 'free ongkir',
    ],
  },
  {
    type: 'trust_building',
    weight: 2,
    keywords: [
      'terpercaya', 'trusted', 'review', 'ulasan', 'testimoni', 'bukti',
      'proof', 'legit', 'asli', 'original', 'resmi', 'official',
      'garansi', 'guarantee', 'return', 'refund', 'aman', 'safe',
      'siapa yang sudah', 'who has used', 'pernah pakai', 'recommend',
    ],
  },
  {
    type: 'identity_aligned',
    weight: 2,
    keywords: [
      'cocok buat', 'perfect for', 'sesuai dengan', 'relates to',
      'nilai saya', 'my values', 'gaya hidup', 'lifestyle',
      'seperti saya', 'like me', 'kebutuhan saya', 'my needs',
      'profesi', 'profession', 'hobby', 'hobi', 'passion',
    ],
  },
  {
    type: 'high_engagement',
    weight: 1.5,
    keywords: [
      'ceritakan', 'tell me more', 'lebih detail', 'more detail', 'jelaskan',
      'explain', 'apa isi', 'what\'s inside', 'bagaimana cara', 'how does',
      'manfaatnya', 'benefit', 'fitur', 'feature', 'spesifikasi', 'spec',
      'bab berapa', 'chapter', 'halaman', 'pages', 'sudah berapa orang',
    ],
  },
  {
    type: 'neutral_exploratory',
    weight: 1,
    keywords: [
      'halo', 'hai', 'hello', 'hi', 'selamat', 'good',
      'apa', 'what', 'info', 'tanya', 'ask', 'cek', 'check',
      'lihat', 'browse', 'lagi cari', 'looking for',
    ],
  },
];

export function classifyMoment(
  message: string,
  recentMessages: string[] = [],
): ClassificationResult {
  const context = [...recentMessages, message].join(' ').toLowerCase();
  const scores: Map<MomentType, { score: number; keywords: string[] }> = new Map();

  for (const rule of MOMENT_RULES) {
    const matched: string[] = [];
    for (const kw of rule.keywords) {
      if (context.includes(kw.toLowerCase())) {
        matched.push(kw);
      }
    }
    if (matched.length > 0) {
      const existing = scores.get(rule.type);
      scores.set(rule.type, {
        score: (existing?.score ?? 0) + matched.length * rule.weight,
        keywords: [...(existing?.keywords ?? []), ...matched],
      });
    }
  }

  if (scores.size === 0) {
    return { momentType: 'neutral_exploratory', confidence: 0.3, keywords: [] };
  }

  // Find highest scoring moment
  let best: MomentType = 'neutral_exploratory';
  let bestScore = 0;
  let bestKeywords: string[] = [];

  for (const [type, { score, keywords }] of scores.entries()) {
    if (score > bestScore) {
      best = type;
      bestScore = score;
      bestKeywords = keywords;
    }
  }

  // Confidence = capped at 0.95, based on score magnitude
  const confidence = Math.min(0.95, Math.max(0.3, bestScore / 10));

  return { momentType: best, confidence, keywords: bestKeywords };
}
