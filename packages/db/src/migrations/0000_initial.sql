-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Enums
CREATE TYPE wati_account_status AS ENUM ('pending', 'registering', 'pending_verification', 'active', 'suspended', 'manual_required');
CREATE TYPE subscription_tier AS ENUM ('trial', 'growth', 'pro', 'scale');
CREATE TYPE knowledge_status AS ENUM ('pending', 'processing', 'ready', 'failed');
CREATE TYPE conversation_state AS ENUM ('INIT','GREETING','BROWSING','PRODUCT_INQUIRY','OBJECTION_HANDLING','CHECKOUT_INTENT','STOCK_CHECK','OUT_OF_STOCK','ADDRESS_COLLECTION','LOCATION_RECEIVED','SHIPPING_CALC','PAYMENT_METHOD_SELECT','INVOICE_GENERATION','AWAITING_PAYMENT','PAYMENT_EXPIRED','PAYMENT_CONFIRMED','ORDER_PROCESSING','SHIPPED','TRACKING','DELIVERED','COMPLETED','ESCALATED','CLOSED_LOST');
CREATE TYPE message_direction AS ENUM ('inbound', 'outbound');
CREATE TYPE order_status AS ENUM ('pending_payment', 'payment_confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded');
CREATE TYPE shipment_status AS ENUM ('pending', 'in_transit', 'out_for_delivery', 'delivered', 'exception', 'returned');

-- updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- tenants
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lynk_user_id VARCHAR(255) NOT NULL UNIQUE,
  store_name VARCHAR(255) NOT NULL,
  waba_id VARCHAR(255),
  wati_api_key_enc TEXT,
  wati_account_status wati_account_status DEFAULT 'pending',
  wati_registration_meta JSONB,
  origin_city_id VARCHAR(50),
  origin_city_name VARCHAR(100),
  payment_account_id VARCHAR(255),
  subscription_tier subscription_tier DEFAULT 'trial',
  subscription_expires_at TIMESTAMP,
  meta_business_id VARCHAR(255),
  display_phone_number VARCHAR(20),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE TRIGGER tenants_updated_at BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ops_tickets
CREATE TABLE ops_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(100) NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payload JSONB,
  status VARCHAR(50) DEFAULT 'open',
  resolved_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE TRIGGER ops_tickets_updated_at BEFORE UPDATE ON ops_tickets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- products
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  sku VARCHAR(100),
  description TEXT,
  tagline VARCHAR(500),
  target_reader TEXT,
  problems_solved JSONB,
  key_outcomes JSONB,
  faq_pairs JSONB,
  testimonials JSONB,
  price_idr BIGINT NOT NULL,
  weight_grams INTEGER NOT NULL,
  dimensions_cm JSONB,
  cover_image_url TEXT,
  pdf_s3_key TEXT,
  knowledge_status knowledge_status DEFAULT 'pending',
  book_persona_prompt TEXT,
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX products_tenant_idx ON products(tenant_id);
CREATE TRIGGER products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- inventory
CREATE TABLE inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  quantity_available INTEGER NOT NULL DEFAULT 0,
  quantity_reserved INTEGER NOT NULL DEFAULT 0,
  quantity_sold INTEGER NOT NULL DEFAULT 0,
  low_stock_threshold INTEGER NOT NULL DEFAULT 10,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_product_unique UNIQUE(product_id)
);
CREATE INDEX inventory_tenant_idx ON inventory(tenant_id);
CREATE TRIGGER inventory_updated_at BEFORE UPDATE ON inventory FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- buyers
CREATE TABLE buyers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  wa_id VARCHAR(20) NOT NULL,
  name VARCHAR(255),
  language VARCHAR(5) DEFAULT 'id',
  opt_in_at TIMESTAMP,
  last_session_at TIMESTAMP,
  do_not_contact BOOLEAN DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT buyers_tenant_wa_unique UNIQUE(tenant_id, wa_id)
);
CREATE INDEX buyers_tenant_idx ON buyers(tenant_id);

-- conversations
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  buyer_id UUID NOT NULL REFERENCES buyers(id),
  product_id UUID REFERENCES products(id),
  state conversation_state NOT NULL DEFAULT 'INIT',
  language VARCHAR(5) DEFAULT 'id',
  address_draft JSONB,
  selected_courier JSONB,
  pending_order_id UUID,
  message_count INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMP
);
CREATE INDEX conv_tenant_idx ON conversations(tenant_id);
CREATE INDEX conv_active_idx ON conversations(tenant_id, is_active);
CREATE INDEX conv_buyer_idx ON conversations(buyer_id);

-- messages
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  wati_message_id VARCHAR(255) UNIQUE,
  direction message_direction NOT NULL,
  message_type VARCHAR(50) DEFAULT 'text',
  content TEXT,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX messages_conv_idx ON messages(conversation_id);
CREATE INDEX messages_wati_idx ON messages(wati_message_id);

-- orders
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_code VARCHAR(50) NOT NULL UNIQUE,
  tenant_id UUID NOT NULL,
  buyer_id UUID NOT NULL REFERENCES buyers(id),
  conversation_id UUID REFERENCES conversations(id),
  product_id UUID NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price_idr BIGINT NOT NULL,
  shipping_cost_idr BIGINT NOT NULL DEFAULT 0,
  total_amount_idr BIGINT NOT NULL,
  status order_status NOT NULL DEFAULT 'pending_payment',
  shipping_address JSONB NOT NULL,
  courier_code VARCHAR(50),
  courier_service VARCHAR(100),
  payment_id VARCHAR(255),
  payment_method VARCHAR(50),
  paid_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX orders_tenant_idx ON orders(tenant_id);
CREATE INDEX orders_status_idx ON orders(status);
CREATE INDEX orders_buyer_idx ON orders(buyer_id);
CREATE TRIGGER orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- shipments
CREATE TABLE shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  resi_number VARCHAR(100) NOT NULL,
  courier_code VARCHAR(50) NOT NULL,
  courier_name VARCHAR(100),
  current_status shipment_status DEFAULT 'pending',
  estimated_delivery TIMESTAMP,
  delivered_at TIMESTAMP,
  last_polled_at TIMESTAMP,
  tracking_history JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX shipments_order_idx ON shipments(order_id);
CREATE INDEX shipments_tenant_idx ON shipments(tenant_id);
CREATE TRIGGER shipments_updated_at BEFORE UPDATE ON shipments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- product_chunks (pgvector)
CREATE TABLE product_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  chunk_index INTEGER NOT NULL,
  content_text TEXT NOT NULL,
  embedding vector(1536),
  page_number INTEGER,
  chapter_title VARCHAR(255),
  token_count INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT chunks_product_chunk_unique UNIQUE(product_id, chunk_index)
);
CREATE INDEX chunks_product_idx ON product_chunks(product_id);
-- HNSW index for fast similarity search (add after initial data load)
CREATE INDEX product_chunks_embedding_hnsw_idx ON product_chunks USING hnsw (embedding vector_cosine_ops);

-- waitlist
CREATE TABLE waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  buyer_id UUID NOT NULL REFERENCES buyers(id),
  notified_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT waitlist_product_buyer_unique UNIQUE(product_id, buyer_id)
);
CREATE INDEX waitlist_product_idx ON waitlist(product_id);

-- audit_logs
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID NOT NULL,
  action VARCHAR(100) NOT NULL,
  actor_type VARCHAR(50) NOT NULL,
  actor_id VARCHAR(255),
  changes JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX audit_tenant_idx ON audit_logs(tenant_id);
CREATE INDEX audit_entity_idx ON audit_logs(entity_type, entity_id);
