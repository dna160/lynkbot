-- Migration 0013: Add pdf_bytes column to products
-- Stores raw PDF bytes for products uploaded without S3 (inline mode).
-- Enables re-training without requiring a re-upload.
-- Nullable: only populated when S3 is not configured.

ALTER TABLE "products" ADD COLUMN "pdf_bytes" bytea;
