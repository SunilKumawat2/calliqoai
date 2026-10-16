'use strict';
/**
 * ============================================================
 * Plivo Webhook Routes
 * 
 * Handles incoming webhooks from Plivo:
 * - Answer URL: Returns XML with Stream instruction
 * - Status callback: Call status updates
 * - Recording callback: Recording ready notification
 * - KYC callback: Document verification status
 * ============================================================
 */

import type { Express, Request, Response, NextFunction } from 'express';
import { getWebhookUrl, getStreamUrl, generateTransferXML, generateHangupXML } from '../config/plivo-config';
import { PlivoCallService } from '../services/plivo-call.service';
import { CallSummarizationService } from '../services/call-summarization.service';
import { AudioBridgeService } from '../services/audio-bridge.service';
import { db } from '../../../db';
import { plivoCalls, plivoPhoneNumbers, agents, users, flowExecutions, calls } from '@shared/schema';
import { eq, or, sql } from 'drizzle-orm';
import { OpenAIPoolService } from '../services/openai-pool.service';
import type { PlivoCallStatus } from '../types';
import { logger } from '../../../utils/logger';
import { webhookDeliveryService } from '../../../services/webhook-delivery';
import { scheduleContactRetry } from '../../../routes/webhooks/helpers';

export function setupPlivoWebhooks(app: Express, baseUrl: string): void {
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
   * Answer URL - Called when a call is initiated or received
   * Returns XML to connect the call to the audio stream
   * 
   * For outbound calls: callId is in the URL path
   * For inbound calls: lookup by phone number
   */
  app.post('/api/plivo/voice/answer', async (req: Request, res: Response) => {
    try {
      const { CallUUID, From, To, Direction } = req.body;
      
      logger.info(`Answer: ${CallUUID} from ${From} to ${To} (${Direction})`, undefined, 'PlivoWebhook');

      const streamUrl = getStreamUrl(baseUrl, CallUUID);

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-mulaw;rate=8000">
    ${streamUrl}
  </Stream>
</Response>`;

      res.set('Content-Type', 'text/xml');
      res.send(xml);
    } catch (error: any) {
      logger.error('Answer error', error, 'PlivoWebhook');
      res.set('Content-Type', 'text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
    }
  });

  /**
   * Answer URL with call ID path - for outbound calls
   */
  app.post('/api/plivo/voice/:callId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { callId } = req.params;
      if (callId === 'ivr-selection' || callId === 'status') {
        return next();
      }
      const { CallUUID, From, To, Direction } = req.body;
      
      logger.info(`Answer for call ${callId}: ${CallUUID} from ${From} to ${To} (${Direction})`, undefined, 'PlivoWebhook');

      // Update the call record with Plivo UUID (keep status as initiated/ringing until stream connects)
      if (callId && CallUUID) {
        await db.update(plivoCalls)
          .set({ plivoCallUuid: CallUUID })
          .where(eq(plivoCalls.id, callId))
          .catch(err => logger.error(`Error updating plivoCallUuid: ${err.message}`, err, 'PlivoWebhook'));
      }

      // Check if the agent assigned to this call is a Master Agent
      let agent: any = null;
      if (callId) {
        const [callRecord] = await db.select().from(plivoCalls).where(eq(plivoCalls.id, callId)).limit(1);
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
        const actionUrl = `${baseUrl}/api/plivo/voice/ivr-selection?masterAgentId=${encodeURIComponent(agent.id)}&callRecordId=${encodeURIComponent(callId)}`;
        const safeActionUrl = escapeXml(actionUrl);

        logger.info(`📞 [Outbound Master Agent IVR] Outbound call ${callId} (${CallUUID}) for Master Agent "${agent.name}" - serving GetDigits IVR menu`, undefined, 'PlivoWebhook');

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

      const streamUrl = getStreamUrl(baseUrl, CallUUID);

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-mulaw;rate=8000">
    ${streamUrl}
  </Stream>
</Response>`;

      res.set('Content-Type', 'text/xml');
      res.send(xml);
    } catch (error: any) {
      logger.error('Answer error', error, 'PlivoWebhook');
      res.set('Content-Type', 'text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
    }
  });

  /**
   * Status callback - Called when call status changes
   */
  app.post('/api/plivo/voice/status', async (req: Request, res: Response) => {
    try {
      const { CallUUID, CallStatus, Duration, HangupCause, From, To } = req.body;
      
      logger.info(`Status: ${CallUUID} -> ${CallStatus} (duration: ${Duration}s, cause: ${HangupCause})`, undefined, 'PlivoWebhook');

      // Find call by Plivo UUID
      const call = await PlivoCallService.getCallByUuid(CallUUID);
      
      if (call) {
        // Map Plivo status to our status enum
        const statusMap: Record<string, PlivoCallStatus> = {
          'ringing': 'ringing',
          'answered': 'in-progress',
          'in-progress': 'in-progress',
          'completed': 'completed',
          'busy': 'busy',
          'failed': 'failed',
          'no-answer': 'no-answer',
          'canceled': 'canceled',
        };

        const normalizedStatus = statusMap[CallStatus.toLowerCase()] || CallStatus.toLowerCase();
        
        await PlivoCallService.handleCallStatus(call.id, normalizedStatus as PlivoCallStatus, {
          hangupCause: HangupCause,
          rawDuration: Duration,
          from: From,
          to: To,
        });

        if (normalizedStatus === 'completed') {
          CallSummarizationService.summarizeCall(call.id).catch(err => {
            logger.error(`Summarization error for ${call.id}: ${err.message}`, err, 'PlivoWebhook');
          });
        }
        
        // Update flow execution status for terminal call states
        if (['completed', 'failed', 'busy', 'no-answer', 'canceled', 'cancelled'].includes(normalizedStatus)) {
          try {
            const [flowExec] = await db
              .select()
              .from(flowExecutions)
              .where(eq(flowExecutions.callId, call.id))
              .limit(1);
            
            if (flowExec && (flowExec.status === 'running' || flowExec.status === 'pending')) {
              const execStatus = normalizedStatus === 'completed' ? 'completed' : 'failed';
              await db
                .update(flowExecutions)
                .set({
                  status: execStatus,
                  completedAt: new Date(),
                  error: normalizedStatus !== 'completed' ? `Call ended with status: ${normalizedStatus}` : null,
                })
                .where(eq(flowExecutions.id, flowExec.id));
              logger.info(`Updated flow execution ${flowExec.id} to ${execStatus}`, undefined, 'PlivoWebhook');
            }
          } catch (flowExecError: any) {
            logger.warn(`Failed to update flow execution status: ${flowExecError.message}`, undefined, 'PlivoWebhook');
          }

          // Track attempt and schedule retry via shared helper
          if (call.contactId && call.campaignId) {
            scheduleContactRetry(call.contactId, call.campaignId, normalizedStatus).catch((err: any) => {
              logger.warn(`Failed to schedule contact retry: ${err.message}`, undefined, 'PlivoWebhook');
            });
          }
        }

      } else {
        logger.warn(`Call not found for UUID: ${CallUUID}`, undefined, 'PlivoWebhook');
      }

      res.sendStatus(200);
    } catch (error: any) {
      logger.error('Status error', error, 'PlivoWebhook');
      res.sendStatus(200); // Always return 200 to prevent retries
    }
  });

  /**
   * Status callback with call ID path
   */
  app.post('/api/plivo/status/:callId', async (req: Request, res: Response) => {
    try {
      const { callId } = req.params;
      const { CallUUID, CallStatus, Duration, HangupCause, From, To } = req.body;
      
      logger.info(`Status for ${callId}: ${CallStatus} (duration: ${Duration}s, cause: ${HangupCause})`, undefined, 'PlivoWebhook');

      // Map Plivo status to our status enum
      const statusMap: Record<string, PlivoCallStatus> = {
        'ringing': 'ringing',
        'answered': 'in-progress',
        'in-progress': 'in-progress',
        'completed': 'completed',
        'busy': 'busy',
        'failed': 'failed',
        'no-answer': 'no-answer',
        'canceled': 'canceled',
      };

      const normalizedStatus = statusMap[CallStatus?.toLowerCase()] || CallStatus?.toLowerCase() || 'failed';
      
      await PlivoCallService.handleCallStatus(callId, normalizedStatus as PlivoCallStatus, {
        hangupCause: HangupCause,
        rawDuration: Duration,
        from: From,
        to: To,
        plivoCallUuid: CallUUID,
      });

      if (normalizedStatus === 'completed') {
        CallSummarizationService.summarizeCall(callId).catch(err => {
          logger.error(`Summarization error for ${callId}: ${err.message}`, err, 'PlivoWebhook');
        });
      }
      
      // Update flow execution status for terminal call states
      if (['completed', 'failed', 'busy', 'no-answer', 'canceled', 'cancelled'].includes(normalizedStatus)) {
        try {
          const [flowExec] = await db
            .select()
            .from(flowExecutions)
            .where(eq(flowExecutions.callId, callId))
            .limit(1);
          
          if (flowExec && (flowExec.status === 'running' || flowExec.status === 'pending')) {
            const execStatus = normalizedStatus === 'completed' ? 'completed' : 'failed';
            await db
              .update(flowExecutions)
              .set({
                status: execStatus,
                completedAt: new Date(),
                error: normalizedStatus !== 'completed' ? `Call ended with status: ${normalizedStatus}` : null,
              })
              .where(eq(flowExecutions.id, flowExec.id));
            logger.info(`Updated flow execution ${flowExec.id} to ${execStatus}`, undefined, 'PlivoWebhook');
          }
        } catch (flowExecError: any) {
          logger.warn(`Failed to update flow execution status: ${flowExecError.message}`, undefined, 'PlivoWebhook');
        }

        // Track attempt and schedule retry via shared helper
        try {
          const [plivoCall] = await db
            .select({ contactId: plivoCalls.contactId, campaignId: plivoCalls.campaignId })
            .from(plivoCalls)
            .where(eq(plivoCalls.id, callId))
            .limit(1);
          if (plivoCall?.contactId && plivoCall?.campaignId) {
            scheduleContactRetry(plivoCall.contactId, plivoCall.campaignId, normalizedStatus).catch((err: any) => {
              logger.warn(`Failed to schedule contact retry: ${err.message}`, undefined, 'PlivoWebhook');
            });
          }
        } catch (retryErr: any) {
          logger.warn(`Failed to lookup plivo call for retry: ${retryErr.message}`, undefined, 'PlivoWebhook');
        }
      }

      res.sendStatus(200);
    } catch (error: any) {
      logger.error('Status error', error, 'PlivoWebhook');
      res.sendStatus(200);
    }
  });

  /**
   * Recording callback - Called when recording is ready
   */
  app.post('/api/plivo/voice/recording', async (req: Request, res: Response) => {
    try {
      const { CallUUID, RecordUrl, RecordingDuration } = req.body;
      
      logger.info(`Recording: ${CallUUID} -> ${RecordUrl} (${RecordingDuration}s)`, undefined, 'PlivoWebhook');

      // Find call by Plivo UUID
      const call = await PlivoCallService.getCallByUuid(CallUUID);
      
      if (call) {
        await PlivoCallService.handleRecordingReady(
          call.id,
          RecordUrl,
          parseInt(RecordingDuration) || 0
        );
      } else {
        logger.warn(`Call not found for recording UUID: ${CallUUID}`, undefined, 'PlivoWebhook');
      }

      res.sendStatus(200);
    } catch (error: any) {
      logger.error('Recording error', error, 'PlivoWebhook');
      res.sendStatus(200);
    }
  });

  /**
   * Recording callback with call ID path
   */
  app.post('/api/plivo/recording/:callId', async (req: Request, res: Response) => {
    try {
      const { callId } = req.params;
      const { CallUUID, RecordUrl, RecordingDuration } = req.body;
      
      logger.info(`Recording for ${callId}: ${RecordUrl} (${RecordingDuration}s)`, undefined, 'PlivoWebhook');

      await PlivoCallService.handleRecordingReady(
        callId,
        RecordUrl,
        parseInt(RecordingDuration) || 0
      );

      res.sendStatus(200);
    } catch (error: any) {
      logger.error('Recording error', error, 'PlivoWebhook');
      res.sendStatus(200);
    }
  });

  /**
   * Recording callback endpoint (new pattern)
   * Called by PlivoRecordingService when recording is ready
   * Plivo sends application/x-www-form-urlencoded with a 'response' field containing JSON string
   */
  app.post('/api/plivo/recording/callback/:callRecordId', async (req: Request, res: Response) => {
    try {
      const { callRecordId } = req.params;
      
      // Log raw request for debugging
      logger.info(`[Recording] ===== CALLBACK RECEIVED =====`, undefined, 'PlivoWebhook');
      logger.info(`[Recording] Content-Type: ${req.headers['content-type']}`, undefined, 'PlivoWebhook');
      logger.info(`[Recording] Raw Body: ${JSON.stringify(req.body)}`, undefined, 'PlivoWebhook');
      logger.info(`[Recording] Call Record ID: ${callRecordId}`, undefined, 'PlivoWebhook');
      
      // Plivo sends data wrapped in a 'response' field as a JSON string
      // e.g., {"response": "{\"record_url\":\"...\",\"recording_id\":\"...\"}"}
      let data = req.body;
      
      // Check if data is wrapped in 'response' field as JSON string
      if (req.body.response && typeof req.body.response === 'string') {
        try {
          data = JSON.parse(req.body.response);
          logger.info(`[Recording] Parsed response JSON successfully`, undefined, 'PlivoWebhook');
        } catch (parseError) {
          logger.warn(`[Recording] Failed to parse response JSON: ${parseError}`, undefined, 'PlivoWebhook');
        }
      }
      
      // Plivo uses snake_case in the parsed response
      const {
        CallUUID,
        RecordUrl,
        RecordingID,
        RecordingDuration,
        RecordingDurationMs,
        // snake_case variants (actual Plivo format)
        call_uuid,
        record_url,
        recording_id,
        recording_url,
        recording_duration,
        recording_duration_ms
      } = data;
      
      // Resolve field values with fallbacks
      const callUuid = call_uuid || CallUUID;
      const recordingUrl = record_url || recording_url || RecordUrl;
      const recordingIdValue = recording_id || RecordingID;
      const durationSec = parseInt(recording_duration) || parseInt(RecordingDuration) || 
                          Math.round((parseInt(recording_duration_ms) || parseInt(RecordingDurationMs) || 0) / 1000);
      
      logger.info(`[Recording] Plivo Call UUID: ${callUuid}`, undefined, 'PlivoWebhook');
      logger.info(`[Recording] Recording URL: ${recordingUrl}`, undefined, 'PlivoWebhook');
      logger.info(`[Recording] Recording ID: ${recordingIdValue}`, undefined, 'PlivoWebhook');
      logger.info(`[Recording] Duration: ${durationSec}s`, undefined, 'PlivoWebhook');

      if (recordingUrl) {
        await PlivoCallService.handleRecordingReady(
          callRecordId,
          recordingUrl,
          durationSec
        );
        logger.info(`[Recording] ✓ Recording saved for ${callRecordId}`, undefined, 'PlivoWebhook');
      } else {
        logger.warn(`[Recording] No recording URL in callback for ${callRecordId}`, undefined, 'PlivoWebhook');
        logger.warn(`[Recording] Available fields: ${Object.keys(data).join(', ')}`, undefined, 'PlivoWebhook');
      }

      res.sendStatus(200);
    } catch (error: any) {
      logger.error(`[Recording] Callback error: ${error.message}`, error, 'PlivoWebhook');
      res.sendStatus(200);
    }
  });

  /**
   * Transfer webhook - Returns XML to dial the transfer target
   * Called when a call is redirected for transfer
   * Supports both GET and POST methods for Plivo compatibility
   */
  const handleTransferWebhook = async (req: Request, res: Response) => {
    try {
      const { target, callerId } = req.query;
      const CallUUID = req.body?.CallUUID || req.query?.CallUUID || 'unknown';
      
      logger.info(`[Transfer XML] ===== PLIVO REQUESTED TRANSFER XML =====`, undefined, 'PlivoWebhook');
      logger.info(`[Transfer XML] Call UUID: ${CallUUID}`, undefined, 'PlivoWebhook');
      logger.info(`[Transfer XML] Target: ${target}`, undefined, 'PlivoWebhook');
      logger.info(`[Transfer XML] Caller ID: ${callerId}`, undefined, 'PlivoWebhook');
      logger.info(`[Transfer XML] Method: ${req.method}`, undefined, 'PlivoWebhook');
      logger.info(`[Transfer XML] Query params: ${JSON.stringify(req.query)}`, undefined, 'PlivoWebhook');
      logger.info(`[Transfer XML] Body: ${JSON.stringify(req.body)}`, undefined, 'PlivoWebhook');
      logger.info(`[Transfer XML] Headers: ${JSON.stringify(req.headers)}`, undefined, 'PlivoWebhook');

      if (!target || typeof target !== 'string') {
        logger.error('[Transfer XML] Target missing!', undefined, 'PlivoWebhook');
        res.set('Content-Type', 'text/xml');
        res.send(generateHangupXML('Sorry, transfer could not be completed.'));
        return;
      }

      const callerIdStr = (callerId as string) || '';
      const xml = generateTransferXML(target, callerIdStr);
      
      logger.info(`[Transfer XML] Returning XML:`, undefined, 'PlivoWebhook');
      logger.info(xml, undefined, 'PlivoWebhook');
      
      res.set('Content-Type', 'text/xml');
      res.send(xml);
    } catch (error: any) {
      logger.error('[Transfer XML] Error generating XML', error, 'PlivoWebhook');
      res.set('Content-Type', 'text/xml');
      res.send(generateHangupXML('Sorry, an error occurred during transfer.'));
    }
  };
  
  // Support both GET and POST for transfer webhook
  app.get('/api/plivo/voice/transfer', handleTransferWebhook);
  app.post('/api/plivo/voice/transfer', handleTransferWebhook);

  /**
   * Hangup webhook - Returns XML to end the call gracefully
   */
  app.post('/api/plivo/voice/hangup', async (req: Request, res: Response) => {
    try {
      const { message } = req.query;
      const { CallUUID } = req.body;
      
      logger.info(`Hangup request for ${CallUUID}`, undefined, 'PlivoWebhook');

      const messageStr = typeof message === 'string' ? message : 'Thank you for calling. Goodbye!';
      const xml = generateHangupXML(messageStr);
      
      res.set('Content-Type', 'text/xml');
      res.send(xml);
    } catch (error: any) {
      logger.error('Hangup error', error, 'PlivoWebhook');
      res.set('Content-Type', 'text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
    }
  });

  function normalizeVoiceForRealtime(voice?: string): string {
    const valid = ['alloy', 'echo', 'shimmer', 'ash', 'coral', 'sage', 'verse', 'ballad'];
    if (!voice) return 'shimmer';
    const v = voice.toLowerCase().trim();
    if (valid.includes(v)) return v;
    return 'shimmer';
  }

  function normalizeModelForRealtime(model?: string): string {
    if (!model) return 'gpt-realtime-1.5';
    const m = model.toLowerCase().trim();
    if (m.includes('mini') || m === 'gpt-4o-mini') {
      return 'gpt-realtime-mini';
    }
    return 'gpt-realtime-1.5';
  }

  /**
   * Health check for incoming endpoint - allows testing if URL is reachable
   */
  app.get('/api/plivo/incoming', async (req: Request, res: Response) => {
    logger.info('Incoming endpoint health check (GET)', undefined, 'PlivoWebhook');
    res.json({ status: 'ok', endpoint: '/api/plivo/incoming', method: 'GET', message: 'Plivo incoming webhook endpoint is accessible' });
  });

  /**
   * Incoming call handler - Routes inbound calls to appropriate agents
   */
  app.post('/api/plivo/incoming', async (req: Request, res: Response) => {
    try {
      // Log raw request for debugging
      console.log('📞 [Plivo Incoming] Raw request received:', {
        body: req.body,
        headers: {
          'content-type': req.headers['content-type'],
          'user-agent': req.headers['user-agent'],
        },
      });
      
      const { CallUUID, From, To, Direction } = req.body;
      
      logger.info(`Incoming call: ${CallUUID} from ${From} to ${To}`, undefined, 'PlivoWebhook');

      // Normalize phone numbers - trim whitespace and remove + prefix
      const normalizedTo = (To || '').toString().trim().replace(/^\+/, '');
      const normalizedFrom = (From || '').toString().trim().replace(/^\+/, '');
      
      logger.info(`Normalized To: ${normalizedTo}`, undefined, 'PlivoWebhook');

      // Find the phone number and associated agent (support +, without +, or exact match)
      const last10Digits = normalizedTo.slice(-10);
      const [phoneNumber] = await db
        .select()
        .from(plivoPhoneNumbers)
        .where(
          or(
            eq(plivoPhoneNumbers.phoneNumber, normalizedTo),
            eq(plivoPhoneNumbers.phoneNumber, `+${normalizedTo}`),
            sql`REPLACE(REPLACE(${plivoPhoneNumbers.phoneNumber}, '+', ''), ' ', '') LIKE ${`%${last10Digits}`}`
          )
        )
        .limit(1);

      // Trigger inbound_call.received early if we have a phone record
      if (phoneNumber?.userId) {
        try {
          await webhookDeliveryService.triggerEvent(phoneNumber.userId, 'inbound_call.received', {
            callId: null,
            callSid: CallUUID,
            direction: 'inbound',
            status: 'received',
            fromNumber: normalizedFrom,
            toNumber: normalizedTo,
            agentId: phoneNumber.assignedAgentId || null,
            phoneNumberId: phoneNumber.id,
          });
          logger.info(`Triggered inbound_call.received webhook for incoming call ${CallUUID}`, undefined, 'PlivoWebhook');
        } catch (webhookError: any) {
          logger.error(`Failed to trigger inbound_call.received webhook: ${webhookError.message}`, undefined, 'PlivoWebhook');
        }
      }

      if (!phoneNumber) {
        logger.error(`Phone number not found: ${normalizedTo} (raw: ${To})`, undefined, 'PlivoWebhook');
        res.set('Content-Type', 'text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak>Sorry, this number is not configured. Goodbye.</Speak>
  <Hangup/>
</Response>`);
        return;
      }

      // Check if there's an assigned agent
      if (!phoneNumber.assignedAgentId) {
        logger.error(`No agent assigned to phone: ${To}`, undefined, 'PlivoWebhook');
        res.set('Content-Type', 'text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak>Sorry, this line is not currently available. Goodbye.</Speak>
  <Hangup/>
</Response>`);
        return;
      }

      // Get agent configuration
      let [agent] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, phoneNumber.assignedAgentId))
        .limit(1);

      if (!agent) {
        const veAgentResult = await db.execute(sql`
          SELECT * FROM ve_voice_agents WHERE id = ${phoneNumber.assignedAgentId} LIMIT 1
        `);
        if (veAgentResult.rows.length > 0) {
          const row: any = veAgentResult.rows[0];
          agent = {
            id: row.id,
            userId: row.user_id,
            name: row.name,
            systemPrompt: row.system_prompt,
            firstMessage: row.first_message,
            elevenLabsVoiceId: row.tts_voice,
            llmModel: row.llm_model || 'gpt-4o-mini',
            language: row.language || 'en',
            telephonyProvider: 'plivo'
          } as any;
        } else {
          const incomingAgentResult = await db.execute(sql`
            SELECT * FROM incoming_agents WHERE id = ${phoneNumber.assignedAgentId} LIMIT 1
          `);
          if (incomingAgentResult.rows.length > 0) {
            const row: any = incomingAgentResult.rows[0];
            agent = {
              id: row.id,
              userId: row.user_id,
              name: row.name,
              systemPrompt: row.system_prompt,
              firstMessage: row.first_message,
              elevenLabsVoiceId: row.eleven_labs_voice_id,
              llmModel: row.llm_model || 'gpt-4o-mini',
              language: row.language || 'en',
              telephonyProvider: 'plivo'
            } as any;
          }
        }
      }

      if (!agent) {
        logger.error(`Agent not found: ${phoneNumber.assignedAgentId}`, undefined, 'PlivoWebhook');
        res.set('Content-Type', 'text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak>Sorry, the agent is not available. Goodbye.</Speak>
  <Hangup/>
</Response>`);
        return;
      }

      // Get user for credit check
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, agent.userId))
        .limit(1);

      if (!user || user.credits < 1) {
        logger.error('User has insufficient credits', undefined, 'PlivoWebhook');
        res.set('Content-Type', 'text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak>Sorry, the service is temporarily unavailable. Goodbye.</Speak>
  <Hangup/>
</Response>`);
        return;
      }

      // ========================================
      // MASTER AGENT (IVR Phone Tree Router) CHECK
      // If this agent is configured as a Master Agent, present the IVR menu
      // ========================================
      const isMasterAgent = (agent as any).isMasterAgent === true || (agent.config as any)?.isMasterAgent === true;
      if (isMasterAgent) {
        logger.info(`📞 [Master Agent IVR] Inbound call ${CallUUID} assigned to Master Agent "${agent.name}" (${agent.id})`, undefined, 'PlivoWebhook');
        
        const actionUrl = `${baseUrl}/api/plivo/voice/ivr-selection?masterAgentId=${encodeURIComponent(agent.id)}&phoneNumberId=${encodeURIComponent(phoneNumber.id)}`;
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

      // Reserve an OpenAI slot
      const tier = OpenAIPoolService.getModelTierForUser(user.planType);
      const openaiCredential = await OpenAIPoolService.reserveSlot(tier);

      if (!openaiCredential) {
        logger.error('No OpenAI capacity available', undefined, 'PlivoWebhook');
        res.set('Content-Type', 'text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak>We are experiencing high demand. Please try again later.</Speak>
  <Hangup/>
</Response>`);
        return;
      }

      // Create incoming call record
      let callRecord: any = null;
      try {
        callRecord = await PlivoCallService.createIncomingCall({
          fromNumber: normalizedFrom,
          toNumber: normalizedTo,
          plivoCallUuid: CallUUID,
          agentId: agent.id,
          plivoPhoneNumberId: phoneNumber.id,
          userId: agent.userId,
          openaiCredentialId: openaiCredential.id,
          plivoCredentialId: phoneNumber.plivoCredentialId || undefined,
          voice: normalizeVoiceForRealtime(agent.openaiVoice || agent.tts_voice || agent.elevenLabsVoiceId),
          model: normalizeModelForRealtime(agent.llmModel || agent.openaiModel),
          systemPrompt: agent.systemPrompt,
          firstMessage: agent.firstMessage,
        });
      } catch (createError: any) {
        // Release the slot if call record creation fails
        await OpenAIPoolService.releaseSlot(openaiCredential.id);
        throw createError;
      }

      // Trigger inbound_call.answered webhook - call has been answered by AI agent
      try {
        await webhookDeliveryService.triggerEvent(agent.userId, 'inbound_call.answered', {
          callId: callRecord?.id || null,
          callSid: CallUUID,
          direction: 'inbound',
          status: 'in-progress',
          fromNumber: normalizedFrom,
          toNumber: normalizedTo,
          agentId: agent.id,
          phoneNumberId: phoneNumber.id,
        });
        logger.info(`Triggered inbound_call.answered webhook for call ${CallUUID}`, undefined, 'PlivoWebhook');
      } catch (webhookError: any) {
        logger.error(`Failed to trigger inbound_call.answered webhook: ${webhookError.message}`, undefined, 'PlivoWebhook');
      }

      // Return stream XML
      const streamUrl = getStreamUrl(baseUrl, CallUUID);

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-mulaw;rate=8000">
    ${streamUrl}
  </Stream>
</Response>`;

      res.set('Content-Type', 'text/xml');
      res.send(xml);
    } catch (error: any) {
      logger.error('Incoming call error', error, 'PlivoWebhook');
      res.set('Content-Type', 'text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak>Sorry, an error occurred. Goodbye.</Speak>
  <Hangup/>
</Response>`);
    }
  });

  /**
   * Transfer XML endpoint - Called by Plivo Transfer API
   * Returns Dial XML to connect the call to the transfer target
   */
  app.get('/api/plivo/voice/transfer', (req: Request, res: Response) => {
    const { target, callerId } = req.query;
    
    logger.info(`[TransferXML] ===== TRANSFER XML ENDPOINT CALLED =====`, undefined, 'PlivoWebhook');
    logger.info(`[TransferXML] Target: ${target}`, undefined, 'PlivoWebhook');
    logger.info(`[TransferXML] Caller ID: ${callerId}`, undefined, 'PlivoWebhook');
    
    if (!target) {
      logger.error(`[TransferXML] No target number provided!`, undefined, 'PlivoWebhook');
      res.set('Content-Type', 'application/xml');
      return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
    }
    
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${callerId || ''}" timeout="30" timeLimit="3600">
    <Number>${target}</Number>
  </Dial>
</Response>`;
    
    logger.info(`[TransferXML] Returning Dial XML:`, undefined, 'PlivoWebhook');
    logger.info(xml, undefined, 'PlivoWebhook');
    logger.info(`[TransferXML] ===== TRANSFER XML SENT =====`, undefined, 'PlivoWebhook');
    
    res.set('Content-Type', 'application/xml');
    res.send(xml);
  });

  /**
   * Post-stream webhook - Fallback handler (kept for compatibility)
   * With the new Transfer API + Stop Stream approach, this is rarely needed
   */
  app.post('/api/plivo/voice/post-stream', (req: Request, res: Response) => {
    const callUuid = req.query.callUuid as string;
    const { CallUUID, StreamAction } = req.body;
    
    logger.info(`[PostStream] ===== POST-STREAM CALLBACK RECEIVED =====`, undefined, 'PlivoWebhook');
    logger.info(`[PostStream] Query callUuid: ${callUuid}`, undefined, 'PlivoWebhook');
    logger.info(`[PostStream] Body CallUUID: ${CallUUID}`, undefined, 'PlivoWebhook');
    logger.info(`[PostStream] StreamAction: ${StreamAction}`, undefined, 'PlivoWebhook');
    logger.info(`[PostStream] Full body: ${JSON.stringify(req.body)}`, undefined, 'PlivoWebhook');
    
    // Use query param callUuid or body CallUUID
    const effectiveCallUuid = callUuid || CallUUID;
    
    if (!effectiveCallUuid) {
      logger.error(`[PostStream] No call UUID provided!`, undefined, 'PlivoWebhook');
      res.set('Content-Type', 'application/xml');
      return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
    }
    
    const pendingTransfer = AudioBridgeService.getPendingTransfer(effectiveCallUuid);
    
    if (pendingTransfer) {
      logger.info(`[PostStream] ===== PENDING TRANSFER FOUND =====`, undefined, 'PlivoWebhook');
      logger.info(`[PostStream] Target: ${pendingTransfer.targetNumber}`, undefined, 'PlivoWebhook');
      logger.info(`[PostStream] Caller ID: ${pendingTransfer.callerId}`, undefined, 'PlivoWebhook');
      
      // Clear the pending transfer before responding
      AudioBridgeService.clearPendingTransfer(effectiveCallUuid);
      
      // Return Dial XML to transfer the call
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${pendingTransfer.callerId}">
    <Number>${pendingTransfer.targetNumber}</Number>
  </Dial>
</Response>`;
      
      logger.info(`[PostStream] Returning Dial XML:`, undefined, 'PlivoWebhook');
      logger.info(xml, undefined, 'PlivoWebhook');
      logger.info(`[PostStream] ===== TRANSFER XML SENT =====`, undefined, 'PlivoWebhook');
      
      res.set('Content-Type', 'application/xml');
      return res.send(xml);
    }
    
    logger.info(`[PostStream] No pending transfer found, returning Hangup`, undefined, 'PlivoWebhook');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Hangup/>
</Response>`;
    
    res.set('Content-Type', 'application/xml');
    res.send(xml);
  });

  /**
   * Master Agent IVR Selection handler - Called when caller presses a digit on keypad
   */
  app.post(['/api/plivo/voice/ivr-selection', '/api/plivo/ivr-selection'], async (req: Request, res: Response) => {
    try {
      const { CallUUID, Digits, From, To, Direction } = req.body;
      const masterAgentId = (req.query.masterAgentId as string) || req.body.masterAgentId;
      const phoneNumberId = (req.query.phoneNumberId as string) || req.body.phoneNumberId;
      const callRecordId = (req.query.callRecordId as string) || req.body.callRecordId;

      logger.info(`📞 [Master Agent IVR Selection] Call ${CallUUID}: pressed digit "${Digits}" for Master Agent ${masterAgentId} (callRecordId=${callRecordId || 'none'})`, undefined, 'PlivoWebhook');

      if (!masterAgentId) {
        logger.error(`[Master Agent IVR] Missing masterAgentId`, undefined, 'PlivoWebhook');
        res.set('Content-Type', 'text/xml');
        return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
      }

      // Fetch master agent
      let [masterAgent] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, masterAgentId))
        .limit(1);

      if (!masterAgent) {
        logger.error(`[Master Agent IVR] Master agent not found: ${masterAgentId}`, undefined, 'PlivoWebhook');
        res.set('Content-Type', 'text/xml');
        return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Speak voice="Polly.Joanna" language="en-US">Configuration error. Goodbye.</Speak><Hangup/></Response>`);
      }

      const masterTts = getPlivoTtsVoiceAndLang(masterAgent.language);
      const routes = ((masterAgent as any).masterAgentRoutes || (masterAgent.config as any)?.masterAgentRoutes || []) as Array<{ digit: string; label: string; targetAgentId: string }>;
      
      const cleanDigit = (Digits || '').toString().trim();
      let matchedRoute = (cleanDigit && cleanDigit !== 'timeout') ? routes.find(r => r.digit?.toString().trim() === cleanDigit) : null;

      let targetAgentId = matchedRoute?.targetAgentId || (masterAgent as any).masterAgentFallbackAgentId || (masterAgent.config as any)?.masterAgentFallbackAgentId;

      if (!targetAgentId) {
        logger.warn(`[Master Agent IVR] No route found for digit "${cleanDigit}" and no fallback agent configured`, undefined, 'PlivoWebhook');
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
            elevenLabsVoiceId: row.tts_voice,
            llmModel: row.llm_model || 'gpt-4o-mini',
            language: row.language || 'en',
            telephonyProvider: 'plivo'
          } as any;
        }
      }

      if (!subAgent) {
        logger.error(`[Master Agent IVR] Sub-agent ${targetAgentId} not found`, undefined, 'PlivoWebhook');
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

      if (!user || user.credits < 1) {
        logger.error(`[Master Agent IVR] User has insufficient credits`, undefined, 'PlivoWebhook');
        const credMsg = masterAgent.language === 'hi' ? "Seva filhal uplabdh nahi hai. Alvida." : "Service temporarily unavailable. Goodbye.";
        res.set('Content-Type', 'text/xml');
        return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Speak voice="${masterTts.voice}" language="${masterTts.language}">${escapeXml(credMsg)}</Speak><Hangup/></Response>`);
      }

      // Normalize phone numbers
      const normalizedTo = (To || '').toString().trim().replace(/^\+/, '');
      const normalizedFrom = (From || '').toString().trim().replace(/^\+/, '');

      // Reserve OpenAI slot
      const tier = OpenAIPoolService.getModelTierForUser(user.planType);
      const openaiCredential = await OpenAIPoolService.reserveSlot(tier);

      if (!openaiCredential) {
        logger.error(`[Master Agent IVR] No OpenAI capacity available`, undefined, 'PlivoWebhook');
        const busyMsg = masterAgent.language === 'hi' ? "Hamari sabhi line vyast hain. Kripya thodi der baad prayas karein." : "We are experiencing high demand. Please try again later.";
        res.set('Content-Type', 'text/xml');
        return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Speak voice="${masterTts.voice}" language="${masterTts.language}">${escapeXml(busyMsg)}</Speak><Hangup/></Response>`);
      }

      // Connect to Sub-Agent:
      // If callRecordId exists (outbound campaign call), update the existing call record!
      if (callRecordId) {
        const [existingCall] = await db.select().from(plivoCalls).where(eq(plivoCalls.id, callRecordId)).limit(1);
        const currentMeta = (existingCall?.metadata as Record<string, any>) || {};
        const updatedMeta = {
          ...currentMeta,
          systemPrompt: subAgent.systemPrompt,
          firstMessage: subAgent.firstMessage,
          subAgentName: subAgent.name,
          subAgentId: subAgent.id
        };

        await db.update(plivoCalls)
          .set({
            agentId: subAgent.id,
            plivoCallUuid: CallUUID,
            openaiCredentialId: openaiCredential.id,
            openaiVoice: normalizeVoiceForRealtime(subAgent.openaiVoice || (subAgent as any).tts_voice || subAgent.elevenLabsVoiceId),
            openaiModel: normalizeModelForRealtime(subAgent.llmModel || (subAgent as any).openaiModel),
            metadata: updatedMeta,
          })
          .where(eq(plivoCalls.id, callRecordId));
        logger.info(`✅ [Master Agent IVR Outbound] Switched outbound call ${callRecordId} (${CallUUID}) to Sub-Agent "${subAgent.name}" (${subAgent.id})`, undefined, 'PlivoWebhook');
      } else {
        // Inbound call - create incoming call record
        try {
          await PlivoCallService.createIncomingCall({
            fromNumber: normalizedFrom,
            toNumber: normalizedTo,
            plivoCallUuid: CallUUID,
            agentId: subAgent.id,
            plivoPhoneNumberId: phoneNumberId || undefined,
            userId: subAgent.userId,
            openaiCredentialId: openaiCredential.id,
            voice: normalizeVoiceForRealtime(subAgent.openaiVoice || (subAgent as any).tts_voice || subAgent.elevenLabsVoiceId),
            model: normalizeModelForRealtime(subAgent.llmModel || (subAgent as any).openaiModel),
            systemPrompt: subAgent.systemPrompt,
            firstMessage: subAgent.firstMessage,
          });
          logger.info(`✅ [Master Agent IVR Inbound] Call ${CallUUID} successfully connected to Sub-Agent "${subAgent.name}" (${subAgent.id})`, undefined, 'PlivoWebhook');
        } catch (createError: any) {
          await OpenAIPoolService.releaseSlot(openaiCredential.id);
          throw createError;
        }
      }

      const streamUrl = getStreamUrl(baseUrl, CallUUID);
      const deptLabel = matchedRoute?.label || subAgent.name;
      const subTts = getPlivoTtsVoiceAndLang(subAgent.language);
      const transferMessage = subAgent.language === 'hi'
        ? `Aapko ${deptLabel} se joda ja raha hai...`
        : `Connecting you to ${deptLabel}...`;
      const safeTransferMessage = escapeXml(transferMessage);

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak voice="${subTts.voice}" language="${subTts.language}">${safeTransferMessage}</Speak>
  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-mulaw;rate=8000">
    ${streamUrl}
  </Stream>
</Response>`;

      res.set('Content-Type', 'text/xml');
      res.send(xml);
    } catch (error: any) {
      logger.error(`[Master Agent IVR] Selection error: ${error.message}`, error, 'PlivoWebhook');
      res.set('Content-Type', 'text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Speak voice="Polly.Joanna" language="en-US">An error occurred. Goodbye.</Speak><Hangup/></Response>`);
    }
  });

  logger.info('Plivo webhook routes registered', undefined, 'PlivoWebhook');
}
