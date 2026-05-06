-- Migration 0022: Remove embedding column from product_chunks
-- Embeddings now live exclusively in product_embeddings (768-dim via unified pipeline)

ALTER TABLE product_chunks DROP COLUMN IF EXISTS embedding;
