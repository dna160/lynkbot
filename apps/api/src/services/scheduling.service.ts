/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/services/scheduling.service.ts
 * Role    : Core business logic for the Scheduling & Booking module.
 *           Owns: availability query (multi-staff, UTC/WIB), appointment CRUD,
 *           staff/service management, LLM JSON envelope execution,
 *           BullMQ reminder job management, staff confirmation dispatch.
 * Exports : SchedulingService
 * DO NOT  : Expose HTTP routes. Call Meta only via getTenantMetaClient.
 */
import { Queue } from 'bullmq';
import {
  db,
  appointments, staff, services, serviceStaff, staffAvailability, buyers, tenants, conversations,
  eq, and, or, sql,
} from '@lynkbot/db';
import { QUEUES, STAFF_CONFIRMATION_KEYWORDS, STAFF_REJECTION_KEYWORDS } from '@lynkbot/shared';
import { formatWIBDatetime } from '@lynkbot/ai';
import { getTenantMetaClient } from './_meta.helper';
import { getCalendarAdapter } from './calendarAdapter';
import type { FastifyBaseLogger } from 'fastify';

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000; // UTC+7
const SLOT_LOOKAHEAD_DAYS = parseInt(process.env.BOOKING_SLOT_LOOKAHEAD_DAYS ?? '14', 10);
const MIN_LEAD_TIME_HOURS = parseInt(process.env.BOOKING_MIN_LEAD_TIME_HOURS ?? '1', 10);

// Redis connection from env — mirrors the pattern in apps/worker/src/index.ts
function getRedisConnection() {
  if (process.env.REDIS_URL) {
    const url = new URL(process.env.REDIS_URL);
    return { host: url.hostname, port: Number(url.port) || 6379, password: url.password || undefined };
  }
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD,
  };
}

/** WIB date string "YYYY-MM-DD" for grouping by calendar date */
function wibDateString(utcDate: Date): string {
  const wib = new Date(utcDate.getTime() + WIB_OFFSET_MS);
  return wib.toISOString().slice(0, 10);
}

/** Parse 'HH:MM' string into [hour, minute] */
function parseHHMM(hhmm: string): [number, number] {
  const [h, m] = hhmm.split(':').map(Number);
  return [h ?? 0, m ?? 0];
}

interface AvailableSlot {
  start: Date;
  end: Date;
  staffId: string;
  staffName: string;
  serviceId: string;
  durationMinutes: number;
}

/**
 * Returns the WhatsApp template name to use for staff confirmation messages.
 * Priority: service-level override → tenant-level override → system default.
 */
async function resolveStaffConfirmationTemplate(tenantId: string, serviceId: string | null): Promise<string> {
  if (serviceId) {
    const svc = await db.query.services.findFirst({ where: eq(services.id, serviceId) });
    if (svc?.confirmationTemplateName) return svc.confirmationTemplateName;
  }
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  return tenant?.staffConfirmationTemplateName ?? 'appointment_confirmation';
}

export class SchedulingService {
  // ─────────────────────────────────────────────────────────────────────────────
  // Availability query — core algorithm (PRD §3.4)
  // ─────────────────────────────────────────────────────────────────────────────

