-- Migrate WANTS_CONSULTATION playbook rows to SCHEDULING.
-- WANTS_CONSULTATION is no longer a distinct intent — the LLM classifier
-- uses SCHEDULING for all scheduling-related signals (ask-to-book AND date/time replies).
-- The enum value is left in place (Postgres cannot drop enum values),
-- but no new rows will reference it.
UPDATE intent_playbooks
SET intent_key = 'SCHEDULING'
WHERE intent_key = 'WANTS_CONSULTATION';
