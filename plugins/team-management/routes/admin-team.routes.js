import { Router } from "express";
import { AdminTeamService } from "../services/admin-team.service.js";
import { ADMIN_PERMISSION_SECTIONS } from "../types.js";
const router = Router();
router.get("/", async (req, res) => {
  try {
    const team = await AdminTeamService.getOrCreateAdminTeam();
    const memberCount = await AdminTeamService.getMemberCount(team.id);
    res.json({
      id: team.id,
      name: team.name,
      description: team.description,
      settings: team.settings,
      memberCount,
      createdAt: team.createdAt
    });
  } catch (error) {
    console.error("[Admin Team] Error fetching admin team:", error);
    res.status(500).json({ error: "Failed to fetch admin team" });
  }
});
router.get("/members", async (req, res) => {
  try {
    const team = await AdminTeamService.getOrCreateAdminTeam();
    const members = await AdminTeamService.getMembersByTeam(team.id);
    res.json({
      members: members.map((m) => ({
        id: m.id,
        email: m.email,
        name: `${m.firstName || ""} ${m.lastName || ""}`.trim() || m.email,
        firstName: m.firstName,
        lastName: m.lastName,
        roleId: m.roleId,
        roleName: m.role?.displayName || m.role?.name || "Unknown",
        status: m.status,
        lastLoginAt: m.lastLoginAt,
        createdAt: m.createdAt
      }))
    });
  } catch (error) {
    console.error("[Admin Team] Error fetching members:", error);
    res.status(500).json({ error: "Failed to fetch admin team members" });
  }
});
router.post("/members", async (req, res) => {
  try {
    const { email, password, firstName, lastName, roleId } = req.body;
    if (!email || !password || !roleId) {
      return res.status(400).json({ error: "Email, password, and role are required" });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }
    const team = await AdminTeamService.getOrCreateAdminTeam();
    const member = await AdminTeamService.createMember(team.id, {
      email,
      password,
      firstName,
      lastName,
      roleId
    });
    await AdminTeamService.logActivity(
      team.id,
      null,
      "member_created",
      "member",
      member.id,
      { email: member.email, createdBy: req.userId },
      req.ip || req.socket.remoteAddress
    );
    res.status(201).json({
      id: member.id,
      email: member.email,
      name: `${member.firstName || ""} ${member.lastName || ""}`.trim() || member.email,
      roleId: member.roleId,
      status: member.status,
      createdAt: member.createdAt
    });
  } catch (error) {
    console.error("[Admin Team] Error creating member:", error);
    if (error.message?.includes("unique") || error.code === "23505") {
      return res.status(400).json({ error: "A member with this email already exists" });
    }
    res.status(500).json({ error: "Failed to create admin team member" });
  }
});
router.patch("/members/:id", async (req, res) => {
  try {
    const { firstName, lastName, roleId, status } = req.body;
    const member = await AdminTeamService.updateMember(req.params.id, {
      firstName,
      lastName,
      roleId,
      status
    });
    const team = await AdminTeamService.getOrCreateAdminTeam();
    await AdminTeamService.logActivity(
      team.id,
      null,
      "member_updated",
      "member",
      member.id,
      { email: member.email, changes: { firstName, lastName, roleId, status }, updatedBy: req.userId },
      req.ip || req.socket.remoteAddress
    );
    res.json({
      id: member.id,
      email: member.email,
      name: `${member.firstName || ""} ${member.lastName || ""}`.trim() || member.email,
      roleId: member.roleId,
      status: member.status
    });
  } catch (error) {
    console.error("[Admin Team] Error updating member:", error);
    res.status(500).json({ error: "Failed to update admin team member" });
  }
});
router.post("/members/:id/reset-password", async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }
    await AdminTeamService.updateMemberPassword(req.params.id, newPassword);
    const team = await AdminTeamService.getOrCreateAdminTeam();
    await AdminTeamService.logActivity(
      team.id,
      null,
      "password_reset",
      "member",
      req.params.id,
      { resetBy: req.userId },
      req.ip || req.socket.remoteAddress
    );
    res.json({ success: true, message: "Password reset successfully" });
  } catch (error) {
    console.error("[Admin Team] Error resetting password:", error);
    res.status(500).json({ error: "Failed to reset password" });
  }
});
router.delete("/members/:id", async (req, res) => {
  try {
    const memberToDelete = await AdminTeamService.getMemberById(req.params.id);
    const team = await AdminTeamService.getOrCreateAdminTeam();
    await AdminTeamService.deleteMember(req.params.id);
    await AdminTeamService.logActivity(
      team.id,
      null,
      "member_deleted",
      "member",
      req.params.id,
      { email: memberToDelete?.email, deletedBy: req.userId },
      req.ip || req.socket.remoteAddress
    );
    res.json({ success: true });
  } catch (error) {
    console.error("[Admin Team] Error deleting member:", error);
    res.status(500).json({ error: "Failed to delete admin team member" });
  }
});
router.get("/roles", async (req, res) => {
  try {
    const team = await AdminTeamService.getOrCreateAdminTeam();
    const roles = await AdminTeamService.getRolesByTeam(team.id);
    res.json({
      roles: roles.map((r) => ({
        id: r.id,
        name: r.displayName || r.name,
        description: r.description,
        isSystem: r.isSystem,
        isDefault: r.isDefault,
        createdAt: r.createdAt
      }))
    });
  } catch (error) {
    console.error("[Admin Team] Error fetching roles:", error);
    res.status(500).json({ error: "Failed to fetch admin team roles" });
  }
});
router.post("/roles", async (req, res) => {
  try {
    const { name, displayName, description, copyFromRoleId } = req.body;
    if (!name || !displayName) {
      return res.status(400).json({ error: "Name and display name are required" });
    }
    const team = await AdminTeamService.getOrCreateAdminTeam();
    const role = await AdminTeamService.createRole(team.id, {
      name,
      displayName,
      description,
      copyFromRoleId
    });
    res.status(201).json({
      id: role.id,
      name: role.displayName || role.name,
      description: role.description,
      isSystem: role.isSystem,
      createdAt: role.createdAt
    });
  } catch (error) {
    console.error("[Admin Team] Error creating role:", error);
    if (error.message?.includes("unique")) {
      return res.status(400).json({ error: "A role with this name already exists" });
    }
    res.status(500).json({ error: "Failed to create role" });
  }
});
router.get("/roles/:id", async (req, res) => {
  try {
    const role = await AdminTeamService.getRoleById(req.params.id);
    if (!role) {
      return res.status(404).json({ error: "Role not found" });
    }
    const permissions = await AdminTeamService.getPermissionsForRole(role.id);
    res.json({
      ...role,
      permissions
    });
  } catch (error) {
    console.error("[Admin Team] Error fetching role:", error);
    res.status(500).json({ error: "Failed to fetch role" });
  }
});
router.patch("/roles/:id", async (req, res) => {
  try {
    const { displayName, description } = req.body;
    const role = await AdminTeamService.updateRole(req.params.id, {
      displayName,
      description
    });
    res.json({
      id: role.id,
      name: role.displayName || role.name,
      description: role.description,
      isSystem: role.isSystem
    });
  } catch (error) {
    console.error("[Admin Team] Error updating role:", error);
    res.status(500).json({ error: "Failed to update role" });
  }
});
router.delete("/roles/:id", async (req, res) => {
  try {
    await AdminTeamService.deleteRole(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error("[Admin Team] Error deleting role:", error);
    if (error.message?.includes("system")) {
      return res.status(403).json({ error: "System roles cannot be deleted" });
    }
    if (error.message?.includes("assigned")) {
      return res.status(400).json({ error: "Cannot delete a role that is currently assigned to members" });
    }
    res.status(500).json({ error: "Failed to delete role" });
  }
});
router.get("/activity-logs", async (req, res) => {
  try {
    const team = await AdminTeamService.getOrCreateAdminTeam();
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const action = req.query.action;
    const memberId = req.query.memberId;
    const search = req.query.search;
    const offset = (page - 1) * limit;
    const { logs, total } = await AdminTeamService.getActivityLogs(team.id, {
      limit,
      offset,
      action,
      memberId,
      search
    });
    res.json({
      logs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error("[Admin Team] Error fetching activity logs:", error);
    res.status(500).json({ error: "Failed to fetch activity logs" });
  }
});
router.get("/permissions/sections", async (req, res) => {
  try {
    res.json({ sections: ADMIN_PERMISSION_SECTIONS });
  } catch (error) {
    console.error("[Admin Team] Error fetching permission sections:", error);
    res.status(500).json({ error: "Failed to fetch permission sections" });
  }
});
router.get("/permissions/:roleId", async (req, res) => {
  try {
    const permissions = await AdminTeamService.getPermissionsForRole(req.params.roleId);
    const permMap = /* @__PURE__ */ new Map();
    for (const perm of permissions) {
      permMap.set(`${perm.section}.${perm.subsection}`, perm);
    }
    const matrix = {
      roleId: req.params.roleId,
      sections: ADMIN_PERMISSION_SECTIONS.map((section) => ({
        id: section.id,
        label: section.label,
        icon: section.icon,
        subsections: section.subsections.map((sub) => {
          const perm = permMap.get(`${section.id}.${sub.id}`);
          return {
            id: sub.id,
            label: sub.label,
            canCreate: perm?.canCreate ?? false,
            canRead: perm?.canRead ?? false,
            canUpdate: perm?.canUpdate ?? false,
            canDelete: perm?.canDelete ?? false
          };
        })
      }))
    };
    res.json(matrix);
  } catch (error) {
    console.error("[Admin Team] Error fetching permissions:", error);
    res.status(500).json({ error: "Failed to fetch permissions" });
  }
});
router.patch("/permissions/:roleId", async (req, res) => {
  try {
    const { permissions } = req.body;
    if (!Array.isArray(permissions)) {
      return res.status(400).json({ error: "Permissions must be an array" });
    }
    await AdminTeamService.bulkSetPermissions(req.params.roleId, permissions);
    const updated = await AdminTeamService.getPermissionsForRole(req.params.roleId);
    res.json({ success: true, permissions: updated });
  } catch (error) {
    console.error("[Admin Team] Error updating permissions:", error);
    res.status(500).json({ error: "Failed to update permissions" });
  }
});
var admin_team_routes_default = router;
export {
  admin_team_routes_default as default
};
