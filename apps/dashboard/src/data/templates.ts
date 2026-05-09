/**
 * @CLAUDE_CONTEXT
 * File    : src/data/templates.ts
 * Role    : Centralized template definitions (S1-S5) for Phase 1 Onboarding + Phase 2 Gallery
 *           All templates are stateless. Language variants (EN/ID) are included.
 */

export interface TemplateConfig {
  id: string;
  labelEn: string;
  labelId: string;
  icon: string;
  category: 'Scheduling' | 'Sales' | 'Marketing' | 'Support';
  previewEn: string[];
  previewId: string[];
}

export const TEMPLATES: Record<string, TemplateConfig> = {
  S1: {
    id: 'S1',
    labelEn: 'Book an Appointment',
    labelId: 'Buat Jadwal',
    icon: '📅',
    category: 'Scheduling',
    previewEn: ['Bot: "What service do you need?"', 'Buyer: "Haircut"'],
    previewId: ['Bot: "Layanan apa yang kamu butuhkan?"', 'Pembeli: "Potong rambut"'],
  },
  S2: {
    id: 'S2',
    labelEn: 'Answer Product Questions',
    labelId: 'Jawab Pertanyaan Produk',
    icon: '💬',
    category: 'Sales',
    previewEn: ['Buyer: "Do you have sizes XL?"', 'Bot: "Yes, we do!"'],
    previewId: ['Pembeli: "Ada ukuran XL?"', 'Bot: "Tentu saja!"'],
  },
  S3: {
    id: 'S3',
    labelEn: 'Collect a Lead',
    labelId: 'Kumpulkan Prospek',
    icon: '👤',
    category: 'Marketing',
    previewEn: ['Bot: "What\'s your name?"', 'Buyer: "John"'],
    previewId: ['Bot: "Siapa nama Anda?"', 'Pembeli: "John"'],
  },
  S4: {
    id: 'S4',
    labelEn: 'Broadcast Announcement',
    labelId: 'Kirim Pengumuman',
    icon: '📢',
    category: 'Marketing',
    previewEn: ['Bot: "New sale! 50% off today"', 'Buyer: "Thanks!"'],
    previewId: ['Bot: "Diskon besar! 50% hari ini"', 'Pembeli: "Terima kasih!"'],
  },
  S5: {
    id: 'S5',
    labelEn: 'Human Handoff',
    labelId: 'Alihkan ke Tim',
    icon: '👥',
    category: 'Support',
    previewEn: ['Buyer: "Talk to someone"', 'Bot: "Connecting to team..."'],
    previewId: ['Pembeli: "Bicara dengan tim"', 'Bot: "Menghubungkan ke tim..."'],
  },
};

export function getTemplatesSuggested(
  business: 'clinic' | 'salon' | 'retail' | 'restaurant' | 'other',
  goal: 'booking' | 'questions' | 'leads' | 'promotions',
): string[] {
  if (business === 'clinic') {
    if (goal === 'booking') return ['S1', 'S5'];
    if (goal === 'questions') return ['S2', 'S1'];
  }
  if (business === 'salon') {
    if (goal === 'booking') return ['S1', 'S3'];
  }
  if (business === 'retail' || business === 'restaurant') {
    if (goal === 'promotions') return ['S4', 'S2'];
  }
  return ['S1', 'S2', 'S3'];
}
