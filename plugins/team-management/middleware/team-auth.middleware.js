import { TeamAuthService } from "../services/team-auth.service.js";
import { TeamPermissionService } from "../services/team-permission.service.js";
import { AdminTeamService } from "../services/admin-team.service.js";
function authenticateTeamMember(options = {}) {
  const teamType = options.teamType || "both";
  return async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        if (options.allowSession && req.userId) {
          return next();
        }
        return res.status(401).json({ error: "Team authentication required" });
      }
      const token = authHeader.substring(7);
      if (teamType === "user" || teamType === "both") {
        const userMember = await TeamAuthService.validateSession(token);
        if (userMember) {
          req.teamMember = userMember;
          req.isTeamMember = true;
          req.isAdminTeamMember = false;
          return next();
        }
      }
      if (teamType === "admin" || teamType === "both") {
        const adminMember = await validateAdminTeamSession(token);
        if (adminMember) {
          req.teamMember = adminMember;
          req.isTeamMember = true;
          req.isAdminTeamMember = true;
          return next();
        }
      }
      return res.status(401).json({ error: "Invalid or expired team session" });
    } catch (error) {
      console.error("[TeamAuth] Middleware error:", error);
      res.status(500).json({ error: "Authentication failed" });
    }
  };
}
function requireTeamPermission(section, subsection, action) {
  return async (req, res, next) => {
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
          error: "Permission denied",
          required: { section, subsection, action }
        });
      }
      next();
    } catch (error) {
      console.error("[TeamAuth] Permission check error:", error);
      res.status(500).json({ error: "Permission check failed" });
    }
  };
}
function createTeamPermissionGuard(section, subsection) {
  return {
    read: requireTeamPermission(section, subsection, "read"),
    create: requireTeamPermission(section, subsection, "create"),
    update: requireTeamPermission(section, subsection, "update"),
    delete: requireTeamPermission(section, subsection, "delete")
  };
}
const TeamPermissionGuards = {
  campaigns: {
    view: createTeamPermissionGuard("campaigns", "view"),
    create: createTeamPermissionGuard("campaigns", "create"),
    edit: createTeamPermissionGuard("campaigns", "edit"),
    delete: createTeamPermissionGuard("campaigns", "delete"),
    contacts: createTeamPermissionGuard("campaigns", "contacts"),
    execute: createTeamPermissionGuard("campaigns", "execute")
  },
  agents: {
    view: createTeamPermissionGuard("agents", "view"),
    create: createTeamPermissionGuard("agents", "create"),
    edit: createTeamPermissionGuard("agents", "edit"),
    delete: createTeamPermissionGuard("agents", "delete"),
    flowBuilder: createTeamPermissionGuard("agents", "flow_builder")
  },
  crm: {
    viewLeads: createTeamPermissionGuard("crm", "view_leads"),
    edit: createTeamPermissionGuard("crm", "edit"),
    delete: createTeamPermissionGuard("crm", "delete"),
    pipelines: createTeamPermissionGuard("crm", "pipelines")
  },
  calls: {
    view: createTeamPermissionGuard("calls", "view"),
    recordings: createTeamPermissionGuard("calls", "recordings"),
    transcripts: createTeamPermissionGuard("calls", "transcripts")
  },
  knowledgeBase: {
    view: createTeamPermissionGuard("knowledge_base", "view"),
    add: createTeamPermissionGuard("knowledge_base", "add"),
    edit: createTeamPermissionGuard("knowledge_base", "edit"),
    delete: createTeamPermissionGuard("knowledge_base", "delete")
  },
  phoneNumbers: {
    view: createTeamPermissionGuard("phone_numbers", "view"),
    purchase: createTeamPermissionGuard("phone_numbers", "purchase"),
    manage: createTeamPermissionGuard("phone_numbers", "manage")
  },
  billing: {
    view: createTeamPermissionGuard("billing", "view"),
    manage: createTeamPermissionGuard("billing", "manage"),
    purchaseCredits: createTeamPermissionGuard("billing", "purchase_credits")
  },
  analytics: {
    view: createTeamPermissionGuard("analytics", "view"),
    export: createTeamPermissionGuard("analytics", "export")
  },
  settings: {
    view: createTeamPermissionGuard("settings", "view"),
    edit: createTeamPermissionGuard("settings", "edit"),
    integrations: createTeamPermissionGuard("settings", "integrations"),
    apiKeys: createTeamPermissionGuard("settings", "api_keys")
  },
  team: {
    view: createTeamPermissionGuard("team", "view"),
    invite: createTeamPermissionGuard("team", "invite"),
    manage: createTeamPermissionGuard("team", "manage"),
    roles: createTeamPermissionGuard("team", "roles")
  }
};
function optionalTeamAuth() {
  return async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
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
function getEffectiveUserId(req) {
  if (req.isTeamMember && req.teamMember) {
    return req.teamMember.userId;
  }
  return req.userId || req.user?.id;
}
function hasTeamPermission(req, section, subsection) {
  if (!req.isTeamMember || !req.teamMember) {
    return true;
  }
  const permissions = req.teamMember.permissions;
  if (!permissions || !permissions[section]) {
    return false;
  }
  return permissions[section][subsection] === true;
}
function hasSectionAccess(req, section) {
  if (!req.isTeamMember || !req.teamMember) {
    return true;
  }
  const permissions = req.teamMember.permissions;
  if (!permissions || !permissions[section]) {
    return false;
  }
  return Object.values(permissions[section]).some((v) => v === true);
}
function getTeamContext(req) {
  return req.teamMember;
}
async function validateAdminTeamSession(token) {
  try {
    const session = await AdminTeamService.validateSession(token);
    if (!session) {
      return null;
    }
    return {
      memberId: session.memberId,
      teamId: session.teamId,
      userId: session.adminId,
      // Use adminId as userId for consistency
      roleId: session.roleId,
      roleName: session.roleName,
      permissions: session.permissions,
      // Cast to match TeamMemberContext
      isAdminTeam: true,
      adminId: session.adminId
    };
  } catch (error) {
    console.error("[Team Auth] Admin session validation error:", error);
    return null;
  }
}
function applyTeamContext() {
  return async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.substring(7);
        const userMember = await TeamAuthService.validateSession(token);
        if (userMember) {
          req.teamMember = userMember;
          req.isTeamMember = true;
          req.isAdminTeamMember = false;
          req.userId = userMember.userId;
          console.log(`[TeamAuth] Applied user team context: member ${userMember.memberId} -> user ${userMember.userId}`);
          return next();
        }
        const adminMember = await validateAdminTeamSession(token);
        if (adminMember) {
          req.teamMember = adminMember;
          req.isTeamMember = true;
          req.isAdminTeamMember = true;
          req.adminId = adminMember.adminId;
          console.log(`[TeamAuth] Applied admin team context: member ${adminMember.memberId} -> admin ${adminMember.adminId}`);
          return next();
        }
      }
      next();
    } catch (error) {
      next();
    }
  };
}
function requirePermission(section, action) {
  return async (req, res, next) => {
    if (!req.isTeamMember || !req.teamMember) {
      return next();
    }
    const permissions = req.teamMember.permissions;
    if (!permissions || !permissions[section]) {
      return res.status(403).json({
        error: "Access denied",
        message: `You don't have permission to access this section`
      });
    }
    const hasPermission = Object.entries(permissions[section]).some(([subsection, perms]) => {
      if (typeof perms === "object" && perms !== null) {
        return perms[action] === true;
      }
      return perms === true;
    });
    if (!hasPermission) {
      return res.status(403).json({
        error: "Permission denied",
        message: `You don't have ${action.replace("can", "").toLowerCase()} permission for this section`
      });
    }
    next();
  };
}
export {
  TeamPermissionGuards,
  applyTeamContext,
  authenticateTeamMember,
  createTeamPermissionGuard,
  getEffectiveUserId,
  getTeamContext,
  hasSectionAccess,
  hasTeamPermission,
  optionalTeamAuth,
  requirePermission,
  requireTeamPermission
};
