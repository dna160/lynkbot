/**
 * @CLAUDE_CONTEXT
 * Package : packages/db
 * File    : src/schema/scheduling.ts
 * Role    : Drizzle ORM schemas for the Scheduling & Booking module.
 *           Five tables: services, staff, serviceStaff (join), staffAvailability, appointments.
 *           appointment_status enum: negotiating | pending_doctor | confirmed | cancelled
 * Exports : appointmentStatusEnum, services, staff, serviceStaff, staffAvailability, appointments
 * DO NOT  : Import from apps/* or packages except @lynkbot/shared and drizzle-orm
 */
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  index,
  unique,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { buyers } from './buyers';

export const appointmentStatusEnum = pgEnum('appointment_status', [
  'negotiating',
  'pending_doctor',
  'confirmed',
  'cancelled',
  'rescheduling_requested',
]);

/**
 * services — bookable items offered by the tenant.
 * Name must be unique per tenant — the AI uses service name for routing.
 * Many-to-many with staff via serviceStaff join table.
 */
export const services = pgTable('services', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  durationMinutes: integer('duration_minutes').notNull().default(60),
  isActive: boolean('is_active').notNull().default(true),
  confirmationStaffId: uuid('confirmation_staff_id').references(() => staff.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  tenantNameUnique: unique('services_tenant_name_unique').on(t.tenantId, t.name),
  tenantIdx: index('services_tenant_idx').on(t.tenantId),
  confirmationStaffIdx: index('services_confirmation_staff_idx').on(t.confirmationStaffId),
}));

/**
 * staff — practitioners who perform services.
 * phoneNumber in E.164 format — receives appointment confirmation templates.
 * Unique per tenant on phone number.
 */
export const staff = pgTable('staff', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  phoneNumber: text('phone_number').notNull(),
  role: text('role').notNull().default('staff'), // doctor | therapist | consultant | staff
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  tenantPhoneUnique: unique('staff_tenant_phone_unique').on(t.tenantId, t.phoneNumber),
  tenantIdx: index('staff_tenant_idx').on(t.tenantId),
}));

/**
 * serviceStaff — join table linking services to staff (many-to-many).
 * Required by the "earliest available slot wins" routing decision.
 * Composite PK on (serviceId, staffId).
 */
export const serviceStaff = pgTable('service_staff', {
  serviceId: uuid('service_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
  staffId: uuid('staff_id').notNull().references(() => staff.id, { onDelete: 'cascade' }),
}, (t) => ({
  pk: primaryKey({ columns: [t.serviceId, t.staffId] }),
}));

/**
 * staffAvailability — weekly recurring schedule per staff member.
 * dayOfWeek: 0=Sunday…6=Saturday (aligned with JS Date.getDay()).
 * startTime/endTime stored as 'HH:MM' text — no timezone (applied relative to WIB).
 */
export const staffAvailability = pgTable('staff_availability', {
  id: uuid('id').primaryKey().defaultRandom(),
  staffId: uuid('staff_id').notNull().references(() => staff.id, { onDelete: 'cascade' }),
  dayOfWeek: integer('day_of_week').notNull(), // 0–6
  startTime: text('start_time').notNull(), // e.g. '09:00'
  endTime: text('end_time').notNull(),     // e.g. '17:00'
}, (t) => ({
  staffDayIdx: index('staff_availability_staff_day_idx').on(t.staffId, t.dayOfWeek),
}));

/**
 * appointments — booking records.
 * startTime/endTime stored UTC. Display in WIB (UTC+7) everywhere.
 * status state machine: negotiating → pending_doctor → confirmed | cancelled
 * BullMQ reminder job enqueued only after status = confirmed.
 */
export const appointments: any = pgTable('appointments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  buyerId: uuid('buyer_id').notNull().references(() => buyers.id, { onDelete: 'cascade' }),
  staffId: uuid('staff_id').notNull().references(() => staff.id, { onDelete: 'restrict' }),
  serviceId: uuid('service_id').notNull().references(() => services.id, { onDelete: 'restrict' }),
  startTime: timestamp('start_time', { withTimezone: true }).notNull(),
  endTime: timestamp('end_time', { withTimezone: true }).notNull(),
  status: appointmentStatusEnum('status').notNull().default('negotiating'),
  previousAppointmentId: uuid('previous_appointment_id').references((): any => appointments.id, { onDelete: 'set null' }),
  reminderOffsetH: integer('reminder_offset_h').notNull().default(24),
  bullmqJobId: text('bullmq_job_id'),
  reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('appointments_tenant_idx').on(t.tenantId),
  staffTimeIdx: index('appointments_staff_time_idx').on(t.staffId, t.startTime),
  statusIdx: index('appointments_status_idx').on(t.status),
  previousIdx: index('appointments_previous_idx').on(t.previousAppointmentId),
}));