  async getAvailableSlots(
    tenantId: string,
    serviceName: string,
    requestedDatetime?: string,
    count = 3,
  ): Promise<AvailableSlot[]> {
    // 1. Resolve service — exact match first, then partial/fuzzy fallback
    let service = await db.query.services.findFirst({
      where: and(
        eq(services.tenantId, tenantId),
        sql`lower(${services.name}) = lower(${serviceName})`,
        eq(services.isActive, true),
      ),
    });

    if (!service) {
      // Fuzzy fallback: either the DB name contains the requested term or vice versa
      service = await db.query.services.findFirst({
        where: and(
          eq(services.tenantId, tenantId),
          sql`lower(${services.name}) like lower(${'%' + serviceName + '%'}) or lower(${serviceName}) like lower(${'%' + services.name + '%'})`,
          eq(services.isActive, true),
        ),
      });
    }

    if (!service) {
      const available = await db.query.services.findMany({
        where: and(eq(services.tenantId, tenantId), eq(services.isActive, true)),
      });
      const names = available.map(s => `"${s.name}"`).join(', ');
      throw new Error(`Service "${serviceName}" not found. Available: ${names || 'none'}.`);
    }

    // 2. Get all active staff for this service via join
    const staffLinks = await db
      .select({ staffId: serviceStaff.staffId })
      .from(serviceStaff)
      .innerJoin(staff, eq(staff.id, serviceStaff.staffId))
      .where(and(eq(serviceStaff.serviceId, service.id), eq(staff.isActive, true)));

    if (staffLinks.length === 0) {
      throw new Error(`No active staff assigned to service "${serviceName}".`);
    }

    // 3. Get staff details + availability rows
    const staffIds = staffLinks.map(l => l.staffId);
    const staffRows = await db.query.staff.findMany({
      where: and(
        eq(staff.tenantId, tenantId),
        eq(staff.isActive, true),
        sql`${staff.id} = ANY(ARRAY[${sql.join(staffIds.map(id => sql`${id}::uuid`), sql`, `)}])`,
      ),
    });
    const availRows = await db.query.staffAvailability.findMany({
      where: sql`${staffAvailability.staffId} = ANY(ARRAY[${sql.join(staffIds.map(id => sql`${id}::uuid`), sql`, `)}])`,
    });

    // 4. Expand weekly schedule into concrete slots
    const adapter = getCalendarAdapter();
    const now = new Date();
    const minStart = new Date(now.getTime() + MIN_LEAD_TIME_HOURS * 3600 * 1000);
    const maxEnd = new Date(now.getTime() + SLOT_LOOKAHEAD_DAYS * 86400 * 1000);
    const durationMs = service.durationMinutes * 60 * 1000;

    const freeSlots: AvailableSlot[] = [];

    for (const staffRow of staffRows.sort((a, b) => a.name.localeCompare(b.name))) {
      const myAvail = availRows.filter(r => r.staffId === staffRow.id);

      // Iterate each day in lookahead window
      const cursor = new Date(minStart);
      cursor.setUTCHours(0, 0, 0, 0);

      while (cursor <= maxEnd) {
        // JS getDay() for WIB date
        const wibDay = new Date(cursor.getTime() + WIB_OFFSET_MS);
        const dayOfWeek = wibDay.getUTCDay();

        const dayAvail = myAvail.filter(a => a.dayOfWeek === dayOfWeek);
        for (const avail of dayAvail) {
          const [sh, sm] = parseHHMM(avail.startTime);
          const [eh, em] = parseHHMM(avail.endTime);

          // Build slot start times for this staff/day
          let slotStart = new Date(Date.UTC(
            wibDay.getUTCFullYear(), wibDay.getUTCMonth(), wibDay.getUTCDate(),
            sh - 7, sm, // Convert WIB hour to UTC (subtract 7)
          ));
          const dayEndUTC = new Date(Date.UTC(
            wibDay.getUTCFullYear(), wibDay.getUTCMonth(), wibDay.getUTCDate(),
            eh - 7, em,
          ));

          while (slotStart < dayEndUTC) {
            const slotEnd = new Date(slotStart.getTime() + durationMs);
            if (slotEnd > dayEndUTC) break;
            if (slotStart >= minStart) {
              // 5. Check availability
              const available = await adapter.isSlotAvailable(staffRow.id, slotStart, slotEnd);
              if (available) {
                freeSlots.push({
                  start: new Date(slotStart),
                  end: new Date(slotEnd),
                  staffId: staffRow.id,
                  staffName: staffRow.name,
                  serviceId: service.id,
                  durationMinutes: service.durationMinutes,
                });
              }
            }
            slotStart = new Date(slotStart.getTime() + durationMs);
          }
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }

    // 6. Sort ascending by start time
    freeSlots.sort((a, b) => a.start.getTime() - b.start.getTime());

    // 7. If requested_datetime: find exact or closest slot
    if (requestedDatetime) {
      const reqDate = new Date(requestedDatetime);
      const exact = freeSlots.find(s => s.start.getTime() === reqDate.getTime());
      if (exact) return [exact];
      // Closest by absolute time difference
      freeSlots.sort((a, b) =>
        Math.abs(a.start.getTime() - reqDate.getTime()) - Math.abs(b.start.getTime() - reqDate.getTime())
      );
      return freeSlots.slice(0, 1);
    }

    // 8. Return first `count` slots on different WIB calendar dates
    const result: AvailableSlot[] = [];
    const seenDates = new Set<string>();
    for (const slot of freeSlots) {
      const dateStr = wibDateString(slot.start);
      if (!seenDates.has(dateStr)) {
        seenDates.add(dateStr);
        result.push(slot);
        if (result.length >= count) break;
      }
    }
    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Appointment CRUD
  // ─────────────────────────────────────────────────────────────────────────────

  async createAppointment(
    tenantId: string,
    buyerId: string,
    staffId: string,
    serviceId: string,
    startTime: Date,
  ) {
    const service = await db.query.services.findFirst({ where: eq(services.id, serviceId) });
    const durationMs = (service?.durationMinutes ?? 60) * 60 * 1000;
    const endTime = new Date(startTime.getTime() + durationMs);

    const [appt] = await db.insert(appointments).values({
      tenantId, buyerId, staffId, serviceId,
      startTime, endTime, status: 'negotiating',
      createdAt: new Date(), updatedAt: new Date(),
    }).returning();
    return appt;
  }

  async getAppointment(id: string, tenantId: string) {
    return db.query.appointments.findFirst({
      where: and(eq(appointments.id, id), eq(appointments.tenantId, tenantId)),
    });
  }

  async listAppointments(tenantId: string, filters: {
    dateFrom?: string; dateTo?: string; status?: string; staffId?: string; page?: number; limit?: number;
  }) {
    const { page = 1, limit = 20, status, staffId, dateFrom, dateTo } = filters;
    const conditions = [eq(appointments.tenantId, tenantId)];
    if (status) conditions.push(eq(appointments.status, status as 'negotiating' | 'pending_doctor' | 'confirmed' | 'cancelled'));
    if (staffId) conditions.push(eq(appointments.staffId, staffId));
    if (dateFrom) conditions.push(sql`${appointments.startTime} >= ${new Date(dateFrom).toISOString()}::timestamptz`);
    if (dateTo) conditions.push(sql`${appointments.startTime} <= ${new Date(dateTo).toISOString()}::timestamptz`);

    return db.query.appointments.findMany({
      where: and(...conditions),
      orderBy: (t, { asc }) => asc(t.startTime),
      limit,
      offset: (page - 1) * limit,
    });
  }

  async updateAppointmentStatus(
    id: string,
    tenantId: string,
    newStatus: 'negotiating' | 'pending_doctor' | 'confirmed' | 'cancelled',
  ) {
    const appt = await this.getAppointment(id, tenantId);
    if (!appt) throw new Error('Appointment not found');

    const [updated] = await db
      .update(appointments)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(and(eq(appointments.id, id), eq(appointments.tenantId, tenantId)))
      .returning();

    // Enqueue reminder when confirmed
    if (newStatus === 'confirmed' && updated) {
      await this.enqueueReminderJob(updated).catch(err =>
        console.error('[scheduling] Failed to enqueue reminder job:', err)
      );
    }

    // Remove BullMQ job when cancelled
    if (newStatus === 'cancelled' && appt.bullmqJobId) {
      await this.removeReminderJob(appt.bullmqJobId).catch(err =>
        console.error('[scheduling] Failed to remove reminder job:', err)
      );
    }

    return updated;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // BullMQ reminder jobs
  // ─────────────────────────────────────────────────────────────────────────────

  async enqueueReminderJob(appt: typeof appointments.$inferSelect) {
    const queue = new Queue(QUEUES.REMINDERS, { connection: getRedisConnection() });
    const delayMs = appt.startTime.getTime() - appt.reminderOffsetH * 3600 * 1000 - Date.now();

    if (delayMs <= 0) {
      console.log(`[scheduling] Reminder for ${appt.id} would fire in the past — skipping`);
      await queue.close();
      return;
    }

    const jobId = `reminder:${appt.id}`;
    await queue.add('reminder', { appointment_id: appt.id, tenant_id: appt.tenantId }, {
      jobId,
      delay: delayMs,
      attempts: 3,
      backoff: { type: 'exponential', delay: 30000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    });

    await db.update(appointments).set({ bullmqJobId: jobId, updatedAt: new Date() }).where(eq(appointments.id, appt.id));
    await queue.close();
    console.log(`[scheduling] Reminder enqueued: ${jobId}, delay=${Math.round(delayMs / 60000)}min`);
  }

  async removeReminderJob(bullmqJobId: string) {
    const queue = new Queue(QUEUES.REMINDERS, { connection: getRedisConnection() });
    try {
      const job = await queue.getJob(bullmqJobId);
      if (job) {
        await job.remove();
        console.log(`[scheduling] Reminder job removed: ${bullmqJobId}`);
      }
    } finally {
      await queue.close();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Staff confirmation templates
  // ─────────────────────────────────────────────────────────────────────────────

  async sendStaffConfirmationTemplate(
    appt: typeof appointments.$inferSelect,
    buyerName: string,
    staffName: string,
    staffPhone: string,
    serviceName: string,
    tenantId: string,
    serviceId?: string | null,
  ) {
    const meta = await getTenantMetaClient(tenantId);
    const timeDisplay = formatWIBDatetime(appt.startTime, appt.endTime);
    const templateName = await resolveStaffConfirmationTemplate(tenantId, serviceId ?? null);

    await meta.sendTemplate({
      to: staffPhone,
      templateName,
      languageCode: 'id',
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: staffName },
            { type: 'text', text: buyerName },
            { type: 'text', text: serviceName },
            { type: 'text', text: timeDisplay },
          ],
        },
        {
          type: 'button',
          sub_type: 'quick_reply',
          index: 0,
          parameters: [{ type: 'payload', payload: `CONFIRM_APPOINTMENT_${appt.id}` }],
        },
        {
          type: 'button',
          sub_type: 'quick_reply',
          index: 1,
          parameters: [{ type: 'payload', payload: `DECLINE_APPOINTMENT_${appt.id}` }],
        },
      ],
    });
    console.log(`[scheduling] Staff confirmation template sent to ${staffPhone} for appointment ${appt.id}`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Staff webhook handlers
  // ─────────────────────────────────────────────────────────────────────────────

  async handleStaffButtonReply(
    tenantId: string,
    appointmentId: string,
    isConfirm: boolean,
    log: FastifyBaseLogger,
  ) {
    const appt = await this.getAppointment(appointmentId, tenantId);
    if (!appt) {
      log.warn({ appointmentId }, '[scheduling] Staff button reply: appointment not found');
      return;
    }
    if (appt.status !== 'pending_doctor') {
      log.warn({ appointmentId, status: appt.status }, '[scheduling] Staff button reply: appointment not in pending_doctor state — ignoring');
      return;
    }

    const buyer = await db.query.buyers.findFirst({ where: eq(buyers.id, appt.buyerId) });
    if (!buyer) return;

    const meta = await getTenantMetaClient(tenantId);

    if (isConfirm) {
      await this.updateAppointmentStatus(appointmentId, tenantId, 'confirmed');
      const timeDisplay = formatWIBDatetime(appt.startTime, appt.endTime);
      const confirmMsg = `✅ Appointment kamu *dikonfirmasi*!\n\n📅 ${timeDisplay}\n\nSampai jumpa! Hubungi kami jika ada perubahan.`;
      await meta.sendText({ to: buyer.waPhone, message: confirmMsg, isWithin24hrWindow: true }).catch(() =>
        meta.sendTemplate({ to: buyer.waPhone, templateName: 'aria_appointment_confirmation_buyer', languageCode: 'id', components: [] }).catch(() => null)
      );
      log.info({ appointmentId }, '[scheduling] Appointment confirmed by staff');
    } else {
      // Cancel the declined appointment
      await this.updateAppointmentStatus(appointmentId, tenantId, 'cancelled');

      // Reset conversation state back to SCHEDULING so the buyer can pick a new slot
      // without having to restart the whole flow with a keyword.
      const buyerConv = await db.query.conversations.findFirst({
        where: and(
          eq(conversations.tenantId, tenantId),
          eq(conversations.buyerId, appt.buyerId),
          eq(conversations.isActive, true),
        ),
        columns: { id: true },
      });
      if (buyerConv) {
        await db.update(conversations)
          .set({ state: 'SCHEDULING', lastMessageAt: new Date() })
          .where(eq(conversations.id, buyerConv.id));
      }

      // Re-present available slots for the same service
      let declineMsg: string;
      try {
        const serviceRow = await db.query.services.findFirst({ where: eq(services.id, appt.serviceId) });
        const slots = serviceRow ? await this.getAvailableSlots(tenantId, serviceRow.name, undefined, 3) : [];

        if (slots.length > 0) {
          const lines = slots.map((s, i) => {
            const label = ['1️⃣', '2️⃣', '3️⃣'][i] ?? `${i + 1}.`;
            return `${label} *${formatWIBDatetime(s.start, s.end)}* — ${s.staffName}`;
          });
          declineMsg = `😔 Maaf, jadwal yang dipilih tidak bisa dikonfirmasi.\n\nBerikut jadwal lain yang tersedia:\n\n${lines.join('\n')}\n\nPilih nomor berapa, Kak? 😊`;
        } else {
          declineMsg = `😔 Maaf, jadwal yang dipilih tidak bisa dikonfirmasi dan saat ini tidak ada jadwal lain yang tersedia. Silakan hubungi kami langsung.`;
        }
      } catch (err) {
        log.warn({ appointmentId, err }, '[scheduling] Failed to fetch slots for decline message');
        declineMsg = `😔 Maaf, jadwal tidak bisa dikonfirmasi. Balas *booking* untuk mencoba jadwal lain.`;
      }

      await meta.sendText({ to: buyer.waPhone, message: declineMsg, isWithin24hrWindow: true }).catch(() => null);
      log.info({ appointmentId }, '[scheduling] Appointment declined — slots re-presented to buyer');
    }
  }

  async handleStaffKeywordReply(
    tenantId: string,
    staffId: string,
    staffPhone: string,
    messageText: string,
    log: FastifyBaseLogger,
  ) {
    const lower = messageText.toLowerCase().trim();

    const isConfirm = (STAFF_CONFIRMATION_KEYWORDS as readonly string[]).some(kw => lower === kw);
    const isDecline = (STAFF_REJECTION_KEYWORDS as readonly string[]).some(kw => lower === kw);

    if (!isConfirm && !isDecline) {
      // Not a keyword — send guidance back to staff
      const meta = await getTenantMetaClient(tenantId);
      await meta.sendText({
        to: staffPhone,
        message: 'Balas *[Konfirmasi]* untuk menyetujui atau *[Tolak]* untuk menolak appointment.',
        isWithin24hrWindow: true,
      }).catch(() => null);
      log.debug({ staffId, messageText }, '[scheduling] Staff sent unrecognized keyword — guidance sent');
      return;
    }

    // Find most recent pending_doctor appointment for this staff
    const pending = await db.query.appointments.findFirst({
      where: and(
        eq(appointments.tenantId, tenantId),
        eq(appointments.staffId, staffId),
        eq(appointments.status, 'pending_doctor'),
      ),
      orderBy: (t, { desc }) => desc(t.createdAt),
    });

    if (!pending) {
      log.warn({ staffId }, '[scheduling] Staff keyword reply: no pending_doctor appointment found');
      return;
    }

    await this.handleStaffButtonReply(tenantId, pending.id, isConfirm, log);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // LLM envelope execution
  // ─────────────────────────────────────────────────────────────────────────────

  async handleLLMEnvelope(
    tenantId: string,
    conv: { id: string; state: string },
    buyer: { id: string; displayName?: string | null; waPhone: string },
    envelope: { action: string; service_name?: string; requested_datetime?: string; staff_id?: string; service_id?: string; start_time?: string; previous_appointment_id?: string },
    overrideConfirmationStaffId?: string,
    confirmationModel?: 'instant' | 'staff_confirm',
  ): Promise<string> {
    if (envelope.action === 'check_availability') {
      const slots = await this.getAvailableSlots(
        tenantId,
        envelope.service_name ?? '',
        envelope.requested_datetime,
      );

      if (slots.length === 0) {
        return 'Maaf, tidak ada jadwal yang tersedia dalam 14 hari ke depan untuk layanan ini. Coba hubungi kami langsung ya.';
      }

      const lines = slots.map((s, i) => {
        const label = ['1️⃣', '2️⃣', '3️⃣'][i] ?? `${i + 1}.`;
        return `${label} *${formatWIBDatetime(s.start, s.end)}* — ${s.staffName}`;
      });
      return `Berikut jadwal yang tersedia:\n\n${lines.join('\n')}\n\nPilih nomor berapa, Kak? 😊`;
    }

    if (envelope.action === 'confirm_booking') {
      if (!envelope.staff_id || !envelope.service_id || !envelope.start_time) {
        return 'Terjadi kesalahan saat memproses booking. Coba ulangi pilihan jadwal kamu.';
      }

      const startTime = new Date(envelope.start_time);
      const appt = await this.createAppointment(
        tenantId, buyer.id, envelope.staff_id, envelope.service_id, startTime,
      );

      const slotStaff = await db.query.staff.findFirst({ where: eq(staff.id, envelope.staff_id) });
      const serviceRow = await db.query.services.findFirst({ where: eq(services.id, envelope.service_id) });
      const timeDisplay = formatWIBDatetime(startTime, new Date(startTime.getTime() + (serviceRow?.durationMinutes ?? 60) * 60 * 1000));

      // ── Instant confirmation — auto-confirm, skip staff notification ──────────
      if (confirmationModel === 'instant') {
        await this.updateAppointmentStatus(appt.id, tenantId, 'confirmed');
        return `✅ Appointment kamu *dikonfirmasi*!\n\n📅 ${timeDisplay}\n🏥 ${serviceRow?.name ?? 'Konsultasi'}\n\nSampai jumpa! Hubungi kami jika ada perubahan.`;
      }

      // ── Staff-confirm (default) — pending_doctor + notify staff ───────────────
      await this.updateAppointmentStatus(appt.id, tenantId, 'pending_doctor');

      // Confirmation staff priority: explicit override → service.confirmationStaffId → slot staff
      let notifyStaff = slotStaff;
      if (overrideConfirmationStaffId) {
        notifyStaff = (await db.query.staff.findFirst({ where: and(eq(staff.id, overrideConfirmationStaffId), eq(staff.tenantId, tenantId)) })) ?? slotStaff;
      } else {
        const svcConfirmStaff = await this.getConfirmationStaff(envelope.service_id, tenantId);
        if (svcConfirmStaff) notifyStaff = svcConfirmStaff;
      }

      if (notifyStaff && serviceRow) {
        await this.sendStaffConfirmationTemplate(
          appt, buyer.displayName ?? 'Pelanggan', notifyStaff.name, notifyStaff.phoneNumber, serviceRow.name, tenantId, envelope.service_id,
        ).catch(err => console.error('[scheduling] Staff confirmation template failed:', err));
      }

      return `Oke, kami sedang mengecek ketersediaan jadwal dengan tim kami 🔍\n\nKamu akan mendapat konfirmasi secepatnya ya, Kak. Mohon tunggu sebentar 🙏`;
    }

    if (envelope.action === 'reschedule_booking') {
      if (!envelope.previous_appointment_id || !envelope.requested_datetime) {
        return 'Terjadi kesalahan saat memproses perubahan jadwal. Coba ulangi ya.';
      }

      const newStartTime = new Date(envelope.requested_datetime);
      return this.handleRescheduleRequest(
        envelope.previous_appointment_id,
        tenantId,
        newStartTime,
        buyer.displayName ?? 'Pelanggan',
      );
    }

    return 'Maaf, terjadi kesalahan. Coba lagi ya.';
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Staff CRUD
  // ─────────────────────────────────────────────────────────────────────────────

  async listStaff(tenantId: string) {
    return db.query.staff.findMany({
      where: eq(staff.tenantId, tenantId),
      orderBy: (t, { asc }) => asc(t.name),
    });
  }

  async getStaff(id: string, tenantId: string) {
    return db.query.staff.findFirst({ where: and(eq(staff.id, id), eq(staff.tenantId, tenantId)) });
  }

  async createStaff(tenantId: string, data: { name: string; phoneNumber: string; role?: string; isActive?: boolean }) {
    // If a staff record with this phone already exists for the tenant, reactivate it
    // rather than hitting the unique constraint. Only block if they're already active.
    const existing = await db.query.staff.findFirst({
      where: and(eq(staff.tenantId, tenantId), eq(staff.phoneNumber, data.phoneNumber)),
    });

    if (existing) {
      if (existing.isActive) {
        const err = Object.assign(new Error('Duplicate phone number'), { code: '23505' });
        throw err;
      }
      const [row] = await db
        .update(staff)
        .set({ name: data.name, role: data.role ?? existing.role, isActive: true })
        .where(eq(staff.id, existing.id))
        .returning();
      return row;
    }

    const [row] = await db.insert(staff).values({ tenantId, ...data, createdAt: new Date() }).returning();
    return row;
  }

  async updateStaff(id: string, tenantId: string, data: Partial<{ name: string; phoneNumber: string; role: string; isActive: boolean }>) {
    const [row] = await db.update(staff).set(data).where(and(eq(staff.id, id), eq(staff.tenantId, tenantId))).returning();
    return row;
  }

  async setStaffAvailability(staffId: string, tenantId: string, rows: { dayOfWeek: number; startTime: string; endTime: string }[]) {
    // Verify staff belongs to tenant
    const staffRow = await this.getStaff(staffId, tenantId);
    if (!staffRow) throw new Error('Staff not found');

    // Replace all availability rows
    await db.delete(staffAvailability).where(eq(staffAvailability.staffId, staffId));
    if (rows.length > 0) {
      await db.insert(staffAvailability).values(rows.map(r => ({ staffId, ...r })));
    }
    return db.query.staffAvailability.findMany({ where: eq(staffAvailability.staffId, staffId) });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Services CRUD
  // ─────────────────────────────────────────────────────────────────────────────

  async listServices(tenantId: string) {
    return db.query.services.findMany({
      where: eq(services.tenantId, tenantId),
      orderBy: (t, { asc }) => asc(t.name),
    });
  }

  async createService(tenantId: string, data: { name: string; durationMinutes?: number; staffIds?: string[]; confirmationStaffId?: string; isActive?: boolean }) {
    const [svc] = await db.insert(services).values({
      tenantId, name: data.name,
      durationMinutes: data.durationMinutes ?? 60,
      confirmationStaffId: data.confirmationStaffId || null,
      isActive: data.isActive ?? true,
      createdAt: new Date(),
    }).returning();

    if (data.staffIds?.length) {
      await db.insert(serviceStaff).values(data.staffIds.map(staffId => ({ serviceId: svc.id, staffId })));
    }
    return svc;
  }

  async updateService(id: string, tenantId: string, data: { name?: string; durationMinutes?: number; staffIds?: string[]; confirmationStaffId?: string | null; isActive?: boolean }) {
    const { staffIds, ...fields } = data;
    const [svc] = await db.update(services).set(fields).where(and(eq(services.id, id), eq(services.tenantId, tenantId))).returning();
    if (!svc) throw new Error('Service not found');

    if (staffIds !== undefined) {
      await db.delete(serviceStaff).where(eq(serviceStaff.serviceId, id));
      if (staffIds.length > 0) {
        await db.insert(serviceStaff).values(staffIds.map(staffId => ({ serviceId: id, staffId })));
      }
    }
    return svc;
  }

  async getServiceWithStaff(id: string, tenantId: string) {
    const svc = await db.query.services.findFirst({ where: and(eq(services.id, id), eq(services.tenantId, tenantId)) });
    if (!svc) return null;
    const links = await db.select({ staffId: serviceStaff.staffId }).from(serviceStaff).where(eq(serviceStaff.serviceId, id));
    return { ...svc, staffIds: links.map(l => l.staffId) };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Rescheduling support
  // ─────────────────────────────────────────────────────────────────────────────

  async getConfirmationStaff(serviceId: string, tenantId: string) {
    const svc = await db.query.services.findFirst({
      where: and(eq(services.id, serviceId), eq(services.tenantId, tenantId)),
    });
    if (!svc || !svc.confirmationStaffId) return null;
    return db.query.staff.findFirst({
      where: and(eq(staff.id, svc.confirmationStaffId), eq(staff.tenantId, tenantId)),
    });
  }

  async sendStaffRescheduleTemplate(
    newAppt: typeof appointments.$inferSelect,
    oldAppt: typeof appointments.$inferSelect,
    buyerName: string,
    staffName: string,
    staffPhone: string,
    tenantId: string,
  ) {
    const meta = await getTenantMetaClient(tenantId);
    const oldTimeDisplay = formatWIBDatetime(oldAppt.startTime, oldAppt.endTime);
    const newTimeDisplay = formatWIBDatetime(newAppt.startTime, newAppt.endTime);

    await meta.sendTemplate({
      to: staffPhone,
      templateName: 'aria_reschedule_request',
      languageCode: 'id',
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: staffName },
            { type: 'text', text: buyerName },
            { type: 'text', text: oldTimeDisplay },
            { type: 'text', text: newTimeDisplay },
          ],
        },
        {
          type: 'button',
          sub_type: 'quick_reply',
          index: 0,
          parameters: [{ type: 'payload', payload: `appt_reschedule_approve:${newAppt.id}` }],
        },
        {
          type: 'button',
          sub_type: 'quick_reply',
          index: 1,
          parameters: [{ type: 'payload', payload: `appt_reschedule_reject:${newAppt.id}` }],
        },
      ],
    });
    console.log(`[scheduling] Reschedule template sent to ${staffPhone} for appointment ${newAppt.id}`);
  }

  async handleRescheduleRequest(
    appointmentId: string,
    tenantId: string,
    newStartTime: Date,
    buyerName: string,
  ): Promise<string> {
    const oldAppt = await this.getAppointment(appointmentId, tenantId);
    if (!oldAppt) {
      return 'Appointment tidak ditemukan. Coba hubungi kami langsung.';
    }

    if (!['pending_doctor', 'confirmed'].includes(oldAppt.status)) {
      return 'Appointment ini tidak bisa direscheduling. Hubungi kami langsung untuk bantuan.';
    }

    const service = await db.query.services.findFirst({ where: eq(services.id, oldAppt.serviceId) });
    const durationMs = (service?.durationMinutes ?? 60) * 60 * 1000;
    const newEndTime = new Date(newStartTime.getTime() + durationMs);

    const newAppt = await db.insert(appointments).values({
      tenantId,
      buyerId: oldAppt.buyerId,
      staffId: oldAppt.staffId,
      serviceId: oldAppt.serviceId,
      startTime: newStartTime,
      endTime: newEndTime,
      status: 'rescheduling_requested',
      previousAppointmentId: oldAppt.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning().then(rows => rows[0]);

    const confirmationStaff = await this.getConfirmationStaff(oldAppt.serviceId, tenantId);
    const staffToNotify = confirmationStaff || (await this.getStaff(oldAppt.staffId, tenantId));

    if (staffToNotify) {
      await this.sendStaffRescheduleTemplate(
        newAppt,
        oldAppt,
        buyerName || 'Pelanggan',
        staffToNotify.name,
        staffToNotify.phoneNumber,
        tenantId,
      ).catch(err => console.error('[scheduling] Failed to send reschedule template:', err));
    }

    return `Baik, permintaan perubahan jadwal sudah dikirim ke ${staffToNotify?.name ?? 'staf'}. Tunggu persetujuannya ya! 🙏`;
  }

  async handleStaffRescheduleApproval(
    newAppointmentId: string,
    tenantId: string,
    isApprove: boolean,
    log: FastifyBaseLogger,
  ) {
    const newAppt = await this.getAppointment(newAppointmentId, tenantId);
    if (!newAppt) {
      log.warn({ appointmentId: newAppointmentId }, '[scheduling] Reschedule approval: appointment not found');
      return;
    }

    if (newAppt.status !== 'rescheduling_requested') {
      log.warn(
        { appointmentId: newAppointmentId, status: newAppt.status },
        '[scheduling] Reschedule approval: appointment not in rescheduling_requested state'
      );
      return;
    }

    if (!newAppt.previousAppointmentId) {
      log.warn({ appointmentId: newAppointmentId }, '[scheduling] Reschedule approval: no previous appointment found');
      return;
    }

    const oldAppt = await this.getAppointment(newAppt.previousAppointmentId, tenantId);
    const buyer = await db.query.buyers.findFirst({ where: eq(buyers.id, newAppt.buyerId) });

    if (!buyer) return;

    const meta = await getTenantMetaClient(tenantId);

    if (isApprove) {
      await db.update(appointments).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(appointments.id, newAppt.previousAppointmentId));
      await this.updateAppointmentStatus(newAppointmentId, tenantId, 'pending_doctor');

      const newTimeDisplay = formatWIBDatetime(newAppt.startTime, newAppt.endTime);
      const approveMsg = `✅ Permintaan reschedule kamu *disetujui*!\n\n📅 Jadwal baru: ${newTimeDisplay}\n\nTunggu konfirmasi dari staf ya! 🙏`;

      await meta.sendText({ to: buyer.waPhone, message: approveMsg, isWithin24hrWindow: true }).catch(() =>
        meta.sendTemplate({ to: buyer.waPhone, templateName: 'aria_reschedule_approved', languageCode: 'id', components: [] }).catch(() => null)
      );

      log.info({ appointmentId: newAppointmentId }, '[scheduling] Reschedule approved by staff');
    } else {
      await db.update(appointments).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(appointments.id, newAppointmentId));

      const rejectMsg = `😔 Maaf, perubahan jadwal tidak bisa disetujui. Jadwal awal kamu tetap berlaku: ${oldAppt ? formatWIBDatetime(oldAppt.startTime, oldAppt.endTime) : 'N/A'}\n\nHubungi kami jika ada pertanyaan.`;
      await meta.sendText({ to: buyer.waPhone, message: rejectMsg, isWithin24hrWindow: true }).catch(() => null);

      log.info({ appointmentId: newAppointmentId }, '[scheduling] Reschedule rejected by staff');
    }
  }
}
