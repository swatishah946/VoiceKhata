-- 001_hardening.sql
-- Safe to run on the existing production database: every statement is
-- idempotent (IF NOT EXISTS) and nothing is dropped or deleted.

-- Fuzzy name matching ("Sidhhi Stone" ≈ "Siddhi Stone")
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Default organisation used by the single-owner MVP
INSERT INTO organizations (id, name, owner_phone)
VALUES ('00000000-0000-0000-0000-000000000000', 'VoiceKhata Admin', '+10000000000')
ON CONFLICT (id) DO NOTHING;

-- Who is allowed to talk to the bot, and for which organisation.
-- Messages from any number not in this table are ignored.
CREATE TABLE IF NOT EXISTS organization_members (
  phone VARCHAR(20) PRIMARY KEY,                 -- E.164, e.g. +919876543210
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name VARCHAR(255),
  role VARCHAR(20) NOT NULL DEFAULT 'owner',     -- 'owner' | 'staff'
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_members_org ON organization_members(organization_id);

-- Webhook idempotency: Twilio retries a webhook if we are slow. Each MessageSid
-- is recorded once; a retry finds it here and is not processed again.
CREATE TABLE IF NOT EXISTS processed_messages (
  message_sid VARCHAR(64) PRIMARY KEY,
  from_phone VARCHAR(20),
  received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Store every part of the bill so it can be re-created and audited later
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS packing_charge DECIMAL(10,2) DEFAULT 0;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tax_percentage DECIMAL(5,2) DEFAULT 0;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tax_amount DECIMAL(12,2) DEFAULT 0;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS stone_type_text VARCHAR(100);
-- Which phone created the entry, so "yes" confirms that person's entry only
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS requested_by_phone VARCHAR(20);
-- Short code shown in WhatsApp, e.g. "yes K7Q2"
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS ref_code VARCHAR(8);

CREATE INDEX IF NOT EXISTS idx_tx_pending_by_phone
  ON transactions(organization_id, requested_by_phone, status, created_at DESC);

-- One transaction per WhatsApp message. Only created if existing data has no
-- duplicates (older versions could create duplicates on retries).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT whatsapp_message_id FROM transactions
    WHERE whatsapp_message_id IS NOT NULL
    GROUP BY whatsapp_message_id HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_tx_whatsapp_message_id
      ON transactions(whatsapp_message_id) WHERE whatsapp_message_id IS NOT NULL;
  ELSE
    RAISE NOTICE 'Duplicate whatsapp_message_id rows exist; review them, then re-run this migration.';
  END IF;
END $$;

-- Trigram indexes for fast fuzzy search
CREATE INDEX IF NOT EXISTS idx_parties_name_trgm ON parties USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_workers_name_trgm ON workers USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_logs(organization_id, created_at DESC);
