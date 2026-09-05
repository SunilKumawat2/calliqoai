/**
 * ============================================================
 * AI Voice Engine Plugin — Type Definitions
 *
 * Core type system for the self-hosted voice engine:
 * - Provider interfaces (STT, LLM, TTS)
 * - FreeSWITCH integration types
 * - Audio pipeline types
 * - Session & conversation state
 * - Memory & caching types
 * - Configuration types
 * ============================================================
 */

// ─── Provider Enums ──────────────────────────────────────────

export type SttProvider = 'deepgram' | 'sarvam';
export type LlmProvider = 'openrouter';
export type TtsProvider = 'deepgram' | 'sarvam';
export type RecordingStorage = 'local' | 's3' | 'r2';

// ─── Audio Types ─────────────────────────────────────────────

export type AudioEncoding = 'linear16' | 'mulaw' | 'alaw' | 'opus';
export type AudioSampleRate = 8000 | 16000 | 22050 | 24000 | 44100 | 48000;

export interface AudioFormat {
  encoding: AudioEncoding;
  sampleRate: AudioSampleRate;
  channels: 1 | 2;
  bitDepth?: 16 | 24 | 32;
}

export const DEFAULT_TELEPHONY_FORMAT: AudioFormat = {
  encoding: 'linear16',
  sampleRate: 8000,
  channels: 1,
  bitDepth: 16,
};

export const DEFAULT_STT_FORMAT: AudioFormat = {
  encoding: 'linear16',
  sampleRate: 16000,
  channels: 1,
  bitDepth: 16,
};

// ─── STT Provider Types ──────────────────────────────────────

export interface SttConfig {
  provider: SttProvider;
  apiKey: string;
  language: string;
  model?: string;
  /** Deepgram-specific */
  deepgramModel?: string;
  interimResults?: boolean;
  punctuate?: boolean;
  endpointing?: number; // ms of silence before finalizing
  detectLanguage?: boolean;
  /** Sarvam-specific */
  sarvamModel?: string;
  sarvamLanguageCode?: string;
}

export interface SttTranscript {
  text: string;
  isFinal: boolean;
  confidence: number;
  words?: SttWord[];
  language?: string;
  duration?: number; // ms
}

export interface SttWord {
  word: string;
  start: number; // seconds
  end: number;
  confidence: number;
}

export interface SttProviderInterface {
  readonly name: SttProvider;
  connect(config: SttConfig, format: AudioFormat): Promise<void>;
  sendAudio(chunk: Buffer): void;
  onTranscript(callback: (transcript: SttTranscript) => void): void;
  onError(callback: (error: Error) => void): void;
  close(): Promise<void>;
  isConnected(): boolean;
}

// ─── LLM Provider Types ─────────────────────────────────────

export interface LlmConfig {
  provider: LlmProvider;
  apiKey: string;
  model: string; // e.g. 'openai/gpt-4o-mini', 'google/gemini-flash-1.5'
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  systemPrompt?: string;
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: LlmToolCall[];
}

export interface LlmToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface LlmToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlmResponse {
  content: string | null;
  toolCalls?: LlmToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter';
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  latencyMs: number;
}

export interface LlmStreamChunk {
  content?: string;
  toolCalls?: Partial<LlmToolCall>[];
  finishReason?: string;
}

export interface LlmProviderInterface {
  readonly name: LlmProvider;
  complete(messages: LlmMessage[], config: LlmConfig, tools?: LlmToolDefinition[]): Promise<LlmResponse>;
  stream(messages: LlmMessage[], config: LlmConfig, tools?: LlmToolDefinition[]): AsyncIterable<LlmStreamChunk>;
}

// ─── TTS Provider Types ─────────────────────────────────────

export interface TtsConfig {
  provider: TtsProvider;
  apiKey: string;
  voice: string;
  language?: string;
  /** Deepgram-specific */
  deepgramModel?: string; // 'aura-asteria-en', etc.
  /** Sarvam-specific */
  sarvamModel?: string;
  sarvamSpeaker?: string;
  speed?: number;
  pitch?: number;
  outputFormat?: AudioFormat;
}

export interface TtsProviderInterface {
  readonly name: TtsProvider;
  synthesize(text: string, config: TtsConfig): Promise<Buffer>;
  synthesizeStream(text: string, config: TtsConfig): AsyncIterable<Buffer>;
}

// ─── FreeSWITCH Types ────────────────────────────────────────

export type FreeSwitchNodeStatus = 'online' | 'offline' | 'degraded' | 'maintenance';

