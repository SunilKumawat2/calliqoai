-- ============================================================
-- Messaging Plugin - Meta WhatsApp Business API Migration
-- Version: 1.1.0
--
-- Creates table for Meta WhatsApp Business API (Cloud API)
-- settings, enabling direct WABA integration per user.
-- ============================================================

CREATE TABLE IF NOT EXISTS meta_whatsapp_settings (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone_number_id VARCHAR(255) NOT NULL,
  waba_id VARCHAR(255) NOT NULL,
  access_token TEXT NOT NULL,
  business_name VARCHAR(500) DEFAULT '',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_whatsapp_settings_user_id ON meta_whatsapp_settings(user_id);
