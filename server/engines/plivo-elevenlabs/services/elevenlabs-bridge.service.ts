'use strict';
/**
 * ============================================================
 * ElevenLabs Bridge Service (Plivo-ElevenLabs Engine)
 * 
 * Bridges audio between Plivo SIP trunk and ElevenLabs Conversational AI.
 * This is ISOLATED from the Twilio+ElevenLabs and Plivo+OpenAI integrations.
 * 
 * Session keys are namespaced with "plivo-elevenlabs:" prefix to avoid
 * collisions with other engines.
 * 
 * Flow:
 * 1. Plivo calls → Incoming webhook creates bridge session
 * 2. Plivo connects stream WebSocket
 * 3. Audio bridge converts and forwards audio bidirectionally
 * ============================================================
 */

import WebSocket from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import { AudioConverter } from './audio-converter';
import type { CallSession, TranscriptPart, ElevenLabsAgentConfig, ElevenLabsWebSocketMessage } from '../types';
import { PlivoElevenLabsConfig } from '../config/config';
import { logger } from '../../../utils/logger';

import { db } from '../../../db';
import { plivoCalls, calls, agents, plivoCredentials } from '@shared/schema';
import { eq, or, sql } from 'drizzle-orm';
import { syncAgentBackgroundSoundInElevenLabs } from '../../../services/elevenlabs';

const SESSION_PREFIX = 'plivo-elevenlabs:';
const SESSION_MAX_AGE_MS = 15 * 60 * 1000;
const SESSION_CLEANUP_INTERVAL_MS = 60 * 1000;

export interface CreateBridgeSessionParams {
  callUuid: string;
  agentId: string;
  elevenLabsApiKey: string;
  agentConfig?: ElevenLabsAgentConfig;
  fromNumber: string;
  toNumber: string;
  direction: 'inbound' | 'outbound';
  dbAgentId?: string;
  transferPhoneNumber?: string;
  transferEnabled?: boolean;
}

export class ElevenLabsBridgeService {
  private static activeSessions: Map<string, CallSession> = new Map();
  private static cleanupTimer: ReturnType<typeof setInterval> | null = null;
  
  private static getSessionKey(callUuid: string): string {
    return `${SESSION_PREFIX}${callUuid}`;
  }
  
