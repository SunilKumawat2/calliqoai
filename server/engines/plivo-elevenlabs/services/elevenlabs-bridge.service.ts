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
import { plivoCalls } from '@shared/schema';
import { eq, or, sql } from 'drizzle-orm';

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
    };
    
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
      
      ws.on('open', () => {
        logger.info(`ElevenLabs WebSocket connected for ${session.callUuid}`, undefined, 'PlivoElevenLabsBridge');
        session.status = 'connected';
        
        const initMessage: any = {
          type: 'conversation_initiation_client_data',
        };
        
        const configOverride: any = {};
        const agentOverride: any = {};

        if (agentConfig?.firstMessage) {
          agentOverride.first_message = agentConfig.firstMessage;
          logger.info(`Setting ElevenLabs first_message override: "${agentConfig.firstMessage.substring(0, 60)}..."`, undefined, 'PlivoElevenLabsBridge');
        }

        if (agentConfig?.systemPrompt) {
          agentOverride.prompt = { prompt: agentConfig.systemPrompt };
          logger.info(`Setting ElevenLabs prompt override`, undefined, 'PlivoElevenLabsBridge');
        }

        if (agentConfig?.language) {
          agentOverride.language = agentConfig.language;
        }

        if (Object.keys(agentOverride).length > 0) {
          configOverride.agent = agentOverride;
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
          
        case 'user_transcript':
          const userText = (message as any).user_transcription_event?.user_transcript || message.user_transcript?.text;
          const isUserFinal = (message as any).user_transcription_event?.is_final ?? message.user_transcript?.is_final ?? true;
          if (userText && isUserFinal) {
            session.transcript.push({
              role: 'user',
              text: userText,
              timestamp: new Date(),
            });
            logger.info(`User: "${userText.substring(0, 80)}..."`, undefined, 'PlivoElevenLabsBridge');
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
