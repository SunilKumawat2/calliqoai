-- ============================================================
-- REST API Plugin - Database Migration
-- Version: 1.0.0
-- 
-- This migration creates the required tables for the REST API plugin:
-- - api_keys: Stores API key credentials and permissions
-- - api_audit_logs: Tracks all API requests for security
-- - api_rate_limits: Sliding window rate limiting
--
-- Run this migration after installing the plugin:
--   psql $DATABASE_URL -f plugins/rest-api/migrations/001_api_tables.sql
-- ============================================================

-- Create api_keys table
CREATE TABLE IF NOT EXISTS api_keys (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Key identification
    name TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    hashed_secret TEXT NOT NULL,
    
    -- Permissions
    scopes TEXT[] NOT NULL DEFAULT ARRAY['calls:read', 'calls:write', 'campaigns:read', 'contacts:read']::text[],
    
    -- Rate limiting
    rate_limit INTEGER NOT NULL DEFAULT 100,
    rate_limit_window INTEGER NOT NULL DEFAULT 60,
    
    -- Security
    ip_whitelist TEXT[] DEFAULT ARRAY[]::text[],
    expires_at TIMESTAMP,
    
    -- Status
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_used_at TIMESTAMP,
    last_used_ip TEXT,
    total_requests INTEGER NOT NULL DEFAULT 0,
    
    -- Metadata
    description TEXT,
    metadata JSONB,
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes for api_keys
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_prefix ON api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_is_active ON api_keys(is_active);

-- Create api_audit_logs table
CREATE TABLE IF NOT EXISTS api_audit_logs (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    api_key_id VARCHAR REFERENCES api_keys(id) ON DELETE SET NULL,
    
    -- Request details
    method TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    path TEXT NOT NULL,
    
    -- Request info
    request_body JSONB,
    query_params JSONB,
    
    -- Response info
    status_code INTEGER NOT NULL,
    response_time INTEGER,
    error_message TEXT,
    
    -- Client info
    ip_address TEXT,
    user_agent TEXT,
    
    -- Correlation
    request_id TEXT NOT NULL,
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes for api_audit_logs
CREATE INDEX IF NOT EXISTS idx_api_audit_logs_user_id ON api_audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_api_audit_logs_api_key_id ON api_audit_logs(api_key_id);
CREATE INDEX IF NOT EXISTS idx_api_audit_logs_created_at ON api_audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_api_audit_logs_request_id ON api_audit_logs(request_id);

-- Create api_rate_limits table
CREATE TABLE IF NOT EXISTS api_rate_limits (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
    api_key_id VARCHAR NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    window_start TIMESTAMP NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes for api_rate_limits
CREATE INDEX IF NOT EXISTS idx_api_rate_limits_api_key_id ON api_rate_limits(api_key_id);
CREATE INDEX IF NOT EXISTS idx_api_rate_limits_window_start ON api_rate_limits(window_start);

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'REST API Plugin: Database migration completed successfully';
    RAISE NOTICE 'Tables created: api_keys, api_audit_logs, api_rate_limits';
END $$;
