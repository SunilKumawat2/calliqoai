'use strict';
/**
 * ============================================================
 * Plivo-ElevenLabs SIP Trunk - Webhook Routes
 * 
 * Handles Plivo SIP trunk webhooks for ElevenLabs integration.
 * ISOLATED from Twilio+ElevenLabs and Plivo+OpenAI systems.
 * ============================================================
 */

import type { Express, Request, Response, NextFunction } from 'express';
import { getSipStreamUrl, getSipWebhookUrl } from '../config/config';
import { ElevenLabsBridgeService } from '../services/elevenlabs-bridge.service';
import { db } from '../../../db';
import { agents, plivoPhoneNumbers, sipPhoneNumbers, users, flowExecutions, plivoCalls, plivoCredentials, type InsertPlivoCall } from '@shared/schema';
import { eq, or, sql } from 'drizzle-orm';
import { deductCallCredits } from '../../../services/credit-service';
import { logger } from '../../../utils/logger';
import { ElevenLabsPoolService } from '../../../services/elevenlabs-pool';

export function setupPlivoElevenLabsWebhooks(app: Express, baseUrl: string): void {
  function escapeXml(str: string): string {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function getPlivoTtsVoiceAndLang(language?: string): { voice: string; language: string } {
    const lang = (language || 'en').toLowerCase().trim();
    if (lang.startsWith('hi')) {
      return { voice: 'Polly.Aditi', language: 'hi-IN' };
    } else if (lang === 'en-in') {
      return { voice: 'Polly.Aditi', language: 'en-IN' };
    } else {
      return { voice: 'Polly.Joanna', language: 'en-US' };
    }
  }
  
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
  <Stream bidirectional="true" keepCallAlive="true" audioTrack="inbound" noiseCancellation="true" contentType="audio/x-mulaw;rate=8000">
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
                eq(plivoCalls.id, internalId),
                eq(plivoCalls.plivoCallUuid, internalId),
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
              let transcriptText: string | null = null;
              if (result?.transcript && result.transcript.length > 0) {
                transcriptText = result.transcript.map(t => `${t.role === 'user' ? 'User' : 'Agent'}: ${t.text}`).join('\n');
              }
              await db
                .update(plivoCalls)
                .set({
                  ...(CallUUID && !call.plivoCallUuid ? { plivoCallUuid: CallUUID } : {}),
                  status: CallStatus,
                  duration: durationSeconds > 0 ? durationSeconds : (call.duration ?? 0),
                  endedAt: new Date(),
                  ...(result?.recordingUrl ? { recordingUrl: result.recordingUrl } : {}),
                  ...(transcriptText ? { transcript: transcriptText } : {}),
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

            // Sync with CRM lead processor (Client requirement #1 & #4)
            if (call.userId && (call.fromNumber || call.toNumber)) {
              try {
                const { CRMLeadProcessor } = await import('../../crm/lead-processor.service');
                const leadPhone = call.callDirection === 'inbound' ? (call.fromNumber || '') : (call.toNumber || '');
                let transcriptToUse = call.transcript;
                if (!transcriptToUse && result?.transcript && result.transcript.length > 0) {
                  transcriptToUse = result.transcript.map((t: any) => `${t.role === 'user' ? 'User' : 'Agent'}: ${t.text}`).join('\n');
                }
                CRMLeadProcessor.processCompletedCall({
                  id: call.id,
                  userId: call.userId,
                  phoneNumber: leadPhone,
                  fromNumber: call.fromNumber,
                  toNumber: call.toNumber,
                  callDirection: (call.callDirection as 'incoming' | 'outgoing') || 'outgoing',
                  status: CallStatus,
                  duration: durationSeconds,
                  transcript: transcriptToUse || null,
                  aiSummary: call.aiSummary || null,
                  sentiment: call.sentiment || null,
                  classification: call.classification || null,
                  campaignId: call.campaignId || null,
                  engine: 'plivo-elevenlabs',
                  metadata: (call.metadata as Record<string, unknown>) || {},
                }).catch(crmErr => logger.warn(`CRM lead processor notice: ${crmErr?.message || crmErr}`, undefined, 'PlivoElevenLabs'));
              } catch (_) {}
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
        const [updatedCall] = await db.update(plivoCalls)
          .set({
            recordingUrl: recordingUrl,
            recordingId: recordingId || null,
            recordingDuration: duration > 0 ? duration : null,
          })
          .where(or(
            eq(plivoCalls.plivoCallUuid, callUuid),
            eq(plivoCalls.id, callUuid),
            sql`${plivoCalls.metadata}->>'internalId' = ${callUuid}`
          ))
          .returning();

        if (updatedCall?.userId) {
          const prospectPhone = (updatedCall.callDirection === 'outbound' || updatedCall.callDirection === 'outgoing')
            ? updatedCall.toNumber
            : updatedCall.fromNumber;
          if (prospectPhone) {
            const leadId = (updatedCall.metadata as any)?.leadId;
            if (leadId) {
              try {
                const { leads } = await import('@shared/schema');
                await db
                  .update(leads)
                  .set({ recordingUrl, updatedAt: new Date() })
                  .where(eq(leads.id, leadId));
              } catch (_) {}
            } else {
              const cleanPhone = prospectPhone.replace(/\D/g, '').slice(-10);
              if (cleanPhone) {
                try {
                  const { leads } = await import('@shared/schema');
                  const { sql, and } = await import('drizzle-orm');
                  await db
                    .update(leads)
                    .set({ recordingUrl, updatedAt: new Date() })
                    .where(and(
                      eq(leads.userId, updatedCall.userId),
                      sql`RIGHT(REGEXP_REPLACE(${leads.phone}, '[^0-9]', '', 'g'), 10) = ${cleanPhone}`
                    ));
                } catch (_) {}
              }
            }

            try {
              const { CrmSyncService } = await import('../../../services/crm-sync/crm-sync.service');
              CrmSyncService.writebackCallOutcome({
                userId: updatedCall.userId,
                phone: prospectPhone,
                leadId: leadId || undefined,
                callStatus: updatedCall.status || 'Completed',
                duration: updatedCall.duration || duration || undefined,
                recordingUrl,
              }).catch(err => logger.warn(`[PlivoElevenLabs] Google Sheets recording writeback note: ${err?.message}`, undefined, 'PlivoElevenLabs'));
            } catch (_) {}
          }
        }
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
  app.post('/api/plivo-elevenlabs/voice/:callId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { callId } = req.params;
      if (callId === 'ivr-selection' || callId === 'status') {
        return next();
      }
      const { CallUUID, From, To, Direction } = req.body;

      logger.info(`Answer for ${callId}: ${CallUUID} from ${From} to ${To} (${Direction})`, undefined, 'PlivoElevenLabs');

      let agent: any = null;
      if (callId) {
        const [callRecord] = await db
          .select()
          .from(plivoCalls)
          .where(or(
            eq(plivoCalls.id, callId),
            sql`${plivoCalls.metadata}->>'internalId' = ${callId}`
          ))
          .limit(1);
        if (callRecord?.agentId) {
          const [foundAgent] = await db.select().from(agents).where(eq(agents.id, callRecord.agentId)).limit(1);
          agent = foundAgent;
        }
      }

      // If Master Agent, serve IVR menu with keypad digits
      if (agent?.isMasterAgent) {
        let greeting = agent.masterAgentGreeting?.trim();
        if (!greeting) {
          const routes = (agent.masterAgentRoutes || []) as Array<{ digit: string; label: string; targetAgentId: string }>;
          if (routes.length > 0) {
            greeting = (agent.language === 'hi')
              ? 'Namaste. ' + routes.map(r => `${r.label || 'Vibhag'} ke liye ${r.digit} dabayein.`).join(' ')
              : 'Welcome. ' + routes.map(r => `For ${r.label || 'department'}, press ${r.digit}.`).join(' ');
          } else {
            greeting = (agent.language === 'hi')
              ? 'Namaste! Hamari company me aapka swagat hai.'
              : 'Welcome to our company. Please hold while we connect your call.';
          }
        }
        const timeout = agent.masterAgentTimeout || 7;
        const actionUrl = `${baseUrl}/api/plivo-elevenlabs/voice/ivr-selection?masterAgentId=${encodeURIComponent(agent.id)}&callRecordId=${encodeURIComponent(callId)}&internalId=${encodeURIComponent(callId)}`;
        const safeActionUrl = escapeXml(actionUrl);

        logger.info(`📞 [Outbound Master Agent IVR] Plivo-ElevenLabs Outbound call ${callId} (${CallUUID}) for Master Agent "${agent.name}" - serving GetDigits IVR menu`, undefined, 'PlivoElevenLabs');

        const safeGreeting = escapeXml(greeting);
        const tts = getPlivoTtsVoiceAndLang(agent.language);
        const timeoutPrompt = agent.language === 'hi'
          ? "Aapki taraf se koi vikalp nahi mila. Alvida."
          : "We did not receive any input. Goodbye.";

        const ivrXml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <GetDigits action="${safeActionUrl}" method="POST" numDigits="1" timeout="${timeout}" retries="1" finishOnKey="#">
    <Speak voice="${tts.voice}" language="${tts.language}">${safeGreeting}</Speak>
  </GetDigits>
  <Speak voice="${tts.voice}" language="${tts.language}">${escapeXml(timeoutPrompt)}</Speak>
  <Hangup/>
</Response>`;

        res.set('Content-Type', 'text/xml');
        return res.send(ivrXml);
      }

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
  <Stream bidirectional="true" keepCallAlive="true" audioTrack="inbound" noiseCancellation="true" contentType="audio/x-mulaw;rate=8000">
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
   * Master Agent IVR Keypad Selection Callback
   */
  app.post(['/api/plivo-elevenlabs/voice/ivr-selection', '/api/plivo-elevenlabs/ivr-selection'], async (req: Request, res: Response) => {
    try {
      const { Digits, CallUUID, From, To } = req.body;
      const masterAgentId = (req.query.masterAgentId as string) || (req.body.masterAgentId as string);
      const callRecordId = (req.query.callRecordId as string) || (req.body.callRecordId as string);
      const internalId = (req.query.internalId as string) || (req.body.internalId as string);
      const phoneNumberId = (req.query.phoneNumberId as string) || (req.body.phoneNumberId as string);

      logger.info(`🔢 [Master Agent IVR] Keypad selection received: Digits="${Digits}", CallUUID="${CallUUID}", masterAgentId="${masterAgentId}"`, undefined, 'PlivoElevenLabs');

      if (!masterAgentId) {
        logger.error(`[Master Agent IVR] Missing masterAgentId`, undefined, 'PlivoElevenLabs');
        res.set('Content-Type', 'text/xml');
        return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Speak voice="Polly.Joanna" language="en-US">An error occurred. Goodbye.</Speak><Hangup/></Response>`);
      }

      const [masterAgent] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, masterAgentId))
        .limit(1);

      if (!masterAgent) {
        logger.error(`[Master Agent IVR] Master agent ${masterAgentId} not found`, undefined, 'PlivoElevenLabs');
        res.set('Content-Type', 'text/xml');
        return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Speak voice="Polly.Joanna" language="en-US">Configuration error. Goodbye.</Speak><Hangup/></Response>`);
      }

      const masterTts = getPlivoTtsVoiceAndLang(masterAgent.language);
      const routes = ((masterAgent as any).masterAgentRoutes || (masterAgent.config as any)?.masterAgentRoutes || []) as Array<{ digit: string; label: string; targetAgentId: string }>;
      
      const cleanDigit = (Digits || '').toString().trim();
      let matchedRoute = (cleanDigit && cleanDigit !== 'timeout') ? routes.find(r => r.digit?.toString().trim() === cleanDigit) : null;

      let targetAgentId = matchedRoute?.targetAgentId || (masterAgent as any).masterAgentFallbackAgentId || (masterAgent.config as any)?.masterAgentFallbackAgentId;

      if (!targetAgentId) {
        logger.warn(`[Master Agent IVR] No route found for digit "${cleanDigit}" and no fallback agent configured`, undefined, 'PlivoElevenLabs');
        const invalidMsg = masterAgent.language === 'hi' ? "Aapki taraf se chuna gaya vikalp uplabdh nahi hai. Alvida." : "Invalid option. Goodbye.";
        res.set('Content-Type', 'text/xml');
        return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Speak voice="${masterTts.voice}" language="${masterTts.language}">${escapeXml(invalidMsg)}</Speak><Hangup/></Response>`);
      }

      // Load target Sub-Agent
      let [subAgent] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, targetAgentId))
        .limit(1);

      if (!subAgent) {
        const veAgentResult = await db.execute(sql`
          SELECT * FROM ve_voice_agents WHERE id = ${targetAgentId} LIMIT 1
        `);
        if (veAgentResult.rows.length > 0) {
          const row: any = veAgentResult.rows[0];
          subAgent = {
            id: row.id,
            userId: row.user_id,
            name: row.name,
            systemPrompt: row.system_prompt,
            firstMessage: row.first_message,
            elevenLabsAgentId: row.eleven_labs_agent_id || row.elevenlabs_agent_id,
            elevenLabsVoiceId: row.tts_voice,
            llmModel: row.llm_model || 'gpt-4o-mini',
            language: row.language || 'en',
            telephonyProvider: 'plivo_elevenlabs'
          } as any;
        }
      }

      if (!subAgent) {
        logger.error(`[Master Agent IVR] Sub-agent ${targetAgentId} not found`, undefined, 'PlivoElevenLabs');
        const notFoundMsg = masterAgent.language === 'hi' ? "Chuna gaya vibhag uplabdh nahi hai. Alvida." : "The selected department is not available. Goodbye.";
        res.set('Content-Type', 'text/xml');
        return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Speak voice="${masterTts.voice}" language="${masterTts.language}">${escapeXml(notFoundMsg)}</Speak><Hangup/></Response>`);
      }

      // Check user credits
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, subAgent.userId))
        .limit(1);

      if (!user || Number(user.credits) < 1) {
        logger.error(`[Master Agent IVR] User has insufficient credits`, undefined, 'PlivoElevenLabs');
        const credMsg = masterAgent.language === 'hi' ? "Seva filhal uplabdh nahi hai. Alvida." : "Service temporarily unavailable. Goodbye.";
        res.set('Content-Type', 'text/xml');
        return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Speak voice="${masterTts.voice}" language="${masterTts.language}">${escapeXml(credMsg)}</Speak><Hangup/></Response>`);
      }

      const effectiveCallId = callRecordId || internalId;
      if (effectiveCallId) {
        await db.update(plivoCalls)
          .set({
            agentId: subAgent.id,
            plivoCallUuid: CallUUID,
          })
          .where(or(
            eq(plivoCalls.id, effectiveCallId),
            sql`${plivoCalls.metadata}->>'internalId' = ${effectiveCallId}`
          ));
        logger.info(`✅ [Master Agent IVR Outbound] Switched outbound call ${effectiveCallId} (${CallUUID}) to Sub-Agent "${subAgent.name}" (${subAgent.id})`, undefined, 'PlivoElevenLabs');
      } else {
        try {
          const insertValues: InsertPlivoCall = {
            userId: subAgent.userId,
            agentId: subAgent.id,
            plivoPhoneNumberId: phoneNumberId || null,
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
          logger.info(`✅ [Master Agent IVR Inbound] Call ${CallUUID} successfully connected to Sub-Agent "${subAgent.name}" (${subAgent.id})`, undefined, 'PlivoElevenLabs');
        } catch (dbErr: any) {
          logger.error(`Failed to insert inbound call record for ${CallUUID}: ${dbErr?.message || dbErr}`, dbErr, 'PlivoElevenLabs');
        }
      }

      // If subAgent is ElevenLabs:
      if (subAgent.elevenLabsAgentId) {
        let elevenLabsApiKey: string | undefined;
        const credential = await ElevenLabsPoolService.getCredentialForAgent(subAgent.id);
        if (credential?.apiKey) {
          elevenLabsApiKey = credential.apiKey;
        } else {
          elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
        }

        if (!elevenLabsApiKey) {
          logger.error('ElevenLabs API key not configured for sub-agent', undefined, 'PlivoElevenLabs');
          res.set('Content-Type', 'text/xml');
          return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Speak voice="${masterTts.voice}" language="${masterTts.language}">Service configuration error. Goodbye.</Speak><Hangup/></Response>`);
        }

        await ElevenLabsBridgeService.createSession({
          callUuid: CallUUID,
          agentId: subAgent.elevenLabsAgentId,
          elevenLabsApiKey,
          agentConfig: {
            agentId: subAgent.elevenLabsAgentId,
            firstMessage: subAgent.firstMessage || undefined,
            language: subAgent.language || 'en',
            transferPhoneNumber: subAgent.transferPhoneNumber || undefined,
            transferEnabled: subAgent.transferEnabled,
            backgroundSound: subAgent.backgroundSound || undefined,
          },
          fromNumber: From,
          toNumber: To,
          direction: effectiveCallId ? 'outbound' : 'inbound',
          dbAgentId: subAgent.id,
          transferPhoneNumber: subAgent.transferPhoneNumber || undefined,
          transferEnabled: subAgent.transferEnabled,
        });

        const streamUrl = getSipStreamUrl(CallUUID);
        const deptLabel = matchedRoute?.label || subAgent.name;
        const subTts = getPlivoTtsVoiceAndLang(subAgent.language);
        const transferMessage = subAgent.language === 'hi'
          ? `Aapko ${deptLabel} se joda ja raha hai...`
          : `Connecting you to ${deptLabel}...`;
        const safeTransferMessage = escapeXml(transferMessage);

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak voice="${subTts.voice}" language="${subTts.language}">${safeTransferMessage}</Speak>
  <Stream bidirectional="true" keepCallAlive="true" audioTrack="inbound" noiseCancellation="true" contentType="audio/x-mulaw;rate=8000">
    ${streamUrl}
  </Stream>
  <Wait length="3600"/>
</Response>`;

        res.set('Content-Type', 'text/xml');
        return res.send(xml);
      } else {
        // Fallback for OpenAI Sub-Agent: connect to OpenAI stream
        const streamUrl = `${baseUrl.replace(/^http/, 'ws')}/api/plivo/stream/${CallUUID}`;
        const deptLabel = matchedRoute?.label || subAgent.name;
        const subTts = getPlivoTtsVoiceAndLang(subAgent.language);
        const transferMessage = subAgent.language === 'hi'
          ? `Aapko ${deptLabel} se joda ja raha hai...`
          : `Connecting you to ${deptLabel}...`;
        const safeTransferMessage = escapeXml(transferMessage);

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak voice="${subTts.voice}" language="${subTts.language}">${safeTransferMessage}</Speak>
  <Stream bidirectional="true" keepCallAlive="true" audioTrack="inbound" noiseCancellation="true" contentType="audio/x-mulaw;rate=8000">
    ${streamUrl}
  </Stream>
</Response>`;

        res.set('Content-Type', 'text/xml');
        return res.send(xml);
      }
    } catch (error: any) {
      logger.error(`[Master Agent IVR] Selection error: ${error.message}`, error, 'PlivoElevenLabs');
      res.set('Content-Type', 'text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Speak voice="Polly.Joanna" language="en-US">An error occurred. Goodbye.</Speak><Hangup/></Response>`);
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

      // Check if Master Agent
      const isMasterAgent = (agent as any)?.isMasterAgent === true || (agent?.config as any)?.isMasterAgent === true;
      if (isMasterAgent && agent) {
        logger.info(`📞 [Master Agent IVR] Inbound SIP call ${CallUUID} assigned to Master Agent "${agent.name}" (${agent.id})`, undefined, 'PlivoElevenLabs');
        
        const actionUrl = `${baseUrl}/api/plivo-elevenlabs/voice/ivr-selection?masterAgentId=${encodeURIComponent(agent.id)}&phoneNumberId=${encodeURIComponent(plivoPhone?.id || '')}`;
        const safeActionUrl = escapeXml(actionUrl);
        const timeout = (agent as any).masterAgentTimeout || 7;
        
        let greeting = (agent as any).masterAgentGreeting?.trim();
        if (!greeting) {
          const routes = ((agent as any).masterAgentRoutes || (agent.config as any)?.masterAgentRoutes || []) as Array<{ digit: string; label: string; targetAgentId: string }>;
          if (routes.length > 0) {
            greeting = (agent.language === 'hi')
              ? 'Namaste. ' + routes.map(r => `${r.label || 'Vibhag'} ke liye ${r.digit} dabayein.`).join(' ')
              : 'Welcome. ' + routes.map(r => `For ${r.label || 'Department'}, press ${r.digit}.`).join(' ');
          } else {
            greeting = (agent.language === 'hi')
              ? 'Namaste! Hamari company me aapka swagat hai.'
              : 'Welcome. Please wait while we connect your call.';
          }
        }

        const safeGreeting = escapeXml(greeting);
        const tts = getPlivoTtsVoiceAndLang(agent.language);
        const timeoutPrompt = agent.language === 'hi'
          ? "Aapki taraf se koi vikalp nahi mila. Alvida."
          : "We did not receive any input. Goodbye.";

        const ivrXml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <GetDigits action="${safeActionUrl}" method="POST" numDigits="1" timeout="${timeout}" retries="1" finishOnKey="#">
    <Speak voice="${tts.voice}" language="${tts.language}">${safeGreeting}</Speak>
  </GetDigits>
  <Speak voice="${tts.voice}" language="${tts.language}">${escapeXml(timeoutPrompt)}</Speak>
  <Hangup/>
</Response>`;

        res.set('Content-Type', 'text/xml');
        return res.send(ivrXml);
      }
      
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
          transferPhoneNumber: agent.transferPhoneNumber || undefined,
          transferEnabled: agent.transferEnabled,
          backgroundSound: agent.backgroundSound || undefined,
        },
        fromNumber: From,
        toNumber: To,
        direction: 'inbound',
        dbAgentId: agent.id,
        transferPhoneNumber: agent.transferPhoneNumber || undefined,
        transferEnabled: agent.transferEnabled,
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
  <Stream bidirectional="true" keepCallAlive="true" audioTrack="inbound" noiseCancellation="true" contentType="audio/x-mulaw;rate=8000">
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
