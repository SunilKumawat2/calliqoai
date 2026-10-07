'use strict';
/**
 * ============================================================
 * Plivo-ElevenLabs SIP Trunk - Webhook Routes
 * 
 * Handles Plivo SIP trunk webhooks for ElevenLabs integration.
 * ISOLATED from Twilio+ElevenLabs and Plivo+OpenAI systems.
 * ============================================================
 */

import type { Express, Request, Response } from 'express';
import { getSipStreamUrl } from '../config/config';
import { ElevenLabsBridgeService } from '../services/elevenlabs-bridge.service';
import { db } from '../../../db';
import { agents, plivoPhoneNumbers, sipPhoneNumbers, users, flowExecutions, plivoCalls, type InsertPlivoCall } from '@shared/schema';
import { eq, or, sql } from 'drizzle-orm';
import { deductCallCredits } from '../../../services/credit-service';
import { logger } from '../../../utils/logger';
import { ElevenLabsPoolService } from '../../../services/elevenlabs-pool';

export function setupPlivoElevenLabsWebhooks(app: Express, baseUrl: string): void {
  
  /**
   * Answer URL for SIP trunk calls
   * Returns XML with Stream instruction to connect to our WebSocket
   */
  app.post('/api/plivo-elevenlabs/voice/answer', async (req: Request, res: Response) => {
    try {
      const { CallUUID, From, To, Direction } = req.body;
      
      logger.info(`Answer: ${CallUUID} from ${From} to ${To} (${Direction})`, undefined, 'PlivoElevenLabs');
      
      if (CallUUID) {
        (async () => {
          try {
            const [cred] = await db.select().from(plivoCredentials).where(eq(plivoCredentials.isActive, true)).limit(1);
            if (cred && CallUUID) {
              const recCallback = getSipWebhookUrl('/recording/callback');
              const recRes = await fetch(`https://api.plivo.com/v1/Account/${cred.authId}/Call/${CallUUID}/Record/`, {
                method: 'POST',
                headers: {
                  'Authorization': 'Basic ' + Buffer.from(`${cred.authId}:${cred.authToken}`).toString('base64'),
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  time_limit: 3600,
                  file_format: 'mp3',
                  callback_url: recCallback,
                  callback_method: 'POST',
                }),
              });
              logger.info(`[Plivo-ElevenLabs Recording] Triggered Record API for inbound ${CallUUID} (status: ${recRes.status})`, undefined, 'PlivoElevenLabs');
            }
          } catch (rErr: any) {
            logger.warn(`[Plivo-ElevenLabs Recording] Inbound Record API trigger notice: ${rErr?.message || rErr}`, undefined, 'PlivoElevenLabs');
          }
        })();
      }

      const streamUrl = getSipStreamUrl(CallUUID);
      
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-mulaw;rate=8000">
    ${streamUrl}
  </Stream>
  <Wait length="3600"/>
</Response>`;
      
      res.set('Content-Type', 'text/xml');
      res.send(xml);
    } catch (error: any) {
      logger.error('Answer error', error, 'PlivoElevenLabs');
      res.set('Content-Type', 'text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
    }
  });

  /**
   * Status callback (MUST be registered before :callId param route)
   */
  app.post('/api/plivo-elevenlabs/voice/status', async (req: Request, res: Response) => {
    try {
      const { CallUUID, CallStatus, Duration, HangupCause } = req.body;
      const internalId = (req.query.internalId as string) || (req.body.internalId as string) || (req.query.callId as string) || (req.body.callId as string);
      
      logger.info(`Status: ${CallUUID || 'unknown'} (internalId: ${internalId || 'none'}) -> ${CallStatus} (duration: ${Duration}s, cause: ${HangupCause})`, undefined, 'PlivoElevenLabs');
      
      // Proactively alias session if both IDs are available on status callback
      if (CallUUID && internalId) {
        ElevenLabsBridgeService.aliasSession(internalId, CallUUID);
      }

      const isTerminal = ['completed', 'failed', 'busy', 'no-answer', 'rejected', 'timeout', 'canceled', 'cancelled'].includes(CallStatus);

      if (isTerminal) {
        // Guarantee session termination by CallUUID and internalId
        let result = CallUUID ? await ElevenLabsBridgeService.endSession(CallUUID) : { duration: 0, transcript: [] };
        if ((!result || result.duration === 0) && internalId) {
          const fallbackResult = await ElevenLabsBridgeService.endSession(internalId);
          if (fallbackResult && fallbackResult.duration > 0) {
            result = fallbackResult;
          }
        }
        logger.info(`Session ended: duration=${result?.duration || 0}s, transcript parts=${result?.transcript?.length || 0}`, undefined, 'PlivoElevenLabs');

        // Plivo's reported Duration is authoritative (answered duration only).
        // Fall back to bridge-measured duration if Plivo did not include one.
        const reportedDuration = Duration ? parseInt(String(Duration), 10) : 0;
        const bridgeDuration = result?.duration ? Math.ceil(Number(result.duration)) : 0;
        const durationSeconds = reportedDuration > 0 ? reportedDuration : bridgeDuration;

        // Update flow execution status - find the call by Plivo UUID or internalId
        try {
          let call;
          if (CallUUID) {
            const [byPlivoUuid] = await db
              .select()
              .from(plivoCalls)
              .where(eq(plivoCalls.plivoCallUuid, CallUUID))
              .limit(1);
            call = byPlivoUuid;
          }

          if (!call && internalId) {
            const [byInternalId] = await db
              .select()
              .from(plivoCalls)
              .where(or(
                eq(plivoCalls.callUuid, internalId),
                sql`${plivoCalls.metadata}->>'internalId' = ${internalId}`
              ))
              .limit(1);
            call = byInternalId;
          }

          if (call) {
            const isThisEngine =
              ((call.metadata as Record<string, unknown> | null)?.engine === 'plivo-elevenlabs');
            if (isThisEngine) {
              const metadataUpdate: any = {};
              if (result?.conversationId) {
                metadataUpdate.conversationId = result.conversationId;
                metadataUpdate.elevenLabsConversationId = result.conversationId;
              }
              if (internalId) {
                metadataUpdate.internalId = internalId;
              }
              await db
                .update(plivoCalls)
                .set({
                  ...(CallUUID && !call.plivoCallUuid ? { plivoCallUuid: CallUUID } : {}),
                  status: CallStatus,
                  duration: durationSeconds > 0 ? durationSeconds : (call.duration ?? 0),
                  endedAt: new Date(),
                  ...(result?.recordingUrl ? { recordingUrl: result.recordingUrl } : {}),
                  ...(Object.keys(metadataUpdate).length > 0 ? {
                    metadata: sql`COALESCE(${plivoCalls.metadata}, '{}'::jsonb) || ${JSON.stringify(metadataUpdate)}::jsonb`
                  } : {}),
                })
                .where(eq(plivoCalls.id, call.id));
            }
          }

          if (call) {
            const [flowExec] = await db
              .select()
              .from(flowExecutions)
              .where(eq(flowExecutions.callId, call.id))
              .limit(1);
            
            if (flowExec && (flowExec.status === 'running' || flowExec.status === 'pending')) {
              const execStatus = CallStatus === 'completed' ? 'completed' : 'failed';
              await db
                .update(flowExecutions)
                .set({
                  status: execStatus,
                  completedAt: new Date(),
                  error: CallStatus !== 'completed' ? `Call ended with status: ${CallStatus}` : null,
                })
                .where(eq(flowExecutions.id, flowExec.id));
              logger.info(`Updated flow execution ${flowExec.id} to ${execStatus}`, undefined, 'PlivoElevenLabs');
            }

            if (
              CallStatus === 'completed' &&
              call.userId &&
              durationSeconds >= 1 &&
              ((call.metadata as Record<string, unknown> | null)?.engine === 'plivo-elevenlabs')
            ) {
              const creditsToDeduct = Math.ceil(durationSeconds / 60);
              if (creditsToDeduct > 0) {
                try {
                  const creditResult = await deductCallCredits({
                    userId: call.userId,
                    creditsToDeduct,
                    callId: call.id,
                    fromNumber: call.fromNumber || 'Unknown',
                    toNumber: call.toNumber || 'Unknown',
                    durationSeconds,
                    engine: 'plivo-elevenlabs',
                  });

                  if (!creditResult.success && !creditResult.alreadyDeducted) {
                    logger.error(
                      `Credit deduction failed for plivo-elevenlabs call ${call.id}: ${creditResult.error || 'Unknown error'}`,
                      undefined,
                      'PlivoElevenLabs'
                    );
                    await db
                      .update(plivoCalls)
                      .set({
                        status: 'credit_failed',
                        metadata: sql`COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({
                          creditDeductionFailed: true,
                          creditError: creditResult.error || 'Insufficient credits',
                          creditsRequired: creditsToDeduct,
                          engine: 'plivo-elevenlabs',
                        })}::jsonb`,
                      })
                      .where(eq(plivoCalls.id, call.id));
                  } else if (creditResult.success && creditResult.creditsDeducted > 0) {
                    logger.info(
                      `Deducted ${creditResult.creditsDeducted} credits for plivo-elevenlabs call ${call.id} (new balance: ${creditResult.newBalance})`,
                      undefined,
                      'PlivoElevenLabs'
                    );
                  }
                } catch (creditErr: any) {
                  logger.error(
                    `Credit deduction exception for plivo-elevenlabs call ${call.id}: ${creditErr?.message || creditErr}`,
                    creditErr,
                    'PlivoElevenLabs'
                  );
                }
              }
            }

            if (CallStatus === 'completed' && call.userId && call.agentId) {
              try {
                const [agentRecord] = await db
                  .select({ elevenLabsAgentId: agents.elevenLabsAgentId })
                  .from(agents)
                  .where(eq(agents.id, call.agentId))
                  .limit(1);
                const agentIdForMessaging = agentRecord?.elevenLabsAgentId || call.agentId;
                const callerPhone = call.callDirection === 'inbound'
                  ? (call.fromNumber || '')
                  : (call.toNumber || '');
                const { triggerPostCallMessaging } = await import('../../../services/post-call-messaging');
                triggerPostCallMessaging({
                  elevenLabsAgentId: agentIdForMessaging,
                  userId: call.userId,
                  callerPhone,
                  callId: call.id,
                }).catch(err => logger.error(`Post-call messaging error: ${err.message}`, err, 'PlivoElevenLabs'));
              } catch (msgErr: any) {
                logger.error(`Post-call messaging setup error: ${msgErr.message}`, msgErr, 'PlivoElevenLabs');
              }
            }
          }
        } catch (dbError: any) {
          logger.error('Failed to update call status in database', dbError.message, 'PlivoElevenLabs');
        }
      }
      
      res.set('Content-Type', 'text/plain');
      res.status(200).send('OK');
    } catch (error: any) {
      logger.error('Status callback error', error.message, 'PlivoElevenLabs');
      res.set('Content-Type', 'text/plain');
      res.status(200).send('OK');
    }
  });

  /**
   * Recording callback for Plivo-ElevenLabs engine
   */
  app.post('/api/plivo-elevenlabs/recording/callback', async (req: Request, res: Response) => {
    try {
      let data = req.body;
      if (req.body.response && typeof req.body.response === 'string') {
        try {
          data = JSON.parse(req.body.response);
        } catch (e) {
          // ignore parse error
        }
      }

      const callUuid = data.call_uuid || data.CallUUID || req.body.CallUUID || req.body.call_uuid;
      const recordingUrl = data.record_url || data.recording_url || data.RecordUrl || req.body.RecordUrl || req.body.record_url;
      const recordingId = data.recording_id || data.RecordingID || req.body.RecordingID;
      const duration = parseInt(data.recording_duration || data.RecordingDuration || req.body.RecordingDuration || '0', 10);

      logger.info(`[Plivo-ElevenLabs Recording] Callback received for ${callUuid}: ${recordingUrl}`, undefined, 'PlivoElevenLabs');

      if (callUuid && recordingUrl) {
        await db.update(plivoCalls)
          .set({
            recordingUrl: recordingUrl,
            recordingId: recordingId || null,
            recordingDuration: duration > 0 ? duration : null,
          })
          .where(or(
            eq(plivoCalls.plivoCallUuid, callUuid),
            eq(plivoCalls.id, callUuid),
            sql`${plivoCalls.metadata}->>'internalId' = ${callUuid}`
          ));
      }

      res.status(200).json({ success: true });
    } catch (error: any) {
      logger.error(`[Plivo-ElevenLabs Recording] Callback error: ${error.message}`, error, 'PlivoElevenLabs');
      res.status(200).json({ success: false });
    }
  });
  
  /**
   * Answer URL with call ID path (for outbound calls)
   */
  app.post('/api/plivo-elevenlabs/voice/:callId', async (req: Request, res: Response) => {
    try {
      const { callId } = req.params;
      const { CallUUID, From, To, Direction } = req.body;

      logger.info(`Answer for ${callId}: ${CallUUID} from ${From} to ${To} (${Direction})`, undefined, 'PlivoElevenLabs');

      if (CallUUID && callId) {
        ElevenLabsBridgeService.aliasSession(callId, CallUUID);
        try {
          await db
            .update(plivoCalls)
            .set({
              plivoCallUuid: CallUUID,
            })
            .where(sql`${plivoCalls.metadata}->>'internalId' = ${callId} AND ${plivoCalls.metadata}->>'engine' = 'plivo-elevenlabs'`);
        } catch (updErr: any) {
          logger.warn(
            `Failed to attach CallUUID ${CallUUID} to outbound call ${callId}: ${updErr?.message || updErr}`,
            undefined,
            'PlivoElevenLabs'
          );
        }

        // Proactively trigger Plivo REST recording API to guarantee call audio is recorded
        (async () => {
          try {
            const [cred] = await db.select().from(plivoCredentials).where(eq(plivoCredentials.isActive, true)).limit(1);
            if (cred && CallUUID) {
              const recCallback = getSipWebhookUrl('/recording/callback');
              const recRes = await fetch(`https://api.plivo.com/v1/Account/${cred.authId}/Call/${CallUUID}/Record/`, {
                method: 'POST',
                headers: {
                  'Authorization': 'Basic ' + Buffer.from(`${cred.authId}:${cred.authToken}`).toString('base64'),
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  time_limit: 3600,
                  file_format: 'mp3',
                  callback_url: recCallback,
                  callback_method: 'POST',
                }),
              });
              logger.info(`[Plivo-ElevenLabs Recording] Triggered Record API for ${CallUUID} (status: ${recRes.status})`, undefined, 'PlivoElevenLabs');
            }
          } catch (rErr: any) {
            logger.warn(`[Plivo-ElevenLabs Recording] Record API trigger notice: ${rErr?.message || rErr}`, undefined, 'PlivoElevenLabs');
          }
        })();
      }

      const streamUrl = getSipStreamUrl(CallUUID || callId);
      
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-mulaw;rate=8000">
    ${streamUrl}
  </Stream>
  <Wait length="3600"/>
