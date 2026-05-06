-- Migration 0021: FINAL — remove legacy bytea column after S3 backfill
-- Run infra/scripts/migrate-pdfs.ts BEFORE applying this migration.

ALTER TABLE products DROP COLUMN IF EXISTS pdf_bytes;
