-- ============================================================
-- Fix schema drift between initial migration and Drizzle schema
-- ============================================================

-- ── buyers ──────────────────────────────────────────────────
-- Rename wa_id → wa_phone
ALTER TABLE buyers RENAME COLUMN wa_id TO wa_phone;

-- Rename name → display_name
ALTER TABLE buyers RENAME COLUMN name TO display_name;

-- Rename language → preferred_language
ALTER TABLE buyers RENAME COLUMN language TO preferred_language;

-- Add missing columns
ALTER TABLE buyers
  ADD COLUMN IF NOT EXISTS total_orders     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_spend_idr  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_order_at    TIMESTAMP,
  ADD COLUMN IF NOT EXISTS tags             JSONB,
  ADD COLUMN IF NOT EXISTS notes            TEXT,
  ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMP NOT NULL DEFAULT NOW();

-- Fix unique constraint name to match Drizzle-generated name
ALTER TABLE buyers
  RENAME CONSTRAINT buyers_tenant_wa_unique TO buyers_wa_phone_tenant_id_unique;

-- ── messages ────────────────────────────────────────────────
-- Migration has: content, metadata
-- Schema expects: text_content, raw_payload + extra columns
ALTER TABLE messages RENAME COLUMN content  TO text_content;
ALTER TABLE messages RENAME COLUMN metadata TO raw_payload;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS media_url     TEXT,
  ADD COLUMN IF NOT EXISTS location_lat  VARCHAR(20),
  ADD COLUMN IF NOT EXISTS location_lng  VARCHAR(20),
  ADD COLUMN IF NOT EXISTS tokens_used   INTEGER,
  ADD COLUMN IF NOT EXISTS model_id      VARCHAR(100),
  ADD COLUMN IF NOT EXISTS latency_ms    INTEGER,
  ADD COLUMN IF NOT EXISTS is_read       BOOLEAN NOT NULL DEFAULT false;

-- ── conversations ────────────────────────────────────────────
-- Migration missing tenant FK on conversations (it's NOT NULL but has no REFERENCES)
-- Drizzle schema has onDelete: cascade — add FK if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'conversations'
      AND constraint_type = 'FOREIGN KEY'
      AND constraint_name LIKE '%tenant%'
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
END$$;
