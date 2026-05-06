-- Migration 0014: allow buyer deletion while preserving conversation and order history
--
-- conversations.buyer_id: make nullable, switch FK to SET NULL
--   → deleting a buyer nullifies buyer_id on their conversations but keeps the records
-- orders.buyer_id: make nullable, switch FK to SET NULL
--   → deleting a buyer nullifies buyer_id on their orders but keeps the records

-- conversations ---------------------------------------------------------------
ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_buyer_id_fkey;

ALTER TABLE conversations
  ALTER COLUMN buyer_id DROP NOT NULL;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_buyer_id_fkey
  FOREIGN KEY (buyer_id) REFERENCES buyers(id) ON DELETE SET NULL;

-- orders ----------------------------------------------------------------------
ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_buyer_id_fkey;

ALTER TABLE orders
  ALTER COLUMN buyer_id DROP NOT NULL;

ALTER TABLE orders
  ADD CONSTRAINT orders_buyer_id_fkey
  FOREIGN KEY (buyer_id) REFERENCES buyers(id) ON DELETE SET NULL;
