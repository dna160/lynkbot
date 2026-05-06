-- Migration 0015: Add service confirmation staff + appointment rescheduling tracking

-- Extend appointment_status enum with rescheduling_requested
ALTER TYPE appointment_status ADD VALUE 'rescheduling_requested';

-- Add confirmationStaffId to services table
ALTER TABLE services ADD COLUMN confirmation_staff_id uuid REFERENCES staff(id) ON DELETE SET NULL;
CREATE INDEX services_confirmation_staff_idx ON services(confirmation_staff_id);

-- Add previousAppointmentId to appointments table (self-join for tracking reschedules)
ALTER TABLE appointments ADD COLUMN previous_appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL;
CREATE INDEX appointments_previous_idx ON appointments(previous_appointment_id);
