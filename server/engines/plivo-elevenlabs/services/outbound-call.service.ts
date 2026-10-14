'use strict';
/**
 * ============================================================
 * Plivo-ElevenLabs Outbound Call Service
 * 
 * Handles outbound calls via Plivo SIP trunk to ElevenLabs.
 * Creates the ElevenLabs bridge session BEFORE initiating the Plivo call
 * to ensure audio streaming works correctly.
 * ============================================================
 */

import { ElevenLabsBridgeService, CreateBridgeSessionParams } from './elevenlabs-bridge.service';
import { getSipWebhookUrl } from '../config/config';
import { db } from '../../../db';
import { plivoCalls, plivoCredentials, agents, type InsertPlivoCall } from '@shared/schema';
import { eq, and, sql } from 'drizzle-orm';

export interface OutboundCallParams {
  toNumber: string;
  fromNumber: string;
  agentId: string;
  elevenLabsApiKey: string;
  agentConfig?: {
    agentId: string;
    firstMessage?: string;
    language?: string;
    voiceId?: string;
    dynamicData?: Record<string, string>;
  };
  plivoAuthId: string;
  plivoAuthToken: string;
  // Tracking fields - required for billing & call records.
  // dbAgentId is the local agents.id (FK), distinct from agentId which may be
  // the ElevenLabs agent id passed to the bridge.
  userId?: string;
  dbAgentId?: string;
  campaignId?: string;
  contactId?: string;
  plivoPhoneNumberId?: string;
}

export interface OutboundCallResult {
  success: boolean;
  callUuid?: string;
  internalId?: string;
  callRecordId?: string;
  error?: string;
}

export class PlivoElevenLabsOutboundService {
  
