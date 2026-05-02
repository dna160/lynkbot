-- Migration 0010: Add 'paused' value to flow_status enum
-- Allows flows to be paused (stops new triggers) while remaining editable,
-- distinct from 'archived' (read-only) and 'draft' (never activated).
ALTER TYPE flow_status ADD VALUE IF NOT EXISTS 'paused';
