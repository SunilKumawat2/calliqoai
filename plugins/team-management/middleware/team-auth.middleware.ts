/**
 * Team Authentication & Permission Middleware
 * 
 * This middleware checks if the request is from a team member
 * and validates their permissions for the requested action.
 */

import { Request, Response, NextFunction } from 'express';
import { TeamAuthService } from '../services/team-auth.service.js';
import { TeamPermissionService } from '../services/team-permission.service.js';
import { AdminTeamService } from '../services/admin-team.service.js';
import { TeamMemberContext } from '../types.js';

export interface AdminTeamMemberContext extends TeamMemberContext {
  isAdminTeam: boolean;
  adminId: string;
}

export interface TeamMemberRequest extends Request {
  teamMember?: TeamMemberContext | AdminTeamMemberContext;
  isTeamMember?: boolean;
  isAdminTeamMember?: boolean;
}

export function authenticateTeamMember(options: { allowSession?: boolean; teamType?: 'user' | 'admin' | 'both' } = {}) {
  const teamType = options.teamType || 'both';
  
  return async (req: TeamMemberRequest, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader?.startsWith('Bearer ')) {
        if (options.allowSession && (req as any).userId) {
          return next();
        }
        return res.status(401).json({ error: 'Team authentication required' });
      }
      
      const token = authHeader.substring(7);
      
      // Try user team first if allowed
      if (teamType === 'user' || teamType === 'both') {
        const userMember = await TeamAuthService.validateSession(token);
        if (userMember) {
          req.teamMember = userMember;
          req.isTeamMember = true;
          req.isAdminTeamMember = false;
          return next();
        }
      }
      
      // Try admin team if allowed
      if (teamType === 'admin' || teamType === 'both') {
        const adminMember = await validateAdminTeamSession(token);
        if (adminMember) {
          req.teamMember = adminMember;
          req.isTeamMember = true;
          req.isAdminTeamMember = true;
          return next();
        }
      }
      
      return res.status(401).json({ error: 'Invalid or expired team session' });
    } catch (error) {
      console.error('[TeamAuth] Middleware error:', error);
      res.status(500).json({ error: 'Authentication failed' });
    }
  };
}

export function requireTeamPermission(section: string, subsection: string, action: 'create' | 'read' | 'update' | 'delete') {
  return async (req: TeamMemberRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.isTeamMember || !req.teamMember) {
        return next();
      }
      
      const hasPermission = await TeamPermissionService.checkPermission(
        req.teamMember.roleId,
        { section, subsection, action }
      );
      
      if (!hasPermission) {
        return res.status(403).json({ 
          error: 'Permission denied',
          required: { section, subsection, action }
        });
      }
      
      next();
    } catch (error) {
      console.error('[TeamAuth] Permission check error:', error);
      res.status(500).json({ error: 'Permission check failed' });
    }
  };
}

export function createTeamPermissionGuard(section: string, subsection: string) {
  return {
    read: requireTeamPermission(section, subsection, 'read'),
    create: requireTeamPermission(section, subsection, 'create'),
    update: requireTeamPermission(section, subsection, 'update'),
    delete: requireTeamPermission(section, subsection, 'delete'),
  };
}

export const TeamPermissionGuards = {
  campaigns: {
    view: createTeamPermissionGuard('campaigns', 'view'),
    create: createTeamPermissionGuard('campaigns', 'create'),
    edit: createTeamPermissionGuard('campaigns', 'edit'),
    delete: createTeamPermissionGuard('campaigns', 'delete'),
    contacts: createTeamPermissionGuard('campaigns', 'contacts'),
    execute: createTeamPermissionGuard('campaigns', 'execute'),
  },
  agents: {
    view: createTeamPermissionGuard('agents', 'view'),
    create: createTeamPermissionGuard('agents', 'create'),
    edit: createTeamPermissionGuard('agents', 'edit'),
    delete: createTeamPermissionGuard('agents', 'delete'),
    flowBuilder: createTeamPermissionGuard('agents', 'flow_builder'),
  },
  crm: {
    viewLeads: createTeamPermissionGuard('crm', 'view_leads'),
    edit: createTeamPermissionGuard('crm', 'edit'),
    delete: createTeamPermissionGuard('crm', 'delete'),
    pipelines: createTeamPermissionGuard('crm', 'pipelines'),
  },
  calls: {
    view: createTeamPermissionGuard('calls', 'view'),
    recordings: createTeamPermissionGuard('calls', 'recordings'),
    transcripts: createTeamPermissionGuard('calls', 'transcripts'),
  },
  knowledgeBase: {
    view: createTeamPermissionGuard('knowledge_base', 'view'),
    add: createTeamPermissionGuard('knowledge_base', 'add'),
    edit: createTeamPermissionGuard('knowledge_base', 'edit'),
    delete: createTeamPermissionGuard('knowledge_base', 'delete'),
  },
  phoneNumbers: {
    view: createTeamPermissionGuard('phone_numbers', 'view'),
    purchase: createTeamPermissionGuard('phone_numbers', 'purchase'),
    manage: createTeamPermissionGuard('phone_numbers', 'manage'),
  },
  billing: {
    view: createTeamPermissionGuard('billing', 'view'),
    manage: createTeamPermissionGuard('billing', 'manage'),
    purchaseCredits: createTeamPermissionGuard('billing', 'purchase_credits'),
  },
  analytics: {
    view: createTeamPermissionGuard('analytics', 'view'),
    export: createTeamPermissionGuard('analytics', 'export'),
  },
  settings: {
    view: createTeamPermissionGuard('settings', 'view'),
    edit: createTeamPermissionGuard('settings', 'edit'),
    integrations: createTeamPermissionGuard('settings', 'integrations'),
    apiKeys: createTeamPermissionGuard('settings', 'api_keys'),
  },
  team: {
    view: createTeamPermissionGuard('team', 'view'),
    invite: createTeamPermissionGuard('team', 'invite'),
    manage: createTeamPermissionGuard('team', 'manage'),
    roles: createTeamPermissionGuard('team', 'roles'),
  },
};

