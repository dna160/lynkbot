-- Add knowledge_error column to products to surface ingest failure details
ALTER TABLE products ADD COLUMN IF NOT EXISTS knowledge_error TEXT;
