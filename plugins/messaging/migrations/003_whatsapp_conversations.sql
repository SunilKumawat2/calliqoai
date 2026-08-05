-- Migration 003: WhatsApp Conversations, Messages, and Meta Admin Config
-- Supports the Meta WhatsApp conversation inbox, inbound webhooks, and admin provider controls

CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  contact_name TEXT DEFAULT '',
  contact_wa_id TEXT DEFAULT '',
  status TEXT DEFAULT 'active' CHECK (status IN ('active','closed','archived')),
  assigned_agent_id UUID NULL,
  auto_reply_enabled BOOLEAN DEFAULT false,
  window_expires_at TIMESTAMPTZ NULL,
  unread_count INTEGER DEFAULT 0,
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_preview TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, contact_phone)
);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  sender_type TEXT NOT NULL CHECK (sender_type IN ('customer','user','agent')),
  message_type TEXT DEFAULT 'text' CHECK (message_type IN ('text','template','image','document','audio','video','reaction','button','interactive','sticker','location','contacts','unknown')),
  content TEXT DEFAULT '',
  meta_message_id TEXT NULL,
  template_name TEXT NULL,
  media_url TEXT NULL,
  media_mime_type TEXT NULL,
  status TEXT DEFAULT 'sent' CHECK (status IN ('pending','sent','delivered','read','failed')),
  error_message TEXT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_messages_conversation ON whatsapp_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_wa_messages_meta_id ON whatsapp_messages(meta_message_id);
CREATE INDEX IF NOT EXISTS idx_wa_messages_user_created ON whatsapp_messages(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_wa_conversations_user_status ON whatsapp_conversations(user_id, status);

CREATE TABLE IF NOT EXISTS meta_whatsapp_admin_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whatsapp_provider_mode TEXT DEFAULT 'both' CHECK (whatsapp_provider_mode IN ('whatsway_only','meta_only','both','disabled')),
  meta_app_id TEXT DEFAULT '',
  meta_app_secret TEXT DEFAULT '',
  meta_config_id TEXT DEFAULT '',
  embedded_signup_enabled BOOLEAN DEFAULT false,
  coexistence_enabled BOOLEAN DEFAULT false,
  webhook_verify_token TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
