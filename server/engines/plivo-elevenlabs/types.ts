'use strict';
/**
 * ============================================================
 * Plivo-ElevenLabs SIP Trunk Engine - Types
 * 
 * This is a SEPARATE engine from the Twilio+ElevenLabs integration.
 * It connects Plivo SIP trunk to ElevenLabs Conversational AI.
 * ============================================================
 */

export interface PlivoElevenLabsConfig {
  plivoAuthId: string;
  plivoAuthToken: string;
  elevenLabsApiKey: string;
  sipTrunkCredentialUuid?: string;
  sipTrunkEndpointUuid?: string;
}

export interface ElevenLabsAgentConfig {
  agentId: string;
  firstMessage?: string;
  systemPrompt?: string;
  voiceId?: string;
  temperature?: number;
  maxDuration?: number;
  language?: string;
  dynamicData?: Record<string, string>;
}

export interface CallSession {
  callUuid: string;
  streamSid: string;
  elevenLabsWs: WebSocket | null;
  plivoWs: WebSocket | null;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  startedAt: Date;
  endedAt: Date | null;
  agentId: string;
  fromNumber: string;
  toNumber: string;
  direction: 'inbound' | 'outbound';
  transcript: TranscriptPart[];
  conversationId?: string;
  initialAudioQueue?: string[];
  isPlivoReady?: boolean;
}

export interface TranscriptPart {
  role: 'user' | 'agent';
  text: string;
  timestamp: Date;
}

export type PlivoCallStatus = 
  | 'ringing'
  | 'answered'
  | 'in-progress'
  | 'completed'
  | 'busy'
  | 'failed'
  | 'no-answer'
  | 'canceled';

export interface PlivoWebhookPayload {
  CallUUID: string;
  From: string;
  To: string;
  Direction: string;
  CallStatus?: string;
  Duration?: string;
  HangupCause?: string;
  RecordUrl?: string;
  RecordingDuration?: string;
}

export interface ElevenLabsWebSocketMessage {
  type: string;
  audio?: {
    chunk?: string;
    format?: string;
    sample_rate?: number;
  };
  audio_event?: {
    audio_base_64: string;
    event_id?: number;
    is_final?: boolean;
  };
  user_transcript?: {
    text: string;
    is_final: boolean;
  };
  user_transcription_event?: {
    user_transcript: string;
    is_final?: boolean;
  };
  agent_response?: {
    text: string;
    is_final: boolean;
  };
  agent_response_event?: {
    agent_response: string;
    is_final?: boolean;
  };
  conversation_id?: string;
  conversation_initiation_metadata_event?: {
    conversation_id: string;
    agent_output_audio_format?: string;
    user_input_audio_format?: string;
  };
  ping_event?: {
    event_id: number;
  };
  error?: {
    message: string;
    code?: string;
  };
}
