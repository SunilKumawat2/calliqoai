/**
 * ============================================================
 * Admin Settings Routes
 *
 * Admin panel routes for managing voice engine global settings,
 * FreeSWITCH nodes, and provider configurations.
 * ============================================================
 */

import { Router, Request, Response } from 'express';
import { db } from '../../../server/db';
import { sql, eq } from 'drizzle-orm';

export function createAdminSettingsRouter(): Router {
  const router = Router();

  // Drop ve_sip_gateways table on startup
  (async () => {
    try {
      await db.execute(sql`DROP TABLE IF EXISTS ve_sip_gateways CASCADE;`);
      console.log('[VE Admin] Deleted old ve_sip_gateways table');
    } catch (err: any) {
      console.error('[VE Admin] Failed to drop ve_sip_gateways table:', err.message);
    }
  })();

  // ── Global Settings ──────────────────────────────────

  /** GET /api/voice-engine/admin/settings */
  router.get('/', async (_req: Request, res: Response) => {
    try {
      const result = await db.execute(
        sql`SELECT * FROM ve_freeswitch_nodes ORDER BY created_at ASC`
      );

      res.json({
        success: true,
        data: {
          nodes: result.rows,
          totalNodes: result.rows.length,
          onlineNodes: (result.rows as any[]).filter((n: any) => n.status === 'online').length,
        },
      });
    } catch (err: any) {
      console.error('[VE Admin] Error fetching settings:', err.message);
      res.status(500).json({ success: false, error: 'Failed to fetch settings' });
    }
  });

  // ── FreeSWITCH Node Management ───────────────────────

  /** GET /api/voice-engine/admin/settings/nodes */
  router.get('/nodes', async (_req: Request, res: Response) => {
    try {
      const result = await db.execute(
        sql`SELECT * FROM ve_freeswitch_nodes ORDER BY created_at ASC`
      );
      res.json({ success: true, data: result.rows });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /** POST /api/voice-engine/admin/settings/nodes */
  router.post('/nodes', async (req: Request, res: Response) => {
    try {
      const { name, eslHost, eslPort, eslPassword, sipHost, sipPort, wsPort, maxCalls, status } = req.body;

      if (!name || !eslHost || !eslPort || !sipHost || !sipPort || !wsPort) {
        return res.status(400).json({ success: false, error: 'Missing required fields' });
      }

      const result = await db.execute(sql`
        INSERT INTO ve_freeswitch_nodes (name, esl_host, esl_port, esl_password, sip_host, sip_port, ws_port, max_calls, status)
        VALUES (${name}, ${eslHost}, ${eslPort}, ${eslPassword || 'ClueCon'}, ${sipHost}, ${sipPort}, ${wsPort}, ${maxCalls || 100}, ${status || 'offline'})
        RETURNING *
      `);

      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /** PUT /api/voice-engine/admin/settings/nodes/:id */
  router.put('/nodes/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { name, eslHost, eslPort, eslPassword, sipHost, sipPort, wsPort, maxCalls, status } = req.body;

      const result = await db.execute(sql`
        UPDATE ve_freeswitch_nodes SET
          name = COALESCE(${name !== undefined ? name : null}, name),
          esl_host = COALESCE(${eslHost !== undefined ? eslHost : null}, esl_host),
          esl_port = COALESCE(${eslPort !== undefined ? eslPort : null}, esl_port),
          esl_password = COALESCE(${eslPassword !== undefined ? eslPassword : null}, esl_password),
          sip_host = COALESCE(${sipHost !== undefined ? sipHost : null}, sip_host),
          sip_port = COALESCE(${sipPort !== undefined ? sipPort : null}, sip_port),
          ws_port = COALESCE(${wsPort !== undefined ? wsPort : null}, ws_port),
          max_calls = COALESCE(${maxCalls !== undefined ? maxCalls : null}, max_calls),
          status = COALESCE(${status !== undefined ? status : null}, status),
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `);

      if ((result.rows as any[]).length === 0) {
        return res.status(404).json({ success: false, error: 'Node not found' });
      }

      res.json({ success: true, data: result.rows[0] });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /** DELETE /api/voice-engine/admin/settings/nodes/:id */
  router.delete('/nodes/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      await db.execute(sql`DELETE FROM ve_freeswitch_nodes WHERE id = ${id}`);
      res.json({ success: true, message: 'Node deleted' });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── SIP Gateway Management (user_sip_gateways) ──────────────────────

  /**
   * POST /api/voice-engine/admin/settings/ensure-twilio-gateway
   *
   * Auto-registers the Twilio SIP gateway for the current admin user
   * (or for the target userId passed in the body).
   * Safe to call repeatedly — uses upsert logic.
   *
   * Body (all optional):
   *   userId   — target user ID (defaults to current admin)
   *   name     — gateway name (default: 'twilio')
   *   proxy    — Twilio SIP proxy hostname from twilio.xml (default: env TWILIO_SIP_PROXY)
   *   username — SIP username (default: env TWILIO_SIP_USERNAME)
   *   password — SIP password (default: env TWILIO_SIP_PASSWORD)
   */
  router.post('/ensure-twilio-gateway', async (req: Request, res: Response) => {
    try {
      const adminId = (req as any).userId;
      const {
        userId = adminId,
        name = 'twilio',
        proxy = process.env.TWILIO_SIP_PROXY || '',
        username = process.env.TWILIO_SIP_USERNAME || 'calliqouser',
        password = process.env.TWILIO_SIP_PASSWORD || '',
      } = req.body;

      if (!proxy) {
        return res.status(400).json({
          success: false,
          error: 'proxy is required. Pass it in the request body or set TWILIO_SIP_PROXY env var (from twilio.xml <param name="proxy" value="..."/>).',
        });
      }

      // Check if user_sip_gateways table exists; skip gracefully if not
      const tableCheck = await db.execute(sql`
        SELECT to_regclass('public.user_sip_gateways') AS t
      `);
      const tableExists = (tableCheck.rows as any[])[0]?.t !== null;

      if (!tableExists) {
        return res.status(503).json({
          success: false,
          error: 'user_sip_gateways table does not exist. Please run the Custom Voice Engine migrations first.',
        });
      }

      // Upsert: update if gateway with same name+user already exists
      const existing = await db.execute(sql`
        SELECT id FROM user_sip_gateways WHERE user_id = ${userId} AND name = ${name} LIMIT 1
      `);

      let gateway: any;
      if ((existing.rows as any[]).length > 0) {
        const result = await db.execute(sql`
          UPDATE user_sip_gateways
          SET proxy = ${proxy},
              username = ${username},
              password = ${password},
              is_active = true,
              updated_at = NOW()
          WHERE user_id = ${userId} AND name = ${name}
          RETURNING *
        `);
        gateway = (result.rows as any[])[0];
        console.log(`[VE Admin] Updated Twilio SIP gateway for user ${userId}: ${proxy}`);
      } else {
        const result = await db.execute(sql`
          INSERT INTO user_sip_gateways (user_id, name, proxy, username, password, is_active)
          VALUES (${userId}, ${name}, ${proxy}, ${username}, ${password}, true)
          RETURNING *
        `);
        gateway = (result.rows as any[])[0];
        console.log(`[VE Admin] Registered Twilio SIP gateway for user ${userId}: ${proxy}`);
      }

      res.json({
        success: true,
        message: `Twilio SIP gateway '${name}' registered successfully.`,
        data: gateway,
      });
    } catch (err: any) {
      console.error('[VE Admin] ensure-twilio-gateway error:', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/voice-engine/admin/settings/gateways
   * List all SIP gateways for a user.
   */
  router.get('/gateways', async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      const targetUserId = (req.query.userId as string) || userId;

      const result = await db.execute(sql`
        SELECT id, user_id, name, proxy, username, is_active, created_at, updated_at
        FROM user_sip_gateways WHERE user_id = ${targetUserId} ORDER BY created_at ASC
      `);

      res.json({ success: true, data: result.rows });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * DELETE /api/voice-engine/admin/settings/gateways/:id
   * Remove a SIP gateway.
   */
  router.delete('/gateways/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      await db.execute(sql`DELETE FROM user_sip_gateways WHERE id = ${id}`);
      res.json({ success: true, message: 'Gateway deleted' });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}