export function optionalTeamAuth() {
  return async (req: TeamMemberRequest, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const member = await TeamAuthService.validateSession(token);
        
        if (member) {
          req.teamMember = member;
          req.isTeamMember = true;
        }
      }
      
      next();
    } catch (error) {
      next();
    }
  };
}

/**
 * Helper function to get effective user ID for data filtering
 * Returns team member's parent user ID if team member, otherwise session user ID
 * This ensures team members see data belonging to their parent user's account
 */
export function getEffectiveUserId(req: TeamMemberRequest): string | number | undefined {
  if (req.isTeamMember && req.teamMember) {
    return req.teamMember.userId;
  }
  return (req as any).userId || (req as any).user?.id;
}

/**
 * Helper function to check if current request has a specific permission
 */
export function hasTeamPermission(req: TeamMemberRequest, section: string, subsection: string): boolean {
  if (!req.isTeamMember || !req.teamMember) {
    return true;
  }
  
  const permissions = req.teamMember.permissions;
  if (!permissions || !permissions[section]) {
    return false;
  }
  
  return permissions[section][subsection] === true;
}

/**
 * Helper function to check if current request has any permission in a section
 */
export function hasSectionAccess(req: TeamMemberRequest, section: string): boolean {
  if (!req.isTeamMember || !req.teamMember) {
    return true;
  }
  
  const permissions = req.teamMember.permissions;
  if (!permissions || !permissions[section]) {
    return false;
  }
  
  return Object.values(permissions[section]).some(v => v === true);
}

/**
 * Get team member context from request (if present)
 */
export function getTeamContext(req: TeamMemberRequest): TeamMemberContext | undefined {
  return req.teamMember;
}

/**
 * Validate admin team session token using AdminTeamService
 * Returns admin team member context if valid, null otherwise
 * Includes member status check (rejects suspended/disabled members)
 */
async function validateAdminTeamSession(token: string): Promise<AdminTeamMemberContext | null> {
  try {
    const session = await AdminTeamService.validateSession(token);
    
    if (!session) {
      return null;
    }
    
    return {
      memberId: session.memberId,
      teamId: session.teamId,
      userId: session.adminId, // Use adminId as userId for consistency
      roleId: session.roleId,
      roleName: session.roleName,
      permissions: session.permissions as any, // Cast to match TeamMemberContext
      isAdminTeam: true,
      adminId: session.adminId,
    };
  } catch (error) {
    console.error('[Team Auth] Admin session validation error:', error);
    return null;
  }
}

/**
 * Combined middleware that applies optional team auth and overwrites userId
 * for seamless integration with existing routes.
 * 
 * This middleware:
 * 1. Checks for team member Bearer token
 * 2. Validates against both user team and admin team sessions
 * 3. If valid team member, overwrites req.userId with parent user/admin ID
 * 4. Sets req.isTeamMember and req.teamMember for permission checking
 * 
 * Usage: Apply after session auth middleware
 */
export function applyTeamContext() {
  return async (req: TeamMemberRequest, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        
        // First try user team session
        const userMember = await TeamAuthService.validateSession(token);
        
        if (userMember) {
          req.teamMember = userMember;
          req.isTeamMember = true;
          req.isAdminTeamMember = false;
          // Overwrite userId with parent user ID for seamless data filtering
          (req as any).userId = userMember.userId;
          console.log(`[TeamAuth] Applied user team context: member ${userMember.memberId} -> user ${userMember.userId}`);
          return next();
        }
        
        // Then try admin team session
        const adminMember = await validateAdminTeamSession(token);
        
        if (adminMember) {
          req.teamMember = adminMember;
          req.isTeamMember = true;
          req.isAdminTeamMember = true;
          // For admin team members, set adminId context for admin routes
          (req as any).adminId = adminMember.adminId;
          console.log(`[TeamAuth] Applied admin team context: member ${adminMember.memberId} -> admin ${adminMember.adminId}`);
          return next();
        }
      }
      
      next();
    } catch (error) {
      // Don't fail - just continue without team context
      next();
    }
  };
}

/**
 * Middleware that requires team member to have specific permission
 * Returns 403 if team member lacks the required permission
 * Non-team members (regular users) are allowed through
 */
export function requirePermission(section: string, action: 'canCreate' | 'canRead' | 'canUpdate' | 'canDelete') {
  return async (req: TeamMemberRequest, res: Response, next: NextFunction) => {
    // Regular users (non-team members) have full access
    if (!req.isTeamMember || !req.teamMember) {
      return next();
    }

    const permissions = req.teamMember.permissions;
    if (!permissions || !permissions[section]) {
      return res.status(403).json({ 
        error: 'Access denied',
        message: `You don't have permission to access this section` 
      });
    }

    // Check if any subsection has the required action
    const hasPermission = Object.entries(permissions[section]).some(([subsection, perms]) => {
      if (typeof perms === 'object' && perms !== null) {
        return (perms as any)[action] === true;
      }
      return perms === true;
    });

    if (!hasPermission) {
      return res.status(403).json({ 
        error: 'Permission denied',
        message: `You don't have ${action.replace('can', '').toLowerCase()} permission for this section`
      });
    }

    next();
  };
}
