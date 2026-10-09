'use strict';
/**
 * Follow-Up Routes
 * 
 * Provides endpoints to manage scheduled follow-up calls, query upcoming callbacks,
 * manually reschedule or cancel, and trigger instant "Call Now" actions.
 */

import { Router, Response } from 'express';
import { RouteContext, AuthRequest } from './common';
import { FollowUpSchedulerService } from '../services/follow-up-scheduler.service';
import { scheduledFollowUps } from '../../shared/schema';
import { eq, and, desc } from 'drizzle-orm';

export function createFollowUpRoutes(ctx: RouteContext): Router {
  const router = Router();
  const { db, authenticateHybrid } = ctx;

  /**
   * GET /api/followups
   * Query follow-ups for user (filter by callId, campaignId, status)
   */
  router.get('/api/followups', authenticateHybrid, async (req: AuthRequest, res: Response) => {
    try {
      const { callId, campaignId, status } = req.query;

      const followUps = await FollowUpSchedulerService.getFollowUps({
        userId: req.userId!,
        callId: callId ? String(callId) : undefined,
        campaignId: campaignId ? String(campaignId) : undefined,
        status: status ? String(status) : undefined,
      });

      res.json(followUps);
    } catch (err: any) {
      console.error('Error fetching follow-ups:', err);
      res.status(500).json({ error: 'Failed to fetch follow-ups' });
    }
  });

  /**
   * POST /api/followups
   * Create a new scheduled follow-up
   */
  router.post('/api/followups', authenticateHybrid, async (req: AuthRequest, res: Response) => {
    try {
      const {
        phoneNumber,
        customerName,
        preferredTimeText,
        scheduledAt,
        contextNote,
        callId,
        agentId,
        campaignId,
        contactId,
      } = req.body;

      if (!phoneNumber) {
        return res.status(400).json({ error: 'phoneNumber is required' });
      }

      const created = await FollowUpSchedulerService.scheduleFollowUp({
        userId: req.userId!,
        campaignId,
        contactId,
        callId,
        agentId,
        phoneNumber,
        customerName,
        preferredTimeText,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        contextNote,
      });

      res.status(201).json(created);
    } catch (err: any) {
      console.error('Error creating follow-up:', err);
      res.status(500).json({ error: 'Failed to create follow-up' });
    }
  });

  /**
   * POST /api/followups/:id/call-now
   * Manually trigger an immediate follow-up call
   */
  router.post('/api/followups/:id/call-now', authenticateHybrid, async (req: AuthRequest, res: Response) => {
    try {
      const result = await FollowUpSchedulerService.triggerFollowUp(req.params.id, req.userId!);
      if (!result.success) {
        return res.status(400).json({ error: result.error || 'Failed to trigger call' });
      }
      res.json({ success: true, callId: result.callId });
    } catch (err: any) {
      console.error('Error triggering follow-up call now:', err);
      res.status(500).json({ error: err.message || 'Failed to trigger call' });
    }
  });

  /**
   * PATCH /api/followups/:id
   * Reschedule or update context notes
   */
  router.patch('/api/followups/:id', authenticateHybrid, async (req: AuthRequest, res: Response) => {
    try {
      const { scheduledAt, preferredTimeText, contextNote, status } = req.body;

      const updated = await FollowUpSchedulerService.updateFollowUp(req.params.id, req.userId!, {
        scheduledAt,
        preferredTimeText,
        contextNote,
        status,
      });

      if (!updated) {
        return res.status(404).json({ error: 'Follow-up not found' });
      }

      res.json(updated);
    } catch (err: any) {
      console.error('Error updating follow-up:', err);
      res.status(500).json({ error: 'Failed to update follow-up' });
    }
  });

  /**
   * DELETE /api/followups/:id
   * Cancel follow-up
   */
  router.delete('/api/followups/:id', authenticateHybrid, async (req: AuthRequest, res: Response) => {
    try {
      const cancelled = await FollowUpSchedulerService.cancelFollowUp(req.params.id, req.userId!);
      if (!cancelled) {
        return res.status(404).json({ error: 'Follow-up not found' });
      }
      res.json({ success: true, message: 'Follow-up cancelled' });
    } catch (err: any) {
      console.error('Error cancelling follow-up:', err);
      res.status(500).json({ error: 'Failed to cancel follow-up' });
    }
  });

  return router;
}
