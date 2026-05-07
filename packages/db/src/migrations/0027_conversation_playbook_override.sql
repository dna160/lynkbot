-- Add playbook_override to conversations.
-- Set by the ACTIVATE_PLAYBOOK flow node to force a specific AI Playbook for
-- subsequent AI responses, overriding auto-detected intent classification.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS playbook_override VARCHAR(50);
