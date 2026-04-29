-- ============================================================
-- 0005_flow_engine.sql — Flow Engine v2.1 foundation
-- Adds: flow_definitions, flow_executions, flow_templates,
--       buyer_broadcast_log, tenant_risk_scores, waba_pool
-- Alters: tenants (4 cols), broadcasts (2 cols), buyers (1 col)
-- ============================================================

-- ── Enums ────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE flow_status AS ENUM ('draft', 'active', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE flow_execution_status AS ENUM ('running', 'completed', 'cancelled', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE flow_template_status AS ENUM (
    'draft', 'pending_submission', 'submitted', 'approved', 'rejected', 'paused', 'disabled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE waba_pool_status AS ENUM ('available', 'assigned', 'suspended', 'retired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── tenants ALTERs ───────────────────────────────────────────────────────────
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS meta_access_token TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS messaging_tier INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS waba_quality_rating VARCHAR(10);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS last_risk_score_at TIMESTAMP;

-- ── buyers ALTER ─────────────────────────────────────────────────────────────
ALTER TABLE buyers ADD COLUMN IF NOT EXISTS active_flow_count INTEGER NOT NULL DEFAULT 0;

-- ── waba_pool ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS waba_pool (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number_id     VARCHAR(50)  NOT NULL UNIQUE,
  display_phone       VARCHAR(20)  NOT NULL,
  waba_id             VARCHAR(255) NOT NULL,
  access_token_enc    TEXT         NOT NULL,
  status              waba_pool_status NOT NULL DEFAULT 'available',
  assigned_to         UUID REFERENCES tenants(id) ON DELETE SET NULL,
  assigned_at         TIMESTAMP,
  quality_rating      VARCHAR(10),
  messaging_tier      INTEGER NOT NULL DEFAULT 1,
  notes               TEXT,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS waba_pool_status_idx ON waba_pool (status);
CREATE INDEX IF NOT EXISTS waba_pool_assigned_to_idx ON waba_pool (assigned_to);

-- ── flow_definitions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flow_definitions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name               VARCHAR(255) NOT NULL,
  description        TEXT,
  status             flow_status NOT NULL DEFAULT 'draft',
  trigger_type       VARCHAR(50)  NOT NULL,
  trigger_config     JSONB        NOT NULL DEFAULT '{}',
  definition         JSONB        NOT NULL,
  validation_errors  JSONB        DEFAULT '[]',
  version            INTEGER      NOT NULL DEFAULT 1,
  generated_by_ai    BOOLEAN      NOT NULL DEFAULT FALSE,
  ai_prompt          TEXT,
  activated_at       TIMESTAMP,
  archived_at        TIMESTAMP,
  created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS flow_definitions_tenant_idx ON flow_definitions (tenant_id);
CREATE INDEX IF NOT EXISTS flow_definitions_status_idx ON flow_definitions (status);
CREATE INDEX IF NOT EXISTS flow_definitions_trigger_type_idx ON flow_definitions (trigger_type);

-- ── flow_executions ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flow_executions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id         UUID NOT NULL REFERENCES flow_definitions(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  buyer_id        UUID NOT NULL REFERENCES buyers(id) ON DELETE CASCADE,
  status          flow_execution_status NOT NULL DEFAULT 'running',
  current_node_id VARCHAR(100),
  context         JSONB NOT NULL DEFAULT '{}',
  started_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMP,
  failed_at       TIMESTAMP,
  cancelled_at    TIMESTAMP,
  last_step_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  error           TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS flow_executions_flow_idx     ON flow_executions (flow_id);
CREATE INDEX IF NOT EXISTS flow_executions_tenant_idx   ON flow_executions (tenant_id);
CREATE INDEX IF NOT EXISTS flow_executions_buyer_idx    ON flow_executions (buyer_id);
CREATE INDEX IF NOT EXISTS flow_executions_status_idx   ON flow_executions (status);

-- A buyer may only have one running execution per flow at any given time.
-- Enforced via partial unique index — Drizzle index DSL doesn't always express
-- partial-unique cleanly, so the SQL migration owns this.
CREATE UNIQUE INDEX IF NOT EXISTS flow_executions_running_unique
  ON flow_executions (flow_id, buyer_id)
  WHERE status = 'running';

-- ── flow_templates ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flow_templates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                VARCHAR(255) NOT NULL,
  category            VARCHAR(50)  NOT NULL,
  language            VARCHAR(10)  NOT NULL DEFAULT 'id',
  status              flow_template_status NOT NULL DEFAULT 'draft',
  body_text           TEXT NOT NULL,
  header              JSONB,
  footer              VARCHAR(60),
  buttons             JSONB DEFAULT '[]',
  variables           JSONB DEFAULT '[]',
  meta_template_id    VARCHAR(255),
  meta_template_name  VARCHAR(255),
  rejection_reason    TEXT,
  appeal_count        INTEGER NOT NULL DEFAULT 0,
  last_appealed_at    TIMESTAMP,
  submitted_at        TIMESTAMP,
  approved_at         TIMESTAMP,
  rejected_at         TIMESTAMP,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS flow_templates_tenant_idx ON flow_templates (tenant_id);
CREATE INDEX IF NOT EXISTS flow_templates_status_idx ON flow_templates (status);
CREATE UNIQUE INDEX IF NOT EXISTS flow_templates_tenant_name_lang_unique
  ON flow_templates (tenant_id, name, language);

-- ── buyer_broadcast_log ──────────────────────────────────────────────────────
-- Cooldown tracker: same template to same buyer max 1× per 7 days.
CREATE TABLE IF NOT EXISTS buyer_broadcast_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  buyer_id        UUID NOT NULL REFERENCES buyers(id) ON DELETE CASCADE,
  template_name   VARCHAR(255) NOT NULL,
  broadcast_id    UUID,
  flow_id         UUID REFERENCES flow_definitions(id) ON DELETE SET NULL,
  sent_at         TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS buyer_broadcast_log_buyer_idx
  ON buyer_broadcast_log (buyer_id, template_name, sent_at DESC);
CREATE INDEX IF NOT EXISTS buyer_broadcast_log_tenant_idx
  ON buyer_broadcast_log (tenant_id);

-- ── tenant_risk_scores ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_risk_scores (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  score           INTEGER NOT NULL,
  factors         JSONB NOT NULL DEFAULT '{}',
  computed_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tenant_risk_scores_tenant_idx
  ON tenant_risk_scores (tenant_id, computed_at DESC);

-- ── broadcasts ALTERs ────────────────────────────────────────────────────────
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS flow_id UUID
  REFERENCES flow_definitions(id) ON DELETE SET NULL;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS risk_score_at_send INTEGER;
