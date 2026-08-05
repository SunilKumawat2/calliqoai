import { db } from "../../../server/db.js";
import { sql } from "drizzle-orm";
import bcrypt from "bcrypt";
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_SECTIONS
} from "../types.js";
const BCRYPT_ROUNDS = 12;
class TeamService {
  static async createTeam(userId, name) {
    const result = await db.execute(sql`
      INSERT INTO teams (user_id, name)
      VALUES (${userId}, ${name || "My Team"})
      ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
      RETURNING *
    `);
    const team = this.mapTeamRow(result.rows[0]);
    await this.initializeDefaultRoles(team.id);
    return team;
  }
  static async getTeamByUserId(userId) {
    const result = await db.execute(sql`
      SELECT * FROM teams WHERE user_id = ${userId}
    `);
    if (result.rows.length === 0) return null;
    return this.mapTeamRow(result.rows[0]);
  }
  static async getTeamById(teamId) {
    const result = await db.execute(sql`
      SELECT * FROM teams WHERE id = ${teamId}::uuid
    `);
    if (result.rows.length === 0) return null;
    return this.mapTeamRow(result.rows[0]);
  }
  static async updateTeam(teamId, data) {
    const setClauses = [];
    if (data.name) {
      setClauses.push(sql`name = ${data.name}`);
    }
    if (data.description !== void 0) {
      setClauses.push(sql`description = ${data.description}`);
    }
    if (data.settings) {
      setClauses.push(sql`settings = ${JSON.stringify(data.settings)}::jsonb`);
    }
    if (setClauses.length === 0) {
      const team = await this.getTeamById(teamId);
      if (!team) throw new Error("Team not found");
      return team;
    }
    const result = await db.execute(sql`
      UPDATE teams 
      SET ${sql.join(setClauses, sql`, `)}, updated_at = NOW()
      WHERE id = ${teamId}::uuid
      RETURNING *
    `);
    return this.mapTeamRow(result.rows[0]);
  }
  static async initializeDefaultRoles(teamId) {
    const defaultRoles = [
      { name: "owner", displayName: "Owner", description: "Full access to all features", isDefault: false },
      { name: "admin", displayName: "Admin", description: "Manage team and most features", isDefault: false },
      { name: "manager", displayName: "Manager", description: "Manage campaigns and agents", isDefault: true },
      { name: "viewer", displayName: "Viewer", description: "View-only access", isDefault: false }
    ];
    const roles = [];
    for (const role of defaultRoles) {
      const result = await db.execute(sql`
        INSERT INTO team_roles (team_id, name, display_name, description, is_system, is_default)
        VALUES (${teamId}::uuid, ${role.name}, ${role.displayName}, ${role.description}, true, ${role.isDefault})
        ON CONFLICT (team_id, name) DO NOTHING
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
    const permissions = DEFAULT_ROLE_PERMISSIONS[roleName];
    for (const section of PERMISSION_SECTIONS) {
      for (const subsection of section.subsections) {
        const permKey = `${section.id}.${subsection.id}`;
        const wildcardSection = `${section.id}.*`;
        const hasPermission = permissions["*"] || permissions[wildcardSection] || permissions[permKey];
        if (hasPermission) {
          await db.execute(sql`
            INSERT INTO team_permissions (role_id, section, subsection, can_create, can_read, can_update, can_delete)
            VALUES (
              ${roleId}::uuid, 
              ${section.id}, 
              ${subsection.id}, 
              true, true, true, true
            )
            ON CONFLICT (role_id, section, subsection) DO NOTHING
          `);
        }
      }
    }
  }
  static async createMember(teamId, data) {
    const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    const result = await db.execute(sql`
      INSERT INTO team_members (team_id, email, password_hash, first_name, last_name, role_id, status)
      VALUES (
        ${teamId}::uuid, 
        ${data.email.toLowerCase()}, 
        ${passwordHash}, 
        ${data.firstName || null}, 
        ${data.lastName || null}, 
        ${data.roleId}::uuid,
        'active'
      )
      RETURNING *
    `);
    return this.mapMemberRow(result.rows[0]);
  }
  static async getMemberById(memberId) {
    const result = await db.execute(sql`
      SELECT * FROM team_members WHERE id = ${memberId}::uuid
    `);
    if (result.rows.length === 0) return null;
    return this.mapMemberRow(result.rows[0]);
  }
  static async getMemberByEmail(teamId, email) {
    const result = await db.execute(sql`
      SELECT * FROM team_members 
      WHERE team_id = ${teamId}::uuid AND LOWER(email) = ${email.toLowerCase()}
    `);
    if (result.rows.length === 0) return null;
    return this.mapMemberRow(result.rows[0]);
  }
  static async getMemberWithRole(memberId) {
    const result = await db.execute(sql`
      SELECT m.*, r.name as role_name, r.display_name as role_display_name, 
             r.description as role_description, r.is_system as role_is_system, r.is_default as role_is_default
      FROM team_members m
      JOIN team_roles r ON m.role_id = r.id
      WHERE m.id = ${memberId}::uuid
    `);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      ...this.mapMemberRow(row),
      role: {
        id: row.role_id,
        teamId: row.team_id,
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
  static async getMembersByTeam(teamId) {
    const result = await db.execute(sql`
      SELECT m.*, r.name as role_name, r.display_name as role_display_name, 
             r.description as role_description, r.is_system as role_is_system, r.is_default as role_is_default
      FROM team_members m
      JOIN team_roles r ON m.role_id = r.id
      WHERE m.team_id = ${teamId}::uuid
      ORDER BY m.created_at ASC
    `);
    return result.rows.map((row) => ({
      ...this.mapMemberRow(row),
      role: {
        id: row.role_id,
        teamId: row.team_id,
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
  static async updateMember(memberId, data) {
    const setClauses = [];
    if (data.firstName !== void 0) setClauses.push(sql`first_name = ${data.firstName}`);
    if (data.lastName !== void 0) setClauses.push(sql`last_name = ${data.lastName}`);
    if (data.roleId) setClauses.push(sql`role_id = ${data.roleId}::uuid`);
    if (data.status) setClauses.push(sql`status = ${data.status}`);
    if (setClauses.length === 0) {
      const member = await this.getMemberById(memberId);
      if (!member) throw new Error("Member not found");
      return member;
    }
    const result = await db.execute(sql`
      UPDATE team_members 
      SET ${sql.join(setClauses, sql`, `)}
      WHERE id = ${memberId}::uuid
      RETURNING *
    `);
    if (result.rows.length === 0) throw new Error("Member not found");
    return this.mapMemberRow(result.rows[0]);
  }
  static async updateMemberPassword(memberId, newPassword) {
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await db.execute(sql`
      UPDATE team_members 
      SET password_hash = ${passwordHash}
      WHERE id = ${memberId}::uuid
    `);
  }
  static async deleteMember(memberId) {
    await db.execute(sql`
      DELETE FROM team_member_sessions WHERE member_id = ${memberId}::uuid
    `);
    await db.execute(sql`
      DELETE FROM team_members WHERE id = ${memberId}::uuid
    `);
  }
  static async getRolesByTeam(teamId) {
    const result = await db.execute(sql`
      SELECT * FROM team_roles 
      WHERE team_id = ${teamId}::uuid
      ORDER BY is_system DESC, created_at ASC
    `);
    return result.rows.map((row) => this.mapRoleRow(row));
  }
  static async getRoleById(roleId) {
    const result = await db.execute(sql`
      SELECT * FROM team_roles WHERE id = ${roleId}::uuid
    `);
    if (result.rows.length === 0) return null;
    return this.mapRoleRow(result.rows[0]);
  }
  static async createRole(teamId, data) {
    const result = await db.execute(sql`
      INSERT INTO team_roles (team_id, name, display_name, description, is_system, is_default)
      VALUES (
        ${teamId}::uuid, 
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
      UPDATE team_roles 
      SET 
        display_name = COALESCE(${data.displayName || null}, display_name),
        description = CASE WHEN ${data.description !== void 0} THEN ${data.description || null} ELSE description END
      WHERE id = ${roleId}::uuid AND is_system = false
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
      SELECT COUNT(*) as count FROM team_members WHERE role_id = ${roleId}::uuid
    `);
    if (parseInt(membersWithRole.rows[0].count) > 0) {
      throw new Error("Cannot delete role with assigned members");
    }
    await db.execute(sql`
      DELETE FROM team_permissions WHERE role_id = ${roleId}::uuid
    `);
    await db.execute(sql`
      DELETE FROM team_roles WHERE id = ${roleId}::uuid
    `);
  }
  static async copyRolePermissions(fromRoleId, toRoleId) {
    await db.execute(sql`
      INSERT INTO team_permissions (role_id, section, subsection, can_create, can_read, can_update, can_delete)
      SELECT ${toRoleId}::uuid, section, subsection, can_create, can_read, can_update, can_delete
      FROM team_permissions
      WHERE role_id = ${fromRoleId}::uuid
      ON CONFLICT (role_id, section, subsection) DO UPDATE
      SET can_create = EXCLUDED.can_create,
          can_read = EXCLUDED.can_read,
          can_update = EXCLUDED.can_update,
          can_delete = EXCLUDED.can_delete
    `);
  }
  static async getMemberCount(teamId) {
    const result = await db.execute(sql`
      SELECT COUNT(*) as count FROM team_members WHERE team_id = ${teamId}::uuid
    `);
    return parseInt(result.rows[0].count);
  }
  static async logActivity(teamId, memberId, action, targetType, targetId, metadata, ipAddress) {
    await db.execute(sql`
      INSERT INTO team_activity_logs (team_id, member_id, action, target_type, target_id, metadata, ip_address)
      VALUES (
        ${teamId}::uuid, 
        ${memberId ? sql`${memberId}::uuid` : sql`NULL`}, 
        ${action}, 
        ${targetType}, 
        ${targetId ? sql`${targetId}::uuid` : sql`NULL`},
        ${metadata ? JSON.stringify(metadata) : null}::jsonb,
        ${ipAddress || null}
      )
    `);
  }
  static async getActivityLogs(teamId, options) {
    const page = options?.page || 1;
    const pageSize = options?.pageSize || 50;
    const offset = (page - 1) * pageSize;
    const search = options?.search?.toLowerCase();
    let query = sql`
      SELECT 
        tal.id,
        tal.team_id,
        tal.member_id,
        tal.action,
        tal.target_type,
        tal.target_id,
        tal.metadata,
        tal.ip_address,
        tal.created_at,
        tm.email as member_email,
        tm.first_name as member_first_name,
        tm.last_name as member_last_name
      FROM team_activity_logs tal
      LEFT JOIN team_members tm ON tal.member_id = tm.id
      WHERE tal.team_id = ${teamId}::uuid
    `;
    if (search) {
      query = sql`${query} AND (
        LOWER(tal.action) LIKE ${`%${search}%`}
        OR LOWER(tal.target_type) LIKE ${`%${search}%`}
        OR LOWER(tm.email) LIKE ${`%${search}%`}
        OR LOWER(tm.first_name) LIKE ${`%${search}%`}
        OR LOWER(tm.last_name) LIKE ${`%${search}%`}
      )`;
    }
    query = sql`${query} ORDER BY tal.created_at DESC LIMIT ${pageSize} OFFSET ${offset}`;
    const result = await db.execute(query);
    let countQuery = sql`
      SELECT COUNT(*) as count FROM team_activity_logs tal
      LEFT JOIN team_members tm ON tal.member_id = tm.id
      WHERE tal.team_id = ${teamId}::uuid
    `;
    if (search) {
      countQuery = sql`${countQuery} AND (
        LOWER(tal.action) LIKE ${`%${search}%`}
        OR LOWER(tal.target_type) LIKE ${`%${search}%`}
        OR LOWER(tm.email) LIKE ${`%${search}%`}
        OR LOWER(tm.first_name) LIKE ${`%${search}%`}
        OR LOWER(tm.last_name) LIKE ${`%${search}%`}
      )`;
    }
    const countResult = await db.execute(countQuery);
    const total = parseInt(countResult.rows[0].count);
    const activities = result.rows.map((row) => ({
      id: row.id,
      teamId: row.team_id,
      memberId: row.member_id,
      memberEmail: row.member_email,
      memberName: row.member_first_name && row.member_last_name ? `${row.member_first_name} ${row.member_last_name}` : row.member_email || "System",
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      metadata: row.metadata,
      ipAddress: row.ip_address,
      createdAt: new Date(row.created_at).toISOString()
    }));
    return { activities, total };
  }
  static mapTeamRow(row) {
    return {
      id: row.id,
      userId: row.user_id,
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
      teamId: row.team_id,
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
      teamId: row.team_id,
      name: row.name,
      displayName: row.display_name,
      description: row.description,
      isSystem: row.is_system,
      isDefault: row.is_default,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }
}
export {
  TeamService
};
