/**
 * @CLAUDE_CONTEXT
 * Package : packages/flow-engine
 * File    : src/nodeProcessors/agent.ts
 * Role    : AGENT node — embedded conversational scheduling agent inside a flow.
 *           Replaces the START_SCHEDULING + AI Playbook two-step with a single
 *           configurable node that owns the full booking conversation.
 *
 * Two exit ports:
 *   customer_reply — agent sent a message and is in waiting_reply state;
 *                    engine re-executes this node on the next buyer message.
 *   exit           — agent has completed its task (booking confirmed / declined).
 *
 * Memory: conversation history stored in ctx.variables['agent_<nodeId>_history'].
 *         Persisted by the engine into flowExecutions.context.variables.
 *         Only populated when config.memoryEnabled === true.
 *
 * Scheduling: uses SCHEDULING_SYSTEM_PROMPT + parseSchedulingEnvelope from
 *             @lynkbot/ai.  Mirrors the inline availability logic from
 *             apps/worker/src/services/webhookMessage.processor.ts.
 * Exports : agentProcessor
 */
import {
  db, services, serviceStaff, staff, staffAvailability, appointments,
  eq, and, or, sql,
} from '@lynkbot/db';
import {
  getLLMClient,
  SCHEDULING_SYSTEM_PROMPT,
  parseSchedulingEnvelope,
  formatWIBDatetime,
} from '@lynkbot/ai';
import type { FlowNode, ExecutionContext, AgentConfig } from '../types';
import type { NodeResult, ProcessorDeps } from './types';

// ── Scheduling constants ──────────────────────────────────────────────────────
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const SLOT_LOOKAHEAD_DAYS = parseInt(process.env.BOOKING_SLOT_LOOKAHEAD_DAYS ?? '14', 10);
const MIN_LEAD_TIME_HOURS = parseInt(process.env.BOOKING_MIN_LEAD_TIME_HOURS ?? '1', 10);

function parseHHMM(hhmm: string): [number, number] {
  const [h, m] = hhmm.split(':').map(Number);
  return [h ?? 0, m ?? 0];
}

