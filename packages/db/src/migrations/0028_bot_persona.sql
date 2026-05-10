-- Migration 0028: Bot persona configuration
-- Adds tenant-level persona fields so every tenant can name and style their AI bot
-- independently. Falls back to store_name when bot_name is null.
-- Also adds staff_confirmation_template_name to resolve the hardcoded 'aria_appointment_confirmation'.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS bot_name                          VARCHAR(100),
  ADD COLUMN IF NOT EXISTS bot_tone                          VARCHAR(20)  DEFAULT 'friendly',
  ADD COLUMN IF NOT EXISTS bot_default_language              VARCHAR(5)   DEFAULT 'id',
  ADD COLUMN IF NOT EXISTS bot_greeting_style                TEXT,
  ADD COLUMN IF NOT EXISTS bot_avatar_emoji                  VARCHAR(10),
  ADD COLUMN IF NOT EXISTS bot_custom_instructions           TEXT,
  ADD COLUMN IF NOT EXISTS staff_confirmation_template_name  VARCHAR(100);

COMMENT ON COLUMN tenants.bot_name IS 'Bot display name shown to buyers. Falls back to store_name if null.';
COMMENT ON COLUMN tenants.bot_tone IS 'friendly | formal | playful — injects tone modifier into system prompt.';
COMMENT ON COLUMN tenants.bot_default_language IS 'Default language for new conversations: id | en.';
COMMENT ON COLUMN tenants.bot_greeting_style IS 'Opening line the bot uses when greeting a new buyer. Replaces generic greeting.';
COMMENT ON COLUMN tenants.bot_avatar_emoji IS 'Emoji or short character used as visual identity on the dashboard (1–2 chars). Not injected into prompts.';
COMMENT ON COLUMN tenants.bot_custom_instructions IS 'Freeform instructions appended to every system prompt for this tenant. High priority — always followed.';
COMMENT ON COLUMN tenants.staff_confirmation_template_name IS 'Default Meta template name for staff appointment confirmation requests. Falls back to generic template when null.';
