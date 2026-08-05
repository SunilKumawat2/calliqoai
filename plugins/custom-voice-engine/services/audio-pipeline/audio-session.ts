/**
 * ============================================================
 * Audio Session Manager
 *
 * Manages the lifecycle of a single voice call session.
 * Coordinates the audio pipeline:
 *   Audio In → VAD → STT → LLM → TTS → Audio Out
 *
 * Handles interruptions, barge-in, turn management,
 * and session cleanup.
 * ============================================================
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { db } from '../../../../server/db';
import { sql } from 'drizzle-orm';
import type {
  VoiceSession,
  SessionStatus,
  TranscriptEntry,
  SttConfig,
  LlmConfig,
  TtsConfig,
  AudioFormat,
  SttTranscript,
  PipelineEvent,
  VoiceAgentConfig,
  VadConfig,
  LlmToolCall,
  LlmToolDefinition,
} from '../../types';
import { ToolExecutor } from '../tools/tool-executor';
import { DEFAULT_TELEPHONY_FORMAT, DEFAULT_VAD_CONFIG } from '../../types';
import { SttProviderFactory } from '../providers/stt/stt-provider.factory';
import { LlmProviderFactory } from '../providers/llm/llm-provider.factory';
import { TtsProviderFactory } from '../providers/tts/tts-provider.factory';
import { VadDetector } from './vad-detector';

function writeWavHeader(samplesLength: number, sampleRate: number, numChannels: number, bitsPerSample: number): Buffer {
  const header = Buffer.alloc(44);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = samplesLength * blockAlign;

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return header;
}

export class AudioSession extends EventEmitter {
  readonly id: string;
  public channelUuid?: string;
  public isTransferred = false;
  private session: VoiceSession;
  private agentConfig: VoiceAgentConfig;
  private sttConfig: SttConfig;
  private llmConfig: LlmConfig;
  private ttsConfig: TtsConfig;

  // Pipeline components
  private sttProvider: ReturnType<typeof SttProviderFactory.create> | null = null;
  private llmProvider: ReturnType<typeof LlmProviderFactory.create> | null = null;
  private ttsProvider: ReturnType<typeof TtsProviderFactory.create> | null = null;
  private vadDetector: VadDetector;

  // State
  private isProcessingLlm = false;
  private isPlayingTts = false;
  private sampleRateWarned = false;
  private ttsGeneration = 0;
  private lastTtsEndTime = 0;
  private pendingTranscript = '';
  private finalTranscriptTimer: ReturnType<typeof setTimeout> | null = null;
  private conversationMessages: Array<{ role: string; content: string }> = [];
  private sessionStartTime: number;
  private destroyed = false;
  private silenceWarningCount = 0;
  private initialized = false;
  private isDemoUser = false;
  private demoLimitTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private isCallAnswered = false;
  private firstMessageTriggered = false;
  private callAnsweredTime = 0;
  private lastIncomingWriteEnd = 0;
  private lastOutgoingWriteEnd = 0;

  // Recording buffer
  private pcmBuffer: Buffer = Buffer.alloc(0);
  private totalIncomingBytes = 0;
  private bargeInPreBuffer: Buffer = Buffer.alloc(0);

  // Idle timeout
  private idleTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private lastUserActivityTime = 0;

  // Audio output callback (sends audio back to FreeSWITCH)
  private audioOutCallback: ((audio: Buffer) => void) | null = null;
  // Sends a control/JSON text frame to mod_audio_fork over this session's
  // websocket (used by the streaming `playAudio` / `killAudio` protocol).
  private controlOutCallback: ((msg: object) => void) | null = null;
  // Experimental gap-free streaming playback. OFF by default so live calls keep
  // using the proven file-per-sentence uuid_broadcast path until streaming is
  // validated on real phone calls. Set VE_STREAMING_PLAYBACK=true to enable it.
  // (On this deployment mod_audio_fork turns each streamed block into its own
  // uuid_broadcast, so streaming must be A/B tested on real calls before it can
  // safely become the default.)
  private streamingPlayback = process.env.VE_STREAMING_PLAYBACK === 'true';

  // Tool calling
  private tools: LlmToolDefinition[] = [];
  private toolMetadata: Map<string, any> = new Map();
  private accumulatedToolCalls: Map<number, Partial<LlmToolCall>> = new Map();

  // Pre-synthesized greeting audio (the static firstMessage). Synthesized during
  // initialize() so the greeting plays immediately on answer instead of paying a
  // cold TTS round-trip on the critical path. Falls back to live synthesis on miss.
  private greetingAudioCache: Buffer | null = null;
  private greetingCacheText: string | null = null;
  private preSynthesizePromise: Promise<void> | null = null;

  // Latency instrumentation: marks the start of the current turn (caller finished
  // speaking) so we can log STT→LLM→TTS→playback timings per turn.
  private turnStartTime = 0;

  constructor(
    sessionId: string,
    session: VoiceSession,
    agentConfig: VoiceAgentConfig,
    sttConfig: SttConfig,
    llmConfig: LlmConfig,
    ttsConfig: TtsConfig,
    vadConfig?: Partial<VadConfig>,
    tools?: LlmToolDefinition[],
    toolMetadata?: Map<string, any>,
  ) {
    super();
    this.id = sessionId;
    this.session = session;
    this.agentConfig = agentConfig;
    this.sttConfig = sttConfig;
    this.llmConfig = llmConfig;
    this.ttsConfig = ttsConfig;
    this.vadDetector = new VadDetector(vadConfig);
    this.sessionStartTime = Date.now();
    this.isCallAnswered = session.direction === 'inbound';
    if (this.isCallAnswered) {
      this.callAnsweredTime = Date.now();
    }
    if (tools) this.tools = tools;
    if (toolMetadata) this.toolMetadata = toolMetadata;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  get direction(): string {
    return this.session.direction;
  }

  get userId(): string {
    return this.session.userId;
  }

  /**
   * Initialize the audio pipeline (connect STT, prepare LLM/TTS)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    try {
      // Initialize STT
      this.sttProvider = SttProviderFactory.create(this.sttConfig.provider);
      await this.sttProvider.connect(this.sttConfig, DEFAULT_TELEPHONY_FORMAT);

      this.sttProvider.onTranscript((transcript) => {
        this.handleSttTranscript(transcript);
      });

      this.sttProvider.onError((error) => {
        this.emitPipelineEvent({
          type: 'error',
          sessionId: this.id,
          error: `STT error: ${error.message}`,
          timestamp: new Date().toISOString(),
        });
      });

      // Initialize LLM provider
      this.llmProvider = LlmProviderFactory.create(this.llmConfig.provider);

      // Initialize TTS provider
      this.ttsProvider = TtsProviderFactory.create(this.ttsConfig.provider);

      // Pre-synthesize the static greeting in the background so it plays
      // immediately on answer instead of paying a cold TTS round-trip. Also
      // warms the TTS provider's keep-alive connection for the first real turn.
      this.preSynthesizePromise = this.preSynthesizeGreeting();

      // Set up system prompt — inject current date/time so the LLM resolves
      // relative date expressions like "today", "tomorrow", "this Friday" correctly.
      const now = new Date();
      const formatterOptions = { timeZone: 'Asia/Kolkata' };
      const dateContext = [
        `\n\n---`,
        `**Current date/time context (use this for all date calculations):**`,
        `- Today's date: ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', ...formatterOptions })}`,
        `- ISO date: ${now.toLocaleDateString('en-CA', formatterOptions)}   (YYYY-MM-DD format — always use this format for appointmentDate)`,
        `- Current time: ${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, ...formatterOptions })}`,
        `- Day of week: ${now.toLocaleDateString('en-US', { weekday: 'long', ...formatterOptions })}`,
        `When the user says "today", use ${now.toLocaleDateString('en-CA', formatterOptions)}. When they say "tomorrow", use ${new Date(now.getTime() + 86400000).toLocaleDateString('en-CA', formatterOptions)}.`,
      ].join('\n');

      const baseSystemPrompt = this.llmConfig.systemPrompt || this.agentConfig.systemPrompt || '';
      const finalPromptContent = this.llmConfig.systemPrompt
        ? baseSystemPrompt
        : baseSystemPrompt + dateContext;

      this.conversationMessages.push({
        role: 'system',
        content: finalPromptContent,
      });

      this.updateStatus('active');

      this.emitPipelineEvent({
        type: 'session_start',
        sessionId: this.id,
        timestamp: new Date().toISOString(),
      });

      // Check if demo user
      try {
        const userResult = await db.execute(sql`
          SELECT email FROM users WHERE id = ${this.userId} LIMIT 1
        `);
        if (userResult.rows[0]?.email === 'demo@diploy.in') {
          this.isDemoUser = true;
          console.log(`[AudioSession:${this.id}] Demo user detected. Enforcing 3 minute call duration limit.`);
          if (this.isCallAnswered) {
            this.startDemoCallDurationLimit();
          }
        }
      } catch (err: any) {
        console.warn(`[AudioSession:${this.id}] Failed to check demo user status:`, err.message);
      }

      console.log(`[AudioSession:${this.id}] Pipeline initialized. direction=${this.session.direction}, answered=${this.isCallAnswered}`);
    } catch (err: any) {
      this.updateStatus('failed');
      throw new Error(`Pipeline initialization failed: ${err.message}`);
    }
  }

  private startDemoCallDurationLimit(): void {
    if (!this.isDemoUser || this.demoLimitTimeoutId) return;

    console.log(`[AudioSession:${this.id}] Starting 3-minute demo call limit timer.`);
    this.demoLimitTimeoutId = setTimeout(async () => {
      console.log(`[AudioSession:${this.id}] Enforcing 3-minute call duration limit. Hanging up.`);
      this.emit('hangup', 'demo_limit_exceeded');
    }, 3 * 60 * 1000); // 3 minutes
  }

  /**
   * Pre-synthesize the static greeting audio during pipeline init.
   * Runs in the background (fire-and-forget). On success the greeting plays
   * from memory on answer; on any failure we simply fall back to live synthesis.
   */
  private async preSynthesizeGreeting(): Promise<void> {
    const greeting = this.agentConfig.firstMessage;
    if (!greeting || !this.ttsProvider) return;

    try {
      const startTime = Date.now();
      const chunks: Buffer[] = [];
      const config = { ...this.ttsConfig };
      if (this.agentConfig.detectLanguageEnabled) {
        config.language = this.detectTtsLanguage(greeting, config.language || 'en-IN');
      }
      for await (const audioChunk of this.ttsProvider.synthesizeStream(greeting, config)) {
        chunks.push(audioChunk);
      }
      if (chunks.length > 0 && !this.destroyed) {
        this.greetingAudioCache = Buffer.concat(chunks);
        this.greetingCacheText = greeting;
        console.log(`[AudioSession:${this.id}] [latency] Greeting pre-synthesized in ${Date.now() - startTime}ms (${this.greetingAudioCache.length} bytes cached)`);
      }
    } catch (err: any) {
      console.warn(`[AudioSession:${this.id}] Greeting pre-synthesis failed (will fall back to live TTS): ${err.message}`);
    }
  }

  private async triggerFirstMessage(): Promise<void> {
    if (this.firstMessageTriggered) {
      console.log(`[AudioSession:${this.id}] triggerFirstMessage - already triggered, returning`);
      return;
    }
    this.firstMessageTriggered = true;

    if (!this.agentConfig.firstMessage) {
      console.log(`[AudioSession:${this.id}] triggerFirstMessage - no firstMessage configured`);
      return;
    }

    const greetingStart = Date.now();
    const isCached = this.greetingCacheText === this.agentConfig.firstMessage && !!this.greetingAudioCache;
    console.log(`[AudioSession:${this.id}] triggerFirstMessage - speaking first message: "${this.agentConfig.firstMessage}" (cached=${isCached})`);

    if (isCached) {
      await this.speakText(this.agentConfig.firstMessage);
    } else {
      // If the greeting is not cached (e.g. inbound calls), split it into sentences and queue them
      // so the first sentence plays immediately instead of waiting for the entire block to synthesize.
      const sentences = this.splitIntoSentences(this.agentConfig.firstMessage);
      console.log(`[AudioSession:${this.id}] triggerFirstMessage - split uncached greeting into ${sentences.length} sentences`);
      for (const sentence of sentences) {
        this.queueTts(sentence);
      }
      // Wait until TTS queue finishes playing the greeting sentences
      while (this.isProcessingTtsQueue || this.ttsQueue.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    this.conversationMessages.push({
      role: 'assistant',
      content: this.agentConfig.firstMessage,
    });
    console.log(`[AudioSession:${this.id}] [latency] triggerFirstMessage - done in ${Date.now() - greetingStart}ms`);
  }

  /**
   * Yield TTS audio for `text`. If we have a matching pre-synthesized buffer
   * (the greeting), stream it from memory in provider-sized frames; otherwise
   * fall through to live provider synthesis. Keeps speakText's mixing/offset
   * logic identical for both paths.
   */
  private async *getTtsStream(text: string): AsyncIterable<Buffer> {
    // If this is the greeting message, wait for pre-synthesis if it is in progress
    if (text === this.agentConfig.firstMessage && this.preSynthesizePromise) {
      try {
        await this.preSynthesizePromise;
      } catch (err: any) {
        console.warn(`[AudioSession:${this.id}] Failed waiting for greeting pre-synthesis: ${err.message}`);
      }
    }

    if (this.greetingAudioCache && this.greetingCacheText === text) {
      const cached = this.greetingAudioCache;
      const chunkSize = 640; // 40ms of 8kHz 16-bit mono, matches provider chunking
      for (let offset = 0; offset < cached.length; offset += chunkSize) {
        yield cached.subarray(offset, Math.min(offset + chunkSize, cached.length));
      }
      return;
    }
    const config = { ...this.ttsConfig };
    if (this.agentConfig.detectLanguageEnabled) {
      config.language = this.detectTtsLanguage(text, config.language || 'en-IN');
    }
    yield* this.ttsProvider!.synthesizeStream(text, config);
  }

  async enableAudio(): Promise<void> {
    if (!this.isCallAnswered) {
      console.log(`[AudioSession:${this.id}] enableAudio - marking answered`);
      this.isCallAnswered = true;
      this.callAnsweredTime = Date.now();
      this.startDemoCallDurationLimit();
    } else {
      console.log(`[AudioSession:${this.id}] enableAudio - already answered`);
    }
  }

  async markCallAnswered(): Promise<void> {
    if (!this.isCallAnswered) {
      console.log(`[AudioSession:${this.id}] callAnswered - marking answered, triggering first message`);
      this.isCallAnswered = true;
      this.callAnsweredTime = Date.now();
      this.startDemoCallDurationLimit();
      this.emit('callAnswered');
    }
    await this.triggerFirstMessage();
  }

  /**
   * Process incoming audio from FreeSWITCH (mod_audio_fork)
   */
  processAudio(chunk: Buffer): void {
    if (this.destroyed) return;

    // Ignore early media / ringing audio before answer
    if (!this.isCallAnswered) return;

    // Record incoming audio chunk chronologically
    const elapsedMs = Math.max(0, Date.now() - this.callAnsweredTime);
    let startOffset = Math.round(elapsedMs * 8) * 2;
    if (startOffset < this.lastIncomingWriteEnd) {
      startOffset = this.lastIncomingWriteEnd;
    }
    this.mixAudioAtOffset(chunk, startOffset);
    this.lastIncomingWriteEnd = startOffset + chunk.length;

    // Check if we are within the echo guard window (to prevent trailing echo from being transcribed/processed)
    const timeSinceLastTts = Date.now() - this.lastTtsEndTime;
    const isWithinEchoGuardWindow = timeSinceLastTts < 250; // 250ms guard window

    if (!isWithinEchoGuardWindow) {
      // VAD processing
      const vadResult = this.vadDetector.processChunk(chunk, this.isPlayingTts);

      if (vadResult.isSpeechEnd) {
        console.log(`[AudioSession:${this.id}] VAD isSpeechEnd, provider=${this.sttProvider?.name}, hasFlush=${typeof (this.sttProvider as any)?.flush === 'function'}, playingTts=${this.isPlayingTts}`);
      }

      if (vadResult.isSpeechStart) {
        // User started speaking — cancel idle timeout immediately so a natural
        // pause-to-think doesn't terminate the call before the utterance finishes.
        this.clearIdleTimeout();
        this.silenceWarningCount = 0;

        if (this.isPlayingTts && this.agentConfig.interruptible) {
          this.handleInterruption();
        }
      }

      // For REST-based STT providers (Sarvam), flush on VAD speech-end
      if (vadResult.isSpeechEnd && (this.sttProvider as any)?.flush) {
        console.log(`[AudioSession:${this.id}] Calling STT flush`);
        (this.sttProvider as any).flush().catch((err: Error) => {
          console.error(`[AudioSession:${this.id}] STT flush error:`, err.message);
        });
      }
    }

    // Send audio to STT only when not playing TTS to prevent echo loop
    const canSendAudio = !this.isPlayingTts;
    if (canSendAudio) {
      this.bargeInPreBuffer = Buffer.alloc(0); // Clear pre-buffer when not playing TTS
      if (!isWithinEchoGuardWindow && this.sttProvider?.isConnected()) {
        this.sttProvider.sendAudio(chunk);
      }
    } else {
      // Buffer a rolling window of audio during TTS playback for barge-in
      const maxPreBufferBytes = 16000; // ~1 second of 8kHz 16-bit mono
      this.bargeInPreBuffer = Buffer.concat([this.bargeInPreBuffer, chunk]);
      if (this.bargeInPreBuffer.length > maxPreBufferBytes) {
        this.bargeInPreBuffer = this.bargeInPreBuffer.slice(this.bargeInPreBuffer.length - maxPreBufferBytes);
      }
    }

    // Check max duration (relative to when the call was answered)
    const answeredTime = this.callAnsweredTime > 0 ? this.callAnsweredTime : this.sessionStartTime;
    const elapsed = (Date.now() - answeredTime) / 1000;
    if (elapsed >= this.agentConfig.maxDurationSeconds) {
      this.end('timeout');
    }
  }

  /**
   * Set callback for sending audio back to caller
   */
  onAudioOut(callback: (audio: Buffer) => void): void {
    this.audioOutCallback = callback;
  }

  /**
   * Set callback for sending control/JSON frames (playAudio / killAudio) to
   * mod_audio_fork over this session's websocket. Required for streaming playback.
   */
  onControlOut(callback: (msg: object) => void): void {
    this.controlOutCallback = callback;
  }

  /** True when gap-free streaming playback is active for this session. */
  get isStreamingPlayback(): boolean {
    return this.streamingPlayback && !!this.controlOutCallback;
  }

  // ── Private: Idle Timeout ──────────────────────────────

  private getSilenceMessages(): { warning: string; end: string } {
    const lang = this.agentConfig.language || 'en';
    const baseLang = lang.split(/[-_]/)[0].toLowerCase();
 
    switch (baseLang) {
      case 'hi':
        return {
          warning: "नमस्ते, क्या आप वहीं हैं? मुझे आपकी आवाज़ नहीं आ रही है।",
          end: "चूंकि आपकी आवाज़ नहीं आ रही है, इसलिए हम इस कॉल को समाप्त कर रहे हैं। धन्यवाद।"
        };
      case 'ta':
        return {
          warning: "வணக்கம், நீங்கள் அங்கே இருக்கிறீர்களா? உங்கள் குரல் கேட்கவில்லை.",
          end: "உங்கள் குரல் கேட்காததால், நாங்கள் அழைப்பை முடிக்கிறோம். நன்றி."
        };
      case 'te':
        return {
          warning: "హలో, మీరు అక్కడే ఉన్నారా? మీ వాయిస్ వినపడడం లేదు.",
          end: "మీ వాయిస్ వినపడనందున, మేము కాల్ ముగిస్తున్నాము. ధన్యవాదాలు."
        };
      case 'kn':
        return {
          warning: "ಹಲೋ, ನೀವು ಅಲ್ಲೇ ಇದ್ದೀರಾ? ನಿಮ್ಮ ಧ್ವನಿ ಕೇಳಿಸುತ್ತಿಲ್ಲ.",
          end: "ನಿಮ್ಮ ಧ್ವನಿ ಕೇಳಿಸದ ಕಾರಣ, ನಾವು ಕರೆಯನ್ನು ಮುಕ್ತಾಯಗೊಳಿಸುತ್ತಿದ್ದೇವೆ. ಧನ್ಯವಾದಗಳು."
        };
      default:
        return {
          warning: "Hello, are you still there? I can't hear you.",
          end: "Since you are not audible, we are ending this call now. Goodbye."
        };
    }
  }
 
  private resetIdleTimeout(): void {
    this.clearIdleTimeout();
    if (this.destroyed) return;
 
    const timeoutMs = this.agentConfig.silenceTimeoutMs || 15000;
    // The warning triggers halfway through the silence timeout limit (minimum 5s)
    const warningInterval = Math.max(5000, Math.floor(timeoutMs / 2));
 
    this.idleTimeoutId = setTimeout(async () => {
      if (this.destroyed) return;
 
      const messages = this.getSilenceMessages();
 
      if (this.silenceWarningCount === 0) {
        this.silenceWarningCount++;
        console.log(`[AudioSession:${this.id}] Silence warning triggered, speaking check-in`);
        
        // Speak warning
        await this.speakText(messages.warning);
        
        // Restart the idle timeout for the remaining period
        this.resetIdleTimeout();
      } else {
        console.log(`[AudioSession:${this.id}] Second silence timeout reached, ending call`);
        
        // Speak end call announcement
        await this.speakText(messages.end);
        
        // Give 2.5 seconds for TTS audio playback to complete before terminating call
        setTimeout(() => {
          this.end('timeout');
        }, 2500);
      }
    }, warningInterval);
  }

  private clearIdleTimeout(): void {
    if (this.idleTimeoutId) {
      clearTimeout(this.idleTimeoutId);
      this.idleTimeoutId = null;
    }
  }

  /**
   * End the session
   */
  async end(reason: string = 'normal'): Promise<void> {
    if (this.destroyed) return;

    this.clearIdleTimeout();
    if (this.demoLimitTimeoutId) {
      clearTimeout(this.demoLimitTimeoutId);
      this.demoLimitTimeoutId = null;
    }

    // Compute duration before status updates so DB saves get the correct values
    const answeredTime = this.callAnsweredTime > 0 ? this.callAnsweredTime : this.sessionStartTime;
    this.session.durationSeconds = Math.floor((Date.now() - answeredTime) / 1000);
    this.session.endedAt = new Date();

    this.updateStatus('completing');

    if (this.finalTranscriptTimer) {
      clearTimeout(this.finalTranscriptTimer);
      this.finalTranscriptTimer = null;
    }

    // Close STT first so any final force-flush transcript can be processed
    try {
      if (this.sttProvider) await this.sttProvider.close();
    } catch { /* ignore */ }

    this.destroyed = true;

    // Save local recording if we collected any audio
    console.log(`[AudioSession:${this.id}] Session ending. pcmBuffer size: ${this.pcmBuffer.length} bytes. totalIncomingBytes: ${this.totalIncomingBytes}`);
    if (this.pcmBuffer.length > 0) {
      try {
        // Trim pcmBuffer to match actual call duration, discarding trailing silence
        // that accumulated after the call ended (e.g. from delayed ESL hangup or idle timeout)
        const expectedBufferBytes = Math.round(this.session.durationSeconds * 8000 * 2);
        const trimmedBuffer = this.pcmBuffer.length > expectedBufferBytes
          ? this.pcmBuffer.slice(0, expectedBufferBytes)
          : this.pcmBuffer;
        if (trimmedBuffer.length !== this.pcmBuffer.length) {
          console.log(`[AudioSession:${this.id}] Trimmed pcmBuffer: ${this.pcmBuffer.length} -> ${trimmedBuffer.length} bytes (removed ${this.pcmBuffer.length - trimmedBuffer.length} trailing silence bytes)`);
        }

        const samplesCount = trimmedBuffer.length / 2;
        const durationSeconds = Math.round(samplesCount / 8000);
        console.log(`[AudioSession:${this.id}] Preparing to save WAV recording. Samples: ${samplesCount}, Duration: ${durationSeconds}s`);

        // Ensure recordings directory exists
        const recordingsDir = path.join(process.cwd(), 'client', 'public', 'uploads', 'recordings');
        if (!fs.existsSync(recordingsDir)) {
          console.log(`[AudioSession:${this.id}] Creating recordings directory: ${recordingsDir}`);
          fs.mkdirSync(recordingsDir, { recursive: true });
        }

        const wavHeader = writeWavHeader(samplesCount, 8000, 1, 16);
        const wavBuffer = Buffer.concat([wavHeader, trimmedBuffer]);

        const fileName = `${this.id}.wav`;
        const storagePath = path.join(recordingsDir, fileName);
        const storageUrl = `/uploads/recordings/${fileName}`;

        console.log(`[AudioSession:${this.id}] Writing WAV file to disk at: ${storagePath}`);
        await fs.promises.writeFile(storagePath, wavBuffer);
        console.log(`[AudioSession:${this.id}] WAV file successfully written to disk. File size: ${wavBuffer.length} bytes`);

        // Save to ve_call_recordings table
        const textTranscript = typeof this.session.transcript === 'string'
          ? this.session.transcript
          : JSON.stringify(this.session.transcript || []);

        console.log(`[AudioSession:${this.id}] Inserting recording metadata into ve_call_recordings table...`);
        await db.execute(sql`
          INSERT INTO ve_call_recordings (
            session_id, user_id, call_id, storage_backend, storage_path, storage_url, file_size, duration_seconds, format, status, transcript, created_at
          ) VALUES (
            ${this.id}, ${this.session.userId}, ${this.session.callId || null}, 'local', ${storagePath}, ${storageUrl}, ${wavBuffer.length}, ${durationSeconds}, 'wav', 'available', ${textTranscript}, NOW()
          )
        `);
        console.log(`[AudioSession:${this.id}] Successfully saved local recording to database with storageUrl: ${storageUrl}`);
      } catch (err: any) {
        console.error(`[AudioSession:${this.id}] Failed to save local recording:`, err.stack || err.message);
      }
    } else {
      console.warn(`[AudioSession:${this.id}] Warning: No audio was recorded for this session. pcmBuffer is empty.`);
    }

    this.updateStatus('completed');

    this.emitPipelineEvent({
      type: 'session_end',
      sessionId: this.id,
      reason,
      timestamp: new Date().toISOString(),
    });

    console.log(`[AudioSession:${this.id}] Ended: ${reason} (${this.session.durationSeconds}s)`);

    // Signal the WS server to hang up the actual phone call via ESL.
    // We emit BEFORE removeAllListeners() so any attached handler can catch it.
    this.emit('hangup', reason);

    this.removeAllListeners();
  }

  /**
   * Get current session data
   */
  getSession(): VoiceSession {
    return { ...this.session };
  }

  // ── Private: STT Handling ──────────────────────────────

  private lastTranscriptText = '';
  private lastTranscriptTime = 0;

  private handleSttTranscript(transcript: SttTranscript): void {
    if (this.destroyed) {
      console.log(`[AudioSession:${this.id}] handleSttTranscript - destroyed, ignoring "${transcript.text}"`);
      return;
    }

    this.emitPipelineEvent({
      type: 'stt_transcript',
      sessionId: this.id,
      transcript,
      timestamp: new Date().toISOString(),
    });

    if (!transcript.isFinal) {
      // Interim result — accumulate but don't process yet
      this.pendingTranscript = transcript.text;
      console.log(`[AudioSession:${this.id}] handleSttTranscript - interim: "${transcript.text}"`);
      return;
    }

    // Final transcript
    const text = transcript.text || this.pendingTranscript;
    console.log(`[AudioSession:${this.id}] handleSttTranscript - FINAL: "${text}"`);

    // Deduplicate: skip if same text within 3 seconds (Sarvam can send overlapping flushes)
    if (text && this.lastTranscriptText === text && (Date.now() - this.lastTranscriptTime) < 3000) {
      console.log(`[AudioSession:${this.id}] Skipping duplicate transcript: "${text}"`);
      return;
    }
    this.lastTranscriptText = text || '';
    this.lastTranscriptTime = Date.now();
    this.pendingTranscript = '';

    if (!text.trim()) return;

    // User spoke — track activity time and cancel the old timeout
    // (a fresh timeout starts after the agent finishes speaking, not here)
    this.lastUserActivityTime = Date.now();
    this.clearIdleTimeout();

    // Clear any pending finalization timer
    if (this.finalTranscriptTimer) {
      clearTimeout(this.finalTranscriptTimer);
    }

    // Process immediately — no debounce (Sarvam only sends finals, Deepgram endpointing handles its own timing)
    this.processUserUtterance(text);
  }

  // ── Private: TTS Queue ────────────────────────────────

  private ttsQueue: string[] = [];
  private isProcessingTtsQueue = false;

  private async processTtsQueue(): Promise<void> {
    if (this.isProcessingTtsQueue || this.ttsQueue.length === 0 || this.destroyed) return;
    this.isProcessingTtsQueue = true;
    const drainGeneration = this.ttsGeneration;
    const useStreaming = this.streamingPlayback && !!this.controlOutCallback;
    console.log(`[AudioSession:${this.id}] processTtsQueue - START (${this.ttsQueue.length} items, streaming=${useStreaming})`);

    // Pipeline synthesis ahead of playback: while the current sentence plays to
    // the caller, synthesize the next queued sentence in parallel so its
    // synthesis time overlaps playback instead of being added serially. Playback
    // itself stays strictly sequential (one speakText at a time) so audio never
    // overlaps.
    let prefetchText: string | null = null;
    let prefetchPromise: Promise<Buffer | null> | null = null;

    while ((this.ttsQueue.length > 0 || prefetchPromise) && !this.destroyed) {
      // Barge-in: if the caller interrupted since this drain started,
      // handleInterruption() bumped ttsGeneration — abandon the rest of the turn
      // (queued + prefetched) so we don't keep speaking over them.
      if (this.ttsGeneration !== drainGeneration) {
        this.ttsQueue.length = 0;
        break;
      }

      let text: string;
      let audio: Buffer | null;

      if (prefetchPromise) {
        text = prefetchText!;
        audio = await prefetchPromise;
        prefetchPromise = null;
        prefetchText = null;
      } else {
        text = this.ttsQueue.shift()!;
        // In streaming mode the first (non-prefetched) sentence is streamed live
        // so the caller hears the first audio as early as possible; buffered
        // prefetch (below) still overlaps synthesis of later sentences.
        audio = useStreaming ? null : await this.synthesizeSentence(text);
      }

      // If the caller interrupted while we were synthesizing, drop this sentence too.
      if (this.ttsGeneration !== drainGeneration) {
        this.ttsQueue.length = 0;
        break;
      }

      // Start synthesizing the next sentence while we play the current one.
      if (this.ttsQueue.length > 0 && !this.destroyed) {
        prefetchText = this.ttsQueue.shift()!;
        prefetchPromise = this.synthesizeSentence(prefetchText);
      }

      await this.speakText(text, audio);
    }

    this.isProcessingTtsQueue = false;
    console.log(`[AudioSession:${this.id}] processTtsQueue - DONE`);
    // All TTS done — start idle timeout for silence detection
    this.resetIdleTimeout();
  }

  /**
   * Synthesize a full sentence into a single PCM buffer. Runs independently of
   * playback so processTtsQueue can prefetch the next sentence while the current
   * one is still playing. Returns null if nothing was produced.
   */
  private async synthesizeSentence(text: string): Promise<Buffer | null> {
    if (this.destroyed || !this.ttsProvider) return null;
    try {
      const chunks: Buffer[] = [];
      let firstChunkLogged = false;
      for await (const audioChunk of this.getTtsStream(text)) {
        if (this.destroyed) break;
        if (!firstChunkLogged) {
          firstChunkLogged = true;
          if (this.turnStartTime > 0) {
            console.log(`[AudioSession:${this.id}] [latency] First TTS audio byte ${Date.now() - this.turnStartTime}ms after turn start`);
          }
        }
        chunks.push(audioChunk);
      }
      return chunks.length > 0 ? Buffer.concat(chunks) : null;
    } catch (err: any) {
      console.error(`[AudioSession:${this.id}] TTS synthesis error:`, err.message);
      return null;
    }
  }

  private queueTts(text: string): void {
    this.ttsQueue.push(text);
    console.log(`[AudioSession:${this.id}] queueTts - queued "${text.substring(0, 50)}..." (queue size: ${this.ttsQueue.length})`);
    if (!this.isProcessingTtsQueue) {
      this.processTtsQueue();
    }
  }

  // ── Private: LLM Processing ────────────────────────────

  private pendingUtterances: string[] = [];

  private async processNextUtterance(): Promise<void> {
    if (this.destroyed || this.isProcessingLlm || this.pendingUtterances.length === 0) return;
    const text = this.pendingUtterances.shift()!;
    await this.processUserUtterance(text);
  }

  private async processUserUtterance(text: string): Promise<void> {
    if (this.destroyed) return;
    if (this.isProcessingLlm) {
      console.log(`[AudioSession:${this.id}] processUserUtterance - LLM busy, queueing: "${text}"`);
      this.pendingUtterances.push(text);
      return;
    }
    this.isProcessingLlm = true;
    this.turnStartTime = Date.now();
    console.log(`[AudioSession:${this.id}] processUserUtterance - START: "${text}"`);

    // Cancel any idle timeout — we are actively processing; the timer
    // will restart in processTtsQueue() only after ALL TTS has finished.
    this.clearIdleTimeout();

    // Add user message
    this.conversationMessages.push({ role: 'user', content: text });
    this.addTranscriptEntry('user', text);

    this.emitPipelineEvent({
      type: 'llm_start',
      sessionId: this.id,
      timestamp: new Date().toISOString(),
    });

    try {
      const startTime = Date.now();

      // Stream LLM response for lower latency
      let fullResponse = '';
      let sentenceBuffer = '';
      this.accumulatedToolCalls.clear();

      const stream = this.llmProvider!.stream(
        this.conversationMessages as any,
        this.llmConfig,
        this.tools.length > 0 ? this.tools : undefined
      );

      let firstTokenLogged = false;
      for await (const chunk of stream) {
        if (this.destroyed) break;

        if (chunk.content) {
          if (!firstTokenLogged) {
            firstTokenLogged = true;
            console.log(`[AudioSession:${this.id}] [latency] LLM first token ${Date.now() - this.turnStartTime}ms after turn start`);
          }
          fullResponse += chunk.content;
          sentenceBuffer += chunk.content;

          // Send to TTS as soon as we have a complete sentence (non-blocking — LLM keeps streaming)
          const sentenceEnd = this.findSentenceEnd(sentenceBuffer);
          if (sentenceEnd !== -1) {
            const sentence = sentenceBuffer.substring(0, sentenceEnd + 1).trim();
            sentenceBuffer = sentenceBuffer.substring(sentenceEnd + 1);

            if (sentence) {
              this.queueTts(sentence);
            }
          }
        }

        // Accumulate tool call deltas
        if (chunk.toolCalls) {
          for (const deltaTc of chunk.toolCalls) {
            if (deltaTc.index === undefined) continue;
            const existing = this.accumulatedToolCalls.get(deltaTc.index) || {};
            if (deltaTc.id) existing.id = deltaTc.id;
            if (deltaTc.type) existing.type = deltaTc.type;
            if (deltaTc.function) {
              if (!existing.function) existing.function = { name: '', arguments: '' };
              if (deltaTc.function.name) existing.function.name = (existing.function.name || '') + deltaTc.function.name;
              if (deltaTc.function.arguments) existing.function.arguments = (existing.function.arguments || '') + deltaTc.function.arguments;
            }
            this.accumulatedToolCalls.set(deltaTc.index, existing);
          }
        }
      }

      // If stream ended with tool calls, execute them
      const toolCallEntries = Array.from(this.accumulatedToolCalls.entries())
        .sort(([a], [b]) => a - b)
        .map(([_, tc]) => tc as LlmToolCall)
        .filter(tc => tc.id && tc.function?.name);

      if (toolCallEntries.length > 0) {
        console.log(`[AudioSession:${this.id}] LLM returned ${toolCallEntries.length} tool calls, executing...`);

        // Save the assistant's tool call message
        this.conversationMessages.push({
          role: 'assistant',
          content: fullResponse || null,
          toolCalls: toolCallEntries,
        });

        let hasEndCall = false;

        for (const tc of toolCallEntries) {
          console.log(`[AudioSession:${this.id}] Tool call: ${tc.function.name}(${tc.function.arguments})`);

          const metadata = this.toolMetadata.get(tc.function.name);
          const result = await ToolExecutor.executeToolCall(
            tc,
            metadata,
            this.session.userId,
            this.agentConfig.id,
            this.session.callId,
            this
          );

          if (tc.function.name === 'end_call') {
            hasEndCall = true;
          }

          // Add tool result to conversation
          this.conversationMessages.push({
            role: 'tool',
            content: JSON.stringify(result.result),
            toolCallId: tc.id,
          });

          this.emitPipelineEvent({
            type: 'llm_tool_call',
            sessionId: this.id,
            toolCall: tc,
            timestamp: new Date().toISOString(),
          } as any);
        }

        // If we're ending the call, skip the follow-up response
        if (hasEndCall || this.destroyed) {
          this.session.llmPromptTokens += Math.round(fullResponse.length / 4);
          this.session.llmCompletionTokens += Math.round(fullResponse.length / 4);
          return;
        }

        // Stream the follow-up response for spoken confirmation (no tools), using
        // the same sentence-by-sentence TTS pipelining as the main reply path so
        // the agent starts speaking as soon as the first sentence is ready
        // instead of waiting for the entire follow-up to be generated.
        console.log(`[AudioSession:${this.id}] Streaming follow-up LLM response for tool confirmation...`);

        // Cancel idle timeout during tool execution + follow-up LLM — this can take many seconds
        this.clearIdleTimeout();

        const followUpStartTime = Date.now();
        let followUpFull = '';
        let followUpSentenceBuffer = '';

        const followUpStream = this.llmProvider!.stream(
          this.conversationMessages as any,
          this.llmConfig
        );

        for await (const chunk of followUpStream) {
          if (this.destroyed) break;
          if (chunk.content) {
            followUpFull += chunk.content;
            followUpSentenceBuffer += chunk.content;

            const sentenceEnd = this.findSentenceEnd(followUpSentenceBuffer);
            if (sentenceEnd !== -1) {
              const sentence = followUpSentenceBuffer.substring(0, sentenceEnd + 1).trim();
              followUpSentenceBuffer = followUpSentenceBuffer.substring(sentenceEnd + 1);
              if (sentence) {
                this.queueTts(sentence);
              }
            }
          }
        }

        // Speak any trailing text that didn't end with sentence punctuation
        if (followUpSentenceBuffer.trim() && !this.destroyed) {
          this.queueTts(followUpSentenceBuffer.trim());
        }

        if (followUpFull && !this.destroyed) {
          this.conversationMessages.push({ role: 'assistant', content: followUpFull });

          this.session.llmPromptTokens += Math.round(followUpFull.length / 4); // approximate
          this.session.llmCompletionTokens += Math.round(followUpFull.length / 4);

          this.emitPipelineEvent({
            type: 'llm_response',
            sessionId: this.id,
            response: followUpFull,
            latencyMs: Date.now() - followUpStartTime,
            timestamp: new Date().toISOString(),
          });
        }

        this.accumulatedToolCalls.clear();
        this.trimConversationHistory();
        return;
      }

      // Speak any remaining text (from content stream)
      if (sentenceBuffer.trim() && !this.destroyed) {
        this.queueTts(sentenceBuffer.trim());
      }

      const latencyMs = Date.now() - startTime;
      console.log(`[AudioSession:${this.id}] processUserUtterance - LLM done in ${latencyMs}ms, response length: ${fullResponse.length} chars`);

      // Track usage
      this.session.llmPromptTokens += Math.round(fullResponse.length / 4); // approximate
      this.session.llmCompletionTokens += Math.round(fullResponse.length / 4);

      // Store assistant response in conversation (for LLM context)
      this.conversationMessages.push({ role: 'assistant', content: fullResponse });
      this.trimConversationHistory();
      // Transcript entry is added per-sentence in speakText after audio playback

      this.emitPipelineEvent({
        type: 'llm_response',
        sessionId: this.id,
        response: fullResponse,
        latencyMs,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error(`[AudioSession:${this.id}] LLM error:`, err.message, err.stack);
      this.emitPipelineEvent({
        type: 'error',
        sessionId: this.id,
        error: `LLM error: ${err.message}`,
        timestamp: new Date().toISOString(),
      });
      // Fallback: add a placeholder so the conversation doesn't dead-end
      if (!this.destroyed) {
        const fallbackMsg = 'I apologize, but I encountered a technical issue. Could you please repeat that?';
        this.conversationMessages.push({ role: 'assistant', content: fallbackMsg });
        this.queueTts(fallbackMsg);
      }
    } finally {
      this.isProcessingLlm = false;
      console.log(`[AudioSession:${this.id}] processUserUtterance - DONE, checking for queued utterances (${this.pendingUtterances.length} pending)`);
      // Process next queued utterance if any
      this.processNextUtterance();
    }
  }

  // ── Private: TTS Output ────────────────────────────────

  private async speakText(text: string, preSynth?: Buffer | null): Promise<void> {
    // Default to gap-free streaming playback when a control channel is wired;
    // otherwise use the legacy file-per-sentence uuid_broadcast path.
    if (this.streamingPlayback && this.controlOutCallback) {
      return this.speakTextStreaming(text, preSynth);
    }
    return this.speakTextFile(text, preSynth);
  }

  private async speakTextFile(text: string, preSynth?: Buffer | null): Promise<void> {
    if (this.destroyed || !this.ttsProvider || !this.audioOutCallback) {
      console.log(`[AudioSession:${this.id}] speakText - skipped (destroyed=${this.destroyed}, hasTts=${!!this.ttsProvider}, hasAudioCb=${!!this.audioOutCallback})`);
      return;
    }

    // Cancel any pending idle timeout — we must not time out while the agent is speaking.
    // processTtsQueue() will restart the timer after the full queue is drained.
    this.clearIdleTimeout();

    const drainGeneration = this.ttsGeneration;
    console.log(`[AudioSession:${this.id}] speakText - START playing: "${text.substring(0, 60)}..."`);

    this.emitPipelineEvent({
      type: 'tts_start',
      sessionId: this.id,
      text,
      timestamp: new Date().toISOString(),
    });

    try {
      // Use the prefetched buffer when processTtsQueue supplied one; otherwise
      // synthesize inline (e.g. the direct greeting call).
      let audio = preSynth ?? null;
      if (!audio) {
        const chunks: Buffer[] = [];
        let firstChunkLogged = false;
        for await (const audioChunk of this.getTtsStream(text)) {
          if (this.destroyed || this.ttsGeneration !== drainGeneration) break; // Interrupted or destroyed
          if (!firstChunkLogged) {
            firstChunkLogged = true;
            if (this.turnStartTime > 0) {
              console.log(`[AudioSession:${this.id}] [latency] First TTS audio byte ${Date.now() - this.turnStartTime}ms after turn start`);
            }
          }
          chunks.push(audioChunk);
        }
        audio = chunks.length > 0 ? Buffer.concat(chunks) : null;
      }

      // Guard against a sample-rate mismatch producing distorted "slow-motion"
      // audio — the playback WAV header is fixed at 8kHz.
      if (audio) {
        audio = this.ensureTelephonySampleRate(audio);
      }

      if (audio && audio.length > 0 && !this.destroyed && this.ttsGeneration === drainGeneration) {
        this.isPlayingTts = true;
        const totalBytes = audio.length;

        // Determine where this TTS playback starts in the recording
        const ttsPlayStartMs = Math.max(0, Date.now() - this.callAnsweredTime);
        let agentWriteOffset = Math.round(ttsPlayStartMs * 8) * 2;
        if (agentWriteOffset < this.lastOutgoingWriteEnd) {
          agentWriteOffset = this.lastOutgoingWriteEnd;
        }

        // Record outgoing audio in a single pass
        this.mixAudioAtOffset(audio, agentWriteOffset);
        this.lastOutgoingWriteEnd = agentWriteOffset + totalBytes;

        this.audioOutCallback(audio);

        // Wait for the audio to finish playing on the client side (FreeSWITCH)
        const playbackDurationMs = Math.round(totalBytes / 16);
        await new Promise((resolve) => setTimeout(resolve, playbackDurationMs));

        // Only add to transcript after audio was successfully sent AND played back
        this.addTranscriptEntry('assistant', text);
        console.log(`[AudioSession:${this.id}] speakText - FINISHED playback (${playbackDurationMs}ms), added to transcript`);

        this.session.ttsCharacters += text.length;
        this.session.ttsDurationMs += Math.round(totalBytes / 16); // approximate for 8kHz 16-bit

        this.emitPipelineEvent({
          type: 'tts_audio',
          sessionId: this.id,
          bytes: totalBytes,
          timestamp: new Date().toISOString(),
        });
      } else {
        console.log(`[AudioSession:${this.id}] speakText - audio DISCARDED (hasAudio=${!!audio}, destroyed=${this.destroyed}, isPlaying=${this.isPlayingTts})`);
      }
    } catch (err: any) {
      console.error(`[AudioSession:${this.id}] TTS error:`, err.message);
    } finally {
      this.isPlayingTts = false;
      this.lastTtsEndTime = Date.now();
      this.vadDetector.reset(); // Reset VAD after TTS playback
    }
  }

  /**
   * Streaming playback path (default). Forwards TTS audio to the caller in small
   * blocks as it is produced, over the mod_audio_fork websocket using drachtio's
   * `playAudio` control message. Consecutive blocks — and consecutive sentences —
   * are handed to the module back-to-back with no per-file gap, and the caller
   * starts hearing the agent as soon as the first block is generated. Falls back
   * to the legacy file path when no control channel is available.
   *
   * `preSynth` (a fully synthesized sentence buffer from the prefetch pipeline) is
   * chunked and streamed in blocks; when omitted the audio is streamed live from
   * the TTS provider for the fastest possible first audio.
   */
  private async speakTextStreaming(text: string, preSynth?: Buffer | null): Promise<void> {
    if (this.destroyed || !this.controlOutCallback || (!this.ttsProvider && !preSynth)) {
      // No control channel / provider — never drop audio, use the file path.
      return this.speakTextFile(text, preSynth);
    }

    // Cancel any pending idle timeout — we must not time out while speaking.
    this.clearIdleTimeout();

    const drainGeneration = this.ttsGeneration;
    console.log(`[AudioSession:${this.id}] speakTextStreaming - START "${text.substring(0, 60)}..."`);

    this.emitPipelineEvent({
      type: 'tts_start',
      sessionId: this.id,
      text,
      timestamp: new Date().toISOString(),
    });

    // Small first block => caller hears audio quickly; larger subsequent blocks
    // => fewer control messages / playback handoffs for the rest of the sentence.
    const FIRST_FLUSH_BYTES = 1600; // ~100ms @ 8kHz 16-bit mono
    const FLUSH_BYTES = 8000;       // ~500ms @ 8kHz 16-bit mono

    // Where this playback starts in the outgoing recording timeline.
    let offset = Math.round(Math.max(0, Date.now() - this.callAnsweredTime) * 8) * 2;
    if (offset < this.lastOutgoingWriteEnd) offset = this.lastOutgoingWriteEnd;
    let totalBytes = 0;
    let firstFlushDone = false;
    let firstBlockLogged = false;

    // Barge-in / teardown check: handleInterruption() bumps ttsGeneration and
    // clears isPlayingTts, so an interruption stops the drain promptly.
    const stopped = () =>
      this.destroyed || this.ttsGeneration !== drainGeneration;

    const flush = async (block: Buffer): Promise<void> => {
      const out = this.ensureTelephonySampleRate(block);
      if (out.length === 0) return;
      if (offset < this.lastOutgoingWriteEnd) offset = this.lastOutgoingWriteEnd;
      // Keep the outgoing-audio recording aligned, one block at a time.
      this.mixAudioAtOffset(out, offset);
      offset += out.length;
      this.lastOutgoingWriteEnd = offset;
      totalBytes += out.length;

      // Mark that we are playing/streaming TTS to allow VAD barge-in
      this.isPlayingTts = true;

      this.controlOutCallback!({
        type: 'playAudio',
        data: {
          audioContentType: 'raw',
          sampleRate: '8000',
          audioContent: out.toString('base64'),
        },
      });

      if (!firstBlockLogged) {
        firstBlockLogged = true;
        if (this.turnStartTime > 0) {
          console.log(`[AudioSession:${this.id}] [latency] First TTS audio sent ${Date.now() - this.turnStartTime}ms after turn start`);
        }
      }

      // Pace roughly at real time so the module's playback queue stays shallow and
      // sentence sequencing / transcript timing stay correct.
      await new Promise((resolve) => setTimeout(resolve, Math.round(out.length / 16)));
    };

    try {
      let pending = Buffer.alloc(0);
      const source: AsyncIterable<Buffer> = preSynth
        ? (async function* () { yield preSynth!; })()
        : this.getTtsStream(text);

      for await (const chunk of source) {
        if (stopped()) break;
        pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;

        let threshold = firstFlushDone ? FLUSH_BYTES : FIRST_FLUSH_BYTES;
        while (pending.length >= threshold) {
          const block = Buffer.from(pending.subarray(0, threshold));
          pending = pending.subarray(threshold);
          firstFlushDone = true;
          await flush(block);
          if (stopped()) break;
          threshold = FLUSH_BYTES;
        }
        if (stopped()) break;
      }

      // Flush any trailing audio that didn't reach a full block.
      if (!stopped() && pending.length > 0) {
        await flush(Buffer.from(pending));
      }

      if (totalBytes > 0 && this.ttsGeneration === drainGeneration) {
        // Only record the transcript after audio was actually streamed out.
        this.addTranscriptEntry('assistant', text);
        this.session.ttsCharacters += text.length;
        this.session.ttsDurationMs += Math.round(totalBytes / 16); // approx 8kHz 16-bit
        this.emitPipelineEvent({
          type: 'tts_audio',
          sessionId: this.id,
          bytes: totalBytes,
          timestamp: new Date().toISOString(),
        });
        console.log(`[AudioSession:${this.id}] speakTextStreaming - FINISHED (${totalBytes} bytes)`);
      } else {
        console.log(`[AudioSession:${this.id}] speakTextStreaming - stopped/empty (bytes=${totalBytes})`);
      }
    } catch (err: any) {
      console.error(`[AudioSession:${this.id}] streaming TTS error:`, err.message);
    } finally {
      this.isPlayingTts = false;
      this.lastTtsEndTime = Date.now();
      this.vadDetector.reset();
    }
  }

  private mixAudioAtOffset(chunk: Buffer, startOffset: number): void {
    if (this.destroyed || chunk.length === 0) return;

    const endOffset = startOffset + chunk.length;

    if (endOffset > this.pcmBuffer.length) {
      const newBuffer = Buffer.alloc(endOffset);
      this.pcmBuffer.copy(newBuffer);
      this.pcmBuffer = newBuffer;
    }

    // Mix using Int16Array views instead of per-sample readInt16LE/writeInt16LE
    // calls. Offsets are always even (byte offsets are computed as sample*2), so
    // the destination view is safe; the source falls back to reads if it happens
    // to be odd-aligned. This keeps the hot mixing loop from blocking the event
    // loop under concurrency.
    const sampleCount = chunk.length >> 1;
    const dst = new Int16Array(
      this.pcmBuffer.buffer,
      this.pcmBuffer.byteOffset + startOffset,
      sampleCount
    );

    if (((chunk.byteOffset) & 1) === 0) {
      const src = new Int16Array(chunk.buffer, chunk.byteOffset, sampleCount);
      for (let i = 0; i < sampleCount; i++) {
        let mixed = dst[i] + src[i];
        if (mixed > 32767) mixed = 32767;
        else if (mixed < -32768) mixed = -32768;
        dst[i] = mixed;
      }
    } else {
      for (let i = 0; i < sampleCount; i++) {
        let mixed = dst[i] + chunk.readInt16LE(i << 1);
        if (mixed > 32767) mixed = 32767;
        else if (mixed < -32768) mixed = -32768;
        dst[i] = mixed;
      }
    }
  }

  /**
   * The playback path writes a fixed 8kHz WAV header, so any TTS audio produced
   * at a different sample rate would play back distorted ("slow-motion"). If the
   * TTS config requests a non-8kHz rate, downsample the PCM to 8kHz here so the
   * caller always hears correct-speed audio. No-op for the normal 8kHz case.
   */
  private ensureTelephonySampleRate(audio: Buffer): Buffer {
    const configured = this.ttsConfig.outputFormat?.sampleRate;
    if (!configured || configured === 8000) return audio;
    if (!this.sampleRateWarned) {
      this.sampleRateWarned = true;
      console.warn(`[AudioSession:${this.id}] TTS sample rate ${configured}Hz != 8000Hz playback rate — resampling to 8kHz to avoid distorted audio`);
    }
    return this.resamplePcm16(audio, configured, 8000);
  }

  private resamplePcm16(audio: Buffer, fromRate: number, toRate: number): Buffer {
    if (fromRate === toRate || audio.length < 2) return audio;
    const srcSamples = audio.length >> 1;
    const ratio = toRate / fromRate;
    const dstSamples = Math.max(1, Math.floor(srcSamples * ratio));
    const out = Buffer.alloc(dstSamples * 2);
    for (let i = 0; i < dstSamples; i++) {
      const srcPos = i / ratio;
      const idx = Math.floor(srcPos);
      const frac = srcPos - idx;
      const s0 = audio.readInt16LE(Math.min(idx, srcSamples - 1) * 2);
      const s1 = audio.readInt16LE(Math.min(idx + 1, srcSamples - 1) * 2);
      out.writeInt16LE(Math.round(s0 + (s1 - s0) * frac), i * 2);
    }
    return out;
  }

  /**
   * Cap the live conversation history so long calls don't keep inflating the LLM
   * prompt every turn (which steadily raises latency). Always keeps the system
   * prompt plus the most recent messages, and never leaves a dangling tool
   * result whose assistant tool-call parent was trimmed away.
   */
  private trimConversationHistory(): void {
    const MAX_RECENT = 40;
    if (this.conversationMessages.length <= MAX_RECENT + 1) return;
    const system = this.conversationMessages[0];
    const rest = this.conversationMessages.slice(1);
    let start = rest.length - MAX_RECENT;
    // Don't start the retained window on a tool result — its assistant tool-call
    // parent would be gone, an invalid message sequence for the LLM.
    while (start < rest.length && (rest[start] as any).role === 'tool') {
      start++;
    }
    this.conversationMessages = [system, ...rest.slice(start)];
  }

  // ── Private: Interruption Handling ─────────────────────

  private handleInterruption(): void {
    if (!this.isPlayingTts) return;

    this.isPlayingTts = false;
    this.isProcessingLlm = false;
    // Signal the TTS drain loop to abandon the rest of this turn's queued and
    // prefetched sentences so the agent stops talking over the caller.
    this.ttsGeneration++;
    this.vadDetector.reset();

    // Send pre-buffered audio to STT so the start of the utterance isn't lost
    if (this.bargeInPreBuffer.length > 0 && this.sttProvider?.isConnected()) {
      console.log(`[AudioSession:${this.id}] Sending ${this.bargeInPreBuffer.length} bytes of pre-buffered barge-in audio to STT`);
      this.sttProvider.sendAudio(this.bargeInPreBuffer);
      this.bargeInPreBuffer = Buffer.alloc(0);
    }

    this.emitPipelineEvent({
      type: 'interruption',
      sessionId: this.id,
      timestamp: new Date().toISOString(),
    });

    console.log(`[AudioSession:${this.id}] User interrupted TTS`);
  }

  // ── Private: Helpers ───────────────────────────────────

  private findSentenceEnd(text: string): number {
    // Find the last sentence-ending punctuation, including Hindi full stops (। and |)
    const endings = ['. ', '! ', '? ', '.\n', '!\n', '?\n', '। ', '।\n', '| ', '|\n'];
    let lastEnd = -1;

    for (const ending of endings) {
      const idx = text.lastIndexOf(ending);
      if (idx > lastEnd) {
        lastEnd = idx;
      }
    }

    return lastEnd;
  }

  private splitIntoSentences(text: string): string[] {
    const sentences: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      const endings = ['. ', '! ', '? ', '.\n', '!\n', '?\n', '। ', '।\n', '| ', '|\n', '.', '!', '?', '।', '|'];
      let earliestIdx = -1;
      let matchedEnding = '';

      for (const ending of endings) {
        const idx = remaining.indexOf(ending);
        if (idx !== -1 && (earliestIdx === -1 || idx < earliestIdx)) {
          earliestIdx = idx;
          matchedEnding = ending;
        }
      }

      if (earliestIdx !== -1) {
        const sentence = remaining.substring(0, earliestIdx + matchedEnding.trim().length).trim();
        if (sentence) {
          sentences.push(sentence);
        }
        remaining = remaining.substring(earliestIdx + matchedEnding.length).trim();
      } else {
        if (remaining.trim()) {
          sentences.push(remaining.trim());
        }
        break;
      }
    }

    return sentences;
  }

  private detectTtsLanguage(text: string, defaultLang: string): string {
    if (/[\u0900-\u097F]/.test(text)) return 'hi-IN'; // Hindi/Devanagari
    if (/[\u0B80-\u0BFF]/.test(text)) return 'ta-IN'; // Tamil
    if (/[\u0C00-\u0C7F]/.test(text)) return 'te-IN'; // Telugu
    if (/[\u0C80-\u0CFF]/.test(text)) return 'kn-IN'; // Kannada
    if (/[\u0D00-\u0D7F]/.test(text)) return 'ml-IN'; // Malayalam
    if (/[\u0980-\u09FF]/.test(text)) return 'bn-IN'; // Bengali/Assamese
    if (/[\u0A80-\u0AFF]/.test(text)) return 'gu-IN'; // Gujarati
    if (/[\u0A00-\u0A7F]/.test(text)) return 'pa-IN'; // Punjabi
    if (/[\u0B00-\u0B7F]/.test(text)) return 'od-IN'; // Oriya
    return defaultLang;
  }

  private addTranscriptEntry(role: TranscriptEntry['role'], content: string): void {
    this.session.transcript.push({
      role,
      content,
      timestamp: new Date().toISOString(),
    });
  }

  private updateStatus(status: SessionStatus): void {
    this.session.status = status;
    this.emit('statusChange', status);
  }

  private emitPipelineEvent(event: PipelineEvent): void {
    this.emit('pipelineEvent', event);
  }
}
