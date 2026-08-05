ALTER TABLE messaging_logs ADD COLUMN IF NOT EXISTS message_content TEXT;
ALTER TABLE messaging_logs ADD COLUMN IF NOT EXISTS message_type VARCHAR(20);
