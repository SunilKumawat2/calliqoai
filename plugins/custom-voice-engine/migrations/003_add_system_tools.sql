-- Migration: Add system tools columns to ve_voice_agents
ALTER TABLE ve_voice_agents 
ADD COLUMN IF NOT EXISTS appointment_booking_enabled BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS end_conversation_enabled BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS transfer_enabled BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS transfer_phone_number TEXT,
ADD COLUMN IF NOT EXISTS messaging_email_enabled BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS messaging_whatsapp_enabled BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS messaging_email_template TEXT,
ADD COLUMN IF NOT EXISTS messaging_whatsapp_template TEXT;