</Response>`;
      
      res.set('Content-Type', 'text/xml');
      res.send(xml);
    } catch (error: any) {
      logger.error('Answer error', error, 'PlivoElevenLabs');
      res.set('Content-Type', 'text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
    }
  });
  
  /**
   * Incoming call handler for SIP trunk
   */
  app.post('/api/plivo-elevenlabs/incoming', async (req: Request, res: Response) => {
    try {
      const { CallUUID, From, To, Direction } = req.body;
      
      logger.info(`Incoming SIP call: ${CallUUID} from ${From} to ${To}`, undefined, 'PlivoElevenLabs');
      
      let assignedAgentId: string | null = null;

      const [plivoPhone] = await db
        .select()
        .from(plivoPhoneNumbers)
        .where(eq(plivoPhoneNumbers.phoneNumber, To))
        .limit(1);
      
      if (plivoPhone?.assignedAgentId) {
        assignedAgentId = plivoPhone.assignedAgentId;
      } else {
        const [sipPhone] = await db
          .select()
          .from(sipPhoneNumbers)
          .where(eq(sipPhoneNumbers.phoneNumber, To))
          .limit(1);
        if (sipPhone?.agentId) {
          assignedAgentId = sipPhone.agentId;
        }
      }
      
      if (!assignedAgentId) {
        logger.error(`Phone not configured: ${To}`, undefined, 'PlivoElevenLabs');
        res.set('Content-Type', 'text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak>Sorry, this number is not configured. Goodbye.</Speak>
  <Hangup/>
</Response>`);
        return;
      }
      
      const [agent] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, assignedAgentId))
        .limit(1);
      
      if (!agent || !agent.elevenLabsAgentId) {
        logger.error(`Agent not found or no ElevenLabs ID: ${assignedAgentId}`, undefined, 'PlivoElevenLabs');
        res.set('Content-Type', 'text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak>Sorry, the agent is not available. Goodbye.</Speak>
  <Hangup/>
</Response>`);
        return;
      }
      
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, agent.userId))
        .limit(1);
      
      if (!user || Number(user.credits) < 1) {
        logger.error('Insufficient credits', undefined, 'PlivoElevenLabs');
        res.set('Content-Type', 'text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak>Service temporarily unavailable. Goodbye.</Speak>
  <Hangup/>
</Response>`);
        return;
      }
      
      let elevenLabsApiKey: string | undefined;
      const credential = await ElevenLabsPoolService.getCredentialForAgent(agent.id);
      if (credential?.apiKey) {
        elevenLabsApiKey = credential.apiKey;
      } else {
        elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
      }
      if (!elevenLabsApiKey) {
        logger.error('ElevenLabs API key not configured (no pool credential or env var)', undefined, 'PlivoElevenLabs');
        res.set('Content-Type', 'text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak>Service configuration error. Goodbye.</Speak>
  <Hangup/>
</Response>`);
        return;
      }
      
      await ElevenLabsBridgeService.createSession({
        callUuid: CallUUID,
        agentId: agent.elevenLabsAgentId,
        elevenLabsApiKey,
        agentConfig: {
          agentId: agent.elevenLabsAgentId,
          firstMessage: agent.firstMessage || undefined,
          language: agent.language || 'en',
        },
        fromNumber: From,
        toNumber: To,
        direction: 'inbound',
      });

      // Record the inbound call so the status webhook can update its
      // duration/status and bill the user on completion.
      try {
        const insertValues: InsertPlivoCall = {
          userId: agent.userId,
          agentId: agent.id,
          plivoPhoneNumberId: plivoPhone?.id ?? null,
          plivoCallUuid: CallUUID,
          fromNumber: From,
          toNumber: To,
          status: 'in-progress',
          callDirection: 'inbound',
          startedAt: new Date(),
          answeredAt: new Date(),
          metadata: { engine: 'plivo-elevenlabs' },
        };
        await db.insert(plivoCalls).values(insertValues);
      } catch (dbErr: any) {
        logger.error(
          `Failed to insert inbound call record for ${CallUUID}: ${dbErr?.message || dbErr}`,
          dbErr,
          'PlivoElevenLabs'
        );
      }

      const streamUrl = getSipStreamUrl(CallUUID);
      
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-mulaw;rate=8000">
    ${streamUrl}
  </Stream>
</Response>`;
      
      res.set('Content-Type', 'text/xml');
      res.send(xml);
    } catch (error: any) {
      logger.error('Incoming call error', error, 'PlivoElevenLabs');
      res.set('Content-Type', 'text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak>An error occurred. Goodbye.</Speak>
  <Hangup/>
</Response>`);
    }
  });
  
  logger.info('Plivo-ElevenLabs SIP trunk webhook routes registered', undefined, 'PlivoElevenLabs');
}