export interface FreeSwitchNode {
  id: string;
  name: string;
  eslHost: string;
  eslPort: number;
  eslPassword: string;
  sipHost: string;
  sipPort: number;
  status: FreeSwitchNodeStatus;
  activeCalls: number;
  maxCalls: number;
  lastHealthCheck?: Date;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface FreeSwitchEvent {
  eventName: string;
  eventSubclass?: string;
  headers: Record<string, string>;
  body?: string;
}

export interface FreeSwitchChannel {
  uuid: string;
  callerIdNumber: string;
  callerIdName?: string;
  destinationNumber: string;
  direction: 'inbound' | 'outbound';
  state: string;
  createdAt: Date;
}

export interface EslCommand {
  command: string;
  args?: string;
}

// ─── Session Types ───────────────────────────────────────────

export type SessionStatus =
  | 'initializing'
  | 'active'
  | 'paused'
  | 'completing'
  | 'completed'
  | 'failed'
  | 'timeout';

export interface VoiceSession {
  id: string;
  userId: string;
  agentId: string;
  callId?: string;
  freeswitchNodeId?: string;
  channelUuid?: string;
  // Caller info
  fromNumber: string;
  toNumber: string;
  direction: 'inbound' | 'outbound';
  // State
  status: SessionStatus;
  startedAt: Date;
  answeredAt?: Date;
  endedAt?: Date;
  durationSeconds: number;
  // Provider tracking
  sttProvider: SttProvider;
  llmProvider: LlmProvider;
  ttsProvider: TtsProvider;
  llmModel: string;
  // Usage
  sttDurationMs: number;
  llmPromptTokens: number;
  llmCompletionTokens: number;
  ttsDurationMs: number;
  ttsCharacters: number;
  // Conversation
  transcript: TranscriptEntry[];
  metadata?: Record<string, unknown>;
  creditsUsed?: number;
}

export interface TranscriptEntry {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: string; // ISO 8601
  durationMs?: number;
  isFinal?: boolean;
}

// ─── Conversation Engine Types ───────────────────────────────

export interface ConversationState {
  sessionId: string;
  messages: LlmMessage[];
  variables: Record<string, unknown>;
  currentTurn: number;
  lastUserInput?: string;
  lastAssistantResponse?: string;
  isProcessing: boolean;
  interruptedAt?: string;
}

export interface ConversationContext {
  systemPrompt: string;
  customerMemory?: CustomerMemory;
  businessRules?: string[];
  knowledgeContext?: string;
  activeTools: LlmToolDefinition[];
  maxContextTokens: number;
}

// ─── Memory Types ────────────────────────────────────────────

export interface CustomerMemory {
  customerId: string;
  phoneNumber: string;
  profile: CustomerProfile;
  preferences: Record<string, unknown>;
  facts: CustomerFact[];
  callHistory: CallSummary[];
  lastInteraction?: Date;
}

export interface CustomerProfile {
  name?: string;
  email?: string;
  company?: string;
  language?: string;
  timezone?: string;
  tags?: string[];
  customFields?: Record<string, unknown>;
}

export interface CustomerFact {
  id: string;
  fact: string;
  category: 'preference' | 'complaint' | 'purchase' | 'feedback' | 'personal' | 'other';
  confidence: number;
  source: string; // callId that generated this fact
  extractedAt: Date;
  expiresAt?: Date;
}

export interface CallSummary {
  callId: string;
  date: Date;
  duration: number;
  direction: 'inbound' | 'outbound';
  summary: string;
  outcome?: string;
  sentiment?: 'positive' | 'neutral' | 'negative';
  topics?: string[];
}

// ─── Cache Types ─────────────────────────────────────────────

export interface CacheEntry {
  key: string;
  value: string;
  embedding?: number[];
  ttlSeconds: number;
  hitCount: number;
  createdAt: Date;
  lastAccessedAt: Date;
}

export interface SemanticCacheConfig {
  enabled: boolean;
  similarityThreshold: number; // 0.0 - 1.0, default 0.92
  maxEntries: number;
  defaultTtlSeconds: number;
}

// ─── Voice Agent Types ───────────────────────────────────────

export interface VoiceAgentConfig {
  id: string;
  userId: string;
  name: string;
  description?: string;
  // AI Configuration
  systemPrompt: string;
  firstMessage?: string;
  language: string;
  llmModel: string;
  sttModel?: string;
  temperature: number;
  maxTokens: number;
  // Voice
  ttsVoice: string;
  ttsProvider: TtsProvider;
  sttProvider: SttProvider;
  // Behavior
  interruptible: boolean;
  silenceTimeoutMs: number;
  maxDurationSeconds: number;
  endCallOnSilence: boolean;
  // Business rules
  businessRules?: string[];
  // Knowledge base
  knowledgeBaseIds?: string[];
  // Tools
  enabledTools?: string[];
  // Memory
  enableMemory: boolean;
  memoryRetentionDays: number;
  detectLanguageEnabled?: boolean;
  appointmentBookingEnabled?: boolean;
  endConversationEnabled?: boolean;
  transferEnabled?: boolean;
  transferPhoneNumber?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Tool Framework Types ────────────────────────────────────

export type ToolType =
  | 'crm_lookup'
  | 'ticket_create'
  | 'appointment_book'
  | 'email_send'
  | 'sms_send'
  | 'whatsapp_send'
  | 'webhook'
  | 'custom';

export interface ToolDefinition {
  name: string;
  type: ToolType;
  description: string;
  parameters: Record<string, unknown>;
  handler: string; // Module path or webhook URL
  config?: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  success: boolean;
  result: unknown;
  error?: string;
  durationMs: number;
}

// ─── Recording Types ─────────────────────────────────────────

export type RecordingStatus = 'recording' | 'processing' | 'available' | 'failed' | 'deleted';

export interface CallRecording {
  id: string;
  sessionId: string;
  userId: string;
  callId?: string;
  storageBackend: RecordingStorage;
  storagePath: string;
  storageUrl?: string;
  fileSize: number;
  durationSeconds: number;
  format: string; // 'wav', 'mp3', 'ogg'
  status: RecordingStatus;
  transcript?: string;
  metadata?: Record<string, unknown>;
  retentionExpiresAt?: Date;
  createdAt: Date;
}

// ─── Usage & Billing Types ───────────────────────────────────

export interface UsageRecord {
  id: string;
  userId: string;
  sessionId: string;
  callId?: string;
  // STT
  sttProvider: SttProvider;
  sttDurationMs: number;
  sttCost: number;
  // LLM
  llmProvider: LlmProvider;
  llmModel: string;
  llmPromptTokens: number;
  llmCompletionTokens: number;
  llmCost: number;
  // TTS
  ttsProvider: TtsProvider;
  ttsCharacters: number;
  ttsDurationMs: number;
  ttsCost: number;
  // Recording
  recordingStorageBytes: number;
  recordingCost: number;
  // Total
  totalCost: number;
  createdAt: Date;
}

// ─── Analytics Types ─────────────────────────────────────────

export interface VoiceEngineMetrics {
  activeCalls: number;
  totalCallsToday: number;
  avgCallDuration: number;
  avgSttLatency: number;
  avgLlmLatency: number;
  avgTtsLatency: number;
  errorRate: number;
  totalCostToday: number;
  callsByProvider: Record<string, number>;
}

// ─── Tenant Config Types ─────────────────────────────────────

export interface TenantProviderConfig {
  id: string;
  userId: string;
  // STT
  sttProvider: SttProvider;
  sttApiKey?: string;
  sttConfig?: Partial<SttConfig>;
  // LLM
  llmProvider: LlmProvider;
  llmApiKey?: string;
  llmModel: string;
  llmConfig?: Partial<LlmConfig>;
  // TTS
  ttsProvider: TtsProvider;
  ttsApiKey?: string;
  ttsVoice: string;
  ttsConfig?: Partial<TtsConfig>;
  // Limits
  maxConcurrentCalls: number;
  // Recording
  recordingEnabled: boolean;
  recordingStorage: RecordingStorage;
  recordingRetentionDays: number;
  // Memory
  memoryEnabled: boolean;
  // Cache
  cacheEnabled: boolean;
  cacheTtlSeconds: number;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Plugin Loader Interface ─────────────────────────────────

export interface VoiceEnginePluginOptions {
  sessionAuthMiddleware: import('express').RequestHandler;
  adminAuthMiddleware: import('express').RequestHandler;
  httpServer?: import('http').Server;
}

// ─── Pipeline Event Types ────────────────────────────────────

export type PipelineEvent =
  | { type: 'session_start'; sessionId: string; timestamp: string }
  | { type: 'audio_received'; sessionId: string; bytes: number; timestamp: string }
  | { type: 'stt_transcript'; sessionId: string; transcript: SttTranscript; timestamp: string }
  | { type: 'llm_start'; sessionId: string; timestamp: string }
  | { type: 'llm_response'; sessionId: string; response: string; latencyMs: number; timestamp: string }
  | { type: 'llm_tool_call'; sessionId: string; toolCall: LlmToolCall; timestamp: string }
  | { type: 'tts_start'; sessionId: string; text: string; timestamp: string }
  | { type: 'tts_audio'; sessionId: string; bytes: number; timestamp: string }
  | { type: 'interruption'; sessionId: string; timestamp: string }
  | { type: 'silence_detected'; sessionId: string; durationMs: number; timestamp: string }
  | { type: 'session_end'; sessionId: string; reason: string; timestamp: string }
  | { type: 'error'; sessionId: string; error: string; timestamp: string };

export type PipelineEventHandler = (event: PipelineEvent) => void;

// ─── VAD Types ───────────────────────────────────────────────

export interface VadConfig {
  /** Minimum speech duration to trigger speech start (ms) */
  speechThresholdMs: number;
  /** Silence duration to trigger speech end (ms) */
  silenceThresholdMs: number;
  /** Energy threshold for speech detection (0.0-1.0) */
  energyThreshold: number;
  /** Enable barge-in (interrupt TTS playback) */
  bargeInEnabled: boolean;
}

export const DEFAULT_VAD_CONFIG: VadConfig = {
  speechThresholdMs: 250,
  silenceThresholdMs: 1500,
  energyThreshold: 0.028,
  bargeInEnabled: true,
};

export type VadState = 'silence' | 'speech' | 'uncertain';

export interface VadResult {
  state: VadState;
  energy: number;
  speechDurationMs: number;
  silenceDurationMs: number;
  isSpeechStart: boolean;
  isSpeechEnd: boolean;
}
