-- Migration 0018: Webhook durability log

CREATE TYPE webhook_ingest_status AS ENUM ('pending', 'processing', 'completed', 'failed');

CREATE TABLE IF NOT EXISTS webhook_ingest_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  meta_message_id text NOT NULL UNIQUE,
  phone_number_id text NOT NULL,
  payload jsonb NOT NULL,
  status webhook_ingest_status NOT NULL DEFAULT 'pending',
  processed_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_ingest_log_status_idx ON webhook_ingest_log(status);
CREATE INDEX IF NOT EXISTS webhook_ingest_log_created_at_idx ON webhook_ingest_log(created_at);
