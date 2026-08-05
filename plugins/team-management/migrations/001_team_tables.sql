-- ============================================================
-- Team Management Plugin - Database Schema
-- Version: 1.0.0
-- 
-- This migration creates all tables required for the Team Management plugin.
-- Run this migration before registering the plugin.
-- ============================================================

-- Teams table: One team per user account
CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL DEFAULT 'My Team',
  description TEXT,
  settings JSONB NOT NULL DEFAULT '{
    "maxMembers": 10,
    "allowCustomRoles": true,
    "requireEmailVerification": false,
    "sessionExpiryHours": 24
  }'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT unique_user_team UNIQUE (user_id)
);

-- Team roles table: Defines roles within a team
CREATE TABLE IF NOT EXISTS team_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT unique_team_role_name UNIQUE (team_id, name)
);

-- Team members table: Team members with separate auth
CREATE TABLE IF NOT EXISTS team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  role_id UUID NOT NULL REFERENCES team_roles(id) ON DELETE RESTRICT,
  status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'suspended', 'deactivated')),
  last_login_at TIMESTAMP WITH TIME ZONE,
  invited_by UUID REFERENCES team_members(id) ON DELETE SET NULL,
  invited_at TIMESTAMP WITH TIME ZONE,
  email_verified_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT unique_team_member_email UNIQUE (team_id, email)
);

-- Team permissions table: Section-wise CRUD permissions per role
CREATE TABLE IF NOT EXISTS team_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES team_roles(id) ON DELETE CASCADE,
  section VARCHAR(100) NOT NULL,
  subsection VARCHAR(100) NOT NULL,
  can_create BOOLEAN NOT NULL DEFAULT FALSE,
  can_read BOOLEAN NOT NULL DEFAULT FALSE,
  can_update BOOLEAN NOT NULL DEFAULT FALSE,
  can_delete BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT unique_role_permission UNIQUE (role_id, section, subsection)
);

-- Team member sessions table: Active sessions for team members
CREATE TABLE IF NOT EXISTS team_member_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  token VARCHAR(512) NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  user_agent TEXT,
  ip_address VARCHAR(45),
  
  CONSTRAINT unique_member_token UNIQUE (member_id, token)
);

-- Team activity logs table: Audit trail
CREATE TABLE IF NOT EXISTS team_activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  member_id UUID REFERENCES team_members(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(100),
  target_id UUID,
  metadata JSONB,
  ip_address VARCHAR(45),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_teams_user_id ON teams(user_id);
CREATE INDEX IF NOT EXISTS idx_team_roles_team_id ON team_roles(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_email ON team_members(email);
CREATE INDEX IF NOT EXISTS idx_team_members_status ON team_members(status);
CREATE INDEX IF NOT EXISTS idx_team_permissions_role_id ON team_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_team_member_sessions_member_id ON team_member_sessions(member_id);
CREATE INDEX IF NOT EXISTS idx_team_member_sessions_token ON team_member_sessions(token);
CREATE INDEX IF NOT EXISTS idx_team_member_sessions_expires_at ON team_member_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_team_activity_logs_team_id ON team_activity_logs(team_id);
CREATE INDEX IF NOT EXISTS idx_team_activity_logs_created_at ON team_activity_logs(created_at);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_team_tables_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to tables with updated_at
DROP TRIGGER IF EXISTS update_teams_updated_at ON teams;
CREATE TRIGGER update_teams_updated_at
  BEFORE UPDATE ON teams
  FOR EACH ROW
  EXECUTE FUNCTION update_team_tables_updated_at();

DROP TRIGGER IF EXISTS update_team_roles_updated_at ON team_roles;
CREATE TRIGGER update_team_roles_updated_at
  BEFORE UPDATE ON team_roles
  FOR EACH ROW
  EXECUTE FUNCTION update_team_tables_updated_at();

DROP TRIGGER IF EXISTS update_team_members_updated_at ON team_members;
CREATE TRIGGER update_team_members_updated_at
  BEFORE UPDATE ON team_members
  FOR EACH ROW
  EXECUTE FUNCTION update_team_tables_updated_at();

DROP TRIGGER IF EXISTS update_team_permissions_updated_at ON team_permissions;
CREATE TRIGGER update_team_permissions_updated_at
  BEFORE UPDATE ON team_permissions
  FOR EACH ROW
  EXECUTE FUNCTION update_team_tables_updated_at();

-- ============================================================
-- ADMIN TEAM TABLES (for platform sub-admins)
-- ============================================================

-- Admin teams table: Platform-level admin team (usually one per installation)
CREATE TABLE IF NOT EXISTS admin_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL DEFAULT 'Admin Team',
  description TEXT,
  settings JSONB NOT NULL DEFAULT '{
    "maxMembers": 50,
    "allowCustomRoles": true,
    "requireEmailVerification": false,
    "sessionExpiryHours": 24
  }'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Admin team roles table: Roles for admin sub-admins
CREATE TABLE IF NOT EXISTS admin_team_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_team_id UUID NOT NULL REFERENCES admin_teams(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT unique_admin_team_role_name UNIQUE (admin_team_id, name)
);

-- Admin team members table: Sub-admins with separate auth
CREATE TABLE IF NOT EXISTS admin_team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_team_id UUID NOT NULL REFERENCES admin_teams(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  role_id UUID NOT NULL REFERENCES admin_team_roles(id) ON DELETE RESTRICT,
  status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'suspended', 'deactivated')),
  last_login_at TIMESTAMP WITH TIME ZONE,
  invited_by UUID REFERENCES admin_team_members(id) ON DELETE SET NULL,
  invited_at TIMESTAMP WITH TIME ZONE,
  email_verified_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT unique_admin_team_member_email UNIQUE (admin_team_id, email)
);

