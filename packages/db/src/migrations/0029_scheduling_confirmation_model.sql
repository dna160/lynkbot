-- Migration 0029: Scheduling confirmation model per service
-- Adds confirmation_model so each service can choose between:
--   'staff_confirm' (default) — staff must reply before buyer is told it's locked in
--   'instant'                 — auto-confirm, notify staff after the fact
-- Also adds a per-service template name override for the staff confirmation WA template.

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS confirmation_model          VARCHAR(20)  DEFAULT 'staff_confirm',
  ADD COLUMN IF NOT EXISTS confirmation_template_name  VARCHAR(100);

COMMENT ON COLUMN services.confirmation_model IS 'instant | staff_confirm — how appointments are confirmed for this service. Default: staff_confirm.';
COMMENT ON COLUMN services.confirmation_template_name IS 'Meta template name for this service''s staff confirmation. Overrides tenant default. Falls back to tenant.staff_confirmation_template_name then generic fallback.';
