-- ============================================================
-- Messaging Plugin - Database Migration
-- Version: 1.0.0
--
-- Creates tables for email templates, WhatsWay settings,
-- and messaging logs.
-- ============================================================

-- User Email Templates
CREATE TABLE IF NOT EXISTS user_email_templates (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  subject VARCHAR(500) NOT NULL,
  html_body TEXT NOT NULL,
  variables TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- WhatsWay Settings (one per user)
CREATE TABLE IF NOT EXISTS whatsway_settings (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  api_key TEXT NOT NULL,
  api_secret TEXT NOT NULL,
  base_url VARCHAR(500) DEFAULT 'https://whatsway.diploy.in',
  channel_id VARCHAR(255) DEFAULT '',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Messaging Logs
CREATE TABLE IF NOT EXISTS messaging_logs (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  call_id VARCHAR,
  agent_id VARCHAR,
  channel VARCHAR(20) NOT NULL,
  recipient_phone VARCHAR(50),
  recipient_email VARCHAR(255),
  template_name VARCHAR(255),
  status VARCHAR(20) DEFAULT 'pending',
  response_data JSONB,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_email_templates_user_id ON user_email_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_whatsway_settings_user_id ON whatsway_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_messaging_logs_user_id ON messaging_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_messaging_logs_channel ON messaging_logs(channel);
CREATE INDEX IF NOT EXISTS idx_messaging_logs_status ON messaging_logs(status);
CREATE INDEX IF NOT EXISTS idx_messaging_logs_created_at ON messaging_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_messaging_logs_agent_id ON messaging_logs(agent_id);
