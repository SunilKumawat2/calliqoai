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

  // GET / — List sessions
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
        pagination: { page, limit, total: (countResult.rows[0] as any)?.total || 0 }
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /:id — Get session
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

  // POST /outbound — Trigger actual outbound call via FreeSWITCH ESL
  router.post('/outbound', async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      const { agentId, toNumber, fromNumber } = req.body;
      if (!agentId || !toNumber) {
        return res.status(400).json({ success: false, error: 'agentId and toNumber are required' });
      }
      // 1. Verify agent
      const agentResult = await db.execute(
        sql`SELECT * FROM ve_voice_agents WHERE id = ${agentId} AND user_id = ${userId} AND is_active = true LIMIT 1`
      );
      if ((agentResult.rows as any[]).length === 0) {
        return res.status(404).json({ success: false, error: 'Agent not found or inactive' });
      }
      // 2. Get online FreeSWITCH node
      const nodeResult = await db.execute(
        sql`SELECT * FROM ve_freeswitch_nodes WHERE status = 'online' ORDER BY created_at ASC LIMIT 1`
      );
      if ((nodeResult.rows as any[]).length === 0) {
        return res.status(503).json({ success: false, error: 'No active FreeSWITCH node. Please ensure FreeSWITCH is running.' });
      }
      const node = (nodeResult.rows as any[])[0];
      const eslHost = node.esl_host || '127.0.0.1';
      const eslPort = node.esl_port || 8021;
      const eslPassword = node.esl_password || 'ClueCon';
      // 4. Resolve caller ID and check if it's Plivo
      let callerId = fromNumber || null;
      let isPlivoCall = false;

      if (callerId) {
        const cleanCallerId = callerId.startsWith('+') ? callerId.slice(1) : callerId;
        const plivoPhoneResult = await db.execute(
          sql`SELECT id FROM plivo_phone_numbers WHERE (phone_number = ${callerId} OR phone_number = ${cleanCallerId}) LIMIT 1`
        );
        if (plivoPhoneResult.rows.length > 0) {
          isPlivoCall = true;
        }
      } else {
        const phoneResult = await db.execute(
          sql`SELECT phone_number FROM phone_numbers WHERE user_id = ${userId} AND status = 'active' ORDER BY created_at ASC LIMIT 1`
        );
        if ((phoneResult.rows as any[]).length > 0) {
          callerId = (phoneResult.rows as any[])[0].phone_number;
        } else {
          const plivoPhoneResult = await db.execute(
            sql`SELECT phone_number FROM plivo_phone_numbers WHERE user_id = ${userId} AND status = 'active' ORDER BY created_at ASC LIMIT 1`
          );
          if ((plivoPhoneResult.rows as any[]).length > 0) {
            callerId = (plivoPhoneResult.rows as any[])[0].phone_number;
            isPlivoCall = true;
          }
        }
      }

      if (!callerId) {
        return res.status(400).json({ success: false, error: 'No fromNumber provided and no active phone number found.' });
      }

      // 3. Resolve SIP gateway
      let gatewayName = 'twilio';
      let gatewayProxy = process.env.TWILIO_SIP_PROXY || 'pstn.twilio.com';

      if (isPlivoCall) {
        gatewayName = 'plivo';
        const gwResult = await db.execute(
          sql`SELECT name, proxy FROM user_sip_gateways WHERE user_id = ${userId} AND name ILIKE 'plivo' AND is_active = true LIMIT 1`
        );
        if ((gwResult.rows as any[]).length > 0) {
          gatewayProxy = (gwResult.rows as any[])[0].proxy;
        } else {
          gatewayProxy = process.env.PLIVO_SIP_PROXY || '14760240167242712.zt.plivo.com';
        }
      } else {
        const gwResult = await db.execute(
          sql`SELECT name, proxy FROM user_sip_gateways WHERE user_id = ${userId} AND is_active = true ORDER BY created_at ASC LIMIT 1`
        );
        if ((gwResult.rows as any[]).length > 0) {
          gatewayName = (gwResult.rows as any[])[0].name.toLowerCase();
          gatewayProxy = (gwResult.rows as any[])[0].proxy;
        }
      }
      const normalizedTo = toNumber.startsWith('+') ? toNumber : `+${toNumber}`;
      const normalizedFrom = callerId.startsWith('+') ? callerId : `+${callerId}`;
      // 5. Create session with valid UUID format so FreeSWITCH uses it as channel Unique-ID
      const { randomUUID } = await import('crypto');
      const sessionId = randomUUID();
      await db.execute(sql`
        INSERT INTO ve_sessions (id, user_id, agent_id, from_number, to_number, direction, status, channel_uuid, metadata)
        VALUES (${sessionId}, ${userId}, ${agentId}, ${normalizedFrom}, ${normalizedTo}, 'outbound', 'initializing', ${sessionId}, ${JSON.stringify({ source: 'api_outbound' })})
      `);
      // Respond immediately
      res.json({ success: true, data: { sessionId, status: 'initializing' } });
      // 6. Fire ESL originate in background
      (async () => {
        try {
          const { EslConnection } = await import('../services/freeswitch/esl-connection');
          const esl = new EslConnection({ host: eslHost, port: eslPort, password: eslPassword, reconnect: false });
          await esl.connect();
          const wsHost = process.env.FREESWITCH_WS_HOST || await (async () => {
            const { default: os } = await import('os');
            const nets = os.networkInterfaces();
            for (const name of Object.keys(nets)) {
              for (const net of (nets[name] || [])) {
                if (net.family === 'IPv4' && !net.internal &&
                  (net.address.startsWith('10.') || net.address.startsWith('172.') || net.address.startsWith('192.168.'))) {
                  return net.address;
                }
              }
            }
            return '127.0.0.1';
          })();
          const port = process.env.PORT || '5000';
          const wsUrl = `ws://${wsHost}:${port}/voice-engine/ws/audio/${sessionId}`;
          const isPlivo = gatewayName.toLowerCase() === 'plivo';
          const callerIdVal = isPlivo ? normalizedFrom.replace(/^\+/, '') : normalizedFrom;
          const plivoFromUser = callerIdVal;
          
          const options: any = {
            origination_uuid: sessionId,
            origination_caller_id_number: callerIdVal,
            origination_caller_id_name: callerIdVal,
            effective_caller_id_number: callerIdVal,
            effective_caller_id_name: callerIdVal,
            sip_from_uri: `sip:${callerIdVal}@${gatewayProxy}`,
            ve_audio_ws_url: wsUrl,
            absolute_codec_string: 'PCMU,PCMA,telephone-event',
            ignore_early_media: 'true',
          };

          if (isPlivo) {
            options.sip_from_user = plivoFromUser;
            options.sip_from_host = gatewayProxy;
            options['sip_h_P-Asserted-Identity'] = `<sip:${plivoFromUser}@${gatewayProxy}>`;
          }

          esl.on('event:CHANNEL_ANSWER', async (event: any) => {
            const uuid = event.headers['Unique-ID'];
            const origUuid = event.headers['Variable_origination_uuid'] || event.headers['variable_origination_uuid'];
            if (uuid === sessionId || origUuid === sessionId) {
              try {
                  console.log(`[CVE Outbound] CHANNEL_ANSWER received for uuid=${uuid} sessionId=${sessionId}, starting audio_fork`);
                  await esl.api(`uuid_audio_fork ${uuid} start ${wsUrl} mono 8k`);
                  await db.execute(sql`UPDATE ve_sessions SET status = 'active', answered_at = NOW(), updated_at = NOW() WHERE id = ${sessionId}`);
              } catch (e: any) { console.error('[CVE Outbound] audio_fork failed:', e.message); }
            }
          });
          esl.on('event:CHANNEL_DESTROY', async (event: any) => {
            const uuid = event.headers['Unique-ID'];
            const origUuid = event.headers['Variable_origination_uuid'] || event.headers['variable_origination_uuid'];
            if (uuid === sessionId || origUuid === sessionId) {
              await db.execute(sql`UPDATE ve_sessions SET status = 'completed', ended_at = NOW(), end_reason = 'normal', updated_at = NOW() WHERE id = ${sessionId}`);
              try { await esl.disconnect(); } catch (_) {}
            }
          });

          await esl.originate(
            `sofia/gateway/${gatewayName}/${normalizedTo}`,
            '&park()',
            options
          );
          await db.execute(sql`UPDATE ve_sessions SET status = 'ringing', updated_at = NOW() WHERE id = ${sessionId}`);
        } catch (eslErr: any) {
          console.error(`[CVE Outbound] ESL error for ${sessionId}:`, eslErr.message);
          await db.execute(sql`UPDATE ve_sessions SET status = 'failed', end_reason = ${eslErr.message}, updated_at = NOW() WHERE id = ${sessionId}`).catch(() => {});
        }
      })();
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /:id/hangup
  router.post('/:id/hangup', async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      const { id } = req.params;
      await db.execute(sql`
        UPDATE ve_sessions SET status = 'completed', ended_at = NOW(), end_reason = 'user_hangup', updated_at = NOW()
        WHERE id = ${id} AND user_id = ${userId} AND status IN ('initializing', 'ringing', 'active')
      `);
      res.json({ success: true, message: 'Call ended' });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}