  private static ensureCleanupTimer(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      this.cleanupStaleSessions();
    }, SESSION_CLEANUP_INTERVAL_MS);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }
  
  private static cleanupStaleSessions(): void {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, session] of Array.from(this.activeSessions.entries())) {
      const age = now - session.startedAt.getTime();
      const isOutboundUnconnected = session.direction === 'outbound' && !session.plivoWs && age > 75 * 1000;
      const isOverMaxAge = age > SESSION_MAX_AGE_MS;

      if (isOutboundUnconnected || isOverMaxAge) {
        logger.warn(`Cleaning up stale session ${key} (age: ${Math.round(age / 1000)}s, unconnected: ${isOutboundUnconnected})`, undefined, 'PlivoElevenLabsBridge');
        if (session.elevenLabsWs) {
          try {
            const readyState = (session.elevenLabsWs as any).readyState;
            if (readyState === WebSocket.OPEN || readyState === WebSocket.CONNECTING) {
              (session.elevenLabsWs as any).close();
            }
          } catch (e) {}
        }
        if (session.plivoWs) {
          try {
            if ((session.plivoWs as any).readyState === WebSocket.OPEN) {
              (session.plivoWs as any).close();
            }
          } catch (e) {}
        }
        this.activeSessions.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} stale sessions, ${this.activeSessions.size} remaining`, undefined, 'PlivoElevenLabsBridge');
    }
  }
  
  /**
   * Create a new bridge session between Plivo and ElevenLabs
   */
  static async createSession(params: CreateBridgeSessionParams): Promise<CallSession> {
    const { callUuid, agentId, elevenLabsApiKey, agentConfig, fromNumber, toNumber, direction } = params;
    
    this.ensureCleanupTimer();
    
    const sessionKey = this.getSessionKey(callUuid);
    
    logger.info(`Creating session ${sessionKey}`, undefined, 'PlivoElevenLabsBridge');
    logger.info(`Agent ID: ${agentId}`, undefined, 'PlivoElevenLabsBridge');
    
    const session: CallSession = {
      callUuid,
      streamSid: '',
      elevenLabsWs: null,
      plivoWs: null,
      status: 'connecting',
      startedAt: new Date(),
      endedAt: null,
      agentId,
      fromNumber,
      toNumber,
      direction,
      transcript: [],
      initialAudioQueue: [],
      isPlivoReady: false,
      dbAgentId: params.dbAgentId,
      transferPhoneNumber: params.transferPhoneNumber || params.agentConfig?.transferPhoneNumber,
      transferEnabled: params.transferEnabled ?? params.agentConfig?.transferEnabled,
      backgroundSound: params.agentConfig?.backgroundSound,
      backgroundNoiseCancellation: params.agentConfig?.backgroundNoiseCancellation,
    };

    // Resolve background sound & noise cancellation dynamically for this agent (per call)
    let bgSoundKey = params.agentConfig?.backgroundSound !== undefined ? params.agentConfig.backgroundSound : session.backgroundSound;
    let noiseCancellation = params.agentConfig?.backgroundNoiseCancellation !== undefined ? params.agentConfig.backgroundNoiseCancellation : true;

    if (session.dbAgentId) {
      try {
        const [dbAgent] = await db
          .select({ 
            backgroundSound: agents.backgroundSound,
            backgroundNoiseCancellation: agents.backgroundNoiseCancellation 
          })
          .from(agents)
          .where(eq(agents.id, session.dbAgentId))
          .limit(1);
        if (dbAgent) {
          if (dbAgent.backgroundSound !== undefined) bgSoundKey = dbAgent.backgroundSound;
          if (dbAgent.backgroundNoiseCancellation !== null && dbAgent.backgroundNoiseCancellation !== undefined) {
            noiseCancellation = dbAgent.backgroundNoiseCancellation;
          }
        }
      } catch (_) {}
    }
    if (session.agentId) {
      try {
        const [dbAgent] = await db
          .select({ 
            backgroundSound: agents.backgroundSound,
            backgroundNoiseCancellation: agents.backgroundNoiseCancellation 
          })
          .from(agents)
          .where(eq(agents.elevenLabsAgentId, session.agentId))
          .limit(1);
        if (dbAgent) {
          if (bgSoundKey === undefined || bgSoundKey === null) bgSoundKey = dbAgent.backgroundSound;
          if (dbAgent.backgroundNoiseCancellation !== null && dbAgent.backgroundNoiseCancellation !== undefined) {
            noiseCancellation = dbAgent.backgroundNoiseCancellation;
          }
        }
      } catch (_) {}
    }
    session.backgroundSound = bgSoundKey;
    session.backgroundNoiseCancellation = noiseCancellation;

    // Guaranteed REST sync to ElevenLabs ConvAI agent BEFORE connecting WebSocket
    if (elevenLabsApiKey && session.agentId) {
      try {
        await syncAgentBackgroundSoundInElevenLabs(session.agentId, elevenLabsApiKey, bgSoundKey, noiseCancellation);
        // Ensure turn_timeout is 30s, natural speed, and eager turn responsiveness on ElevenLabs
        fetch(`https://api.elevenlabs.io/v1/convai/agents/${session.agentId}`, {
          method: 'PATCH',
          headers: {
            'xi-api-key': elevenLabsApiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            conversation_config: {
              tts: { speed: 1.30 },
              agent: { disable_first_message_interruptions: false },
              turn: { mode: "turn", turn_eagerness: "eager", turn_timeout: 30 },
              // vad: { background_voice_detection: true } // Commented out as requested - Plivo telecom noise cancellation handles line cleanly without dropping user speech
            }
          })
        }).catch(() => {});
      } catch (syncErr: any) {
        logger.warn(`Failed background sound / noise filter REST sync: ${syncErr.message}`, undefined, 'PlivoElevenLabsBridge');
      }
    }
    
    this.activeSessions.set(sessionKey, session);
    
    try {
      await this.connectToElevenLabs(session, elevenLabsApiKey, agentConfig);

      // Safety guard for outbound calls: if Plivo audio stream never connects within 60s
      // (e.g. user rejected, telecom busy/failed, or webhook dropped), force terminate
      // the ElevenLabs WebSocket to prevent credit drain on ghost calls.
      if (direction === 'outbound') {
        const safetyTimeout = setTimeout(() => {
          const currentSession = this.activeSessions.get(sessionKey);
          if (currentSession && !currentSession.plivoWs && currentSession.status !== 'disconnected') {
            logger.warn(`[Plivo-ElevenLabsBridge] Safety timeout (60s) reached for outbound call ${callUuid} without media connection. Force closing ElevenLabs session to save credits.`, undefined, 'PlivoElevenLabsBridge');
            ElevenLabsBridgeService.endSession(callUuid).catch(err => logger.error(`Error in safety timeout cleanup: ${err?.message || err}`, undefined, 'PlivoElevenLabsBridge'));
          }
        }, 60000);
        if ((safetyTimeout as any).unref) {
          (safetyTimeout as any).unref();
        }
      }

      return session;
    } catch (error: any) {
      logger.error('Failed to create session', error.message, 'PlivoElevenLabsBridge');
      session.status = 'error';
      this.activeSessions.delete(sessionKey);
      throw error;
    }
  }
  
  /**
   * Connect to ElevenLabs WebSocket
   */
  private static async connectToElevenLabs(
    session: CallSession,
    apiKey: string,
    agentConfig?: ElevenLabsAgentConfig
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const agentId = agentConfig?.agentId || session.agentId;
      const wsUrl = `${PlivoElevenLabsConfig.elevenLabsWebSocketUrl}?agent_id=${agentId}`;
      
      logger.info(`Connecting to ElevenLabs: agent=${agentId}`, undefined, 'PlivoElevenLabsBridge');
      
      const ws = new WebSocket(wsUrl, {
        headers: {
          'xi-api-key': apiKey,
        },
      });
      
      session.elevenLabsWs = ws as any;
      
      ws.on('open', async () => {
        logger.info(`ElevenLabs WebSocket connected for ${session.callUuid}`, undefined, 'PlivoElevenLabsBridge');
        session.status = 'connected';
        
        const initMessage: any = {
          type: 'conversation_initiation_client_data',
        };
        
        const configOverride: any = {};
        const agentOverride: any = {};

        // NOTE: ElevenLabs agents already have their first_message, prompt, and language configured on ElevenLabs.
        // Sending first_message, prompt, or language in conversation_config_override causes ElevenLabs to reject the
        // WebSocket connection with "Override for field 'first_message' is not allowed by config" unless specifically whitelisted.
        // Per-call customizations (name, property, city, budget) are cleanly handled via dynamic_variables below.
        if (agentConfig?.allowOverrides) {
          if (agentConfig?.firstMessage) {
            agentOverride.first_message = agentConfig.firstMessage;
          }
          if (agentConfig?.systemPrompt) {
            agentOverride.prompt = { prompt: agentConfig.systemPrompt };
          }
          if (agentConfig?.language) {
            agentOverride.language = agentConfig.language;
          }
        }

        const conversationOverride: any = {};

        // Resolve background sound dynamically for this agent (per call)
        let bgSoundKey = agentConfig?.backgroundSound !== undefined ? agentConfig.backgroundSound : session.backgroundSound;
        if ((bgSoundKey === undefined || bgSoundKey === null) && session.dbAgentId) {
          try {
            const [dbAgent] = await db
              .select({ backgroundSound: agents.backgroundSound })
              .from(agents)
              .where(eq(agents.id, session.dbAgentId))
              .limit(1);
            if (dbAgent) {
              bgSoundKey = dbAgent.backgroundSound;
            }
          } catch (e: any) {
            logger.warn(`Failed to read backgroundSound from DB for agent ${session.dbAgentId}: ${e.message}`, undefined, 'PlivoElevenLabsBridge');
          }
        }

        if ((bgSoundKey === undefined || bgSoundKey === null) && session.agentId) {
          try {
            const [dbAgent] = await db
              .select({ backgroundSound: agents.backgroundSound })
              .from(agents)
              .where(eq(agents.elevenLabsAgentId, session.agentId))
              .limit(1);
            if (dbAgent) {
              bgSoundKey = dbAgent.backgroundSound;
            }
          } catch (e: any) {
            logger.warn(`Failed to read backgroundSound by elevenLabsAgentId ${session.agentId}: ${e.message}`, undefined, 'PlivoElevenLabsBridge');
          }
        }

        if (bgSoundKey && bgSoundKey !== 'none' && bgSoundKey !== '') {
          const presetMap: Record<string, string> = {
            office: 'office1',
            keyboard: 'typing',
            cafe: 'restaurant',
            city: 'city',
          };
          const sourceId = presetMap[bgSoundKey] || bgSoundKey;
          conversationOverride.background_sound = {
            source_type: 'preset',
            source_id: sourceId,
            volume: 0.35,
            crossfade_loop: true,
          };
          logger.info(`Applying dynamic ElevenLabs background sound override: "${bgSoundKey}" (${sourceId}) with volume 0.35`, undefined, 'PlivoElevenLabsBridge');
        } else if (bgSoundKey === 'none' || bgSoundKey === '' || bgSoundKey === null) {
          conversationOverride.background_sound = null;
          logger.info(`Disabling ElevenLabs background sound for call (none/disabled)`, undefined, 'PlivoElevenLabsBridge');
        }

        const shouldFilterNoise = session.backgroundNoiseCancellation !== false;
        if (shouldFilterNoise && agentOverride.prompt?.prompt) {
          const noisePromptRule = `\n\n[SPEAKER & NOISE GUARD]: Ignore ambient background noise, chatter, TV/media sounds, or secondary voices in the room. Strictly listen and respond only to direct speech addressed to you by the primary caller.`;
          if (!agentOverride.prompt.prompt.includes('[SPEAKER & NOISE GUARD]')) {
            agentOverride.prompt.prompt += noisePromptRule;
          }
        }

        const voicemailPromptRule = `\n\n[VOICEMAIL & OPERATOR DETECTION RULE]:\nIf you hear an automated voicemail greeting, IVR carrier announcement, or answering machine (e.g. "please leave a message after the tone", "forwarded to voicemail", "the person you are calling is unavailable", "aapka dial kiya gaya number vyast hai, kripya baad mein call karein", "switched off"), IMMEDIATELY stop speaking and invoke end_call with reason "voicemail_detected". Never talk to answering machines or leave voice messages.`;
        if (agentOverride.prompt?.prompt && !agentOverride.prompt.prompt.includes('[VOICEMAIL & OPERATOR DETECTION RULE]')) {
          agentOverride.prompt.prompt += voicemailPromptRule;
        }

        // Allow user interruptions right from the first message
        agentOverride.disable_first_message_interruptions = false;

        if (Object.keys(agentOverride).length > 0) {
          configOverride.agent = agentOverride;
        }
        if (Object.keys(conversationOverride).length > 0) {
          configOverride.conversation = conversationOverride;
        }
        // Use eager turn-taking for snappy human-like response latency without delayed silence waiting
        configOverride.turn = { turn_eagerness: "eager" };
        configOverride.tts = { speed: 1.30 };
        // Background voice detection commented out as requested - Plivo telecom noise cancellation handles line cleanly without dropping user speech
        // if (shouldFilterNoise) {
        //   configOverride.vad = { background_voice_detection: true };
        // }
        if (Object.keys(configOverride).length > 0) {
          initMessage.conversation_config_override = configOverride;
        }
        
        // Pass dynamic_variables if provided (e.g. company_name, name, phone)
        const dynamicVars = agentConfig?.dynamicData || {};
        if (Object.keys(dynamicVars).length > 0) {
          initMessage.dynamic_variables = dynamicVars;
          logger.info(`Sending dynamic_variables with ${Object.keys(dynamicVars).length} variables`, undefined, 'PlivoElevenLabsBridge');
        }
        
        ws.send(JSON.stringify(initMessage));
        resolve();
      });
      
      ws.on('message', (data) => {
        this.handleElevenLabsMessage(session, data.toString());
      });
      
      ws.on('error', (error) => {
        logger.error('ElevenLabs WebSocket error', error, 'PlivoElevenLabsBridge');
        session.status = 'error';
        reject(error);
      });
      
      ws.on('close', (code, reason) => {
        logger.info(`ElevenLabs WebSocket closed: ${code} ${reason?.toString() || ''}`, undefined, 'PlivoElevenLabsBridge');
        session.status = 'disconnected';
        session.endedAt = new Date();
      });
      
      setTimeout(() => {
        if (session.status === 'connecting') {
          reject(new Error('ElevenLabs WebSocket connection timeout'));
        }
      }, PlivoElevenLabsConfig.defaults.connectionTimeout);
    });
  }
  
  /**
   * Handle messages from ElevenLabs
   */
  private static handleElevenLabsMessage(session: CallSession, data: string): void {
    try {
      const message: ElevenLabsWebSocketMessage = JSON.parse(data);
      
      switch (message.type) {
        case 'conversation_initiation_metadata':
          session.conversationId = (message as any).conversation_initiation_metadata_event?.conversation_id || message.conversation_id;
          logger.info(`Conversation started: ${session.conversationId}`, undefined, 'PlivoElevenLabsBridge');
          if (session.conversationId && session.callUuid) {
            db.update(plivoCalls)
              .set({
                metadata: sql`COALESCE(${plivoCalls.metadata}, '{}'::jsonb) || ${JSON.stringify({
                  conversationId: session.conversationId,
                  elevenLabsConversationId: session.conversationId,
                })}::jsonb`,
              })
              .where(or(
                eq(plivoCalls.plivoCallUuid, session.callUuid),
                eq(plivoCalls.id, session.callUuid),
                sql`${plivoCalls.metadata}->>'internalId' = ${session.callUuid}`
              ))
              .catch(err => logger.warn(`Failed to store conversationId: ${err?.message || err}`, undefined, 'PlivoElevenLabsBridge'));
          }
          break;
          
        case 'audio':
          const audioChunk = (message as any).audio_event?.audio_base_64 || message.audio?.chunk;
          if (audioChunk) {
            const pcmBuffer = AudioConverter.decodeBase64(audioChunk);
            const mulawBuffer = AudioConverter.pcm16ToMulaw(pcmBuffer);
            const mulawBase64 = AudioConverter.encodeBase64(mulawBuffer);
            
            if (!session.isPlivoReady || !session.plivoWs || (session.plivoWs as any).readyState !== WebSocket.OPEN) {
              if (!session.initialAudioQueue) session.initialAudioQueue = [];
              if (session.initialAudioQueue.length < 100) {
                session.initialAudioQueue.push(mulawBase64);
              }
            } else {
              this.sendToPlivoStream(session, mulawBase64);
            }
          }
          break;

        case 'interruption':
        case 'agent_interruption':
          logger.info(`🛑 [PlivoElevenLabsBridge] User interruption detected, clearing Plivo audio playback`, undefined, 'PlivoElevenLabsBridge');
          session.initialAudioQueue = [];
          this.clearPlivoBuffer(session);
          break;
          
        case 'user_transcript':
          // Immediate barge-in cutoff: as soon as caller speaks, flush Plivo queued audio so agent stops talking over user
          session.initialAudioQueue = [];
          this.clearPlivoBuffer(session);
          const userText = (message as any).user_transcription_event?.user_transcript || message.user_transcript?.text;
          const isUserFinal = (message as any).user_transcription_event?.is_final ?? message.user_transcript?.is_final ?? true;
          if (userText) {
            if (isUserFinal) {
              session.transcript.push({
                role: 'user',
                text: userText,
                timestamp: new Date(),
              });
              logger.info(`User: "${userText.substring(0, 80)}..."`, undefined, 'PlivoElevenLabsBridge');
            }

            // Voicemail & Answering Machine Interceptor (Within first 35s of call)
            const callDurationSec = (Date.now() - session.startedAt.getTime()) / 1000;
            if (callDurationSec <= 35 && this.isVoicemailOrAnsweringMachine(userText)) {
              logger.warn(`[Voicemail Interceptor] Voicemail detected on Plivo+ElevenLabs call ${session.callUuid}: "${userText}". Terminating call immediately!`, undefined, 'PlivoElevenLabsBridge');
              this.handleVoicemailDetected(session, userText).catch(err => {
                logger.error(`Error in handleVoicemailDetected: ${err?.message || err}`, undefined, 'PlivoElevenLabsBridge');
              });
              return;
            }

            // Call Transfer Interceptor: If user requests to speak with human / transfer
            if (this.isTransferRequest(userText)) {
              logger.info(`[Transfer Interceptor] Transfer request detected in transcript for ${session.callUuid}: "${userText}"`, undefined, 'PlivoElevenLabsBridge');
              this.handleCallTransfer(session).catch(err => {
                logger.error(`Error in handleCallTransfer: ${err?.message || err}`, undefined, 'PlivoElevenLabsBridge');
              });
            }
          }
          break;
          
        case 'client_tool_call':
          const toolCall = (message as any).client_tool_call || (message as any).client_tool_call_event;
          if (toolCall) {
            const toolName = toolCall.tool_name || toolCall.name;
            const toolCallId = toolCall.tool_call_id;
            const params = toolCall.parameters || {};
            logger.info(`ElevenLabs client_tool_call: ${toolName}`, { toolCallId, params }, 'PlivoElevenLabsBridge');

            if (toolName === 'transfer_call' || toolName === 'transfer' || toolName.startsWith('transfer_')) {
              const targetNumber = params.destination || params.phoneNumber || params.number || session.transferPhoneNumber;
              this.handleCallTransfer(session, targetNumber).catch(err => {
                logger.error(`Error in handleCallTransfer: ${err?.message || err}`, undefined, 'PlivoElevenLabsBridge');
              });
            } else if (toolName === 'end_call' || toolName === 'hangup' || toolName === 'end_conversation') {
              const isVoicemail = params.reason === 'voicemail_detected' || params.reason === 'voicemail';
              logger.info(`[ElevenLabs Tool Call] Agent invoked ${toolName} (reason: ${params.reason || 'normal'}) for ${session.callUuid}`, undefined, 'PlivoElevenLabsBridge');
              this.handleVoicemailDetected(
                session,
                isVoicemail ? 'Agent end_call: voicemail_detected' : 'Agent end_call: call concluded'
              ).catch(err => {
                logger.error(`Error in handleVoicemailDetected from end_call: ${err?.message || err}`, undefined, 'PlivoElevenLabsBridge');
              });
            }
          }
          break;

        case 'agent_response':
          const agentText = (message as any).agent_response_event?.agent_response || message.agent_response?.text;
          const isAgentFinal = (message as any).agent_response_event?.is_final ?? message.agent_response?.is_final ?? true;
          if (agentText && isAgentFinal) {
            session.transcript.push({
              role: 'agent',
              text: agentText,
              timestamp: new Date(),
            });
            logger.info(`Agent: "${agentText.substring(0, 80)}..."`, undefined, 'PlivoElevenLabsBridge');
          }
          break;
          
        case 'ping':
          if (message.ping_event?.event_id) {
            const pongMessage = {
              type: 'pong',
              event_id: message.ping_event.event_id,
            };
            if (session.elevenLabsWs && (session.elevenLabsWs as any).readyState === WebSocket.OPEN) {
              (session.elevenLabsWs as any).send(JSON.stringify(pongMessage));
            }
          }
          break;
          
        case 'error':
          logger.error('ElevenLabs error', message.error, 'PlivoElevenLabsBridge');
          break;
          
        default:
          break;
      }
    } catch (error: any) {
      logger.error('Error handling message', error.message, 'PlivoElevenLabsBridge');
    }
  }
  
  /**
   * Send audio to Plivo stream
   */
  private static sendToPlivoStream(session: CallSession, audioBase64: string): void {
    if (!session.plivoWs || (session.plivoWs as any).readyState !== WebSocket.OPEN) {
      return;
    }
    
    const playAudioMessage = {
      event: 'playAudio',
      media: {
        contentType: 'audio/x-mulaw',
        sampleRate: 8000,
        payload: audioBase64,
      },
    };
    
    try {
      (session.plivoWs as any).send(JSON.stringify(playAudioMessage));
    } catch (e: any) {
      logger.warn(`Error sending audio to Plivo stream: ${e?.message || e}`, undefined, 'PlivoElevenLabsBridge');
    }
  }

  /**
   * Immediately clears any buffered audio playback on Plivo side for barge-in / interruptions
   */
  static clearPlivoBuffer(session: CallSession): void {
    if (!session.plivoWs || (session.plivoWs as any).readyState !== WebSocket.OPEN) {
      return;
    }
    try {
      const payloads: any[] = [];
      if (session.streamSid) {
        payloads.push({
          event: 'clearAudio',
          streamId: session.streamSid,
        });
      }
      payloads.push({ event: 'clearAudio' });

      for (const p of payloads) {
        (session.plivoWs as any).send(JSON.stringify(p));
      }
      logger.info(`[PlivoElevenLabsBridge] Sent clearAudio to Plivo (streamId: ${session.streamSid || 'none'}) for ${session.callUuid}`, undefined, 'PlivoElevenLabsBridge');
    } catch (e: any) {
      logger.warn(`Failed to send clearAudio to Plivo: ${e?.message || e}`, undefined, 'PlivoElevenLabsBridge');
    }
  }
  
  /**
   * Handle incoming audio from Plivo
   */
  static async handlePlivoAudio(callUuid: string, audioBase64: string): Promise<void> {
    const sessionKey = this.getSessionKey(callUuid);
    const session = this.activeSessions.get(sessionKey);
    
    if (!session) {
      return;
    }
    
    if (!session.elevenLabsWs || (session.elevenLabsWs as any).readyState !== WebSocket.OPEN) {
      return;
    }

    // Drop early audio if Plivo media stream is not ready/stabilized to prevent connect burst from triggering VAD
    if (!session.isPlivoReady) {
      return;
    }
    
    try {
      const mulawBuffer = AudioConverter.decodeBase64(audioBase64);
      const pcmBuffer = AudioConverter.mulawToPcm16(mulawBuffer);
      const pcmBase64 = AudioConverter.encodeBase64(pcmBuffer);
      
      const audioMessage = {
        user_audio_chunk: pcmBase64,
      };
      
      (session.elevenLabsWs as any).send(JSON.stringify(audioMessage));
    } catch (error: any) {
      logger.error('Error processing audio', error.message, 'PlivoElevenLabsBridge');
    }
  }
  
  /**
   * Set the Plivo WebSocket for a session
   */
  static setPlivoWebSocket(callUuid: string, plivoWs: WebSocket, streamSid: string): void {
    const sessionKey = this.getSessionKey(callUuid);
    const session = this.activeSessions.get(sessionKey);
    
    if (session) {
      session.plivoWs = plivoWs as any;
      session.streamSid = streamSid;
      logger.info(`Plivo WebSocket set for ${callUuid}, streamSid: ${streamSid}`, undefined, 'PlivoElevenLabsBridge');

      // Wait 450ms for Plivo RTP media bridge to stabilize on caller's phone line
      setTimeout(() => {
        session.isPlivoReady = true;

        if (session.initialAudioQueue && session.initialAudioQueue.length > 0) {
          logger.info(`Flushing ${session.initialAudioQueue.length} queued initial audio chunks to Plivo stream`, undefined, 'PlivoElevenLabsBridge');
          const queue = [...session.initialAudioQueue];
          session.initialAudioQueue = [];
          for (const mulawChunk of queue) {
            this.sendToPlivoStream(session, mulawChunk);
          }
        }
      }, 450);
    } else {
      logger.warn(`No session found for ${callUuid} when setting Plivo WebSocket`, undefined, 'PlivoElevenLabsBridge');
    }
  }
  
  /**
   * Get active session
   */
  static getSession(callUuid: string): CallSession | undefined {
    const sessionKey = this.getSessionKey(callUuid);
    return this.activeSessions.get(sessionKey);
  }
  
  /**
   * Alias a session under a secondary key (e.g. Plivo CallUUID -> synthetic callUuid)
   */
  static aliasSession(oldUuid: string, newUuid: string): void {
    if (!oldUuid || !newUuid || oldUuid === newUuid) return;
    const oldKey = this.getSessionKey(oldUuid);
    const session = this.activeSessions.get(oldKey);
    if (session) {
      const newKey = this.getSessionKey(newUuid);
      this.activeSessions.set(newKey, session);
      logger.info(`Aliased bridge session ${oldUuid} -> ${newUuid}`, undefined, 'PlivoElevenLabsBridge');
    }
  }

  /**
   * Check if a session exists
   */
  static hasSession(callUuid: string): boolean {
    const sessionKey = this.getSessionKey(callUuid);
    return this.activeSessions.has(sessionKey);
  }
  
  /**
   * End a bridge session
   */
  static async endSession(callUuid: string): Promise<{
    duration: number;
    transcript: TranscriptPart[];
    conversationId?: string;
    recordingUrl?: string;
  }> {
    if (!callUuid) {
      return { duration: 0, transcript: [] };
    }

    const sessionKey = this.getSessionKey(callUuid);
    let session = this.activeSessions.get(sessionKey);

    // Fallback 1: check direct raw key if prefix wasn't used
    if (!session) {
      session = this.activeSessions.get(callUuid);
    }

    // Fallback 2: search all active sessions by callUuid or streamSid
    if (!session) {
      for (const [key, s] of this.activeSessions.entries()) {
        if (s.callUuid === callUuid || s.streamSid === callUuid || key.includes(callUuid)) {
          session = s;
          logger.info(`Found session for ${callUuid} via active session search (key: ${key})`, undefined, 'PlivoElevenLabsBridge');
          break;
        }
      }
    }
    
    if (!session) {
      logger.warn(`No active bridge session found to end for callUuid=${callUuid}`, undefined, 'PlivoElevenLabsBridge');
      return { duration: 0, transcript: [] };
    }
    
    logger.info(`Ending session for ${callUuid} (originalCallUuid: ${session.callUuid})`, undefined, 'PlivoElevenLabsBridge');
    
    session.status = 'disconnected';
    session.endedAt = new Date();
    
    // Close ElevenLabs WS immediately
    if (session.elevenLabsWs) {
      try {
        const readyState = (session.elevenLabsWs as any).readyState;
        if (readyState === WebSocket.OPEN || readyState === WebSocket.CONNECTING) {
          (session.elevenLabsWs as any).close();
          logger.info(`Closed ElevenLabs WebSocket for ${callUuid}`, undefined, 'PlivoElevenLabsBridge');
        }
      } catch (wsErr: any) {
        logger.warn(`Error closing ElevenLabs WS: ${wsErr?.message}`, undefined, 'PlivoElevenLabsBridge');
      }
    }

    // Close Plivo WS if open
    if (session.plivoWs) {
      try {
        if ((session.plivoWs as any).readyState === WebSocket.OPEN) {
          (session.plivoWs as any).close();
          logger.info(`Closed Plivo WebSocket for ${callUuid}`, undefined, 'PlivoElevenLabsBridge');
        }
      } catch (wsErr: any) {
        logger.warn(`Error closing Plivo WS: ${wsErr?.message}`, undefined, 'PlivoElevenLabsBridge');
      }
    }
    
    const duration = Math.floor((session.endedAt.getTime() - session.startedAt.getTime()) / 1000);
    const transcript = [...session.transcript];
    const conversationId = session.conversationId;
    
    // Delete all keys referencing this session
    for (const [k, s] of Array.from(this.activeSessions.entries())) {
      if (s === session || s.callUuid === session.callUuid) {
        this.activeSessions.delete(k);
      }
    }
    
    return { duration, transcript, conversationId };
  }

  /**
   * Check if user audio transcript is an answering machine, voicemail, or IVR announcement
   */
  private static isVoicemailOrAnsweringMachine(text: string): boolean {
    if (!text) return false;
    const lower = text.toLowerCase().trim();

    // Specific English & Hindi voicemail and answering machine phrases
    const voicemailPhrases = [
      // Standard Voicemail & Answering Machine
      'leave a message',
      'leave your message',
      'leave me a message',
      'after the tone',
      'after the beep',
      'at the tone',
      'at the beep',
      'record your message',
      'record a message',
      'recording your message',
      'finished recording',
      'forwarded to voicemail',
      'forwarded to an automated voice',
      'voice mailbox',
      'voice mail',
      'voicemail',
      'answering machine',
      'mailbox is full',
      'person you are trying to reach',
      'person you have called',
      'person is unavailable',
      'currently unavailable',
      'not available right now',
      'not available to take your call',
      'unable to take your call',
      'cannot take your call',
      'cannot take your call right now',
      'cannot come to the phone',
      'can not come to the phone',
      'please call back later',
      'press 1 to leave',
      'press pound to',
      
      // iPhone Live Voicemail (iOS 17+)
      'person you\'re trying to reach is unavailable',
      'your call has been forwarded',
      'call has been forwarded to',
      'when you have finished recording',
      'you may hang up or press',
      
      // Indian Carrier Voicemail & Operator Announcements
      'kripya beep ke baad',
      'kripaya beep ke baad',
      'beep ke baad apna sandesh',
      'sandesh record karein',
      'sandesh chhoden',
      'sandesh chhodiye',
      'uttar nahi de rahe hain',
      'uttar nahi de rahi hain',
      'vyakti ko call kar rahe hain',
      'aapka dial kiya gaya number',
      'dial kiya hua number',
      'number abhi vyast hai',
      'kripya thodi der baad',
      'switched off hai',
      'pawnch se bahar hai',
      'reach se bahar hai',
    ];

    return voicemailPhrases.some(phrase => lower.includes(phrase));
  }

  /**
   * Handle voicemail detection: terminate audio, disconnect Plivo carrier line, update DB to no-answer
   */
  private static async handleVoicemailDetected(session: CallSession, transcript: string): Promise<void> {
    if (session.isEnding || session.status === 'disconnected') return;
    session.isEnding = true;

    logger.warn(`[Voicemail Interceptor] Voicemail detected on Plivo+ElevenLabs call ${session.callUuid}: "${transcript}". Triggering immediate carrier hangup!`, undefined, 'PlivoElevenLabsBridge');

    // 1. Immediately clear queued audio, close Plivo WS & ElevenLabs WS so no AI audio plays and line drops
    session.initialAudioQueue = [];
    if (session.elevenLabsWs) {
      try {
        (session.elevenLabsWs as any).close();
      } catch (_) {}
    }
    if (session.plivoWs) {
      try {
        (session.plivoWs as any).close(1000, 'Voicemail detected');
      } catch (_) {}
    }
    session.status = 'disconnected';

    // 2. Look up the call in DB to get Plivo request UUID & Plivo credentials
    try {
      const [callRow] = await db
        .select()
        .from(plivoCalls)
        .where(
          or(
            eq(plivoCalls.plivoCallUuid, session.callUuid),
            eq(plivoCalls.id, session.callUuid),
            sql`${plivoCalls.metadata}->>'internalId' = ${session.callUuid}`
          )
        )
        .limit(1);

      const targetUuid = callRow?.plivoCallUuid || (callRow?.metadata as any)?.requestUuid || session.callUuid;

      // 3. Mark DB record as no-answer with VOICEMAIL_DETECTED
      if (callRow?.id) {
        await db
          .update(plivoCalls)
          .set({
            status: 'no-answer',
            endedAt: new Date(),
            metadata: sql`COALESCE(${plivoCalls.metadata}, '{}'::jsonb) || ${JSON.stringify({
              hangupCause: 'VOICEMAIL_DETECTED',
              voicemailDetected: true,
              voicemailTranscript: transcript,
            })}::jsonb`,
          })
          .where(eq(plivoCalls.id, callRow.id))
          .catch(() => {});
      }

      // Also update calls table if present
      await db
        .update(calls)
        .set({
          status: 'no-answer',
          endedAt: new Date(),
          metadata: sql`COALESCE(${calls.metadata}, '{}'::jsonb) || ${JSON.stringify({
            hangupCause: 'VOICEMAIL_DETECTED',
            voicemailDetected: true,
            voicemailTranscript: transcript,
          })}::jsonb`,
        })
        .where(
          or(
            eq(calls.id, session.callUuid),
            sql`${calls.metadata}->>'internalId' = ${session.callUuid}`,
            sql`${calls.metadata}->>'plivoCallUuid' = ${session.callUuid}`
          )
        )
        .catch(() => {});

      // 4. Hang up via Plivo REST API if targetUuid exists and looks like a Plivo UUID
      const isPlivoUuid = targetUuid && !targetUuid.startsWith('plivo-el-');
      if (isPlivoUuid) {
        try {
          const plivo = (await import('plivo')).default || (await import('plivo'));
          // Look up active credential from plivoCredentials table
          const [cred] = await db
            .select()
            .from(plivoCredentials)
            .where(eq(plivoCredentials.isActive, true))
            .limit(1);

          const plivoAuthId = cred?.authId || process.env.PLIVO_AUTH_ID;
          const plivoAuthToken = cred?.authToken || process.env.PLIVO_AUTH_TOKEN;

          if (plivoAuthId && plivoAuthToken) {
            const client = new (plivo as any).Client(plivoAuthId, plivoAuthToken);
            await client.calls.hangup(targetUuid);
            logger.info(`[Voicemail Interceptor] Plivo carrier hangup executed for UUID ${targetUuid}`, undefined, 'PlivoElevenLabsBridge');
          }
        } catch (hangupErr: any) {
          logger.warn(`[Voicemail Interceptor] Plivo REST hangup notice: ${hangupErr?.message || hangupErr}`, undefined, 'PlivoElevenLabsBridge');
        }
      }
    } catch (e: any) {
      logger.error(`[Voicemail Interceptor] Error during voicemail hangup: ${e?.message || e}`, undefined, 'PlivoElevenLabsBridge');
    }

    // 5. Close Plivo WebSocket and end bridge session
    if (session.plivoWs) {
      try {
        (session.plivoWs as any).close();
      } catch (_) {}
    }

    await this.endSession(session.callUuid);
  }

  /**
   * Detect if user transcript indicates request to transfer to human agent / executive
   */
  private static isTransferRequest(text: string): boolean {
    if (!text) return false;
    const lower = text.toLowerCase().trim();
    const transferPhrases = [
      'transfer kar do',
      'transfer karo',
      'transfer kar dijiye',
      'transfer kardo',
      'call transfer',
      'transfer the call',
      'transfer call',
      'transfer me',
      'transfer to',
      'human se baat',
      'kisi human se',
      'real person se',
      'real human se',
      'insan se baat',
      'executive se baat',
      'executive se connect',
      'executive se mila do',
      'senior se baat',
      'senior se connect',
      'manager se baat',
      'manager se connect',
      'live agent',
      'live representative',
      'customer care',
      'customer support',
      'support agent',
      'speak to human',
      'speak to a human',
      'talk to a human',
      'speak to an agent',
      'talk to an agent',
      'speak to real person',
      'talk to a real person',
      'speak to manager',
      'talk to manager',
      'connect to agent',
      'connect to executive',
    ];
    return transferPhrases.some(phrase => lower.includes(phrase));
  }

  /**
   * Execute call transfer for Plivo + ElevenLabs
   */
  private static async handleCallTransfer(session: CallSession, targetNumberParam?: string): Promise<{ success: boolean; error?: string }> {
    if (session.status === 'disconnected' || session.isEnding) {
      logger.info(`Ignoring transfer - session ${session.callUuid} already ending/disconnected`, undefined, 'PlivoElevenLabsBridge');
      return { success: false, error: 'Session already disconnecting' };
    }

    logger.info(`[Transfer] Initiating call transfer for ${session.callUuid}`, undefined, 'PlivoElevenLabsBridge');

    // Mark session as ending so end_call or other handlers don't conflict
    session.isEnding = true;

    try {
      // 1. Resolve target transfer phone number
      let targetNumber = targetNumberParam || session.transferPhoneNumber;

      // If not in session, check DB (plivoCalls -> agents)
      if (!targetNumber) {
        const [callRow] = await db
          .select({ agentId: plivoCalls.agentId, metadata: plivoCalls.metadata })
          .from(plivoCalls)
          .where(
            or(
              eq(plivoCalls.plivoCallUuid, session.callUuid),
              eq(plivoCalls.id, session.callUuid),
              sql`${plivoCalls.metadata}->>'internalId' = ${session.callUuid}`
            )
          )
          .limit(1)
          .catch(() => []);

        const agentDbId = callRow?.agentId || session.dbAgentId || session.agentId;
        if (agentDbId) {
          const [agentRow] = await db
            .select({
              transferPhoneNumber: agents.transferPhoneNumber,
              transferEnabled: agents.transferEnabled,
              transferMessage: agents.transferMessage,
            })
            .from(agents)
            .where(or(eq(agents.id, agentDbId), eq(agents.elevenLabsAgentId, agentDbId)))
            .limit(1)
            .catch(() => []);

          if (agentRow?.transferPhoneNumber) {
            targetNumber = agentRow.transferPhoneNumber;
          }
        }
      }

      if (!targetNumber) {
        logger.warn(`[Transfer] No transfer phone number found for session ${session.callUuid}`, undefined, 'PlivoElevenLabsBridge');
        session.isEnding = false; // reset so call can continue
        return { success: false, error: 'No transfer phone number configured' };
      }

      // 2. Normalize target phone number to E.164
      let normalizedTarget = targetNumber.trim().replace(/[\s\-\(\)]/g, '');
      if (normalizedTarget.length === 10 && !normalizedTarget.startsWith('+')) {
        normalizedTarget = `+91${normalizedTarget}`;
      } else if (!normalizedTarget.startsWith('+') && normalizedTarget.startsWith('91') && normalizedTarget.length === 12) {
        normalizedTarget = `+${normalizedTarget}`;
      } else if (!normalizedTarget.startsWith('+') && !normalizedTarget.startsWith('0')) {
        normalizedTarget = `+${normalizedTarget}`;
      }

      // Determine callerId (use fromNumber if outbound, toNumber if inbound)
      let callerId = session.direction === 'inbound' ? (session.toNumber || session.fromNumber) : (session.fromNumber || session.toNumber);
      if (callerId && !callerId.startsWith('+') && !callerId.startsWith('0')) {
        callerId = `+${callerId}`;
      }

      logger.info(`[Transfer] Target: ${normalizedTarget}, CallerId: ${callerId}`, undefined, 'PlivoElevenLabsBridge');

      // 3. Find real Plivo Call UUID from DB if session.callUuid is synthetic (e.g. plivo-el-...)
      let plivoCallUuid = session.callUuid;
      const [dbCall] = await db
        .select({ plivoCallUuid: plivoCalls.plivoCallUuid, id: plivoCalls.id, metadata: plivoCalls.metadata })
        .from(plivoCalls)
        .where(
          or(
            eq(plivoCalls.plivoCallUuid, session.callUuid),
            eq(plivoCalls.id, session.callUuid),
            sql`${plivoCalls.metadata}->>'internalId' = ${session.callUuid}`
          )
        )
        .limit(1)
        .catch(() => []);

      if (dbCall?.plivoCallUuid) {
        plivoCallUuid = dbCall.plivoCallUuid;
      }

      // 4. Get Plivo credentials
      const { storage } = await import('../../../storage');
      const plivoSetting = await storage.getGlobalSetting('plivo_credentials');
      const plivoCreds = (plivoSetting?.value as any) || {};
      const authId = plivoCreds.auth_id || process.env.PLIVO_AUTH_ID;
      const authToken = plivoCreds.auth_token || process.env.PLIVO_AUTH_TOKEN;

      if (!authId || !authToken) {
        throw new Error('Plivo credentials not found');
      }

      // 5. Build transfer XML URL
      const { getDomain } = await import('../../../utils/domain');
      const baseUrl = getDomain();
      const transferXmlUrl = `${baseUrl}/api/plivo/voice/transfer?target=${encodeURIComponent(normalizedTarget)}&callerId=${encodeURIComponent(callerId || '')}`;

      logger.info(`[Transfer] Calling Plivo Call Redirect API: https://api.plivo.com/v1/Account/${authId}/Call/${plivoCallUuid}/ with aleg_url=${transferXmlUrl}`, undefined, 'PlivoElevenLabsBridge');

      // Call Plivo Update Call API to set aleg_url
      const axios = (await import('axios')).default;
      const transferUrl = `https://api.plivo.com/v1/Account/${authId}/Call/${plivoCallUuid}/`;

      await axios.post(
        transferUrl,
        {
          legs: 'aleg',
          aleg_url: transferXmlUrl,
          aleg_method: 'GET',
        },
        {
          auth: {
            username: authId,
            password: authToken,
          },
        }
      );

      // Stop the stream using DELETE API to trigger Plivo to execute aleg_url
      const stopStreamUrl = `https://api.plivo.com/v1/Account/${authId}/Call/${plivoCallUuid}/Stream/`;
      try {
        await axios.delete(stopStreamUrl, {
          auth: {
            username: authId,
            password: authToken,
          },
        });
        logger.info(`[Transfer] Plivo stream stopped for ${plivoCallUuid}`, undefined, 'PlivoElevenLabsBridge');
      } catch (stopErr: any) {
        logger.warn(`[Transfer] Stop stream notice: ${stopErr?.message || stopErr}`, undefined, 'PlivoElevenLabsBridge');
      }

      // 6. Update DB call record status to 'transferred'
      if (dbCall?.id) {
        await db
          .update(plivoCalls)
          .set({
            status: 'transferred',
            metadata: sql`COALESCE(${plivoCalls.metadata}, '{}'::jsonb) || ${JSON.stringify({
              callTransferred: true,
              transferTarget: normalizedTarget,
              transferredAt: new Date(),
            })}::jsonb`,
          })
          .where(eq(plivoCalls.id, dbCall.id))
          .catch(() => {});
      }

      // 7. Disconnect session and close ElevenLabs WS cleanly
      session.status = 'disconnected';
      if (session.elevenLabsWs) {
        try {
          (session.elevenLabsWs as any).close();
        } catch (_) {}
      }

      if (session.plivoWs) {
        try {
          (session.plivoWs as any).close();
        } catch (_) {}
      }

      logger.info(`[Transfer] Successfully initiated transfer for ${session.callUuid} -> ${normalizedTarget}`, undefined, 'PlivoElevenLabsBridge');
      return { success: true };
    } catch (err: any) {
      logger.error(`[Transfer] Call transfer failed for ${session.callUuid}: ${err?.message || err}`, err, 'PlivoElevenLabsBridge');
      session.isEnding = false;
      return { success: false, error: err?.message || 'Transfer failed' };
    }
  }
  
  /**
   * Get all active sessions (for monitoring)
   */
  static getActiveSessions(): Map<string, CallSession> {
    return this.activeSessions;
  }
  
  /**
   * Get session count (for monitoring)
   */
  static getSessionCount(): number {
    return this.activeSessions.size;
  }
}
