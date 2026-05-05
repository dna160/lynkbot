/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/services/calendarAdapter.ts
 * Role    : CalendarAdapter interface for slot conflict detection.
 *           v1.0 — DbCalendarAdapter checks the appointments table.
 *           v1.1 will add GoogleCalendarAdapter (swap via CALENDAR_ADAPTER env var).
 * Exports : CalendarAdapter, DbCalendarAdapter, getCalendarAdapter
 * DO NOT  : Expose HTTP routes. Pure business logic.
 */
import { db, appointments, eq, and, or, sql } from '@lynkbot/db';

export interface CalendarAdapter {
  /** Returns true if the slot [start, end) is free for this staff member */
  isSlotAvailable(staffId: string, start: Date, end: Date): Promise<boolean>;
  /** v1.0 no-op — appointment insert acts as the lock */
  lockSlot(appointmentId: string, staffId: string, start: Date, end: Date): Promise<void>;
  /** v1.0 no-op — status update to cancelled frees the slot */
  releaseSlot(appointmentId: string): Promise<void>;
}

export class DbCalendarAdapter implements CalendarAdapter {
  async isSlotAvailable(staffId: string, start: Date, end: Date): Promise<boolean> {
    // Overlap check: existing appointment overlaps [start, end) if:
    //   existing.startTime < end AND existing.endTime > start
    const conflicts = await db
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          eq(appointments.staffId, staffId),
          or(
            eq(appointments.status, 'pending_doctor'),
            eq(appointments.status, 'confirmed'),
          ),
          sql`${appointments.startTime} < ${end.toISOString()}::timestamptz`,
          sql`${appointments.endTime} > ${start.toISOString()}::timestamptz`,
        ),
      )
      .limit(1);

    return conflicts.length === 0;
  }

  async lockSlot(_appointmentId: string, _staffId: string, _start: Date, _end: Date): Promise<void> {
    // v1.0 no-op: the appointment row itself is the lock
  }

  async releaseSlot(_appointmentId: string): Promise<void> {
    // v1.0 no-op: status=cancelled frees the slot implicitly
  }
}

export function getCalendarAdapter(): CalendarAdapter {
  const adapter = process.env.CALENDAR_ADAPTER ?? 'db';
  if (adapter === 'db') {
    return new DbCalendarAdapter();
  }
  console.warn(`[calendarAdapter] Unknown CALENDAR_ADAPTER="${adapter}" — falling back to DbCalendarAdapter`);
  return new DbCalendarAdapter();
}
