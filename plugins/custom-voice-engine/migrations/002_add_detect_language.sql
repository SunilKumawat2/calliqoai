-- ============================================================
-- AI Voice Engine Plugin — Database Migration
-- Version: 002
--
-- Adds detect_language_enabled to ve_voice_agents table
-- ============================================================

BEGIN;

ALTER TABLE ve_voice_agents ADD COLUMN IF NOT EXISTS detect_language_enabled BOOLEAN NOT NULL DEFAULT false;

COMMIT;
