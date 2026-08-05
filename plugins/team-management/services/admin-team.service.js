import { db } from "../../../server/db.js";
import { sql } from "drizzle-orm";
import bcrypt from "bcrypt";
import {
  ADMIN_PERMISSION_SECTIONS
} from "../types.js";
const BCRYPT_ROUNDS = 12;
class AdminTeamService {
  static async getOrCreateAdminTeam() {
    const existing = await db.execute(sql`SELECT * FROM admin_teams LIMIT 1`);
    if (existing.rows.length > 0) {
      return this.mapTeamRow(existing.rows[0]);
    }
    const result = await db.execute(sql`
      INSERT INTO admin_teams (name, description)
      VALUES ('Admin Team', 'Platform administration team for sub-admins')
      RETURNING *
    `);
    const team = this.mapTeamRow(result.rows[0]);
    await this.initializeDefaultRoles(team.id);
    return team;
  }
  static async getAdminTeam() {
    const result = await db.execute(sql`SELECT * FROM admin_teams LIMIT 1`);
    if (result.rows.length === 0) return null;
    return this.mapTeamRow(result.rows[0]);
  }
  static async initializeDefaultRoles(adminTeamId) {
    const defaultRoles = [
      { name: "super_admin", displayName: "Super Admin", description: "Full access to all admin features", isDefault: false },
      { name: "admin", displayName: "Admin", description: "Manage users and billing", isDefault: true },
      { name: "support", displayName: "Support", description: "View users and handle support", isDefault: false },
      { name: "viewer", displayName: "Viewer", description: "Read-only access", isDefault: false }
    ];
    const roles = [];
    for (const role of defaultRoles) {
      const result = await db.execute(sql`
        INSERT INTO admin_team_roles (admin_team_id, name, display_name, description, is_system, is_default)
        VALUES (${adminTeamId}, ${role.name}, ${role.displayName}, ${role.description}, true, ${role.isDefault})
        ON CONFLICT (admin_team_id, name) DO NOTHING
        RETURNING *
      `);
      if (result.rows.length > 0) {
        const createdRole = this.mapRoleRow(result.rows[0]);
        roles.push(createdRole);
        await this.initializeRolePermissions(createdRole.id, role.name);
      }
    }
    return roles;
  }
  static async initializeRolePermissions(roleId, roleName) {
    const permissionLevel = this.getDefaultPermissionLevel(roleName);
    for (const section of ADMIN_PERMISSION_SECTIONS) {
      for (const subsection of section.subsections) {
        const perms = this.getPermissionsForLevel(permissionLevel);
        await db.execute(sql`
          INSERT INTO admin_team_permissions (role_id, section, subsection, can_create, can_read, can_update, can_delete)
          VALUES (${roleId}, ${section.id}, ${subsection.id}, ${perms.canCreate}, ${perms.canRead}, ${perms.canUpdate}, ${perms.canDelete})
          ON CONFLICT (role_id, section, subsection) DO NOTHING
        `);
      }
    }
  }
  static getDefaultPermissionLevel(roleName) {
    switch (roleName) {
      case "super_admin":
        return "full";
      case "admin":
        return "manage";
      case "support":
        return "read";
      case "viewer":
        return "read";
      default:
        return "none";
    }
  }
  static getPermissionsForLevel(level) {
    switch (level) {
      case "full":
        return { canCreate: true, canRead: true, canUpdate: true, canDelete: true };
      case "manage":
        return { canCreate: true, canRead: true, canUpdate: true, canDelete: false };
      case "read":
        return { canCreate: false, canRead: true, canUpdate: false, canDelete: false };
      default:
        return { canCreate: false, canRead: false, canUpdate: false, canDelete: false };
    }
  }
  static async createMember(adminTeamId, data) {
    const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    const result = await db.execute(sql`
      INSERT INTO admin_team_members (admin_team_id, email, password_hash, first_name, last_name, role_id, status, invited_by, invited_at)
      VALUES (
        ${adminTeamId},
        ${data.email.toLowerCase()},
        ${passwordHash},
        ${data.firstName || null},
        ${data.lastName || null},
        ${data.roleId},
        'active',
        ${data.invitedBy || null},
        NOW()
      )
      RETURNING *
    `);
    return this.mapMemberRow(result.rows[0]);
  }
  static async getMembersByTeam(adminTeamId) {
    const result = await db.execute(sql`
      SELECT m.*, r.name as role_name, r.display_name as role_display_name, 
             r.description as role_description, r.is_system as role_is_system, r.is_default as role_is_default
      FROM admin_team_members m
      JOIN admin_team_roles r ON m.role_id = r.id
      WHERE m.admin_team_id = ${adminTeamId}
      ORDER BY m.created_at ASC
    `);
    return result.rows.map((row) => ({
      ...this.mapMemberRow(row),
      role: {
        id: row.role_id,
        adminTeamId: row.admin_team_id,
        name: row.role_name,
        displayName: row.role_display_name,
        description: row.role_description,
        isSystem: row.role_is_system,
        isDefault: row.role_is_default,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    }));
  }
  static async getMemberById(memberId) {
    const result = await db.execute(sql`
      SELECT * FROM admin_team_members WHERE id = ${memberId}
    `);
    if (result.rows.length === 0) return null;
    return this.mapMemberRow(result.rows[0]);
  }
  static async getMemberByEmail(email) {
    const result = await db.execute(sql`
      SELECT m.*, r.name as role_name, r.display_name as role_display_name, 
             r.description as role_description, r.is_system as role_is_system, r.is_default as role_is_default
      FROM admin_team_members m
      JOIN admin_team_roles r ON m.role_id = r.id
      WHERE m.email = ${email.toLowerCase()}
    `);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      ...this.mapMemberRow(row),
      role: {
        id: row.role_id,
        adminTeamId: row.admin_team_id,
        name: row.role_name,
        displayName: row.role_display_name,
        description: row.role_description,
        isSystem: row.role_is_system,
        isDefault: row.role_is_default,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    };
  }
  static async updateMember(memberId, data) {
    const setClauses = [];
    if (data.firstName !== void 0) setClauses.push(sql`first_name = ${data.firstName}`);
    if (data.lastName !== void 0) setClauses.push(sql`last_name = ${data.lastName}`);
    if (data.roleId) setClauses.push(sql`role_id = ${data.roleId}`);
    if (data.status) setClauses.push(sql`status = ${data.status}`);
    if (setClauses.length === 0) {
      const member = await this.getMemberById(memberId);
      if (!member) throw new Error("Member not found");
      return member;
    }
    const result = await db.execute(sql`
      UPDATE admin_team_members 
      SET ${sql.join(setClauses, sql`, `)}, updated_at = NOW()
      WHERE id = ${memberId}
      RETURNING *
    `);
    if (result.rows.length === 0) throw new Error("Member not found");
    return this.mapMemberRow(result.rows[0]);
  }
  static async updateMemberPassword(memberId, newPassword) {
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await db.execute(sql`
      UPDATE admin_team_members SET password_hash = ${passwordHash}, updated_at = NOW() WHERE id = ${memberId}
    `);
  }
  static async deleteMember(memberId) {
    await db.execute(sql`DELETE FROM admin_team_sessions WHERE member_id = ${memberId}`);
    await db.execute(sql`DELETE FROM admin_team_members WHERE id = ${memberId}`);
  }
  static async getRolesByTeam(adminTeamId) {
    const result = await db.execute(sql`
      SELECT * FROM admin_team_roles 
      WHERE admin_team_id = ${adminTeamId}
      ORDER BY is_system DESC, created_at ASC
    `);
    return result.rows.map((row) => this.mapRoleRow(row));
  }
  static async getRoleById(roleId) {
    const result = await db.execute(sql`SELECT * FROM admin_team_roles WHERE id = ${roleId}`);
    if (result.rows.length === 0) return null;
    return this.mapRoleRow(result.rows[0]);
  }
  static async createRole(adminTeamId, data) {
    const result = await db.execute(sql`
      INSERT INTO admin_team_roles (admin_team_id, name, display_name, description, is_system, is_default)
      VALUES (
        ${adminTeamId},
        ${data.name.toLowerCase().replace(/\s+/g, "_")},
        ${data.displayName},
        ${data.description || null},
        false,
        false
      )
      RETURNING *
    `);
    const role = this.mapRoleRow(result.rows[0]);
    if (data.copyFromRoleId) {
      await this.copyRolePermissions(data.copyFromRoleId, role.id);
    }
    return role;
  }
  static async updateRole(roleId, data) {
    if (!data.displayName && data.description === void 0) {
      const role = await this.getRoleById(roleId);
      if (!role) throw new Error("Role not found");
      return role;
    }
    const result = await db.execute(sql`
      UPDATE admin_team_roles 
      SET 
        display_name = COALESCE(${data.displayName || null}, display_name),
        description = CASE WHEN ${data.description !== void 0} THEN ${data.description || null} ELSE description END,
        updated_at = NOW()
      WHERE id = ${roleId} AND is_system = false
      RETURNING *
    `);
    if (result.rows.length === 0) throw new Error("Role not found or is a system role");
    return this.mapRoleRow(result.rows[0]);
  }
  static async deleteRole(roleId) {
    const role = await this.getRoleById(roleId);
    if (!role) throw new Error("Role not found");
    if (role.isSystem) throw new Error("Cannot delete system roles");
    const membersWithRole = await db.execute(sql`
      SELECT COUNT(*) as count FROM admin_team_members WHERE role_id = ${roleId}
    `);
    if (parseInt(membersWithRole.rows[0].count) > 0) {
      throw new Error("Cannot delete role with assigned members");
    }
    await db.execute(sql`DELETE FROM admin_team_permissions WHERE role_id = ${roleId}`);
    await db.execute(sql`DELETE FROM admin_team_roles WHERE id = ${roleId}`);
  }
  static async copyRolePermissions(fromRoleId, toRoleId) {
    await db.execute(sql`
      INSERT INTO admin_team_permissions (role_id, section, subsection, can_create, can_read, can_update, can_delete)
      SELECT ${toRoleId}, section, subsection, can_create, can_read, can_update, can_delete
      FROM admin_team_permissions
      WHERE role_id = ${fromRoleId}
      ON CONFLICT (role_id, section, subsection) DO UPDATE
      SET can_create = EXCLUDED.can_create,
          can_read = EXCLUDED.can_read,
          can_update = EXCLUDED.can_update,
          can_delete = EXCLUDED.can_delete
    `);
  }
  static async getPermissionsForRole(roleId) {
    const result = await db.execute(sql`
      SELECT * FROM admin_team_permissions WHERE role_id = ${roleId}
    `);
    return result.rows.map((row) => ({
      id: row.id,
      roleId: row.role_id,
      section: row.section,
      subsection: row.subsection,
      canCreate: row.can_create,
      canRead: row.can_read,
      canUpdate: row.can_update,
      canDelete: row.can_delete
    }));
  }
  static async bulkSetPermissions(roleId, permissions) {
    if (permissions.length === 0) return;
    const CHUNK_SIZE = 50;
    const chunks = [];
    for (let i = 0; i < permissions.length; i += CHUNK_SIZE) {
      chunks.push(permissions.slice(i, i + CHUNK_SIZE));
    }
    await Promise.all(chunks.map(async (chunk) => {
      const values = chunk.map(
        (perm) => sql`(${roleId}, ${perm.section}, ${perm.subsection}, ${perm.canCreate}, ${perm.canRead}, ${perm.canUpdate}, ${perm.canDelete})`
      );
      await db.execute(sql`
        INSERT INTO admin_team_permissions (role_id, section, subsection, can_create, can_read, can_update, can_delete)
        VALUES ${sql.join(values, sql`, `)}
        ON CONFLICT (role_id, section, subsection) DO UPDATE
        SET can_create = EXCLUDED.can_create,
            can_read = EXCLUDED.can_read,
            can_update = EXCLUDED.can_update,
            can_delete = EXCLUDED.can_delete
      `);
    }));
  }
  static async getMemberCount(adminTeamId) {
    const result = await db.execute(sql`
      SELECT COUNT(*) as count FROM admin_team_members WHERE admin_team_id = ${adminTeamId}
    `);
    return parseInt(result.rows[0].count);
  }
  /**
   * Validate admin team session token
   * Returns session context if valid, null otherwise
   * Checks for:
   * - Valid session in database
   * - Session not expired
   * - Member is active (not suspended/disabled)
   */
  static async validateSession(token) {
    try {
      const sessionResult = await db.execute(sql`
        SELECT 
          s.id, s.member_id, s.admin_team_id, s.expires_at,
          m.role_id, m.status, m.email, m.first_name, m.last_name,
          t.id as team_id,
          r.name as role_name
        FROM admin_team_sessions s
        JOIN admin_team_members m ON s.member_id = m.id
        JOIN admin_teams t ON s.admin_team_id = t.id
        JOIN admin_team_roles r ON m.role_id = r.id
        WHERE s.token = ${token} AND s.expires_at > NOW()
      `);
      if (sessionResult.rows.length === 0) {
        return null;
      }
      const session = sessionResult.rows[0];
      if (session.status !== "active") {
        console.log(`[Admin Team Auth] Session rejected: member ${session.member_id} has status ${session.status}`);
        return null;
      }
      await db.execute(sql`
        UPDATE admin_team_sessions SET last_activity_at = NOW() WHERE token = ${token}
      `);
      const permissions = await this.getPermissionsForRole(session.role_id);
      return {
        memberId: session.member_id,
        teamId: session.admin_team_id,
        adminId: session.admin_team_id,
        // Use team ID for admin context
        roleId: session.role_id,
        roleName: session.role_name,
        permissions
      };
    } catch (error) {
      console.error("[Admin Team Auth] Session validation error:", error);
      return null;
    }
  }
  static mapTeamRow(row) {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      settings: typeof row.settings === "string" ? JSON.parse(row.settings) : row.settings,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }
  static mapMemberRow(row) {
    return {
      id: row.id,
      adminTeamId: row.admin_team_id,
      email: row.email,
      passwordHash: row.password_hash,
      firstName: row.first_name,
      lastName: row.last_name,
      roleId: row.role_id,
      status: row.status,
      lastLoginAt: row.last_login_at ? new Date(row.last_login_at) : void 0,
      invitedBy: row.invited_by,
      invitedAt: row.invited_at ? new Date(row.invited_at) : void 0,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }
  static mapRoleRow(row) {
    return {
      id: row.id,
      adminTeamId: row.admin_team_id,
      name: row.name,
      displayName: row.display_name,
      description: row.description,
      isSystem: row.is_system,
      isDefault: row.is_default,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }
  /**
   * Log admin team activity for audit trail
   */
  static async logActivity(adminTeamId, memberId, action, targetType, targetId, metadata, ipAddress) {
    try {
      await db.execute(sql`
        INSERT INTO admin_team_activity_logs (admin_team_id, member_id, action, target_type, target_id, metadata, ip_address)
        VALUES (
          ${adminTeamId},
          ${memberId || null},
          ${action},
          ${targetType},
          ${targetId || null},
          ${metadata ? JSON.stringify(metadata) : null}::jsonb,
          ${ipAddress || null}
        )
      `);
    } catch (error) {
      console.error("[Admin Team] Failed to log activity:", error);
    }
  }
  /**
   * Get activity logs for admin team
   */
  static async getActivityLogs(adminTeamId, options) {
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;
    let whereClause = sql`WHERE l.admin_team_id = ${adminTeamId}`;
    if (options?.memberId) {
      whereClause = sql`${whereClause} AND l.member_id = ${options.memberId}`;
    }
    if (options?.action) {
      whereClause = sql`${whereClause} AND l.action = ${options.action}`;
    }
    if (options?.search) {
      const searchTerm = `%${options.search.toLowerCase()}%`;
      whereClause = sql`${whereClause} AND (
        LOWER(l.action) LIKE ${searchTerm} OR 
        LOWER(l.target_type) LIKE ${searchTerm} OR 
        LOWER(m.email) LIKE ${searchTerm} OR
        LOWER(m.first_name) LIKE ${searchTerm} OR
        LOWER(m.last_name) LIKE ${searchTerm}
      )`;
    }
    const countResult = await db.execute(sql`
      SELECT COUNT(*) as total FROM admin_team_activity_logs l
      LEFT JOIN admin_team_members m ON l.member_id = m.id
      ${whereClause}
    `);
    const total = parseInt(countResult.rows[0].total, 10);
    const result = await db.execute(sql`
      SELECT 
        l.*,
        m.email as member_email,
        m.first_name as member_first_name,
        m.last_name as member_last_name
      FROM admin_team_activity_logs l
      LEFT JOIN admin_team_members m ON l.member_id = m.id
      ${whereClause}
      ORDER BY l.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);
    return {
      logs: result.rows.map((row) => ({
        id: row.id,
        adminTeamId: row.admin_team_id,
        memberId: row.member_id,
        memberEmail: row.member_email,
        memberName: row.member_first_name && row.member_last_name ? `${row.member_first_name} ${row.member_last_name}`.trim() : row.member_email,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        metadata: row.metadata,
        ipAddress: row.ip_address,
        createdAt: new Date(row.created_at)
      })),
      total
    };
  }
}
export {
  AdminTeamService
};
