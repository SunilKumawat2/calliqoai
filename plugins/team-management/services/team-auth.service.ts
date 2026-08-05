/**
 * Team Auth Service - Team member authentication and session management
 */

import { db } from '../../../server/db.js';
import { sql } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import {
  TeamMemberLoginInput,
  TeamMemberLoginResult,
  TeamMemberContext,
  TeamMemberSession,
  TeamPermission,
} from '../types.js';
import { TeamService } from './team.service.js';
import { TeamPermissionService } from './team-permission.service.js';

const SESSION_EXPIRY_HOURS = parseInt(process.env.TEAM_SESSION_EXPIRY || '24');

export class TeamAuthService {
  static async login(data: TeamMemberLoginInput): Promise<TeamMemberLoginResult> {
    try {
      let teamId = data.teamId;
      
      if (!teamId) {
        const memberResult = await db.execute(sql`
          SELECT team_id FROM team_members 
          WHERE LOWER(email) = ${data.email.toLowerCase()}
          LIMIT 1
        `);
        
        if (memberResult.rows.length === 0) {
          return { success: false, error: 'Invalid email or password' };
        }
        
        teamId = (memberResult.rows[0] as any).team_id;
      }
      
      const member = await TeamService.getMemberByEmail(teamId!, data.email);
      
      if (!member) {
        return { success: false, error: 'Invalid email or password' };
      }
      
      if (member.status !== 'active') {
        return { success: false, error: 'Account is not active' };
      }
      
      const passwordValid = await bcrypt.compare(data.password, member.passwordHash);
      
      if (!passwordValid) {
        return { success: false, error: 'Invalid email or password' };
      }
      
      const token = this.generateToken();
      const expiresAt = new Date(Date.now() + SESSION_EXPIRY_HOURS * 60 * 60 * 1000);
      
      await db.execute(sql`
        INSERT INTO team_member_sessions (member_id, team_id, token, expires_at)
        VALUES (${member.id}::uuid, ${member.teamId}::uuid, ${token}, ${expiresAt})
      `);
      
      await db.execute(sql`
        UPDATE team_members SET last_login_at = NOW() WHERE id = ${member.id}::uuid
      `);
      
      const team = await TeamService.getTeamById(member.teamId);
      const memberWithRole = await TeamService.getMemberWithRole(member.id);
      
      await TeamService.logActivity(
        member.teamId,
        member.id,
        'login',
        'member',
        member.id
      );
      
      return {
        success: true,
        token,
        member: memberWithRole!,
        team: team!,
        expiresAt,
      };
    } catch (error: any) {
      console.error('[Team Auth] Login error:', error);
      return { success: false, error: 'Authentication failed' };
    }
  }

  static async logout(token: string): Promise<void> {
    await db.execute(sql`
      DELETE FROM team_member_sessions WHERE token = ${token}
    `);
  }

  static async validateSession(token: string): Promise<TeamMemberContext | null> {
    try {
      const sessionResult = await db.execute(sql`
        SELECT s.*, m.role_id, m.team_id, t.user_id, r.name as role_name
        FROM team_member_sessions s
        JOIN team_members m ON s.member_id = m.id
        JOIN teams t ON s.team_id = t.id
        JOIN team_roles r ON m.role_id = r.id
        WHERE s.token = ${token} AND s.expires_at > NOW()
      `);
      
      if (sessionResult.rows.length === 0) {
        return null;
      }
      
      const session = sessionResult.rows[0] as any;
      
      await db.execute(sql`
        UPDATE team_member_sessions SET last_activity_at = NOW() WHERE token = ${token}
      `);
      
      const permissions = await TeamPermissionService.getPermissionsForRole(session.role_id);
      
      return {
        memberId: session.member_id,
        teamId: session.team_id,
        userId: session.user_id,
        roleId: session.role_id,
        roleName: session.role_name,
        permissions,
      };
    } catch (error) {
      console.error('[Team Auth] Session validation error:', error);
      return null;
    }
  }

  static async refreshSession(token: string): Promise<string | null> {
    const context = await this.validateSession(token);
    
    if (!context) {
      return null;
    }
    
    const newToken = this.generateToken();
    const expiresAt = new Date(Date.now() + SESSION_EXPIRY_HOURS * 60 * 60 * 1000);
    
    await db.execute(sql`
      UPDATE team_member_sessions 
      SET token = ${newToken}, expires_at = ${expiresAt}, last_activity_at = NOW()
      WHERE token = ${token}
    `);
    
    return newToken;
  }

  static async invalidateAllSessions(memberId: string): Promise<void> {
    await db.execute(sql`
      DELETE FROM team_member_sessions WHERE member_id = ${memberId}::uuid
    `);
  }

  static async cleanupExpiredSessions(): Promise<number> {
    const result = await db.execute(sql`
      DELETE FROM team_member_sessions WHERE expires_at < NOW()
      RETURNING id
    `);
    
    return result.rows.length;
  }

  static async getActiveSessions(memberId: string): Promise<TeamMemberSession[]> {
    const result = await db.execute(sql`
      SELECT * FROM team_member_sessions 
      WHERE member_id = ${memberId}::uuid AND expires_at > NOW()
      ORDER BY last_activity_at DESC
    `);
    
    return result.rows.map((row: any) => ({
      id: row.id,
      memberId: row.member_id,
      teamId: row.team_id,
      token: row.token,
      expiresAt: new Date(row.expires_at),
      createdAt: new Date(row.created_at),
      lastActivityAt: new Date(row.last_activity_at),
      userAgent: row.user_agent,
      ipAddress: row.ip_address,
    }));
  }

  static async generatePasswordResetToken(memberId: string): Promise<string> {
    const token = this.generateToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    
    return token;
  }

  private static generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }
}
