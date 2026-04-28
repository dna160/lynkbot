-- ============================================================
-- Add tables present in Drizzle schema but missing from initial migration:
--   buyer_genomes, genome_mutations, broadcasts
-- ============================================================

-- ── Enums ────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE confidence_level AS ENUM ('HIGH', 'MEDIUM', 'LOW');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── buyer_genomes ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS buyer_genomes (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id                UUID NOT NULL REFERENCES buyers(id) ON DELETE CASCADE,
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  confidence              confidence_level NOT NULL DEFAULT 'LOW',
  observation_count       INTEGER NOT NULL DEFAULT 0,

  -- OCEAN
  openness                INTEGER NOT NULL DEFAULT 50,
  conscientiousness       INTEGER NOT NULL DEFAULT 50,
  extraversion            INTEGER NOT NULL DEFAULT 50,
  agreeableness           INTEGER NOT NULL DEFAULT 50,
  neuroticism             INTEGER NOT NULL DEFAULT 50,

  -- Behavioural
  communication_style     INTEGER NOT NULL DEFAULT 50,
  decision_making         INTEGER NOT NULL DEFAULT 50,
  brand_relationship      INTEGER NOT NULL DEFAULT 50,
  influence_susceptibility INTEGER NOT NULL DEFAULT 50,
  emotional_expression    INTEGER NOT NULL DEFAULT 50,
  conflict_behavior       INTEGER NOT NULL DEFAULT 50,
  literacy_articulation   INTEGER NOT NULL DEFAULT 50,
  socioeconomic_friction  INTEGER NOT NULL DEFAULT 50,

  -- Human Uniqueness
  identity_fusion         INTEGER NOT NULL DEFAULT 50,
  chronesthesia_capacity  INTEGER NOT NULL DEFAULT 50,
  tom_self_awareness      INTEGER NOT NULL DEFAULT 50,
  tom_social_modeling     INTEGER NOT NULL DEFAULT 50,
  executive_flexibility   INTEGER NOT NULL DEFAULT 50,

  formation_invariants    JSONB DEFAULT '[]',
  dialog_cache            JSONB,
  dialog_cache_built_at   TIMESTAMP,
  osint_summary           TEXT,
  last_signal_extracted_at TIMESTAMP,
  created_at              TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT buyer_genomes_buyer_tenant_unique UNIQUE (buyer_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS buyer_genomes_tenant_idx ON buyer_genomes (tenant_id);

-- ── genome_mutations ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS genome_mutations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id         UUID NOT NULL REFERENCES buyers(id) ON DELETE CASCADE,
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trait_name       TEXT NOT NULL,
  old_score        INTEGER NOT NULL,
  new_score        INTEGER NOT NULL,
  delta            INTEGER NOT NULL,
  evidence_summary TEXT,
  confidence       confidence_level NOT NULL,
  conversation_id  UUID,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS genome_mutations_buyer_idx ON genome_mutations (buyer_id);

-- ── broadcasts ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS broadcasts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_name    VARCHAR(255) NOT NULL,
  template_params  JSONB NOT NULL DEFAULT '[]',
  audience_filter  JSONB,
  recipient_count  INTEGER NOT NULL DEFAULT 0,
  sent_count       INTEGER NOT NULL DEFAULT 0,
  failed_count     INTEGER NOT NULL DEFAULT 0,
  status           VARCHAR(50) NOT NULL DEFAULT 'pending',
  error_log        JSONB,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMP
);
