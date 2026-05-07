-- Add SCHEDULING to intent_key enum so playbooks can be configured for scheduling intent
-- (previously only WANTS_CONSULTATION existed, but the LLM classifier returns SCHEDULING)
ALTER TYPE intent_key ADD VALUE IF NOT EXISTS 'SCHEDULING';
