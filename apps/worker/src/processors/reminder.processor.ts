/**
 * @CLAUDE_CONTEXT
 * Package : apps/worker
 * File    : src/processors/reminder.processor.ts
 * Role    : Processes appointment reminder jobs from QUEUES.REMINDERS queue.
 *           Sends WA reminder messages to buyers before their scheduled appointments.
 *           Jobs are enqueued with a delay calculated so they fire 24h and 1h before
 *           the appointment start time (WIB).
 * Imports : @lynkbot/db, @lynkbot/meta
 * Exports : reminderProcessor (BullMQ Processor function)
 * DO NOT  : Import from apps/api or apps/dashboard.
 * Job data: { appointmentId: string; tenantId: string; reminderType: '24h' | '1h' }
 */
import type { Processor } from 'bullmq';
import { db, appointments, buyers, staff, services, eq, and } from '@lynkbot/db';
import { MetaClient } from '@lynkbot/meta';

export interface ReminderJobData {
  appointmentId: string;
  tenantId: string;
  /** '24h' = day-before reminder, '1h' = one-hour reminder */
  reminderType: '24h' | '1h';
}

/** Build a MetaClient for the given tenant using env credentials. */
async function getTenantClient(tenantId: string): Promise<MetaClient> {
  // Resolve tenant credentials from DB
  const { db: database, tenants } = await import('@lynkbot/db');
  const { eq: eqOp } = await import('@lynkbot/db');
  const tenant = await database.query.tenants.findFirst({
    where: eqOp(tenants.id, tenantId),
    columns: { metaPhoneNumberId: true, metaAccessToken: true },
  });

  if (!tenant?.metaPhoneNumberId || !tenant?.metaAccessToken) {
    throw new Error(`[reminder] Tenant ${tenantId} missing Meta credentials`);
  }

  return new MetaClient(tenant.metaAccessToken, tenant.metaPhoneNumberId);
}

/** Format a UTC Date into WIB time display ("09:00 WIB"). */
function toWIBTime(utc: Date): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(utc).replace('.', ':') + ' WIB';
}

/** Format a UTC Date into WIB full date ("Selasa, 14 Mei 2026"). */
function toWIBDate(utc: Date): string {
  const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const MONTH_NAMES = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

  const parts = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).formatToParts(utc);

  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  const day = parseInt(get('day'), 10);
  const month = parseInt(get('month'), 10) - 1;
  const year = get('year');
  const dayOfWeek = new Date(utc.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' })).getDay();

  return `${DAY_NAMES[dayOfWeek]}, ${day} ${MONTH_NAMES[month]} ${year}`;
}

export const reminderProcessor: Processor<ReminderJobData> = async (job) => {
  const { appointmentId, tenantId, reminderType } = job.data;

  console.info(`[reminder] Processing ${reminderType} reminder for appointment ${appointmentId}`);

  // Load appointment with related data
  const appt = await db.query.appointments.findFirst({
    where: and(
      eq(appointments.id, appointmentId),
      eq(appointments.tenantId, tenantId),
    ),
  });

  if (!appt) {
    console.warn(`[reminder] Appointment ${appointmentId} not found — skipping`);
    return { skipped: true, reason: 'appointment_not_found' };
  }

  // Only send reminders for confirmed appointments
  if (appt.status !== 'confirmed') {
    console.info(
      `[reminder] Appointment ${appointmentId} status=${appt.status} — skipping reminder (only confirmed get reminders)`,
    );
    return { skipped: true, reason: `status_${appt.status}` };
  }

  // Load buyer phone number
  const buyer = await db.query.buyers.findFirst({
    where: eq(buyers.id, appt.buyerId),
    columns: { waPhone: true, displayName: true },
  });

  if (!buyer?.waPhone) {
    console.error(`[reminder] Buyer ${appt.buyerId} not found or missing phone — cannot send reminder`);
    return { skipped: true, reason: 'buyer_not_found' };
  }

  // Load staff name
  const staffRow = await db.query.staff.findFirst({
    where: eq(staff.id, appt.staffId),
    columns: { name: true },
  });

  // Load service name
  const serviceRow = await db.query.services.findFirst({
    where: eq(services.id, appt.serviceId),
    columns: { name: true },
  });

  const staffName = staffRow?.name ?? 'tim kami';
  const serviceName = serviceRow?.name ?? 'Konsultasi';
  const dateStr = toWIBDate(appt.startTime);
  const timeStr = toWIBTime(appt.startTime);
  const buyerName = buyer.displayName ? `, ${buyer.displayName}` : '';

  // Compose reminder message
  const message = reminderType === '24h'
    ? `Halo${buyerName}! 👋 Mengingatkan bahwa kamu punya jadwal *${serviceName}* bersama *${staffName}* besok:\n\n` +
      `📅 *${dateStr}*\n` +
      `⏰ *${timeStr}*\n\n` +
      `Harap hadir tepat waktu ya. Jika ada perubahan, silakan hubungi kami secepatnya. 🙏`
    : `Halo${buyerName}! ⏰ Jadwal *${serviceName}* kamu bersama *${staffName}* akan dimulai dalam *1 jam*:\n\n` +
      `📅 *${dateStr}* pukul *${timeStr}*\n\n` +
      `Kami menunggu kamu! 😊`;

  try {
    const metaClient = await getTenantClient(tenantId);

    // Reminders are sent as free-form text within the assumption that the buyer
    // initiated contact recently (they booked via WhatsApp). However, if 24h window
    // has expired, we must use a template. For now we attempt sendText and catch.
    await metaClient.sendText({ to: buyer.waPhone, message, isWithin24hrWindow: true });

    console.info(
      `[reminder] Sent ${reminderType} reminder for appointment ${appointmentId} to ${buyer.waPhone}`,
    );

    return { sent: true, reminderType, waPhone: buyer.waPhone };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // If outside 24h window, Meta returns error code 131047
    if (msg.includes('131047') || msg.includes('outside 24 hour')) {
      console.warn(
        `[reminder] Cannot send ${reminderType} reminder for ${appointmentId} — outside 24h session window. ` +
        `Template fallback not yet configured.`,
      );
      return { skipped: true, reason: 'outside_24h_window' };
    }
    throw err; // BullMQ will retry
  }
};
