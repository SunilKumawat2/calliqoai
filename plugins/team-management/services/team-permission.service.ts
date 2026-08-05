/**
 * Team Permission Service - Permission checking and management
 */

import { db } from '../../../server/db.js';
import { sql } from 'drizzle-orm';
import {
  TeamPermission,
  CheckPermissionInput,
  SetPermissionInput,
  BulkSetPermissionsInput,
  PERMISSION_SECTIONS,
} from '../types.js';

export interface PermissionMatrix {
  roleId: string;
  sections: Array<{
    id: string;
    label: string;
    icon: string;
    subsections: Array<{
      id: string;
      label: string;
      canCreate: boolean;
      canRead: boolean;
      canUpdate: boolean;
      canDelete: boolean;
    }>;
  }>;
}

export class TeamPermissionService {
  static async checkPermission(roleId: string, check: CheckPermissionInput): Promise<boolean> {
    const result = await db.execute(sql`
      SELECT * FROM team_permissions 
      WHERE role_id = ${roleId}::uuid 
        AND section = ${check.section}
        AND subsection = ${check.subsection}
    `);
    
    if (result.rows.length === 0) {
      return false;
    }
    
    const perm = result.rows[0] as any;
    
    switch (check.action) {
      case 'create': return perm.can_create;
      case 'read': return perm.can_read;
      case 'update': return perm.can_update;
      case 'delete': return perm.can_delete;
      default: return false;
    }
  }

  static async checkMemberPermission(memberId: string, check: CheckPermissionInput): Promise<boolean> {
    const memberResult = await db.execute(sql`
      SELECT role_id FROM team_members WHERE id = ${memberId}::uuid
    `);
    
    if (memberResult.rows.length === 0) {
      return false;
    }
    
    const roleId = (memberResult.rows[0] as any).role_id;
    return this.checkPermission(roleId, check);
  }

  static async getPermissionsForRole(roleId: string): Promise<TeamPermission[]> {
    const result = await db.execute(sql`
      SELECT * FROM team_permissions WHERE role_id = ${roleId}::uuid
    `);
    
    return result.rows.map((row: any) => ({
      id: row.id,
      roleId: row.role_id,
      section: row.section,
      subsection: row.subsection,
      canCreate: row.can_create,
      canRead: row.can_read,
      canUpdate: row.can_update,
      canDelete: row.can_delete,
    }));
  }

  static async getPermissionMatrix(roleId: string): Promise<PermissionMatrix> {
    const permissions = await this.getPermissionsForRole(roleId);
    
    const permMap = new Map<string, TeamPermission>();
    for (const perm of permissions) {
      permMap.set(`${perm.section}.${perm.subsection}`, perm);
    }
    
    const sections = PERMISSION_SECTIONS.map(section => ({
      id: section.id,
      label: section.label,
      icon: section.icon,
      subsections: section.subsections.map(sub => {
        const perm = permMap.get(`${section.id}.${sub.id}`);
        return {
          id: sub.id,
          label: sub.label,
          canCreate: perm?.canCreate ?? false,
          canRead: perm?.canRead ?? false,
          canUpdate: perm?.canUpdate ?? false,
          canDelete: perm?.canDelete ?? false,
        };
      }),
    }));
    
    return { roleId, sections };
  }

  static async setPermission(data: SetPermissionInput): Promise<TeamPermission> {
    const result = await db.execute(sql`
      INSERT INTO team_permissions (role_id, section, subsection, can_create, can_read, can_update, can_delete)
      VALUES (
        ${data.roleId}::uuid, 
        ${data.section}, 
        ${data.subsection}, 
        ${data.canCreate}, 
        ${data.canRead}, 
        ${data.canUpdate}, 
        ${data.canDelete}
      )
      ON CONFLICT (role_id, section, subsection) DO UPDATE
      SET can_create = ${data.canCreate},
          can_read = ${data.canRead},
          can_update = ${data.canUpdate},
          can_delete = ${data.canDelete},
          updated_at = NOW()
      RETURNING *
    `);
    
    const row = result.rows[0] as any;
    return {
      id: row.id,
      roleId: row.role_id,
      section: row.section,
      subsection: row.subsection,
      canCreate: row.can_create,
      canRead: row.can_read,
      canUpdate: row.can_update,
      canDelete: row.can_delete,
    };
  }

  static async bulkSetPermissions(data: BulkSetPermissionsInput): Promise<void> {
    if (data.permissions.length === 0) return;

    // Use Promise.all with chunks to batch efficiently while maintaining safety
    const CHUNK_SIZE = 50;
    const chunks: typeof data.permissions[] = [];
    for (let i = 0; i < data.permissions.length; i += CHUNK_SIZE) {
      chunks.push(data.permissions.slice(i, i + CHUNK_SIZE));
    }

    await Promise.all(chunks.map(async (chunk) => {
      const values = chunk.map(perm => 
        sql`(${data.roleId}::uuid, ${perm.section}, ${perm.subsection}, ${perm.canCreate}, ${perm.canRead}, ${perm.canUpdate}, ${perm.canDelete})`
      );
      
      await db.execute(sql`
        INSERT INTO team_permissions (role_id, section, subsection, can_create, can_read, can_update, can_delete)
        VALUES ${sql.join(values, sql`, `)}
        ON CONFLICT (role_id, section, subsection) DO UPDATE
        SET can_create = EXCLUDED.can_create,
            can_read = EXCLUDED.can_read,
            can_update = EXCLUDED.can_update,
            can_delete = EXCLUDED.can_delete,
            updated_at = NOW()
      `);
    }));
  }

  static async clearRolePermissions(roleId: string): Promise<void> {
    await db.execute(sql`
      DELETE FROM team_permissions WHERE role_id = ${roleId}::uuid
    `);
  }

  static async grantAllPermissions(roleId: string): Promise<void> {
    for (const section of PERMISSION_SECTIONS) {
      for (const subsection of section.subsections) {
        await this.setPermission({
          roleId,
          section: section.id,
          subsection: subsection.id,
          canCreate: true,
          canRead: true,
          canUpdate: true,
          canDelete: true,
        });
      }
    }
  }

  static async grantSectionPermissions(
    roleId: string, 
    sectionId: string, 
    permissions: { canCreate?: boolean; canRead?: boolean; canUpdate?: boolean; canDelete?: boolean }
  ): Promise<void> {
    const section = PERMISSION_SECTIONS.find(s => s.id === sectionId);
    if (!section) return;
    
    for (const subsection of section.subsections) {
      await this.setPermission({
        roleId,
        section: sectionId,
        subsection: subsection.id,
        canCreate: permissions.canCreate ?? false,
        canRead: permissions.canRead ?? false,
        canUpdate: permissions.canUpdate ?? false,
        canDelete: permissions.canDelete ?? false,
      });
    }
  }

  static getAvailableSections() {
    return PERMISSION_SECTIONS;
  }
}
