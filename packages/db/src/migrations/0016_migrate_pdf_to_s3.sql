-- Migration 0016: PDF bytea → S3 migration prep
-- Adds pdf_uploaded_at column. Existing bytea data must be exported via infra/scripts/migrate-pdfs.ts before dropping pdf_bytes.

ALTER TABLE products ADD COLUMN IF NOT EXISTS pdf_uploaded_at timestamptz;

-- NOTE: Run `npx tsx infra/scripts/migrate-pdfs.ts` to backfill existing pdf_bytes to S3 before applying the DROP.
-- ALTER TABLE products DROP COLUMN IF EXISTS pdf_bytes;
