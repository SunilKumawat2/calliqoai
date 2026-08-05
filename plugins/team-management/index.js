import { Router } from "express";
import userTeamRoutes from "./routes/user-team.routes.js";
import userMembersRoutes from "./routes/user-members.routes.js";
import userRolesRoutes from "./routes/user-roles.routes.js";
import userPermissionsRoutes from "./routes/user-permissions.routes.js";
import teamAuthRoutes from "./routes/team-auth.routes.js";
import adminTeamAuthRoutes from "./routes/admin-team-auth.routes.js";
import adminTeamsRoutes from "./routes/admin-teams.routes.js";
import adminTeamRoutes from "./routes/admin-team.routes.js";
import { TeamService } from "./services/team.service.js";
import { TeamAuthService } from "./services/team-auth.service.js";
import { TeamPermissionService } from "./services/team-permission.service.js";
import { AdminTeamService } from "./services/admin-team.service.js";
export * from "./types.js";
const PLUGIN_VERSION = "1.0.0";
const PLUGIN_NAME = "team-management";
function createUserTeamRouter() {
  const router = Router();
  router.use("/", userTeamRoutes);
  router.use("/members", userMembersRoutes);
  router.use("/roles", userRolesRoutes);
  router.use("/permissions", userPermissionsRoutes);
  return router;
}
function createTeamAuthRouter() {
  const router = Router();
  router.use("/", teamAuthRoutes);
  return router;
}
function createAdminTeamAuthRouter() {
  const router = Router();
  router.use("/", adminTeamAuthRoutes);
  return router;
}
function createAdminTeamsRouter() {
  const router = Router();
  router.use("/", adminTeamsRoutes);
  return router;
}
function createAdminTeamRouter() {
  const router = Router();
  router.use("/", adminTeamRoutes);
  return router;
}
function registerTeamManagementRoutes(app, options) {
  const { sessionAuthMiddleware, adminAuthMiddleware } = options;
  app.use("/api/team/auth", createTeamAuthRouter());
  app.use("/api/admin/team/auth", createAdminTeamAuthRouter());
  app.use("/api/team", sessionAuthMiddleware, createUserTeamRouter());
  app.use("/api/admin/teams", adminAuthMiddleware, createAdminTeamsRouter());
  app.use("/api/admin/team", adminAuthMiddleware, createAdminTeamRouter());
  console.log("[Team Management] Plugin registered (v1.0)");
  console.log("[Team Management] Endpoints:");
  console.log("  - /api/team (user auth) - User team management");
  console.log("  - /api/team/members (user auth) - User team member CRUD");
  console.log("  - /api/team/roles (user auth) - User team role management");
  console.log("  - /api/team/permissions (user auth) - User permission config");
  console.log("  - /api/team/auth (public) - Team member authentication");
  console.log("  - /api/admin/team/auth (public) - Admin sub-admin authentication");
  console.log("  - /api/admin/teams (admin auth) - User team oversight");
  console.log("  - /api/admin/team (admin auth) - Admin team for sub-admins");
  console.log("\u2705 Team Management Plugin initialized");
}
var index_default = {
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  register: registerTeamManagementRoutes
};
export {
  AdminTeamService,
  PLUGIN_NAME,
  PLUGIN_VERSION,
  TeamAuthService,
  TeamPermissionService,
  TeamService,
  createAdminTeamAuthRouter,
  createAdminTeamRouter,
  createAdminTeamsRouter,
  createTeamAuthRouter,
  createUserTeamRouter,
  index_default as default,
  registerTeamManagementRoutes
};
