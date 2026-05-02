-- Migration: 0009_add_waiting_reply_status.sql
-- Adds 'waiting_reply' to the flow_execution_status enum.
--
-- Background: 0005_flow_engine.sql created the enum with only:
--   running | completed | cancelled | failed
-- The schema source (flowExecutions.ts) declares 'waiting_reply' but the value
-- was never added via migration. Without this, the Meta webhook handler crashes
-- at startup with:
--   PostgresError: invalid input value for enum flow_execution_status: "waiting_reply"
-- which causes ALL inbound WhatsApp messages to be silently dropped.
--
-- IF NOT EXISTS makes this idempotent (safe to run multiple times).
-- ALTER TYPE ADD VALUE IF NOT EXISTS is supported on PostgreSQL 9.6+.

ALTER TYPE flow_execution_status ADD VALUE IF NOT EXISTS 'waiting_reply';
