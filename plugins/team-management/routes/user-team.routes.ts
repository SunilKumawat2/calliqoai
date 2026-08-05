/**
 * User Team Routes - Team CRUD operations
 */

import { Router, Request, Response } from 'express';
import { TeamService } from '../services/team.service.js';

interface AuthRequest extends Request {
  userId?: number;
}

const router = Router();

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    let team = await TeamService.getTeamByUserId(req.userId);
    
    if (!team) {
      team = await TeamService.createTeam(req.userId);
    }

    const memberCount = await TeamService.getMemberCount(team.id);

    res.json({
      ...team,
      memberCount,
    });
  } catch (error: any) {
    console.error('[Team] Error fetching team:', error);
    res.status(500).json({ error: 'Failed to fetch team' });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { name } = req.body;

    const existingTeam = await TeamService.getTeamByUserId(req.userId);
    if (existingTeam) {
      return res.status(400).json({ error: 'Team already exists' });
    }

    const team = await TeamService.createTeam(req.userId, name);

    res.status(201).json(team);
  } catch (error: any) {
    console.error('[Team] Error creating team:', error);
    res.status(500).json({ error: 'Failed to create team' });
  }
});

router.patch('/', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const team = await TeamService.getTeamByUserId(req.userId);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const { name, description, settings } = req.body;

    const updatedTeam = await TeamService.updateTeam(team.id, {
      name,
      description,
      settings,
    });

    res.json(updatedTeam);
  } catch (error: any) {
    console.error('[Team] Error updating team:', error);
    res.status(500).json({ error: 'Failed to update team' });
  }
});

router.get('/activity', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const team = await TeamService.getTeamByUserId(req.userId);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const search = req.query.search as string | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 50;

    const { activities, total } = await TeamService.getActivityLogs(team.id, {
      search,
      page,
      pageSize,
    });

    res.json({ 
      activities, 
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      }
    });
  } catch (error: any) {
    console.error('[Team] Error fetching activity:', error);
    res.status(500).json({ error: 'Failed to fetch activity' });
  }
});

export default router;
