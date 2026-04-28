-- Add meta_phone_number_id to tenants (was in Drizzle schema but missing from initial migration)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS meta_phone_number_id VARCHAR(50);