-- Admin team permissions table: Section-wise CRUD permissions per admin role
CREATE TABLE IF NOT EXISTS admin_team_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES admin_team_roles(id) ON DELETE CASCADE,
  section VARCHAR(100) NOT NULL,
  subsection VARCHAR(100) NOT NULL,
  can_create BOOLEAN NOT NULL DEFAULT FALSE,
  can_read BOOLEAN NOT NULL DEFAULT FALSE,
  can_update BOOLEAN NOT NULL DEFAULT FALSE,
  can_delete BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT unique_admin_role_permission UNIQUE (role_id, section, subsection)
);

-- Admin team sessions table: Active sessions for sub-admins
CREATE TABLE IF NOT EXISTS admin_team_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES admin_team_members(id) ON DELETE CASCADE,
  admin_team_id UUID NOT NULL REFERENCES admin_teams(id) ON DELETE CASCADE,
  token VARCHAR(512) NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  user_agent TEXT,
  ip_address VARCHAR(45),
  
  CONSTRAINT unique_admin_member_token UNIQUE (member_id, token)
);

-- Admin team activity logs table: Audit trail for admin actions
CREATE TABLE IF NOT EXISTS admin_team_activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_team_id UUID NOT NULL REFERENCES admin_teams(id) ON DELETE CASCADE,
  member_id UUID REFERENCES admin_team_members(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(100),
  target_id UUID,
  metadata JSONB,
  ip_address VARCHAR(45),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for admin team tables
CREATE INDEX IF NOT EXISTS idx_admin_team_roles_admin_team_id ON admin_team_roles(admin_team_id);
CREATE INDEX IF NOT EXISTS idx_admin_team_members_admin_team_id ON admin_team_members(admin_team_id);
CREATE INDEX IF NOT EXISTS idx_admin_team_members_email ON admin_team_members(email);
CREATE INDEX IF NOT EXISTS idx_admin_team_members_status ON admin_team_members(status);
CREATE INDEX IF NOT EXISTS idx_admin_team_permissions_role_id ON admin_team_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_admin_team_sessions_member_id ON admin_team_sessions(member_id);
CREATE INDEX IF NOT EXISTS idx_admin_team_sessions_token ON admin_team_sessions(token);
CREATE INDEX IF NOT EXISTS idx_admin_team_sessions_expires_at ON admin_team_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_team_activity_logs_admin_team_id ON admin_team_activity_logs(admin_team_id);
CREATE INDEX IF NOT EXISTS idx_admin_team_activity_logs_created_at ON admin_team_activity_logs(created_at);

-- Apply triggers to admin team tables with updated_at
DROP TRIGGER IF EXISTS update_admin_teams_updated_at ON admin_teams;
CREATE TRIGGER update_admin_teams_updated_at
  BEFORE UPDATE ON admin_teams
  FOR EACH ROW
  EXECUTE FUNCTION update_team_tables_updated_at();

DROP TRIGGER IF EXISTS update_admin_team_roles_updated_at ON admin_team_roles;
CREATE TRIGGER update_admin_team_roles_updated_at
  BEFORE UPDATE ON admin_team_roles
  FOR EACH ROW
  EXECUTE FUNCTION update_team_tables_updated_at();

DROP TRIGGER IF EXISTS update_admin_team_members_updated_at ON admin_team_members;
CREATE TRIGGER update_admin_team_members_updated_at
  BEFORE UPDATE ON admin_team_members
  FOR EACH ROW
  EXECUTE FUNCTION update_team_tables_updated_at();

DROP TRIGGER IF EXISTS update_admin_team_permissions_updated_at ON admin_team_permissions;
CREATE TRIGGER update_admin_team_permissions_updated_at
  BEFORE UPDATE ON admin_team_permissions
  FOR EACH ROW
  EXECUTE FUNCTION update_team_tables_updated_at();

-- ============================================================
-- Default Roles Function: Called when creating a new team
-- ============================================================
-- Note: Default roles and permissions are created via the service layer
-- when a team is initialized, not via SQL triggers, to allow for
-- flexibility and customization based on plan settings.
