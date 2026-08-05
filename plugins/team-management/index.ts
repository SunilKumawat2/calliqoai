/**
 * ============================================================
 * Team Management Plugin - Main Entry Point
 * 
 * Provides comprehensive team management with:
 * - Separate team member logins (email + password)
 * - Role-based access control
 * - Hierarchical section-wise CRUD permissions
 * - Admin oversight and user team management
 * 
 * Installation:
 * 1. Run database migration (migrations/001_team_tables.sql)
 * 2. Import and register routes in main server file
 * 3. Configure team settings in admin panel
 * 
 * See INSTALLATION.md for detailed setup instructions.
 * See STRUCTURE.md for code architecture overview.
 * ============================================================
 */

import { Router, type Express, type RequestHandler, type Request, type Response, type NextFunction } from 'express';
import type { Server as HttpServer } from 'http';

import userTeamRoutes from './routes/user-team.routes.js';
import userMembersRoutes from './routes/user-members.routes.js';
import userRolesRoutes from './routes/user-roles.routes.js';
import userPermissionsRoutes from './routes/user-permissions.routes.js';
import teamAuthRoutes from './routes/team-auth.routes.js';
import adminTeamAuthRoutes from './routes/admin-team-auth.routes.js';
import adminTeamsRoutes from './routes/admin-teams.routes.js';
import adminTeamRoutes from './routes/admin-team.routes.js';

export { TeamService } from './services/team.service.js';
export { TeamAuthService } from './services/team-auth.service.js';
export { TeamPermissionService } from './services/team-permission.service.js';
export { AdminTeamService } from './services/admin-team.service.js';

export * from './types.js';

export const PLUGIN_VERSION = '1.0.0';
export const PLUGIN_NAME = 'team-management';

export function createUserTeamRouter(): Router {
  const router = Router();
  
  router.use('/', userTeamRoutes);
  router.use('/members', userMembersRoutes);
  router.use('/roles', userRolesRoutes);
  router.use('/permissions', userPermissionsRoutes);
  
  return router;
}

export function createTeamAuthRouter(): Router {
  const router = Router();
  
  router.use('/', teamAuthRoutes);
  
  return router;
}

export function createAdminTeamAuthRouter(): Router {
  const router = Router();
  
  router.use('/', adminTeamAuthRoutes);
  
  return router;
}

export function createAdminTeamsRouter(): Router {
  const router = Router();
  
  router.use('/', adminTeamsRoutes);
  
  return router;
}

export function createAdminTeamRouter(): Router {
  const router = Router();
  
  router.use('/', adminTeamRoutes);
  
  return router;
}

interface PluginLoaderOptions {
  sessionAuthMiddleware: RequestHandler;
  adminAuthMiddleware: RequestHandler;
  httpServer?: HttpServer;
}

export function registerTeamManagementRoutes(
  app: Express,
  options: PluginLoaderOptions
): void {
  const { sessionAuthMiddleware, adminAuthMiddleware } = options;
  
  // IMPORTANT: Register public auth routes BEFORE protected team routes
  // Express matches routes in order, so /api/team/auth must come first
  app.use('/api/team/auth', createTeamAuthRouter());
  
  // Admin team auth (public route for sub-admin login)
  app.use('/api/admin/team/auth', createAdminTeamAuthRouter());
  
  app.use('/api/team', sessionAuthMiddleware, createUserTeamRouter());
  
  app.use('/api/admin/teams', adminAuthMiddleware, createAdminTeamsRouter());
  
  app.use('/api/admin/team', adminAuthMiddleware, createAdminTeamRouter());
  
  console.log('[Team Management] Plugin registered (v1.0)');
  console.log('[Team Management] Endpoints:');
  console.log('  - /api/team (user auth) - User team management');
  console.log('  - /api/team/members (user auth) - User team member CRUD');
  console.log('  - /api/team/roles (user auth) - User team role management');
  console.log('  - /api/team/permissions (user auth) - User permission config');
  console.log('  - /api/team/auth (public) - Team member authentication');
  console.log('  - /api/admin/team/auth (public) - Admin sub-admin authentication');
  console.log('  - /api/admin/teams (admin auth) - User team oversight');
  console.log('  - /api/admin/team (admin auth) - Admin team for sub-admins');
  console.log('✅ Team Management Plugin initialized');
}

export default {
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  register: registerTeamManagementRoutes,
};
