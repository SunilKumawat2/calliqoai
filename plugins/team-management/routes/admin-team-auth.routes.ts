/**
 * Admin Team Auth Routes - Sub-admin authentication
 * Public routes for admin team members to login
 */

import { Router, Request, Response } from 'express';
import { AdminTeamService } from '../services/admin-team.service.js';
import { db } from '../../../server/db.js';
import { sql } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

const router = Router();

const SESSION_EXPIRY_HOURS = parseInt(process.env.ADMIN_TEAM_SESSION_EXPIRY || '24');

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const memberResult = await db.execute(sql`
      SELECT m.*, r.name as role_name, r.display_name as role_display_name, at.id as admin_team_id, at.name as admin_team_name
      FROM admin_team_members m
      JOIN admin_team_roles r ON m.role_id = r.id
      JOIN admin_teams at ON m.admin_team_id = at.id
      WHERE LOWER(m.email) = ${email.toLowerCase()}
      LIMIT 1
    `);

    if (memberResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const member = memberResult.rows[0] as any;

    if (member.status !== 'active') {
      return res.status(401).json({ error: 'Account is not active' });
    }

    const passwordValid = await bcrypt.compare(password, member.password_hash);
    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_EXPIRY_HOURS * 60 * 60 * 1000);

    await db.execute(sql`
      INSERT INTO admin_team_sessions (member_id, admin_team_id, token, expires_at)
      VALUES (${member.id}, ${member.admin_team_id}, ${token}, ${expiresAt})
    `);

    await db.execute(sql`
      UPDATE admin_team_members SET last_login_at = NOW() WHERE id = ${member.id}
    `);

    // Log login activity
    await AdminTeamService.logActivity(
      member.admin_team_id,
      member.id,
      'login',
      'member',
      member.id,
      { email: member.email },
      req.ip || req.socket.remoteAddress
    );

    res.json({
      token,
      expiresAt,
      member: {
        id: member.id,
        email: member.email,
        firstName: member.first_name,
        lastName: member.last_name,
        role: {
          id: member.role_id,
          name: member.role_display_name || member.role_name,
        },
      },
      team: {
        id: member.admin_team_id,
        name: member.admin_team_name,
        type: 'admin',
      },
    });
  } catch (error: any) {
    console.error('[Admin Team Auth] Login error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

router.post('/logout', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);

    // Get session info before deleting for logging
    const sessionResult = await db.execute(sql`
      SELECT s.member_id, s.admin_team_id, m.email 
      FROM admin_team_sessions s
      JOIN admin_team_members m ON s.member_id = m.id
      WHERE s.token = ${token}
    `);

    await db.execute(sql`
      DELETE FROM admin_team_sessions WHERE token = ${token}
    `);

    // Log logout activity
    if (sessionResult.rows.length > 0) {
      const session = sessionResult.rows[0] as any;
      await AdminTeamService.logActivity(
        session.admin_team_id,
        session.member_id,
        'logout',
        'member',
        session.member_id,
        { email: session.email },
        req.ip || req.socket.remoteAddress
      );
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('[Admin Team Auth] Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

router.get('/me', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);

    const sessionResult = await db.execute(sql`
      SELECT s.*, m.role_id, m.admin_team_id, r.name as role_name, r.display_name as role_display_name
      FROM admin_team_sessions s
      JOIN admin_team_members m ON s.member_id = m.id
      JOIN admin_team_roles r ON m.role_id = r.id
      WHERE s.token = ${token} AND s.expires_at > NOW()
    `);

    if (sessionResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    const session = sessionResult.rows[0] as any;

    await db.execute(sql`
      UPDATE admin_team_sessions SET last_activity_at = NOW() WHERE token = ${token}
    `);

    const memberResult = await db.execute(sql`
      SELECT m.*, r.name as role_name, r.display_name as role_display_name, at.name as admin_team_name
      FROM admin_team_members m
      JOIN admin_team_roles r ON m.role_id = r.id
      JOIN admin_teams at ON m.admin_team_id = at.id
      WHERE m.id = ${session.member_id}
    `);

    if (memberResult.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const member = memberResult.rows[0] as any;

    const permissions = await AdminTeamService.getPermissionsForRole(member.role_id);
    const permMap: { [section: string]: { [subsection: string]: { canCreate: boolean; canRead: boolean; canUpdate: boolean; canDelete: boolean } } } = {};
    for (const perm of permissions) {
      if (!permMap[perm.section]) {
        permMap[perm.section] = {};
      }
      permMap[perm.section][perm.subsection] = {
        canCreate: perm.canCreate,
        canRead: perm.canRead,
        canUpdate: perm.canUpdate,
        canDelete: perm.canDelete,
      };
    }

    res.json({
      member: {
        id: member.id,
        email: member.email,
        firstName: member.first_name,
        lastName: member.last_name,
        role: {
          id: member.role_id,
          name: member.role_display_name || member.role_name,
        },
        status: member.status,
      },
      team: {
        id: member.admin_team_id,
        name: member.admin_team_name,
        type: 'admin',
      },
      permissions: permMap,
    });
  } catch (error: any) {
    console.error('[Admin Team Auth] Get me error:', error);
    res.status(500).json({ error: 'Failed to get member info' });
  }
});

router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);

    const sessionResult = await db.execute(sql`
      SELECT * FROM admin_team_sessions
      WHERE token = ${token} AND expires_at > NOW()
    `);

    if (sessionResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    const newToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_EXPIRY_HOURS * 60 * 60 * 1000);

    await db.execute(sql`
      UPDATE admin_team_sessions 
      SET token = ${newToken}, expires_at = ${expiresAt}, last_activity_at = NOW()
      WHERE token = ${token}
    `);

    res.json({
      token: newToken,
      expiresAt,
    });
  } catch (error: any) {
    console.error('[Admin Team Auth] Refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh session' });
  }
});

export default router;
