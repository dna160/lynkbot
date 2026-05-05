-- Migration 0012: Scheduling & Booking Module
-- Adds SCHEDULING states to conversation_state enum, creates 5 scheduling tables.
--
-- CRITICAL: This migration runs ALTER TYPE on conversation_state.
-- If the ALTER TYPE block fails, it means the enum is in an unexpected state.
-- Check: SELECT enum_range(NULL::conversation_state); to see current values.
-- Failure here does NOT roll back the enum — re-run with caution.

-- ── Step 1: Extend conversation_state enum ───────────────────────────────────
-- Uses IF NOT EXISTS guard so re-running is safe.
-- NOTE: ALTER TYPE ADD VALUE cannot run inside a transaction in PostgreSQL < 12.
-- Railway uses Postgres 14+ so this is safe.
DO $$
BEGIN
  BEGIN
    ALTER TYPE conversation_state ADD VALUE IF NOT EXISTS 'SCHEDULING';
    RAISE NOTICE 'conversation_state: added SCHEDULING';
  EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'conversation_state: SCHEDULING already exists — skipping';
  END;

  BEGIN
    ALTER TYPE conversation_state ADD VALUE IF NOT EXISTS 'SCHEDULING_CONFIRMED';
    RAISE NOTICE 'conversation_state: added SCHEDULING_CONFIRMED';
  EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'conversation_state: SCHEDULING_CONFIRMED already exists — skipping';
  END;

  BEGIN
    ALTER TYPE conversation_state ADD VALUE IF NOT EXISTS 'SCHEDULING_CANCELLED';
    RAISE NOTICE 'conversation_state: added SCHEDULING_CANCELLED';
  EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'conversation_state: SCHEDULING_CANCELLED already exists — skipping';
  END;
END $$;

-- ── Step 2: appointment_status enum ─────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'appointment_status') THEN
    CREATE TYPE appointment_status AS ENUM (
      'negotiating',
      'pending_doctor',
      'confirmed',
      'cancelled'
    );
    RAISE NOTICE 'Created enum: appointment_status';
  ELSE
    RAISE NOTICE 'appointment_status enum already exists — skipping';
  END IF;
END $$;

-- ── Step 3: services table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "services" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"        uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name"             text NOT NULL,
  "duration_minutes" integer NOT NULL DEFAULT 60,
  "is_active"        boolean NOT NULL DEFAULT true,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "services_tenant_name_unique" UNIQUE ("tenant_id", "name")
);
CREATE INDEX IF NOT EXISTS "services_tenant_idx" ON "services"("tenant_id");

-- ── Step 4: staff table ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "staff" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"    uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name"         text NOT NULL,
  "phone_number" text NOT NULL,
  "role"         text NOT NULL DEFAULT 'staff',
  "is_active"    boolean NOT NULL DEFAULT true,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "staff_tenant_phone_unique" UNIQUE ("tenant_id", "phone_number")
);
CREATE INDEX IF NOT EXISTS "staff_tenant_idx" ON "staff"("tenant_id");

-- ── Step 5: service_staff join table ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "service_staff" (
  "service_id" uuid NOT NULL REFERENCES "services"("id") ON DELETE CASCADE,
  "staff_id"   uuid NOT NULL REFERENCES "staff"("id") ON DELETE CASCADE,
  PRIMARY KEY ("service_id", "staff_id")
);

-- ── Step 6: staff_availability table ─────────────────────────────────────────
-- day_of_week: 0=Sunday…6=Saturday (JS Date.getDay() convention).
-- start_time/end_time: 'HH:MM' text, no timezone — relative to WIB (UTC+7).
CREATE TABLE IF NOT EXISTS "staff_availability" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "staff_id"     uuid NOT NULL REFERENCES "staff"("id") ON DELETE CASCADE,
  "day_of_week"  integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  "start_time"   text NOT NULL,
  "end_time"     text NOT NULL,
  CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS "staff_availability_staff_day_idx" ON "staff_availability"("staff_id", "day_of_week");

-- ── Step 7: appointments table ───────────────────────────────────────────────
-- All timestamps UTC. Display in WIB (UTC+7) in AI and dashboard.
-- bullmq_job_id: set when reminder job is enqueued; used for job.remove() on cancel.
CREATE TABLE IF NOT EXISTS "appointments" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "buyer_id"          uuid NOT NULL REFERENCES "buyers"("id") ON DELETE CASCADE,
  "staff_id"          uuid NOT NULL REFERENCES "staff"("id") ON DELETE RESTRICT,
  "service_id"        uuid NOT NULL REFERENCES "services"("id") ON DELETE RESTRICT,
  "start_time"        timestamptz NOT NULL,
  "end_time"          timestamptz NOT NULL,
  "status"            appointment_status NOT NULL DEFAULT 'negotiating',
  "reminder_offset_h" integer NOT NULL DEFAULT 24,
  "bullmq_job_id"     text,
  "reminder_sent_at"  timestamptz,
  "notes"             text,
  "created_at"        timestamptz NOT NULL DEFAULT now(),
  "updated_at"        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "appointments_tenant_idx"     ON "appointments"("tenant_id");
CREATE INDEX IF NOT EXISTS "appointments_staff_time_idx" ON "appointments"("staff_id", "start_time");
CREATE INDEX IF NOT EXISTS "appointments_status_idx"     ON "appointments"("status");
