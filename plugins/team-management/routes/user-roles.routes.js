import { Router } from "express";
import { TeamService } from "../services/team.service.js";
import { TeamPermissionService } from "../services/team-permission.service.js";
const router = Router();
router.get("/", async (req, res) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const team = await TeamService.getTeamByUserId(req.userId);
    if (!team) {
      return res.status(404).json({ error: "Team not found" });
    }
    const roles = await TeamService.getRolesByTeam(team.id);
    const formattedRoles = roles.map((r) => ({
      id: r.id,
      name: r.displayName || r.name,
      description: r.description,
      isSystemRole: r.isSystem,
      createdAt: r.createdAt
    }));
    res.json({ roles: formattedRoles });
  } catch (error) {
    console.error("[Team Roles] Error fetching roles:", error);
    res.status(500).json({ error: "Failed to fetch roles" });
  }
});
router.post("/", async (req, res) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const team = await TeamService.getTeamByUserId(req.userId);
    if (!team) {
      return res.status(404).json({ error: "Team not found" });
    }
    if (!team.settings.allowCustomRoles) {
      return res.status(403).json({ error: "Custom roles are not allowed for this team" });
    }
    const { name, displayName, description, copyFromRoleId } = req.body;
    if (!name || !displayName) {
      return res.status(400).json({ error: "Name and display name are required" });
    }
    const role = await TeamService.createRole(team.id, {
      name,
      displayName,
      description,
      copyFromRoleId
    });
    await TeamService.logActivity(team.id, null, "role_created", "role", role.id, {
      name: role.name
    });
    res.status(201).json(role);
  } catch (error) {
    console.error("[Team Roles] Error creating role:", error);
    if (error.message?.includes("unique")) {
      return res.status(400).json({ error: "A role with this name already exists" });
    }
    res.status(500).json({ error: "Failed to create role" });
  }
});
router.get("/:id", async (req, res) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const team = await TeamService.getTeamByUserId(req.userId);
    if (!team) {
      return res.status(404).json({ error: "Team not found" });
    }
    const role = await TeamService.getRoleById(req.params.id);
    if (!role || role.teamId !== team.id) {
      return res.status(404).json({ error: "Role not found" });
    }
    const permissionMatrix = await TeamPermissionService.getPermissionMatrix(role.id);
    res.json({
      ...role,
      permissions: permissionMatrix
    });
  } catch (error) {
    console.error("[Team Roles] Error fetching role:", error);
    res.status(500).json({ error: "Failed to fetch role" });
  }
});
router.patch("/:id", async (req, res) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const team = await TeamService.getTeamByUserId(req.userId);
    if (!team) {
      return res.status(404).json({ error: "Team not found" });
    }
    const role = await TeamService.getRoleById(req.params.id);
    if (!role || role.teamId !== team.id) {
      return res.status(404).json({ error: "Role not found" });
    }
    if (role.isSystem) {
      return res.status(403).json({ error: "System roles cannot be modified" });
    }
    const { displayName, description } = req.body;
    const updatedRole = await TeamService.updateRole(req.params.id, {
      displayName,
      description
    });
    await TeamService.logActivity(team.id, null, "role_updated", "role", role.id);
    res.json(updatedRole);
  } catch (error) {
    console.error("[Team Roles] Error updating role:", error);
    res.status(500).json({ error: "Failed to update role" });
  }
});
router.delete("/:id", async (req, res) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const team = await TeamService.getTeamByUserId(req.userId);
    if (!team) {
      return res.status(404).json({ error: "Team not found" });
    }
    const role = await TeamService.getRoleById(req.params.id);
    if (!role || role.teamId !== team.id) {
      return res.status(404).json({ error: "Role not found" });
    }
    await TeamService.deleteRole(req.params.id);
    await TeamService.logActivity(team.id, null, "role_deleted", "role", req.params.id, {
      name: role.name
    });
    res.json({ success: true });
  } catch (error) {
    console.error("[Team Roles] Error deleting role:", error);
    if (error.message?.includes("system")) {
      return res.status(403).json({ error: "System roles cannot be deleted" });
    }
    if (error.message?.includes("assigned")) {
      return res.status(400).json({ error: "Cannot delete a role that is currently assigned to members" });
    }
    res.status(500).json({ error: "Failed to delete role" });
  }
});
var user_roles_routes_default = router;
export {
  user_roles_routes_default as default
};
