-- Migration 0006: Add UNIQUE constraint on tenant_risk_scores.tenant_id (PRD §10)
-- Ensures one risk score row per tenant; enables safe upsert via ON CONFLICT.
-- Safe to run on empty or populated table: deletes older duplicates first.

-- 1. Remove duplicate rows, keeping the most recently computed per tenant.
DELETE FROM tenant_risk_scores
WHERE id NOT IN (
  SELECT DISTINCT ON (tenant_id) id
  FROM tenant_risk_scores
  ORDER BY tenant_id, computed_at DESC
);

-- 2. Add the unique index.
CREATE UNIQUE INDEX tenant_risk_scores_tenant_unique
  ON tenant_risk_scores (tenant_id);