  /**
   * Initiate an outbound call
   * 
   * IMPORTANT: Creates ElevenLabs bridge session BEFORE calling Plivo
   * to ensure session exists when stream connects.
   */
  static async makeCall(params: OutboundCallParams): Promise<OutboundCallResult> {
    const {
      toNumber,
      fromNumber,
      agentId,
      elevenLabsApiKey,
      agentConfig,
      plivoAuthId,
      plivoAuthToken,
    } = params;
    
    const callUuid = `plivo-el-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    console.log(`[Plivo-ElevenLabs Outbound] Initiating call ${callUuid} to ${toNumber}`);
    
    // Insert the call record FIRST (before dialing Plivo). This avoids a race
    // where Plivo's terminal status webhook arrives before our INSERT commits.
    // We store the synthetic `callUuid` in metadata.internalId; the real
    // Plivo-assigned CallUUID is written into the plivo_call_uuid column when
    // the /voice/:callId answer webhook fires, so /voice/status can find the
    // row by Plivo's CallUUID (the only identifier the status webhook has).
    let callRecordId: string | undefined;
    try {
      const insertValues: InsertPlivoCall = {
        userId: params.userId ?? null,
        campaignId: params.campaignId ?? null,
        contactId: params.contactId ?? null,
        agentId: params.dbAgentId ?? null,
        plivoPhoneNumberId: params.plivoPhoneNumberId ?? null,
        plivoCallUuid: null,
        fromNumber,
        toNumber,
        status: 'initiated',
        callDirection: 'outbound',
        startedAt: new Date(),
        metadata: { engine: 'plivo-elevenlabs', internalId: callUuid },
      };
      const [row] = await db.insert(plivoCalls).values(insertValues).returning({ id: plivoCalls.id });
      callRecordId = row?.id;
    } catch (dbErr: any) {
      console.error(`[Plivo-ElevenLabs Outbound] Failed to insert call record for ${callUuid}:`, dbErr?.message || dbErr);
    }

    let finalFromNumber = fromNumber;
    if (!finalFromNumber || finalFromNumber.includes('12495010039') || finalFromNumber.startsWith('+1249')) {
      const [activePlivo] = await db.select().from(plivoPhoneNumbers).where(eq(plivoPhoneNumbers.status, 'active')).limit(1);
      if (activePlivo) {
        finalFromNumber = activePlivo.phoneNumber;
      }
    }
    if (finalFromNumber && !finalFromNumber.startsWith('+')) {
      finalFromNumber = '+' + finalFromNumber;
    }

    try {
      let transferPhoneNumber: string | undefined;
      let transferEnabled: boolean | undefined;
      const finalAgentConfig: any = { ...(agentConfig || {}) };

      if (params.dbAgentId) {
        try {
          const [agentRow] = await db
            .select({
              transferPhoneNumber: agents.transferPhoneNumber,
              transferEnabled: agents.transferEnabled,
              backgroundSound: agents.backgroundSound,
            })
            .from(agents)
            .where(eq(agents.id, params.dbAgentId))
            .limit(1);
          if (agentRow?.transferPhoneNumber) {
            transferPhoneNumber = agentRow.transferPhoneNumber;
            transferEnabled = agentRow.transferEnabled ?? true;
          }
          if (agentRow?.backgroundSound !== undefined && finalAgentConfig.backgroundSound === undefined) {
            finalAgentConfig.backgroundSound = agentRow.backgroundSound;
          }
        } catch (_) {}
      } else if (agentConfig?.agentId || agentId) {
        const targetAgentId = agentConfig?.agentId || agentId;
        try {
          const [agentRow] = await db
            .select({
              id: agents.id,
              transferPhoneNumber: agents.transferPhoneNumber,
              transferEnabled: agents.transferEnabled,
              backgroundSound: agents.backgroundSound,
            })
            .from(agents)
            .where(eq(agents.elevenLabsAgentId, targetAgentId))
            .limit(1);
          if (agentRow) {
            params.dbAgentId = agentRow.id;
            if (agentRow.transferPhoneNumber) {
              transferPhoneNumber = agentRow.transferPhoneNumber;
              transferEnabled = agentRow.transferEnabled ?? true;
            }
            if (agentRow.backgroundSound !== undefined && finalAgentConfig.backgroundSound === undefined) {
              finalAgentConfig.backgroundSound = agentRow.backgroundSound;
            }
          }
        } catch (_) {}
      }

      const sessionParams: CreateBridgeSessionParams = {
        callUuid,
        agentId: finalAgentConfig?.agentId || agentId,
        elevenLabsApiKey,
        agentConfig: finalAgentConfig,
        fromNumber: finalFromNumber,
        toNumber,
        direction: 'outbound',
        dbAgentId: params.dbAgentId,
        transferPhoneNumber,
        transferEnabled,
      };
      
      await ElevenLabsBridgeService.createSession(sessionParams);
      console.log(`[Plivo-ElevenLabs Outbound] Bridge session created for ${callUuid}`);
      
      const answerUrl = getSipWebhookUrl(`/voice/${callUuid}`);
      const statusUrl = getSipWebhookUrl(`/voice/status?internalId=${encodeURIComponent(callUuid)}`);
      const recordingCallbackUrl = getSipWebhookUrl('/recording/callback');
      
      const plivoClient = await this.getPlivoClient(plivoAuthId, plivoAuthToken);
      
      const response = await plivoClient.calls.create(
        finalFromNumber,
        toNumber,
        answerUrl,
        {
          answerMethod: 'POST',
          hangupUrl: statusUrl,
          hangupMethod: 'POST',
          callbackUrl: statusUrl,
          callbackMethod: 'POST',
        }
      );

      console.log(`[Plivo-ElevenLabs Outbound] Plivo call initiated: ${response.requestUuid}`);

      if (callRecordId && response?.requestUuid) {
        await db
          .update(plivoCalls)
          .set({ 
            plivoCallUuid: response.requestUuid,
            metadata: sql`COALESCE(${plivoCalls.metadata}, '{}'::jsonb) || ${JSON.stringify({ requestUuid: response.requestUuid, internalId: callUuid })}::jsonb`
          })
          .where(eq(plivoCalls.id, callRecordId))
          .catch((err: any) => console.error('[Plivo-ElevenLabs Outbound] Failed to update requestUuid:', err));
      }

      return {
        success: true,
        callUuid: response.requestUuid || callUuid,
        internalId: callUuid,
        callRecordId,
      };
      
    } catch (error: any) {
      console.error(`[Plivo-ElevenLabs Outbound] Call failed:`, error.message);
      
      await ElevenLabsBridgeService.endSession(callUuid);
      
      return {
        success: false,
        error: error.message,
      };
    }
  }
  
  /**
   * Get Plivo client instance with fallbacks
   */
  private static async getPlivoClient(authId?: string, authToken?: string): Promise<any> {
    let finalAuthId = authId || process.env.PLIVO_AUTH_ID;
    let finalAuthToken = authToken || process.env.PLIVO_AUTH_TOKEN;

    if (!finalAuthId || !finalAuthToken) {
      try {
        const [primaryCred] = await db
          .select()
          .from(plivoCredentials)
          .where(and(eq(plivoCredentials.isPrimary, true), eq(plivoCredentials.isActive, true)))
          .limit(1);
        if (primaryCred) {
          finalAuthId = primaryCred.authId;
          finalAuthToken = primaryCred.authToken;
        } else {
          const [anyCred] = await db
            .select()
            .from(plivoCredentials)
            .where(eq(plivoCredentials.isActive, true))
            .limit(1);
          if (anyCred) {
            finalAuthId = anyCred.authId;
            finalAuthToken = anyCred.authToken;
          }
        }
      } catch (err) {
        console.error('[Plivo-ElevenLabs Outbound] Error fetching Plivo credentials from DB:', err);
      }
    }

    if (!finalAuthId || !finalAuthToken) {
      throw new Error("Plivo credentials not found. Please configure Plivo credentials in settings.");
    }

    const plivo = await import('plivo');
    return new plivo.Client(finalAuthId, finalAuthToken);
  }
}
