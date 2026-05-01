-- Migration 0008: Add variable_labels column to flow_templates
-- Stores the {{N}} → field-path mapping (e.g. {"{{1}}": "buyer.displayName"})
-- so that template submission can build realistic Meta example values.

ALTER TABLE flow_templates
  ADD COLUMN IF NOT EXISTS variable_labels JSONB NOT NULL DEFAULT '{}';
