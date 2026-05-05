-- Migration 0011: Intent Playbooks
-- Adds tenant-configurable AI behavior playbooks per conversation intent.

CREATE TYPE "intent_key" AS ENUM (
  'GREETING',
  'BROWSING',
  'PRODUCT_INQUIRY',
  'OBJECTION_HANDLING',
  'CHECKOUT_INTENT',
  'OUT_OF_STOCK',
  'WANTS_CONSULTATION',
  'GENERAL_INQUIRY'
);

CREATE TYPE "next_step_type" AS ENUM (
  'continue_conversation',
  'checkout',
  'schedule_consultation',
  'human_handoff',
  'collect_info'
);

CREATE TABLE "intent_playbooks" (
  "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "intent_key"            "intent_key" NOT NULL,
  "label"                 varchar(255) NOT NULL,
  "description"           text,
  "is_active"             boolean NOT NULL DEFAULT true,
  "priority"              integer NOT NULL DEFAULT 0,
  "system_prompt_addition" text NOT NULL DEFAULT '',
  "tone_note"             text,
  "next_step_type"        "next_step_type" NOT NULL DEFAULT 'continue_conversation',
  "next_step_config"      jsonb,
  "detection_keywords"    jsonb,
  "fallback_message"      text,
  "created_at"            timestamp NOT NULL DEFAULT now(),
  "updated_at"            timestamp NOT NULL DEFAULT now()
);

CREATE INDEX "intent_playbooks_tenant_idx" ON "intent_playbooks"("tenant_id");
CREATE INDEX "intent_playbooks_tenant_intent_idx" ON "intent_playbooks"("tenant_id", "intent_key");
