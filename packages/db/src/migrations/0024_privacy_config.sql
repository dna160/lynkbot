-- Migration: Add privacy configuration columns to tenants table
-- Purpose: Support GDPR/privacy notice configuration per tenant

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS privacy_notice_text TEXT,
  ADD COLUMN IF NOT EXISTS contact_info VARCHAR(255),
  ADD COLUMN IF NOT EXISTS opt_out_keyword VARCHAR(50) DEFAULT 'STOP',
  ADD COLUMN IF NOT EXISTS retention_days INTEGER DEFAULT 365;

-- Create index for retention cleanup queries
CREATE INDEX IF NOT EXISTS idx_tenants_retention_days ON tenants(retention_days);
