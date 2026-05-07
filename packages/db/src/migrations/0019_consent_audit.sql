-- Migration 0019: Consent audit trail for PDP Law compliance

CREATE TYPE consent_action AS ENUM ('opt_in', 'opt_out', 'template_sent', 'broadcast_sent');

CREATE TABLE IF NOT EXISTS consent_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id uuid REFERENCES buyers(id) ON DELETE SET NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  action consent_action NOT NULL,
  channel text NOT NULL DEFAULT 'whatsapp',
  template_name text,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS consent_audit_tenant_idx ON consent_audit(tenant_id);
CREATE INDEX IF NOT EXISTS consent_audit_buyer_idx ON consent_audit(buyer_id);
CREATE INDEX IF NOT EXISTS consent_audit_created_at_idx ON consent_audit(created_at);
