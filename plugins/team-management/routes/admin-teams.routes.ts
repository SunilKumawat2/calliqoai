/**
 * Admin Teams Routes - Platform-wide team management
 */

import { Router, Request, Response } from 'express';
import { db } from '../../../server/db.js';
import { sql } from 'drizzle-orm';
import { TeamService } from '../services/team.service.js';
import { AdminTeamStats } from '../types.js';

interface AuthRequest extends Request {
  userId?: number;
  isAdmin?: boolean;
  adminTeamMember?: { id: string; roleId: string; status: string };
}

const router = Router();

function requireAdminOrTeamMember(req: AuthRequest, res: Response, next: Function) {
  // Allow platform admins or admin team members
  if (!req.isAdmin && !req.adminTeamMember) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

router.use(requireAdminOrTeamMember as any);

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { page = '1', limit = '20', search } = req.query;
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);

    let whereClause = sql`1=1`;
    if (search) {
      whereClause = sql`(t.name ILIKE ${`%${search}%`} OR u.email ILIKE ${`%${search}%`})`;
    }

    const result = await db.execute(sql`
      SELECT t.*, u.email as owner_email, u.id as owner_user_id,
        (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) as member_count
      FROM teams t
      JOIN users u ON t.user_id = u.id
      WHERE ${whereClause}
      ORDER BY t.created_at DESC
      LIMIT ${parseInt(limit as string)} OFFSET ${offset}
    `);

    const countResult = await db.execute(sql`
      SELECT COUNT(*) as total
      FROM teams t
      JOIN users u ON t.user_id = u.id
      WHERE ${whereClause}
    `);

    const total = parseInt((countResult.rows[0] as any).total);

    res.json({
      teams: result.rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        settings: row.settings,
        ownerEmail: row.owner_email,
        ownerUserId: row.owner_user_id,
        memberCount: parseInt(row.member_count),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total,
        totalPages: Math.ceil(total / parseInt(limit as string)),
      },
    });
  } catch (error: any) {
    console.error('[Admin Teams] Error fetching teams:', error);
    res.status(500).json({ error: 'Failed to fetch teams' });
  }
});

router.get('/stats', async (req: AuthRequest, res: Response) => {
  try {
    const teamsResult = await db.execute(sql`SELECT COUNT(*) as count FROM teams`);
    const membersResult = await db.execute(sql`SELECT COUNT(*) as count FROM team_members`);
    const activeResult = await db.execute(sql`
      SELECT COUNT(*) as count FROM team_members WHERE status = 'active'
    `);
    const invitedResult = await db.execute(sql`
      SELECT COUNT(*) as count FROM team_members WHERE status = 'invited'
    `);

    const stats: AdminTeamStats = {
      totalTeams: parseInt((teamsResult.rows[0] as any).count),
      totalMembers: parseInt((membersResult.rows[0] as any).count),
      activeMembers: parseInt((activeResult.rows[0] as any).count),
      invitedMembers: parseInt((invitedResult.rows[0] as any).count),
      teamsByPlan: {},
    };

    res.json(stats);
  } catch (error: any) {
    console.error('[Admin Teams] Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch team stats' });
  }
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const team = await TeamService.getTeamById(req.params.id);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const members = await TeamService.getMembersByTeam(req.params.id);
    const roles = await TeamService.getRolesByTeam(req.params.id);

    res.json({
      ...team,
      members: members.map(m => ({
        id: m.id,
        email: m.email,
        firstName: m.firstName,
        lastName: m.lastName,
        role: m.role,
        status: m.status,
        lastLoginAt: m.lastLoginAt,
        createdAt: m.createdAt,
      })),
      roles,
    });
  } catch (error: any) {
    console.error('[Admin Teams] Error fetching team:', error);
    res.status(500).json({ error: 'Failed to fetch team' });
  }
});

router.get('/:id/members', async (req: AuthRequest, res: Response) => {
  try {
    const team = await TeamService.getTeamById(req.params.id);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const members = await TeamService.getMembersByTeam(req.params.id);

    res.json({
      members: members.map(m => ({
        id: m.id,
        email: m.email,
        name: `${m.firstName || ''} ${m.lastName || ''}`.trim() || m.email,
        roleId: m.roleId,
        roleName: m.role?.displayName || m.role?.name || 'Unknown',
        status: m.status,
        lastLoginAt: m.lastLoginAt,
        createdAt: m.createdAt,
      })),
    });
  } catch (error: any) {
    console.error('[Admin Teams] Error fetching members:', error);
    res.status(500).json({ error: 'Failed to fetch team members' });
  }
});

router.patch('/:id/settings', async (req: AuthRequest, res: Response) => {
  try {
    const team = await TeamService.getTeamById(req.params.id);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const { name, description, settings } = req.body;

    const updatedTeam = await TeamService.updateTeam(req.params.id, {
      name,
      description,
      settings: settings ? { ...team.settings, ...settings } : undefined,
    });

    res.json(updatedTeam);
  } catch (error: any) {
    console.error('[Admin Teams] Error updating team:', error);
    res.status(500).json({ error: 'Failed to update team' });
  }
});

router.delete('/:id/members/:memberId', async (req: AuthRequest, res: Response) => {
  try {
    const team = await TeamService.getTeamById(req.params.id);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const member = await TeamService.getMemberById(req.params.memberId);
    if (!member || member.teamId !== req.params.id) {
      return res.status(404).json({ error: 'Member not found' });
    }

    await TeamService.deleteMember(req.params.memberId);

    await TeamService.logActivity(team.id, null, 'admin_removed_member', 'member', req.params.memberId, {
      email: member.email,
      adminUserId: req.userId,
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error('[Admin Teams] Error removing member:', error);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

router.post('/:id/members/:memberId/reset-password', async (req: AuthRequest, res: Response) => {
  try {
    const team = await TeamService.getTeamById(req.params.id);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const member = await TeamService.getMemberById(req.params.memberId);
    if (!member || member.teamId !== req.params.id) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    await TeamService.updateMemberPassword(req.params.memberId, newPassword);

    await TeamService.logActivity(team.id, null, 'admin_reset_password', 'member', req.params.memberId, {
      adminUserId: req.userId,
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error('[Admin Teams] Error resetting password:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

export default router;
