import { Router } from "express";
import { TeamService } from "../services/team.service.js";
import { TeamPermissionService } from "../services/team-permission.service.js";
import { PERMISSION_SECTIONS } from "../types.js";
const router = Router();
router.get("/sections", async (req, res) => {
  try {
    res.json(PERMISSION_SECTIONS);
  } catch (error) {
    console.error("[Team Permissions] Error fetching sections:", error);
    res.status(500).json({ error: "Failed to fetch permission sections" });
  }
});
router.get("/matrix/:roleId", async (req, res) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const team = await TeamService.getTeamByUserId(req.userId);
    if (!team) {
      return res.status(404).json({ error: "Team not found" });
    }
    const role = await TeamService.getRoleById(req.params.roleId);
    if (!role || role.teamId !== team.id) {
      return res.status(404).json({ error: "Role not found" });
    }
    const matrix = await TeamPermissionService.getPermissionMatrix(req.params.roleId);
    res.json(matrix);
  } catch (error) {
    console.error("[Team Permissions] Error fetching matrix:", error);
    res.status(500).json({ error: "Failed to fetch permission matrix" });
  }
});
router.patch("/:roleId", async (req, res) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const team = await TeamService.getTeamByUserId(req.userId);
    if (!team) {
      return res.status(404).json({ error: "Team not found" });
    }
    const role = await TeamService.getRoleById(req.params.roleId);
    if (!role || role.teamId !== team.id) {
      return res.status(404).json({ error: "Role not found" });
    }
    const { permissions } = req.body;
    if (!Array.isArray(permissions)) {
      return res.status(400).json({ error: "Permissions must be an array" });
    }
    await TeamPermissionService.bulkSetPermissions({
      roleId: req.params.roleId,
      permissions
    });
    await TeamService.logActivity(team.id, null, "permissions_updated", "role", role.id, {
      permissionCount: permissions.length
    });
    const updatedMatrix = await TeamPermissionService.getPermissionMatrix(req.params.roleId);
    res.json(updatedMatrix);
  } catch (error) {
    console.error("[Team Permissions] Error updating permissions:", error);
    res.status(500).json({ error: "Failed to update permissions" });
  }
});
router.post("/:roleId/grant-all", async (req, res) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const team = await TeamService.getTeamByUserId(req.userId);
    if (!team) {
      return res.status(404).json({ error: "Team not found" });
    }
    const role = await TeamService.getRoleById(req.params.roleId);
    if (!role || role.teamId !== team.id) {
      return res.status(404).json({ error: "Role not found" });
    }
    await TeamPermissionService.grantAllPermissions(req.params.roleId);
    await TeamService.logActivity(team.id, null, "permissions_granted_all", "role", role.id);
    const matrix = await TeamPermissionService.getPermissionMatrix(req.params.roleId);
    res.json(matrix);
  } catch (error) {
    console.error("[Team Permissions] Error granting all permissions:", error);
    res.status(500).json({ error: "Failed to grant all permissions" });
  }
});
router.post("/:roleId/clear", async (req, res) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const team = await TeamService.getTeamByUserId(req.userId);
    if (!team) {
      return res.status(404).json({ error: "Team not found" });
    }
    const role = await TeamService.getRoleById(req.params.roleId);
    if (!role || role.teamId !== team.id) {
      return res.status(404).json({ error: "Role not found" });
    }
    await TeamPermissionService.clearRolePermissions(req.params.roleId);
    await TeamService.logActivity(team.id, null, "permissions_cleared", "role", role.id);
    const matrix = await TeamPermissionService.getPermissionMatrix(req.params.roleId);
    res.json(matrix);
  } catch (error) {
    console.error("[Team Permissions] Error clearing permissions:", error);
    res.status(500).json({ error: "Failed to clear permissions" });
  }
});
router.post("/:roleId/copy-from/:sourceRoleId", async (req, res) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const team = await TeamService.getTeamByUserId(req.userId);
    if (!team) {
      return res.status(404).json({ error: "Team not found" });
    }
    const role = await TeamService.getRoleById(req.params.roleId);
    if (!role || role.teamId !== team.id) {
      return res.status(404).json({ error: "Target role not found" });
    }
    const sourceRole = await TeamService.getRoleById(req.params.sourceRoleId);
    if (!sourceRole || sourceRole.teamId !== team.id) {
      return res.status(404).json({ error: "Source role not found" });
    }
    await TeamService.copyRolePermissions(req.params.sourceRoleId, req.params.roleId);
    await TeamService.logActivity(team.id, null, "permissions_copied", "role", role.id, {
      sourceRoleId: sourceRole.id,
      sourceRoleName: sourceRole.name
    });
    const matrix = await TeamPermissionService.getPermissionMatrix(req.params.roleId);
    res.json(matrix);
  } catch (error) {
    console.error("[Team Permissions] Error copying permissions:", error);
    res.status(500).json({ error: "Failed to copy permissions" });
  }
});
var user_permissions_routes_default = router;
export {
  user_permissions_routes_default as default
};
