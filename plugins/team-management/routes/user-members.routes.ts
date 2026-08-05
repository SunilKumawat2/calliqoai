/**
 * User Members Routes - Team member management
 */

import { Router, Request, Response } from 'express';
import { TeamService } from '../services/team.service.js';
import { TeamAuthService } from '../services/team-auth.service.js';

interface AuthRequest extends Request {
  userId?: number;
}

const router = Router();

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const team = await TeamService.getTeamByUserId(req.userId);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const members = await TeamService.getMembersByTeam(team.id);

    const sanitizedMembers = members.map(m => ({
      id: m.id,
      email: m.email,
      name: `${m.firstName || ''} ${m.lastName || ''}`.trim() || m.email,
      roleId: m.roleId,
      roleName: m.role?.displayName || m.role?.name || 'Unknown',
      status: m.status,
      lastLoginAt: m.lastLoginAt,
      createdAt: m.createdAt,
    }));

    res.json({ members: sanitizedMembers });
  } catch (error: any) {
    console.error('[Team Members] Error fetching members:', error);
    res.status(500).json({ error: 'Failed to fetch team members' });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const team = await TeamService.getTeamByUserId(req.userId);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const { email, password, firstName, lastName, roleId } = req.body;

    if (!email || !password || !roleId) {
      return res.status(400).json({ error: 'Email, password, and role are required' });
    }

    const existingMember = await TeamService.getMemberByEmail(team.id, email);
    if (existingMember) {
      return res.status(400).json({ error: 'A member with this email already exists' });
    }

    const memberCount = await TeamService.getMemberCount(team.id);
    if (memberCount >= team.settings.maxMembers) {
      return res.status(400).json({ error: 'Team member limit reached' });
    }

    const member = await TeamService.createMember(team.id, {
      email,
      password,
      firstName,
      lastName,
      roleId,
    });

    await TeamService.logActivity(team.id, null, 'member_created', 'member', member.id, {
      email: member.email,
    });

    res.status(201).json({
      id: member.id,
      email: member.email,
      firstName: member.firstName,
      lastName: member.lastName,
      roleId: member.roleId,
      status: member.status,
      createdAt: member.createdAt,
    });
  } catch (error: any) {
    console.error('[Team Members] Error creating member:', error);
    res.status(500).json({ error: 'Failed to create team member' });
  }
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const team = await TeamService.getTeamByUserId(req.userId);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const member = await TeamService.getMemberWithRole(req.params.id);
    if (!member || member.teamId !== team.id) {
      return res.status(404).json({ error: 'Member not found' });
    }

    res.json({
      id: member.id,
      email: member.email,
      firstName: member.firstName,
      lastName: member.lastName,
      role: member.role,
      status: member.status,
      lastLoginAt: member.lastLoginAt,
      createdAt: member.createdAt,
    });
  } catch (error: any) {
    console.error('[Team Members] Error fetching member:', error);
    res.status(500).json({ error: 'Failed to fetch team member' });
  }
});

router.patch('/:id', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const team = await TeamService.getTeamByUserId(req.userId);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const member = await TeamService.getMemberById(req.params.id);
    if (!member || member.teamId !== team.id) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const { firstName, lastName, roleId, status } = req.body;

    const updatedMember = await TeamService.updateMember(req.params.id, {
      firstName,
      lastName,
      roleId,
      status,
    });

    await TeamService.logActivity(team.id, null, 'member_updated', 'member', member.id, {
      changes: { firstName, lastName, roleId, status },
    });

    res.json({
      id: updatedMember.id,
      email: updatedMember.email,
      firstName: updatedMember.firstName,
      lastName: updatedMember.lastName,
      roleId: updatedMember.roleId,
      status: updatedMember.status,
    });
  } catch (error: any) {
    console.error('[Team Members] Error updating member:', error);
    res.status(500).json({ error: 'Failed to update team member' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const team = await TeamService.getTeamByUserId(req.userId);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const member = await TeamService.getMemberById(req.params.id);
    if (!member || member.teamId !== team.id) {
      return res.status(404).json({ error: 'Member not found' });
    }

    await TeamService.deleteMember(req.params.id);

    await TeamService.logActivity(team.id, null, 'member_deleted', 'member', req.params.id, {
      email: member.email,
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error('[Team Members] Error deleting member:', error);
    res.status(500).json({ error: 'Failed to delete team member' });
  }
});

router.post('/:id/reset-password', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const team = await TeamService.getTeamByUserId(req.userId);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const member = await TeamService.getMemberById(req.params.id);
    if (!member || member.teamId !== team.id) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    await TeamService.updateMemberPassword(req.params.id, newPassword);

    await TeamAuthService.invalidateAllSessions(req.params.id);

    await TeamService.logActivity(team.id, null, 'password_reset', 'member', req.params.id);

    res.json({ success: true });
  } catch (error: any) {
    console.error('[Team Members] Error resetting password:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

export default router;
