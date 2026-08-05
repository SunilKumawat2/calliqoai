/**
 * ============================================================
 * Calls Routes — Initiate and manage voice calls
 * ============================================================
 */

import { Router, Request, Response } from 'express';
import { db } from '../../../server/db';
import { sql } from 'drizzle-orm';

export function createCallsRouter(): Router {
  const router = Router();

  /** GET /api/voice-engine/calls — List call sessions */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const offset = (page - 1) * limit;
      const direction = req.query.direction as string;
      const status = req.query.status as string;

      let query = sql`SELECT * FROM ve_sessions WHERE user_id = ${userId}`;
      if (direction) query = sql`${query} AND direction = ${direction}`;
      if (status) query = sql`${query} AND status = ${status}`;
      query = sql`${query} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;

      const result = await db.execute(query);

      const countResult = await db.execute(
        sql`SELECT COUNT(*)::int as total FROM ve_sessions WHERE user_id = ${userId}`
      );

      res.json({
        success: true,
        data: result.rows,
        pagination: {
          page,
          limit,
          total: (countResult.rows[0] as any)?.total || 0,
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /** GET /api/voice-engine/calls/:id — Get call session details */
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      const { id } = req.params;

      const result = await db.execute(
        sql`SELECT * FROM ve_sessions WHERE id = ${id} AND user_id = ${userId} LIMIT 1`
      );

      if ((result.rows as any[]).length === 0) {
        return res.status(404).json({ success: false, error: 'Session not found' });
      }

      res.json({ success: true, data: result.rows[0] });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /** POST /api/voice-engine/calls/outbound — Initiate outbound call */
  router.post('/outbound', async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      const { agentId, toNumber, fromNumber } = req.body;

      if (!agentId || !toNumber) {
        return res.status(400).json({ success: false, error: 'agentId and toNumber are required' });
      }

      // Verify agent belongs to user
      const agentResult = await db.execute(
        sql`SELECT * FROM ve_voice_agents WHERE id = ${agentId} AND user_id = ${userId} AND is_active = true LIMIT 1`
      );

      if ((agentResult.rows as any[]).length === 0) {
        return res.status(404).json({ success: false, error: 'Agent not found or inactive' });
      }

      // Create session
      const sessionResult = await db.execute(sql`
        INSERT INTO ve_sessions (user_id, agent_id, to_number, from_number, direction, status)
        VALUES (${userId}, ${agentId}, ${toNumber}, ${fromNumber || null}, 'outbound', 'initializing')
        RETURNING *
      `);

      const session = (sessionResult.rows as any[])[0];

      // TODO: Trigger FreeSWITCH originate via ESL
      // This would be handled by the call orchestrator service

      res.json({ success: true, data: session });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /** POST /api/voice-engine/calls/:id/hangup — End a call */
  router.post('/:id/hangup', async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      const { id } = req.params;

      await db.execute(sql`
        UPDATE ve_sessions SET status = 'completed', ended_at = NOW(), end_reason = 'user_hangup', updated_at = NOW()
        WHERE id = ${id} AND user_id = ${userId} AND status IN ('initializing', 'active')
      `);

      res.json({ success: true, message: 'Call ended' });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}
