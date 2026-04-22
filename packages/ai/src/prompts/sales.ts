/**
 * @CLAUDE_CONTEXT
 * Package : packages/ai
 * File    : src/prompts/sales.ts
 * Role    : Sales intelligence directives and NLP patterns for intent detection.
 *           Includes objection handling, buy intent, and disengagement detection.
 * Exports : SALES_DIRECTIVES, BUY_INTENT_KEYWORDS, OBJECTION_KEYWORDS, DISENGAGEMENT_KEYWORDS
 * DO NOT  : Import from apps/*, wati, payments
 */

export const SALES_DIRECTIVES = `
OBJECTION HANDLING:
- Price too high: Anchor on value ("Untuk ilmu senilai ini..."), offer instalment if available
- "I'll think about it": Create soft urgency ("Stok terbatas, kak"), not pressure
- "Not sure yet": Ask what's holding them back, address specific concern
- Competitor comparison: Focus on unique value, never disparage competitors

CLOSING TECHNIQUES:
- Summary close: Recap benefits before asking for commitment
- Assumptive close: "Mau dikirim ke mana, kak?" (assumes yes)
- Scarcity: Only mention if genuine ("Tinggal X unit tersisa")
`;

export const BUY_INTENT_KEYWORDS = {
  id: ['beli', 'order', 'pesan', 'mau', 'minta', 'transfer', 'bayar', 'checkout', 'ambil', 'dapatkan', 'oke', 'deal', 'sepakat', 'jadi'],
  en: ['buy', 'order', 'purchase', 'want', 'get', 'pay', 'checkout', 'take it', 'ok deal', 'let\'s do it', 'yes', 'sure'],
};

export const OBJECTION_KEYWORDS = {
  id: ['mahal', 'kemahalan', 'harga', 'murah', 'diskon', 'promo', 'nego', 'kurang', 'banyak', 'mikir dulu', 'pikir', 'nanti', 'belum'],
  en: ['expensive', 'price', 'cheap', 'discount', 'promo', 'negotiate', 'think about', 'later', 'not now', 'maybe'],
};

export const DISENGAGEMENT_KEYWORDS = {
  id: ['tidak tertarik', 'nggak jadi', 'gak jadi', 'ga jadi', 'batal', 'cancel', 'bye', 'dadah', 'makasih', 'skip', 'lewat'],
  en: ['not interested', 'nevermind', 'cancel', 'bye', 'pass', 'no thanks', 'forget it'],
};

export const STOP_KEYWORDS = ['STOP', 'stop', 'berhenti', 'unsubscribe', 'hapus', 'blokir'];
export const AGENT_KEYWORDS = ['AGENT', 'agent', 'manusia', 'cs', 'customer service', 'admin', 'human', 'orang'];