function wibDateString(utcDate: Date): string {
  return new Date(utcDate.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

interface AvailableSlot {
  start: Date;
  end: Date;
  staffId: string;
  staffName: string;
  serviceId: string;
  durationMinutes: number;
}

async function isSlotFree(staffId: string, start: Date, end: Date): Promise<boolean> {
  const conflicts = await db
    .select({ id: appointments.id })
    .from(appointments)
    .where(
      and(
        eq(appointments.staffId, staffId),
        or(eq(appointments.status, 'pending_doctor'), eq(appointments.status, 'confirmed')),
        sql`${appointments.startTime} < ${end.toISOString()}::timestamptz`,
        sql`${appointments.endTime} > ${start.toISOString()}::timestamptz`,
      ),
    )
    .limit(1);
  return conflicts.length === 0;
}

async function getAvailableSlots(
  tenantId: string,
  serviceName: string,
  requestedDatetime?: string,
  count = 3,
): Promise<AvailableSlot[]> {
  let service = await db.query.services.findFirst({
    where: and(
      eq(services.tenantId, tenantId),
      sql`lower(${services.name}) = lower(${serviceName})`,
      eq(services.isActive, true),
    ),
  });

  if (!service) {
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

  const staffLinks = await db
    .select({ staffId: serviceStaff.staffId })
    .from(serviceStaff)
    .innerJoin(staff, eq(staff.id, serviceStaff.staffId))
    .where(and(eq(serviceStaff.serviceId, service.id), eq(staff.isActive, true)));

  if (staffLinks.length === 0) throw new Error(`No active staff for service "${serviceName}".`);

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

  const now = new Date();
  const minStart = new Date(now.getTime() + MIN_LEAD_TIME_HOURS * 3600 * 1000);
  const maxEnd = new Date(now.getTime() + SLOT_LOOKAHEAD_DAYS * 86400 * 1000);
  const durationMs = service.durationMinutes * 60 * 1000;
  const freeSlots: AvailableSlot[] = [];

  for (const staffRow of staffRows.sort((a, b) => a.name.localeCompare(b.name))) {
    const myAvail = availRows.filter(r => r.staffId === staffRow.id);
    const cursor = new Date(minStart);
    cursor.setUTCHours(0, 0, 0, 0);

    while (cursor <= maxEnd) {
      const wibDay = new Date(cursor.getTime() + WIB_OFFSET_MS);
      const dayOfWeek = wibDay.getUTCDay();
      for (const avail of myAvail.filter(a => a.dayOfWeek === dayOfWeek)) {
        const [sh, sm] = parseHHMM(avail.startTime);
        const [eh, em] = parseHHMM(avail.endTime);
        let slotStart = new Date(Date.UTC(wibDay.getUTCFullYear(), wibDay.getUTCMonth(), wibDay.getUTCDate(), sh - 7, sm));
        const dayEnd = new Date(Date.UTC(wibDay.getUTCFullYear(), wibDay.getUTCMonth(), wibDay.getUTCDate(), eh - 7, em));
        while (slotStart < dayEnd) {
          const slotEnd = new Date(slotStart.getTime() + durationMs);
          if (slotEnd > dayEnd) break;
          if (slotStart >= minStart && await isSlotFree(staffRow.id, slotStart, slotEnd)) {
            freeSlots.push({ start: new Date(slotStart), end: new Date(slotEnd), staffId: staffRow.id, staffName: staffRow.name, serviceId: service.id, durationMinutes: service.durationMinutes });
          }
          slotStart = new Date(slotStart.getTime() + durationMs);
        }
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  freeSlots.sort((a, b) => a.start.getTime() - b.start.getTime());

  if (requestedDatetime) {
    const reqDate = new Date(requestedDatetime);
    const exact = freeSlots.find(s => s.start.getTime() === reqDate.getTime());
    if (exact) return [exact];
    freeSlots.sort((a, b) => Math.abs(a.start.getTime() - reqDate.getTime()) - Math.abs(b.start.getTime() - reqDate.getTime()));
    return freeSlots.slice(0, 1);
  }

  const result: AvailableSlot[] = [];
  const seen = new Set<string>();
  for (const slot of freeSlots) {
    const d = wibDateString(slot.start);
    if (!seen.has(d)) { seen.add(d); result.push(slot); if (result.length >= count) break; }
  }
  return result;
}

// ── Variable substitution for staff message template ─────────────────────────

function renderTemplate(
  template: string,
  vars: { buyerName?: string; serviceName?: string; time?: string },
): string {
  return template
    .replace(/\{\{buyerName\}\}/g, vars.buyerName ?? 'Pelanggan')
    .replace(/\{\{serviceName\}\}/g, vars.serviceName ?? '')
    .replace(/\{\{time\}\}/g, vars.time ?? '');
}

// ── Envelope execution ────────────────────────────────────────────────────────

type AgentEnvelopeResult = { reply: string; exit: boolean };

async function executeEnvelope(
  envelope: { action: string; service_name?: string; requested_datetime?: string; staff_id?: string; service_id?: string; start_time?: string; previous_appointment_id?: string },
  ctx: ExecutionContext,
  config: AgentConfig,
  deps: ProcessorDeps,
): Promise<AgentEnvelopeResult> {
  // ── check_availability ────────────────────────────────────────────────────
  if (envelope.action === 'check_availability') {
    try {
      const slots = await getAvailableSlots(ctx.tenantId, envelope.service_name ?? '', envelope.requested_datetime);
      if (slots.length === 0) {
        return { reply: 'Maaf, tidak ada jadwal yang tersedia dalam 14 hari ke depan. Coba hubungi kami langsung ya.', exit: false };
      }
      const lines = slots.map((s, i) => `${['1️⃣', '2️⃣', '3️⃣'][i] ?? `${i + 1}.`} *${formatWIBDatetime(s.start, s.end)}* — ${s.staffName}`);
      return { reply: `Berikut jadwal yang tersedia:\n\n${lines.join('\n')}\n\nPilih nomor berapa, Kak? 😊`, exit: false };
    } catch (err: any) {
      return { reply: err?.message ?? 'Maaf, gagal cek jadwal. Coba lagi ya.', exit: false };
    }
  }

  // ── confirm_booking ───────────────────────────────────────────────────────
  if (envelope.action === 'confirm_booking') {
    if (!envelope.staff_id || !envelope.service_id || !envelope.start_time) {
      return { reply: 'Terjadi kesalahan saat memproses booking. Coba ulangi pilihan jadwal kamu.', exit: false };
    }

    const startTime = new Date(envelope.start_time);
    const serviceRow = await db.query.services.findFirst({ where: eq(services.id, envelope.service_id) });
    const durationMs = (serviceRow?.durationMinutes ?? 60) * 60 * 1000;
    const endTime = new Date(startTime.getTime() + durationMs);

    const [appt] = await db.insert(appointments).values({
      tenantId: ctx.tenantId,
      buyerId: ctx.buyerId,
      staffId: envelope.staff_id,
      serviceId: envelope.service_id,
      startTime,
      endTime,
      status: 'pending_doctor',
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();

    const slotStaff = await db.query.staff.findFirst({ where: eq(staff.id, envelope.staff_id) });
    const timeDisplay = formatWIBDatetime(startTime, endTime);
    const buyerName = ctx.buyer.displayName ?? ctx.buyer.name ?? 'Pelanggan';

    // Resolve primary notification staff (config.assignedStaffId overrides slot staff)
    const notifyStaff = config.assignedStaffId
      ? (await db.query.staff.findFirst({ where: and(eq(staff.id, config.assignedStaffId), eq(staff.tenantId, ctx.tenantId)) }) ?? slotStaff)
      : slotStaff;

    const meta = await deps.getMetaClient(ctx.tenantId);

    // Send primary staff notification
    if (notifyStaff) {
      const defaultMsg = `📅 Permintaan appointment baru!\n\n*Pasien:* ${buyerName}\n*Layanan:* ${serviceRow?.name ?? ''}\n*Waktu:* ${timeDisplay}\n\nBalas *Konfirmasi* untuk menerima atau *Tolak* untuk menolak.`;
      const staffMsg = config.staffMessage
        ? renderTemplate(config.staffMessage, { buyerName, serviceName: serviceRow?.name, time: timeDisplay })
        : defaultMsg;
      await meta.sendText({ to: notifyStaff.phoneNumber, message: staffMsg, isWithin24hrWindow: true }).catch(() => null);
    }

    // Send additional staff notifications
    for (const extra of config.additionalStaffNotifications ?? []) {
      const extraStaff = await db.query.staff.findFirst({ where: and(eq(staff.id, extra.staffId), eq(staff.tenantId, ctx.tenantId)) });
      if (extraStaff) {
        const extraMsg = renderTemplate(extra.message, { buyerName, serviceName: serviceRow?.name, time: timeDisplay });
        await meta.sendText({ to: extraStaff.phoneNumber, message: extraMsg, isWithin24hrWindow: true }).catch(() => null);
      }
    }

    const reply = `Baik, permintaan appointment *${serviceRow?.name ?? ''}* sudah kami kirim ke ${notifyStaff?.name ?? 'staf'}. Tunggu konfirmasinya ya, Kak 🙏\n\nKamu akan dapat notifikasi segera setelah dikonfirmasi.`;
    return { reply, exit: true };
  }

  // ── reschedule_booking ────────────────────────────────────────────────────
  if (envelope.action === 'reschedule_booking') {
    if (!envelope.previous_appointment_id || !envelope.requested_datetime) {
      return { reply: 'Terjadi kesalahan saat memproses perubahan jadwal. Coba ulangi ya.', exit: false };
    }

    const oldAppt = await db.query.appointments.findFirst({
      where: and(eq(appointments.id, envelope.previous_appointment_id), eq(appointments.tenantId, ctx.tenantId)),
    });
    if (!oldAppt) return { reply: 'Appointment tidak ditemukan. Silakan mulai booking baru.', exit: false };

    const newStartTime = new Date(envelope.requested_datetime);
    const serviceRow = await db.query.services.findFirst({ where: eq(services.id, oldAppt.serviceId) });
    const durationMs = (serviceRow?.durationMinutes ?? 60) * 60 * 1000;
    const newEndTime = new Date(newStartTime.getTime() + durationMs);

    const [newAppt] = await db.insert(appointments).values({
      tenantId: ctx.tenantId,
      buyerId: ctx.buyerId,
      staffId: oldAppt.staffId,
      serviceId: oldAppt.serviceId,
      startTime: newStartTime,
      endTime: newEndTime,
      status: 'rescheduling_requested' as any,
      previousAppointmentId: oldAppt.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();

    const notifyStaff = config.assignedStaffId
      ? (await db.query.staff.findFirst({ where: and(eq(staff.id, config.assignedStaffId), eq(staff.tenantId, ctx.tenantId)) }))
      : (await db.query.staff.findFirst({ where: eq(staff.id, oldAppt.staffId) }));

    if (notifyStaff && newAppt) {
      const meta = await deps.getMetaClient(ctx.tenantId);
      const staffMsg = `🔄 Permintaan reschedule!\n\n*Pasien:* ${ctx.buyer.displayName ?? ctx.buyer.name}\n*Layanan:* ${serviceRow?.name ?? ''}\n*Dari:* ${formatWIBDatetime(oldAppt.startTime, oldAppt.endTime)}\n*Ke:* ${formatWIBDatetime(newAppt.startTime, newAppt.endTime)}\n\nBalas *Konfirmasi* untuk menyetujui atau *Tolak* untuk menolak.`;
      await meta.sendText({ to: notifyStaff.phoneNumber, message: staffMsg, isWithin24hrWindow: true }).catch(() => null);
    }

    return {
      reply: `Permintaan reschedule sudah dikirim! Dari ${formatWIBDatetime(oldAppt.startTime)} ke ${formatWIBDatetime(newStartTime, newEndTime)}. Tunggu konfirmasi dari staf ya 🙏`,
      exit: true,
    };
  }

  return { reply: 'Maaf, terjadi kesalahan. Coba lagi ya.', exit: false };
}

// ── Main processor ────────────────────────────────────────────────────────────

type HistoryMessage = { role: 'user' | 'assistant' | 'system'; content: string };

export async function agentProcessor(
  node: FlowNode,
  ctx: ExecutionContext,
  deps: ProcessorDeps,
): Promise<NodeResult> {
  const config = node.config as AgentConfig;
  const memoryKey = `agent_${node.id}_history`;

  // Load conversation history from variables (if memory is on)
  const history: HistoryMessage[] = config.memoryEnabled && Array.isArray(ctx.variables[memoryKey])
    ? (ctx.variables[memoryKey] as HistoryMessage[])
    : [];

  const userMessage = ctx.trigger.messageText?.trim() ?? '';
  const isFirstEntry = history.length === 0;

  // On very first entry with an intro message, send it and wait for customer reply
  if (isFirstEntry && config.introMessage?.trim() && !userMessage) {
    const meta = await deps.getMetaClient(ctx.tenantId);
    await meta.sendText({ to: ctx.buyer.waPhone, message: config.introMessage, isWithin24hrWindow: true }).catch(() => null);

    if (config.memoryEnabled) {
      history.push({ role: 'assistant', content: config.introMessage });
      ctx.variables[memoryKey] = history;
    }

    ctx.executionLog.push({ nodeId: node.id, nodeType: node.type, timestamp: new Date().toISOString(), status: 'waiting', meta: { phase: 'intro_sent' } });
    return { status: 'waiting_reply' };
  }

  // Append new customer message to history
  if (userMessage && (!history.length || history[history.length - 1].role !== 'user')) {
    history.push({ role: 'user', content: userMessage });
  }

  // Fetch active services so LLM uses exact names
  const activeServices = await db.query.services.findMany({
    where: and(eq(services.tenantId, ctx.tenantId), eq(services.isActive, true)),
  });

  if (activeServices.length === 0) {
    const meta = await deps.getMetaClient(ctx.tenantId);
    await meta.sendText({ to: ctx.buyer.waPhone, message: 'Maaf, saat ini sistem booking belum tersedia. Silakan hubungi kami langsung. 🙏', isWithin24hrWindow: true }).catch(() => null);
    ctx.executionLog.push({ nodeId: node.id, nodeType: node.type, timestamp: new Date().toISOString(), status: 'error', error: 'no_active_services' });
    return { nextNodeId: 'exit' };
  }

  const serviceList = activeServices.map(s => `- ${s.name}`).join('\n');
  const systemPrompt = [
    SCHEDULING_SYSTEM_PROMPT,
    `\nLAYANAN TERSEDIA (gunakan nama persis ini di service_name):\n${serviceList}`,
    config.instructions ? `\nINSTRUKSI AGENT:\n${config.instructions}` : '',
    config.consultationType ? `\nTipe konsultasi default: ${config.consultationType}` : '',
  ].join('');

  // Call LLM
  const llm = getLLMClient();
  let responseText: string;
  try {
    const llmResponse = await llm.chat([
      { role: 'system', content: systemPrompt },
      ...history.filter(m => m.role !== 'system'),
    ]);
    responseText = llmResponse.content.trim();
  } catch (err) {
    console.error('[agentProcessor] LLM call failed:', err);
    const meta = await deps.getMetaClient(ctx.tenantId);
    await meta.sendText({ to: ctx.buyer.waPhone, message: 'Maaf, ada gangguan teknis. Silakan coba lagi atau hubungi kami langsung.', isWithin24hrWindow: true }).catch(() => null);
    ctx.executionLog.push({ nodeId: node.id, nodeType: node.type, timestamp: new Date().toISOString(), status: 'error', error: 'llm_failed' });
    return { nextNodeId: 'exit' };
  }

  // Try parsing as scheduling envelope
  const envelope = parseSchedulingEnvelope(responseText);
  let replyText: string;
  let shouldExit = false;

  if (envelope) {
    console.log(`[agentProcessor] envelope action=${envelope.action} node=${node.id} tenant=${ctx.tenantId}`);
    const result = await executeEnvelope(envelope, ctx, config, deps);
    replyText = result.reply;
    shouldExit = result.exit;
  } else {
    // Plain text — send to buyer and wait for reply
    replyText = responseText;
    shouldExit = false;
  }

  // Send reply to buyer
  try {
    const meta = await deps.getMetaClient(ctx.tenantId);
    await meta.sendText({ to: ctx.buyer.waPhone, message: replyText, isWithin24hrWindow: true });
  } catch (err) {
    console.error('[agentProcessor] Failed to send reply to buyer:', err);
    ctx.executionLog.push({ nodeId: node.id, nodeType: node.type, timestamp: new Date().toISOString(), status: 'error', error: 'send_failed' });
    return { nextNodeId: 'exit' };
  }

  // Update history
  history.push({ role: 'assistant', content: replyText });
  if (config.memoryEnabled) ctx.variables[memoryKey] = history;

  ctx.executionLog.push({
    nodeId: node.id,
    nodeType: node.type,
    timestamp: new Date().toISOString(),
    status: 'ok',
    meta: { action: envelope?.action ?? 'text', exit: shouldExit },
  });

  return shouldExit
    ? { nextNodeId: 'exit' }
    : { status: 'waiting_reply' };
}
