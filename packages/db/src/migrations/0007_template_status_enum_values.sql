-- Migration 0007: Add missing flow_template_status enum values
-- The original 0005_flow_engine.sql only created 7 values; the Drizzle schema
-- defines 10. Add the 3 missing values so the service can set them.

ALTER TYPE flow_template_status ADD VALUE IF NOT EXISTS 'pending_review';
ALTER TYPE flow_template_status ADD VALUE IF NOT EXISTS 'flagged';
ALTER TYPE flow_template_status ADD VALUE IF NOT EXISTS 'in_appeal';
