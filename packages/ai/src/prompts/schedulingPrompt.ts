/**
 * @CLAUDE_CONTEXT
 * Package : packages/ai
 * File    : src/prompts/schedulingPrompt.ts
 * Role    : System prompt and utilities for SCHEDULING state conversations.
 *           Replaces the standard commerce prompt when booking intent is detected.
 *           Instructs LLM to use JSON envelope pattern for tool calls (no native function calling).
 * Exports : SCHEDULING_SYSTEM_PROMPT, parseSchedulingEnvelope, formatWIBDatetime
 * DO NOT  : Import from apps/*, wati, payments
 */

/** WIB timezone identifier */
const WIB = 'Asia/Jakarta';

const DAY_NAMES_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const MONTH_NAMES_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

/**
 * Format a UTC Date into WIB display string.
 * Single time: "Selasa, 14 Mei 2026 · 09:00 WIB"
 * With end:    "Selasa, 14 Mei 2026 · 09:00–10:00 WIB"
 */
export function formatWIBDatetime(utcStart: Date, utcEnd?: Date): string {
  const wibStart = new Intl.DateTimeFormat('id-ID', {
    timeZone: WIB,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(utcStart);

  const get = (type: string) => wibStart.find(p => p.type === type)?.value ?? '';
  const day = parseInt(get('day'), 10);
  const month = parseInt(get('month'), 10) - 1;
  const year = get('year');
  const startHHMM = `${get('hour')}:${get('minute')}`;
  const dayOfWeek = new Date(utcStart.toLocaleString('en-US', { timeZone: WIB })).getDay();
  const dayName = DAY_NAMES_ID[dayOfWeek];
  const monthName = MONTH_NAMES_ID[month];

  if (!utcEnd) {
    return `${dayName}, ${day} ${monthName} ${year} · ${startHHMM} WIB`;
  }

  const endHHMM = new Intl.DateTimeFormat('id-ID', {
    timeZone: WIB, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(utcEnd).replace('.', ':');

  return `${dayName}, ${day} ${monthName} ${year} · ${startHHMM}–${endHHMM} WIB`;
}

/** Type for parsed scheduling action envelopes */
export type SchedulingEnvelope =
  | { action: 'check_availability'; service_name: string; requested_datetime?: string }
  | { action: 'confirm_booking'; staff_id: string; service_id: string; start_time: string };

/**
 * Try to parse an LLM response as a scheduling JSON envelope.
 * Returns the typed envelope or null if the text is not a valid envelope.
 * All errors are swallowed — null means "treat as plain text".
 */
export function parseSchedulingEnvelope(text: string): SchedulingEnvelope | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    if (obj.action === 'check_availability' && typeof obj.service_name === 'string') {
      return {
        action: 'check_availability',
        service_name: obj.service_name,
        requested_datetime: typeof obj.requested_datetime === 'string' ? obj.requested_datetime : undefined,
      };
    }
    if (
      obj.action === 'confirm_booking' &&
      typeof obj.staff_id === 'string' &&
      typeof obj.service_id === 'string' &&
      typeof obj.start_time === 'string'
    ) {
      return {
        action: 'confirm_booking',
        staff_id: obj.staff_id,
        service_id: obj.service_id,
        start_time: obj.start_time,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * System prompt for SCHEDULING state conversations.
 * Replaces the standard commerce prompt entirely.
 * Instructs the LLM to use JSON envelopes to trigger tool calls.
 */
export const SCHEDULING_SYSTEM_PROMPT = `Kamu adalah asisten booking WhatsApp yang ramah dan efisien.

MISI:
Bantu pembeli menemukan dan mengkonfirmasi jadwal appointment yang cocok, secepatnya.

FORMAT WHATSAPP:
- Gunakan *teks tebal* untuk nama layanan, waktu, dan info penting
- Jangan gunakan # header atau markdown kompleks
- Pesan singkat — maksimal 3 paragraf
- Emoji boleh secukupnya

TOOL CALLS (JSON ENVELOPE):
Ketika kamu perlu cek ketersediaan atau konfirmasi booking, BALAS HANYA dengan JSON berikut (tanpa teks lain):

Untuk cek jadwal kosong:
{"action":"check_availability","service_name":"<nama layanan>","requested_datetime":"<ISO8601 atau null>"}

Untuk konfirmasi slot yang sudah disetujui pembeli:
{"action":"confirm_booking","staff_id":"<uuid>","service_id":"<uuid>","start_time":"<UTC ISO8601>"}

ALUR PERCAKAPAN:
1. Tanya layanan apa yang diinginkan (jika belum jelas)
2. Gunakan check_availability untuk tampilkan 3 slot tersedia
3. Tanya pembeli pilih slot yang mana
4. Setelah pembeli setuju, gunakan confirm_booking untuk submit
5. Informasikan bahwa permintaan sudah dikirim ke staf untuk dikonfirmasi

BATASAN:
- Maksimal 3 putaran negosiasi. Jika tidak ada slot yang cocok, sarankan pembeli menghubungi langsung.
- Selalu tampilkan waktu dalam format WIB (Asia/Jakarta)
- Jangan konfirmasi appointment tanpa JSON envelope confirm_booking

CONTOH SLOT DISPLAY:
"Berikut jadwal yang tersedia:
1️⃣ *Senin, 11 Mei 2026 · 09:00–10:00 WIB* — Dr. Sarah
2️⃣ *Senin, 11 Mei 2026 · 14:00–15:00 WIB* — Dr. Sarah
3️⃣ *Selasa, 12 Mei 2026 · 10:00–11:00 WIB* — Dr. Budi

Pilih nomor berapa, Kak? 😊"`;
