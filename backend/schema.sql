-- VoiceKhata Database Schema

-- Organizations Table (Multi-tenant)
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  owner_phone VARCHAR(20) UNIQUE NOT NULL,
  owner_name VARCHAR(255),
  plan VARCHAR(20) DEFAULT 'free',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_owner_phone ON organizations(owner_phone);

-- Parties Table (Customers, Transporters, Suppliers)
CREATE TABLE IF NOT EXISTS parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL, -- 'customer', 'transporter', 'supplier', 'trader'
  phone VARCHAR(20),
  gst_number VARCHAR(15),
  address TEXT,
  city VARCHAR(100),
  credit_limit DECIMAL(12,2) DEFAULT 0,
  notes TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  aliases TEXT[],
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, name)
);
CREATE INDEX IF NOT EXISTS idx_org_type ON parties(organization_id, type);
CREATE INDEX IF NOT EXISTS idx_outstanding_balance ON parties(organization_id);

-- Stone Types Catalog
CREATE TABLE IF NOT EXISTS stone_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  size_format VARCHAR(50) NOT NULL,
  width_inches DECIMAL(5,2),
  height_inches DECIMAL(5,2),
  finish VARCHAR(50),
  thickness_mm INT,
  current_price NUMERIC(8,2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'INR',
  unit VARCHAR(20) DEFAULT 'SQFT',
  is_active BOOLEAN DEFAULT TRUE,
  last_price_update TIMESTAMP,
  updated_by_user_id UUID,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, size_format, finish)
);
CREATE INDEX IF NOT EXISTS idx_org_active ON stone_types(organization_id, is_active);
CREATE INDEX IF NOT EXISTS idx_search ON stone_types(organization_id, size_format);

-- Price History Table (Audit Trail)
CREATE TABLE IF NOT EXISTS stone_price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stone_type_id UUID NOT NULL REFERENCES stone_types(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  old_price NUMERIC(8,2),
  new_price NUMERIC(8,2) NOT NULL,
  change_reason VARCHAR(255),
  change_date DATE,
  updated_by_user_id UUID,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_stone_history ON stone_price_history(stone_type_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_history ON stone_price_history(organization_id, created_at DESC);

-- Workers Table (Labor Ledger)
CREATE TABLE IF NOT EXISTS workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name VARCHAR(255) NOT NULL,
  role VARCHAR(100),
  phone VARCHAR(20),
  wage_per_day DECIMAL(8,2),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, name)
);
CREATE INDEX IF NOT EXISTS idx_org_workers ON workers(organization_id);

-- Transactions Table (Core Ledger)
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  party_id UUID REFERENCES parties(id),
  worker_id UUID REFERENCES workers(id),
  
  transaction_type VARCHAR(50), -- 'dispatch', 'advance', 'payment', 'freight', 'expense', 'correction'
  related_to UUID REFERENCES transactions(id),
  
  -- For dispatch
  stone_type_id UUID REFERENCES stone_types(id),
  pieces_count INT,
  sqft_quantity DECIMAL(10,2),
  unit_rate DECIMAL(8,2),
  master_price DECIMAL(8,2),
  price_variance DECIMAL(8,2),
  subtotal_amount DECIMAL(12,2),
  
  -- Freight & additional charges
  freight_charge DECIMAL(10,2) DEFAULT 0,
  loading_charge DECIMAL(10,2) DEFAULT 0,
  tax_surcharge DECIMAL(10,2) DEFAULT 0,
  
  -- Total & advance
  total_amount DECIMAL(12,2),
  advance_paid DECIMAL(12,2) DEFAULT 0,
  outstanding_balance DECIMAL(12,2),
  
  -- Status tracking
  status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'confirmed', 'failed'
  needs_price_confirmation BOOLEAN DEFAULT FALSE,
  price_warning JSONB,
  pending_whatsapp_msg_id VARCHAR(255),
  whatsapp_message_id VARCHAR(255), -- For idempotency
  confirmed_at TIMESTAMP,
  confirmed_by_user_id UUID,
  
  -- AI metadata
  voice_note_url VARCHAR(500),
  transcription_text TEXT,
  ai_extracted_json JSONB,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_org_party ON transactions(organization_id, party_id);
CREATE INDEX IF NOT EXISTS idx_status ON transactions(organization_id, status);

-- Transaction Line Items
CREATE TABLE IF NOT EXISTS transaction_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID REFERENCES transactions(id),
  stone_type_id UUID REFERENCES stone_types(id),
  pieces_count INT,
  sqft_quantity DECIMAL(10,2),
  unit_rate DECIMAL(8,2),
  line_amount DECIMAL(12,2),
  sequence INT
);

-- Party Balances Table
CREATE TABLE IF NOT EXISTS party_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  total_billed DECIMAL(12,2) DEFAULT 0,
  total_paid DECIMAL(12,2) DEFAULT 0,
  outstanding_balance DECIMAL(12,2) DEFAULT 0,
  last_transaction_date TIMESTAMP,
  last_payment_date TIMESTAMP,
  days_since_last_payment INT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, party_id)
);
CREATE INDEX IF NOT EXISTS idx_overdue ON party_balances(organization_id, outstanding_balance, last_payment_date);

-- Worker Ledger Table
CREATE TABLE IF NOT EXISTS worker_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  worker_id UUID NOT NULL REFERENCES workers(id),
  wage_earned DECIMAL(10,2) DEFAULT 0,
  advances_taken DECIMAL(10,2) DEFAULT 0,
  net_due DECIMAL(10,2) DEFAULT 0,
  last_settlement_date TIMESTAMP,
  last_settlement_amount DECIMAL(10,2),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, worker_id)
);

-- Audit Log
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  action VARCHAR(255),
  entity_type VARCHAR(100),
  entity_id UUID,
  old_values JSONB,
  new_values JSONB,
  user_id UUID,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Price Sheet Config
CREATE TABLE IF NOT EXISTS price_sheet_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  sheet_title VARCHAR(255),
  show_logos BOOLEAN DEFAULT TRUE,
  show_contact_info BOOLEAN DEFAULT TRUE,
  show_payment_terms BOOLEAN DEFAULT FALSE,
  color_theme VARCHAR(50) DEFAULT 'professional',
  include_notes BOOLEAN DEFAULT TRUE,
  auto_update BOOLEAN DEFAULT TRUE,
  last_generated TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id)
);
