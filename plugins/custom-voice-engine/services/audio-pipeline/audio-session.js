import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import { db } from "../../../../server/db.js";
import { sql } from "drizzle-orm";
import { ToolExecutor } from "../tools/tool-executor.js";
import { DEFAULT_TELEPHONY_FORMAT } from "../../types.js";
import { SttProviderFactory } from "../providers/stt/stt-provider.factory.js";
import { LlmProviderFactory } from "../providers/llm/llm-provider.factory.js";
import { TtsProviderFactory } from "../providers/tts/tts-provider.factory.js";
import { VadDetector } from "./vad-detector.js";
function writeWavHeader(samplesLength, sampleRate, numChannels, bitsPerSample) {
  const header = Buffer.alloc(44);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = samplesLength * blockAlign;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return header;
}
class AudioSession extends EventEmitter {
  id;
  channelUuid;
  isTransferred = false;
  session;
  agentConfig;
  sttConfig;
  llmConfig;
  ttsConfig;
  // Pipeline components
  sttProvider = null;
  llmProvider = null;
  ttsProvider = null;
  vadDetector;
  // State
  isProcessingLlm = false;
  isPlayingTts = false;
  sampleRateWarned = false;
  ttsGeneration = 0;
  lastTtsEndTime = 0;
  pendingTranscript = "";
  finalTranscriptTimer = null;
  conversationMessages = [];
  sessionStartTime;
  destroyed = false;
  silenceWarningCount = 0;
  initialized = false;
  isCallAnswered = false;
  firstMessageTriggered = false;
  callAnsweredTime = 0;
  lastIncomingWriteEnd = 0;
  lastOutgoingWriteEnd = 0;
  // Recording buffer
  pcmBuffer = Buffer.alloc(0);
  totalIncomingBytes = 0;
  bargeInPreBuffer = Buffer.alloc(0);
  // Idle timeout
  idleTimeoutId = null;
  lastUserActivityTime = 0;
  // Audio output callback (sends audio back to FreeSWITCH)
  audioOutCallback = null;
  // Sends a control/JSON text frame to mod_audio_fork over this session's
  // websocket (used by the streaming `playAudio` / `killAudio` protocol).
  controlOutCallback = null;
  // Experimental gap-free streaming playback. OFF by default so live calls keep
  // using the proven file-per-sentence uuid_broadcast path until streaming is
  // validated on real phone calls. Set VE_STREAMING_PLAYBACK=true to enable it.
  // (On this deployment mod_audio_fork turns each streamed block into its own
  // uuid_broadcast, so streaming must be A/B tested on real calls before it can
  // safely become the default.)
  streamingPlayback = process.env.VE_STREAMING_PLAYBACK === "true";
  // Tool calling
  tools = [];
  toolMetadata = /* @__PURE__ */ new Map();
  accumulatedToolCalls = /* @__PURE__ */ new Map();
  // Pre-synthesized greeting audio (the static firstMessage). Synthesized during
  // initialize() so the greeting plays immediately on answer instead of paying a
  // cold TTS round-trip on the critical path. Falls back to live synthesis on miss.
  greetingAudioCache = null;
  greetingCacheText = null;
  preSynthesizePromise = null;
  // Latency instrumentation: marks the start of the current turn (caller finished
  // speaking) so we can log STT→LLM→TTS→playback timings per turn.
  turnStartTime = 0;
  constructor(sessionId, session, agentConfig, sttConfig, llmConfig, ttsConfig, vadConfig, tools, toolMetadata) {
    super();
    this.id = sessionId;
    this.session = session;
    this.agentConfig = agentConfig;
    this.sttConfig = sttConfig;
    this.llmConfig = llmConfig;
    this.ttsConfig = ttsConfig;
    this.vadDetector = new VadDetector(vadConfig);
    this.sessionStartTime = Date.now();
    this.isCallAnswered = session.direction === "inbound";
    if (this.isCallAnswered) {
      this.callAnsweredTime = Date.now();
    }
    if (tools) this.tools = tools;
    if (toolMetadata) this.toolMetadata = toolMetadata;
  }
  isInitialized() {
    return this.initialized;
  }
  get direction() {
    return this.session.direction;
  }
  /**
   * Initialize the audio pipeline (connect STT, prepare LLM/TTS)
   */
  async initialize() {
    if (this.initialized) return;
    this.initialized = true;
    try {
      this.sttProvider = SttProviderFactory.create(this.sttConfig.provider);
      await this.sttProvider.connect(this.sttConfig, DEFAULT_TELEPHONY_FORMAT);
      this.sttProvider.onTranscript((transcript) => {
        this.handleSttTranscript(transcript);
      });
      this.sttProvider.onError((error) => {
        this.emitPipelineEvent({
          type: "error",
          sessionId: this.id,
          error: `STT error: ${error.message}`,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      });
      this.llmProvider = LlmProviderFactory.create(this.llmConfig.provider);
      this.ttsProvider = TtsProviderFactory.create(this.ttsConfig.provider);
      this.preSynthesizePromise = this.preSynthesizeGreeting();
      const now = /* @__PURE__ */ new Date();
      const formatterOptions = { timeZone: "Asia/Kolkata" };
      const dateContext = [
        `

---`,
        `**Current date/time context (use this for all date calculations):**`,
        `- Today's date: ${now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", ...formatterOptions })}`,
        `- ISO date: ${now.toLocaleDateString("en-CA", formatterOptions)}   (YYYY-MM-DD format \u2014 always use this format for appointmentDate)`,
        `- Current time: ${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true, ...formatterOptions })}`,
        `- Day of week: ${now.toLocaleDateString("en-US", { weekday: "long", ...formatterOptions })}`,
        `When the user says "today", use ${now.toLocaleDateString("en-CA", formatterOptions)}. When they say "tomorrow", use ${new Date(now.getTime() + 864e5).toLocaleDateString("en-CA", formatterOptions)}.`
      ].join("\n");
      const baseSystemPrompt = this.llmConfig.systemPrompt || this.agentConfig.systemPrompt || "";
      const finalPromptContent = this.llmConfig.systemPrompt ? baseSystemPrompt : baseSystemPrompt + dateContext;
      this.conversationMessages.push({
        role: "system",
        content: finalPromptContent
      });
      this.updateStatus("active");
      this.emitPipelineEvent({
        type: "session_start",
        sessionId: this.id,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      console.log(`[AudioSession:${this.id}] Pipeline initialized. direction=${this.session.direction}, answered=${this.isCallAnswered}`);
    } catch (err) {
      this.updateStatus("failed");
      throw new Error(`Pipeline initialization failed: ${err.message}`);
    }
  }
  /**
   * Pre-synthesize the static greeting audio during pipeline init.
   * Runs in the background (fire-and-forget). On success the greeting plays
   * from memory on answer; on any failure we simply fall back to live synthesis.
   */
  async preSynthesizeGreeting() {
    const greeting = this.agentConfig.firstMessage;
    if (!greeting || !this.ttsProvider) return;
    try {
      const startTime = Date.now();
      const chunks = [];
      const config = { ...this.ttsConfig };
      if (this.agentConfig.detectLanguageEnabled) {
        config.language = this.detectTtsLanguage(greeting, config.language || "en-IN");
      }
      for await (const audioChunk of this.ttsProvider.synthesizeStream(greeting, config)) {
        chunks.push(audioChunk);
      }
      if (chunks.length > 0 && !this.destroyed) {
        this.greetingAudioCache = Buffer.concat(chunks);
        this.greetingCacheText = greeting;
        console.log(`[AudioSession:${this.id}] [latency] Greeting pre-synthesized in ${Date.now() - startTime}ms (${this.greetingAudioCache.length} bytes cached)`);
      }
    } catch (err) {
      console.warn(`[AudioSession:${this.id}] Greeting pre-synthesis failed (will fall back to live TTS): ${err.message}`);
    }
  }
  async triggerFirstMessage() {
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
      const sentences = this.splitIntoSentences(this.agentConfig.firstMessage);
      console.log(`[AudioSession:${this.id}] triggerFirstMessage - split uncached greeting into ${sentences.length} sentences`);
      for (const sentence of sentences) {
        this.queueTts(sentence);
      }
      while (this.isProcessingTtsQueue || this.ttsQueue.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    this.conversationMessages.push({
      role: "assistant",
      content: this.agentConfig.firstMessage
    });
    console.log(`[AudioSession:${this.id}] [latency] triggerFirstMessage - done in ${Date.now() - greetingStart}ms`);
  }
  /**
   * Yield TTS audio for `text`. If we have a matching pre-synthesized buffer
   * (the greeting), stream it from memory in provider-sized frames; otherwise
   * fall through to live provider synthesis. Keeps speakText's mixing/offset
   * logic identical for both paths.
   */
  async *getTtsStream(text) {
    if (text === this.agentConfig.firstMessage && this.preSynthesizePromise) {
      try {
        await this.preSynthesizePromise;
      } catch (err) {
        console.warn(`[AudioSession:${this.id}] Failed waiting for greeting pre-synthesis: ${err.message}`);
      }
    }
    if (this.greetingAudioCache && this.greetingCacheText === text) {
      const cached = this.greetingAudioCache;
      const chunkSize = 640;
      for (let offset = 0; offset < cached.length; offset += chunkSize) {
        yield cached.subarray(offset, Math.min(offset + chunkSize, cached.length));
      }
      return;
    }
    const config = { ...this.ttsConfig };
    if (this.agentConfig.detectLanguageEnabled) {
      config.language = this.detectTtsLanguage(text, config.language || "en-IN");
    }
    yield* this.ttsProvider.synthesizeStream(text, config);
  }
  async enableAudio() {
    if (!this.isCallAnswered) {
      console.log(`[AudioSession:${this.id}] enableAudio - marking answered`);
      this.isCallAnswered = true;
      this.callAnsweredTime = Date.now();
    } else {
      console.log(`[AudioSession:${this.id}] enableAudio - already answered`);
    }
  }
  async markCallAnswered() {
    if (!this.isCallAnswered) {
      console.log(`[AudioSession:${this.id}] callAnswered - marking answered, triggering first message`);
      this.isCallAnswered = true;
      this.callAnsweredTime = Date.now();
      this.emit("callAnswered");
    }
    await this.triggerFirstMessage();
  }
  /**
   * Process incoming audio from FreeSWITCH (mod_audio_fork)
   */
  processAudio(chunk) {
    if (this.destroyed) return;
    if (!this.isCallAnswered) return;
    const elapsedMs = Math.max(0, Date.now() - this.callAnsweredTime);
    let startOffset = Math.round(elapsedMs * 8) * 2;
    if (startOffset < this.lastIncomingWriteEnd) {
      startOffset = this.lastIncomingWriteEnd;
    }
    this.mixAudioAtOffset(chunk, startOffset);
    this.lastIncomingWriteEnd = startOffset + chunk.length;
    const timeSinceLastTts = Date.now() - this.lastTtsEndTime;
    const isWithinEchoGuardWindow = timeSinceLastTts < 250;
    if (!isWithinEchoGuardWindow) {
      const vadResult = this.vadDetector.processChunk(chunk, this.isPlayingTts);
      if (vadResult.isSpeechEnd) {
        console.log(`[AudioSession:${this.id}] VAD isSpeechEnd, provider=${this.sttProvider?.name}, hasFlush=${typeof this.sttProvider?.flush === "function"}, playingTts=${this.isPlayingTts}`);
      }
      if (vadResult.isSpeechStart) {
        this.clearIdleTimeout();
        this.silenceWarningCount = 0;
        if (this.isPlayingTts && this.agentConfig.interruptible) {
          this.handleInterruption();
        }
      }
      if (vadResult.isSpeechEnd && this.sttProvider?.flush) {
        console.log(`[AudioSession:${this.id}] Calling STT flush`);
        this.sttProvider.flush().catch((err) => {
          console.error(`[AudioSession:${this.id}] STT flush error:`, err.message);
        });
      }
    }
    const canSendAudio = !this.isPlayingTts;
    if (canSendAudio) {
      this.bargeInPreBuffer = Buffer.alloc(0);
      if (!isWithinEchoGuardWindow && this.sttProvider?.isConnected()) {
        this.sttProvider.sendAudio(chunk);
      }
    } else {
      const maxPreBufferBytes = 16e3;
      this.bargeInPreBuffer = Buffer.concat([this.bargeInPreBuffer, chunk]);
      if (this.bargeInPreBuffer.length > maxPreBufferBytes) {
        this.bargeInPreBuffer = this.bargeInPreBuffer.slice(this.bargeInPreBuffer.length - maxPreBufferBytes);
      }
    }
    const answeredTime = this.callAnsweredTime > 0 ? this.callAnsweredTime : this.sessionStartTime;
    const elapsed = (Date.now() - answeredTime) / 1e3;
    if (elapsed >= this.agentConfig.maxDurationSeconds) {
      this.end("timeout");
    }
  }
  /**
   * Set callback for sending audio back to caller
   */
  onAudioOut(callback) {
    this.audioOutCallback = callback;
  }
  /**
   * Set callback for sending control/JSON frames (playAudio / killAudio) to
   * mod_audio_fork over this session's websocket. Required for streaming playback.
   */
  onControlOut(callback) {
    this.controlOutCallback = callback;
  }
  /** True when gap-free streaming playback is active for this session. */
  get isStreamingPlayback() {
    return this.streamingPlayback && !!this.controlOutCallback;
  }
  // ── Private: Idle Timeout ──────────────────────────────
  getSilenceMessages() {
    const lang = this.agentConfig.language || "en";
    const baseLang = lang.split(/[-_]/)[0].toLowerCase();
    switch (baseLang) {
      case "hi":
        return {
          warning: "\u0928\u092E\u0938\u094D\u0924\u0947, \u0915\u094D\u092F\u093E \u0906\u092A \u0935\u0939\u0940\u0902 \u0939\u0948\u0902? \u092E\u0941\u091D\u0947 \u0906\u092A\u0915\u0940 \u0906\u0935\u093E\u091C\u093C \u0928\u0939\u0940\u0902 \u0906 \u0930\u0939\u0940 \u0939\u0948\u0964",
          end: "\u091A\u0942\u0902\u0915\u093F \u0906\u092A\u0915\u0940 \u0906\u0935\u093E\u091C\u093C \u0928\u0939\u0940\u0902 \u0906 \u0930\u0939\u0940 \u0939\u0948, \u0907\u0938\u0932\u093F\u090F \u0939\u092E \u0907\u0938 \u0915\u0949\u0932 \u0915\u094B \u0938\u092E\u093E\u092A\u094D\u0924 \u0915\u0930 \u0930\u0939\u0947 \u0939\u0948\u0902\u0964 \u0927\u0928\u094D\u092F\u0935\u093E\u0926\u0964"
        };
      case "ta":
        return {
          warning: "\u0BB5\u0BA3\u0B95\u0BCD\u0B95\u0BAE\u0BCD, \u0BA8\u0BC0\u0B99\u0BCD\u0B95\u0BB3\u0BCD \u0B85\u0B99\u0BCD\u0B95\u0BC7 \u0B87\u0BB0\u0BC1\u0B95\u0BCD\u0B95\u0BBF\u0BB1\u0BC0\u0BB0\u0BCD\u0B95\u0BB3\u0BBE? \u0B89\u0B99\u0BCD\u0B95\u0BB3\u0BCD \u0B95\u0BC1\u0BB0\u0BB2\u0BCD \u0B95\u0BC7\u0B9F\u0BCD\u0B95\u0BB5\u0BBF\u0BB2\u0BCD\u0BB2\u0BC8.",
          end: "\u0B89\u0B99\u0BCD\u0B95\u0BB3\u0BCD \u0B95\u0BC1\u0BB0\u0BB2\u0BCD \u0B95\u0BC7\u0B9F\u0BCD\u0B95\u0BBE\u0BA4\u0BA4\u0BBE\u0BB2\u0BCD, \u0BA8\u0BBE\u0B99\u0BCD\u0B95\u0BB3\u0BCD \u0B85\u0BB4\u0BC8\u0BAA\u0BCD\u0BAA\u0BC8 \u0BAE\u0BC1\u0B9F\u0BBF\u0B95\u0BCD\u0B95\u0BBF\u0BB1\u0BCB\u0BAE\u0BCD. \u0BA8\u0BA9\u0BCD\u0BB1\u0BBF."
        };
      case "te":
        return {
          warning: "\u0C39\u0C32\u0C4B, \u0C2E\u0C40\u0C30\u0C41 \u0C05\u0C15\u0C4D\u0C15\u0C21\u0C47 \u0C09\u0C28\u0C4D\u0C28\u0C3E\u0C30\u0C3E? \u0C2E\u0C40 \u0C35\u0C3E\u0C2F\u0C3F\u0C38\u0C4D \u0C35\u0C3F\u0C28\u0C2A\u0C21\u0C21\u0C02 \u0C32\u0C47\u0C26\u0C41.",
          end: "\u0C2E\u0C40 \u0C35\u0C3E\u0C2F\u0C3F\u0C38\u0C4D \u0C35\u0C3F\u0C28\u0C2A\u0C21\u0C28\u0C02\u0C26\u0C41\u0C28, \u0C2E\u0C47\u0C2E\u0C41 \u0C15\u0C3E\u0C32\u0C4D \u0C2E\u0C41\u0C17\u0C3F\u0C38\u0C4D\u0C24\u0C41\u0C28\u0C4D\u0C28\u0C3E\u0C2E\u0C41. \u0C27\u0C28\u0C4D\u0C2F\u0C35\u0C3E\u0C26\u0C3E\u0C32\u0C41."
        };
      case "kn":
        return {
          warning: "\u0CB9\u0CB2\u0CCB, \u0CA8\u0CC0\u0CB5\u0CC1 \u0C85\u0CB2\u0CCD\u0CB2\u0CC7 \u0C87\u0CA6\u0CCD\u0CA6\u0CC0\u0CB0\u0CBE? \u0CA8\u0CBF\u0CAE\u0CCD\u0CAE \u0CA7\u0CCD\u0CB5\u0CA8\u0CBF \u0C95\u0CC7\u0CB3\u0CBF\u0CB8\u0CC1\u0CA4\u0CCD\u0CA4\u0CBF\u0CB2\u0CCD\u0CB2.",
          end: "\u0CA8\u0CBF\u0CAE\u0CCD\u0CAE \u0CA7\u0CCD\u0CB5\u0CA8\u0CBF \u0C95\u0CC7\u0CB3\u0CBF\u0CB8\u0CA6 \u0C95\u0CBE\u0CB0\u0CA3, \u0CA8\u0CBE\u0CB5\u0CC1 \u0C95\u0CB0\u0CC6\u0CAF\u0CA8\u0CCD\u0CA8\u0CC1 \u0CAE\u0CC1\u0C95\u0CCD\u0CA4\u0CBE\u0CAF\u0C97\u0CCA\u0CB3\u0CBF\u0CB8\u0CC1\u0CA4\u0CCD\u0CA4\u0CBF\u0CA6\u0CCD\u0CA6\u0CC7\u0CB5\u0CC6. \u0CA7\u0CA8\u0CCD\u0CAF\u0CB5\u0CBE\u0CA6\u0C97\u0CB3\u0CC1."
        };
      default:
        return {
          warning: "Hello, are you still there? I can't hear you.",
          end: "Since you are not audible, we are ending this call now. Goodbye."
        };
    }
  }
  resetIdleTimeout() {
    this.clearIdleTimeout();
    if (this.destroyed) return;
    const timeoutMs = this.agentConfig.silenceTimeoutMs || 15e3;
    const warningInterval = Math.max(5e3, Math.floor(timeoutMs / 2));
    this.idleTimeoutId = setTimeout(async () => {
      if (this.destroyed) return;
      const messages = this.getSilenceMessages();
      if (this.silenceWarningCount === 0) {
        this.silenceWarningCount++;
        console.log(`[AudioSession:${this.id}] Silence warning triggered, speaking check-in`);
        await this.speakText(messages.warning);
        this.resetIdleTimeout();
      } else {
        console.log(`[AudioSession:${this.id}] Second silence timeout reached, ending call`);
        await this.speakText(messages.end);
        setTimeout(() => {
          this.end("timeout");
        }, 2500);
      }
    }, warningInterval);
  }
  clearIdleTimeout() {
    if (this.idleTimeoutId) {
      clearTimeout(this.idleTimeoutId);
      this.idleTimeoutId = null;
    }
  }
  /**
   * End the session
   */
  async end(reason = "normal") {
    if (this.destroyed) return;
    this.clearIdleTimeout();
    const answeredTime = this.callAnsweredTime > 0 ? this.callAnsweredTime : this.sessionStartTime;
    this.session.durationSeconds = Math.floor((Date.now() - answeredTime) / 1e3);
    this.session.endedAt = /* @__PURE__ */ new Date();
    this.updateStatus("completing");
    if (this.finalTranscriptTimer) {
      clearTimeout(this.finalTranscriptTimer);
      this.finalTranscriptTimer = null;
    }
    try {
      if (this.sttProvider) await this.sttProvider.close();
    } catch {
    }
    this.destroyed = true;
    console.log(`[AudioSession:${this.id}] Session ending. pcmBuffer size: ${this.pcmBuffer.length} bytes. totalIncomingBytes: ${this.totalIncomingBytes}`);
    if (this.pcmBuffer.length > 0) {
      try {
        const expectedBufferBytes = Math.round(this.session.durationSeconds * 8e3 * 2);
        const trimmedBuffer = this.pcmBuffer.length > expectedBufferBytes ? this.pcmBuffer.slice(0, expectedBufferBytes) : this.pcmBuffer;
        if (trimmedBuffer.length !== this.pcmBuffer.length) {
          console.log(`[AudioSession:${this.id}] Trimmed pcmBuffer: ${this.pcmBuffer.length} -> ${trimmedBuffer.length} bytes (removed ${this.pcmBuffer.length - trimmedBuffer.length} trailing silence bytes)`);
        }
        const samplesCount = trimmedBuffer.length / 2;
        const durationSeconds = Math.round(samplesCount / 8e3);
        console.log(`[AudioSession:${this.id}] Preparing to save WAV recording. Samples: ${samplesCount}, Duration: ${durationSeconds}s`);
        const recordingsDir = path.join(process.cwd(), "client", "public", "uploads", "recordings");
        if (!fs.existsSync(recordingsDir)) {
          console.log(`[AudioSession:${this.id}] Creating recordings directory: ${recordingsDir}`);
          fs.mkdirSync(recordingsDir, { recursive: true });
        }
        const wavHeader = writeWavHeader(samplesCount, 8e3, 1, 16);
        const wavBuffer = Buffer.concat([wavHeader, trimmedBuffer]);
        const fileName = `${this.id}.wav`;
        const storagePath = path.join(recordingsDir, fileName);
        const storageUrl = `/uploads/recordings/${fileName}`;
        console.log(`[AudioSession:${this.id}] Writing WAV file to disk at: ${storagePath}`);
        await fs.promises.writeFile(storagePath, wavBuffer);
        console.log(`[AudioSession:${this.id}] WAV file successfully written to disk. File size: ${wavBuffer.length} bytes`);
        const textTranscript = typeof this.session.transcript === "string" ? this.session.transcript : JSON.stringify(this.session.transcript || []);
        console.log(`[AudioSession:${this.id}] Inserting recording metadata into ve_call_recordings table...`);
        await db.execute(sql`
          INSERT INTO ve_call_recordings (
            session_id, user_id, call_id, storage_backend, storage_path, storage_url, file_size, duration_seconds, format, status, transcript, created_at
          ) VALUES (
            ${this.id}, ${this.session.userId}, ${this.session.callId || null}, 'local', ${storagePath}, ${storageUrl}, ${wavBuffer.length}, ${durationSeconds}, 'wav', 'available', ${textTranscript}, NOW()
          )
        `);
        console.log(`[AudioSession:${this.id}] Successfully saved local recording to database with storageUrl: ${storageUrl}`);
      } catch (err) {
        console.error(`[AudioSession:${this.id}] Failed to save local recording:`, err.stack || err.message);
      }
    } else {
      console.warn(`[AudioSession:${this.id}] Warning: No audio was recorded for this session. pcmBuffer is empty.`);
    }
    this.updateStatus("completed");
    this.emitPipelineEvent({
      type: "session_end",
      sessionId: this.id,
      reason,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    console.log(`[AudioSession:${this.id}] Ended: ${reason} (${this.session.durationSeconds}s)`);
    this.emit("hangup", reason);
    this.removeAllListeners();
  }
  /**
   * Get current session data
   */
  getSession() {
    return { ...this.session };
  }
  // ── Private: STT Handling ──────────────────────────────
  lastTranscriptText = "";
  lastTranscriptTime = 0;
  handleSttTranscript(transcript) {
    if (this.destroyed) {
      console.log(`[AudioSession:${this.id}] handleSttTranscript - destroyed, ignoring "${transcript.text}"`);
      return;
    }
    this.emitPipelineEvent({
      type: "stt_transcript",
      sessionId: this.id,
      transcript,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    if (!transcript.isFinal) {
      this.pendingTranscript = transcript.text;
      console.log(`[AudioSession:${this.id}] handleSttTranscript - interim: "${transcript.text}"`);
      return;
    }
    const text = transcript.text || this.pendingTranscript;
    console.log(`[AudioSession:${this.id}] handleSttTranscript - FINAL: "${text}"`);
    if (text && this.lastTranscriptText === text && Date.now() - this.lastTranscriptTime < 3e3) {
      console.log(`[AudioSession:${this.id}] Skipping duplicate transcript: "${text}"`);
      return;
    }
    this.lastTranscriptText = text || "";
    this.lastTranscriptTime = Date.now();
    this.pendingTranscript = "";
    if (!text.trim()) return;
    this.lastUserActivityTime = Date.now();
    this.clearIdleTimeout();
    if (this.finalTranscriptTimer) {
      clearTimeout(this.finalTranscriptTimer);
    }
    this.processUserUtterance(text);
  }
  // ── Private: TTS Queue ────────────────────────────────
  ttsQueue = [];
  isProcessingTtsQueue = false;
  async processTtsQueue() {
    if (this.isProcessingTtsQueue || this.ttsQueue.length === 0 || this.destroyed) return;
    this.isProcessingTtsQueue = true;
    const drainGeneration = this.ttsGeneration;
    const useStreaming = this.streamingPlayback && !!this.controlOutCallback;
    console.log(`[AudioSession:${this.id}] processTtsQueue - START (${this.ttsQueue.length} items, streaming=${useStreaming})`);
    let prefetchText = null;
    let prefetchPromise = null;
    while ((this.ttsQueue.length > 0 || prefetchPromise) && !this.destroyed) {
      if (this.ttsGeneration !== drainGeneration) {
        this.ttsQueue.length = 0;
        break;
      }
      let text;
      let audio;
      if (prefetchPromise) {
        text = prefetchText;
        audio = await prefetchPromise;
        prefetchPromise = null;
        prefetchText = null;
      } else {
        text = this.ttsQueue.shift();
        audio = useStreaming ? null : await this.synthesizeSentence(text);
      }
      if (this.ttsGeneration !== drainGeneration) {
        this.ttsQueue.length = 0;
        break;
      }
      if (this.ttsQueue.length > 0 && !this.destroyed) {
        prefetchText = this.ttsQueue.shift();
        prefetchPromise = this.synthesizeSentence(prefetchText);
      }
      await this.speakText(text, audio);
    }
    this.isProcessingTtsQueue = false;
    console.log(`[AudioSession:${this.id}] processTtsQueue - DONE`);
    this.resetIdleTimeout();
  }
  /**
   * Synthesize a full sentence into a single PCM buffer. Runs independently of
   * playback so processTtsQueue can prefetch the next sentence while the current
   * one is still playing. Returns null if nothing was produced.
   */
  async synthesizeSentence(text) {
    if (this.destroyed || !this.ttsProvider) return null;
    try {
      const chunks = [];
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
    } catch (err) {
      console.error(`[AudioSession:${this.id}] TTS synthesis error:`, err.message);
      return null;
    }
  }
  queueTts(text) {
    this.ttsQueue.push(text);
    console.log(`[AudioSession:${this.id}] queueTts - queued "${text.substring(0, 50)}..." (queue size: ${this.ttsQueue.length})`);
    if (!this.isProcessingTtsQueue) {
      this.processTtsQueue();
    }
  }
  // ── Private: LLM Processing ────────────────────────────
  pendingUtterances = [];
  async processNextUtterance() {
    if (this.destroyed || this.isProcessingLlm || this.pendingUtterances.length === 0) return;
    const text = this.pendingUtterances.shift();
    await this.processUserUtterance(text);
  }
  async processUserUtterance(text) {
    if (this.destroyed) return;
    if (this.isProcessingLlm) {
      console.log(`[AudioSession:${this.id}] processUserUtterance - LLM busy, queueing: "${text}"`);
      this.pendingUtterances.push(text);
      return;
    }
    this.isProcessingLlm = true;
    this.turnStartTime = Date.now();
    console.log(`[AudioSession:${this.id}] processUserUtterance - START: "${text}"`);
    this.clearIdleTimeout();
    this.conversationMessages.push({ role: "user", content: text });
    this.addTranscriptEntry("user", text);
    this.emitPipelineEvent({
      type: "llm_start",
      sessionId: this.id,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    try {
      const startTime = Date.now();
      let fullResponse = "";
      let sentenceBuffer = "";
      this.accumulatedToolCalls.clear();
      const stream = this.llmProvider.stream(
        this.conversationMessages,
        this.llmConfig,
        this.tools.length > 0 ? this.tools : void 0
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
          const sentenceEnd = this.findSentenceEnd(sentenceBuffer);
          if (sentenceEnd !== -1) {
            const sentence = sentenceBuffer.substring(0, sentenceEnd + 1).trim();
            sentenceBuffer = sentenceBuffer.substring(sentenceEnd + 1);
            if (sentence) {
              this.queueTts(sentence);
            }
          }
        }
        if (chunk.toolCalls) {
          for (const deltaTc of chunk.toolCalls) {
            if (deltaTc.index === void 0) continue;
            const existing = this.accumulatedToolCalls.get(deltaTc.index) || {};
            if (deltaTc.id) existing.id = deltaTc.id;
            if (deltaTc.type) existing.type = deltaTc.type;
            if (deltaTc.function) {
              if (!existing.function) existing.function = { name: "", arguments: "" };
              if (deltaTc.function.name) existing.function.name = (existing.function.name || "") + deltaTc.function.name;
              if (deltaTc.function.arguments) existing.function.arguments = (existing.function.arguments || "") + deltaTc.function.arguments;
            }
            this.accumulatedToolCalls.set(deltaTc.index, existing);
          }
        }
      }
      const toolCallEntries = Array.from(this.accumulatedToolCalls.entries()).sort(([a], [b]) => a - b).map(([_, tc]) => tc).filter((tc) => tc.id && tc.function?.name);
      if (toolCallEntries.length > 0) {
        console.log(`[AudioSession:${this.id}] LLM returned ${toolCallEntries.length} tool calls, executing...`);
        this.conversationMessages.push({
          role: "assistant",
          content: fullResponse || null,
          toolCalls: toolCallEntries
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
          if (tc.function.name === "end_call") {
            hasEndCall = true;
          }
          this.conversationMessages.push({
            role: "tool",
            content: JSON.stringify(result.result),
            toolCallId: tc.id
          });
          this.emitPipelineEvent({
            type: "llm_tool_call",
            sessionId: this.id,
            toolCall: tc,
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          });
        }
        if (hasEndCall || this.destroyed) {
          this.session.llmPromptTokens += Math.round(fullResponse.length / 4);
          this.session.llmCompletionTokens += Math.round(fullResponse.length / 4);
          return;
        }
        console.log(`[AudioSession:${this.id}] Streaming follow-up LLM response for tool confirmation...`);
        this.clearIdleTimeout();
        const followUpStartTime = Date.now();
        let followUpFull = "";
        let followUpSentenceBuffer = "";
        const followUpStream = this.llmProvider.stream(
          this.conversationMessages,
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
        if (followUpSentenceBuffer.trim() && !this.destroyed) {
          this.queueTts(followUpSentenceBuffer.trim());
        }
        if (followUpFull && !this.destroyed) {
          this.conversationMessages.push({ role: "assistant", content: followUpFull });
          this.session.llmPromptTokens += Math.round(followUpFull.length / 4);
          this.session.llmCompletionTokens += Math.round(followUpFull.length / 4);
          this.emitPipelineEvent({
            type: "llm_response",
            sessionId: this.id,
            response: followUpFull,
            latencyMs: Date.now() - followUpStartTime,
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          });
        }
        this.accumulatedToolCalls.clear();
        this.trimConversationHistory();
        return;
      }
      if (sentenceBuffer.trim() && !this.destroyed) {
        this.queueTts(sentenceBuffer.trim());
      }
      const latencyMs = Date.now() - startTime;
      console.log(`[AudioSession:${this.id}] processUserUtterance - LLM done in ${latencyMs}ms, response length: ${fullResponse.length} chars`);
      this.session.llmPromptTokens += Math.round(fullResponse.length / 4);
      this.session.llmCompletionTokens += Math.round(fullResponse.length / 4);
      this.conversationMessages.push({ role: "assistant", content: fullResponse });
      this.trimConversationHistory();
      this.emitPipelineEvent({
        type: "llm_response",
        sessionId: this.id,
        response: fullResponse,
        latencyMs,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    } catch (err) {
      console.error(`[AudioSession:${this.id}] LLM error:`, err.message, err.stack);
      this.emitPipelineEvent({
        type: "error",
        sessionId: this.id,
        error: `LLM error: ${err.message}`,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      if (!this.destroyed) {
        const fallbackMsg = "I apologize, but I encountered a technical issue. Could you please repeat that?";
        this.conversationMessages.push({ role: "assistant", content: fallbackMsg });
        this.queueTts(fallbackMsg);
      }
    } finally {
      this.isProcessingLlm = false;
      console.log(`[AudioSession:${this.id}] processUserUtterance - DONE, checking for queued utterances (${this.pendingUtterances.length} pending)`);
      this.processNextUtterance();
    }
  }
  // ── Private: TTS Output ────────────────────────────────
  async speakText(text, preSynth) {
    if (this.streamingPlayback && this.controlOutCallback) {
      return this.speakTextStreaming(text, preSynth);
    }
    return this.speakTextFile(text, preSynth);
  }
  async speakTextFile(text, preSynth) {
    if (this.destroyed || !this.ttsProvider || !this.audioOutCallback) {
      console.log(`[AudioSession:${this.id}] speakText - skipped (destroyed=${this.destroyed}, hasTts=${!!this.ttsProvider}, hasAudioCb=${!!this.audioOutCallback})`);
      return;
    }
    this.clearIdleTimeout();
    const drainGeneration = this.ttsGeneration;
    console.log(`[AudioSession:${this.id}] speakText - START playing: "${text.substring(0, 60)}..."`);
    this.emitPipelineEvent({
      type: "tts_start",
      sessionId: this.id,
      text,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    try {
      let audio = preSynth ?? null;
      if (!audio) {
        const chunks = [];
        let firstChunkLogged = false;
        for await (const audioChunk of this.getTtsStream(text)) {
          if (this.destroyed || this.ttsGeneration !== drainGeneration) break;
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
      if (audio) {
        audio = this.ensureTelephonySampleRate(audio);
      }
      if (audio && audio.length > 0 && !this.destroyed && this.ttsGeneration === drainGeneration) {
        this.isPlayingTts = true;
        const totalBytes = audio.length;
        const ttsPlayStartMs = Math.max(0, Date.now() - this.callAnsweredTime);
        let agentWriteOffset = Math.round(ttsPlayStartMs * 8) * 2;
        if (agentWriteOffset < this.lastOutgoingWriteEnd) {
          agentWriteOffset = this.lastOutgoingWriteEnd;
        }
        this.mixAudioAtOffset(audio, agentWriteOffset);
        this.lastOutgoingWriteEnd = agentWriteOffset + totalBytes;
        this.audioOutCallback(audio);
        const playbackDurationMs = Math.round(totalBytes / 16);
        await new Promise((resolve) => setTimeout(resolve, playbackDurationMs));
        this.addTranscriptEntry("assistant", text);
        console.log(`[AudioSession:${this.id}] speakText - FINISHED playback (${playbackDurationMs}ms), added to transcript`);
        this.session.ttsCharacters += text.length;
        this.session.ttsDurationMs += Math.round(totalBytes / 16);
        this.emitPipelineEvent({
          type: "tts_audio",
          sessionId: this.id,
          bytes: totalBytes,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      } else {
        console.log(`[AudioSession:${this.id}] speakText - audio DISCARDED (hasAudio=${!!audio}, destroyed=${this.destroyed}, isPlaying=${this.isPlayingTts})`);
      }
    } catch (err) {
      console.error(`[AudioSession:${this.id}] TTS error:`, err.message);
    } finally {
      this.isPlayingTts = false;
      this.lastTtsEndTime = Date.now();
      this.vadDetector.reset();
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
  async speakTextStreaming(text, preSynth) {
    if (this.destroyed || !this.controlOutCallback || !this.ttsProvider && !preSynth) {
      return this.speakTextFile(text, preSynth);
    }
    this.clearIdleTimeout();
    const drainGeneration = this.ttsGeneration;
    console.log(`[AudioSession:${this.id}] speakTextStreaming - START "${text.substring(0, 60)}..."`);
    this.emitPipelineEvent({
      type: "tts_start",
      sessionId: this.id,
      text,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    const FIRST_FLUSH_BYTES = 1600;
    const FLUSH_BYTES = 8e3;
    let offset = Math.round(Math.max(0, Date.now() - this.callAnsweredTime) * 8) * 2;
    if (offset < this.lastOutgoingWriteEnd) offset = this.lastOutgoingWriteEnd;
    let totalBytes = 0;
    let firstFlushDone = false;
    let firstBlockLogged = false;
    const stopped = () => this.destroyed || this.ttsGeneration !== drainGeneration;
    const flush = async (block) => {
      const out = this.ensureTelephonySampleRate(block);
      if (out.length === 0) return;
      if (offset < this.lastOutgoingWriteEnd) offset = this.lastOutgoingWriteEnd;
      this.mixAudioAtOffset(out, offset);
      offset += out.length;
      this.lastOutgoingWriteEnd = offset;
      totalBytes += out.length;
      this.isPlayingTts = true;
      this.controlOutCallback({
        type: "playAudio",
        data: {
          audioContentType: "raw",
          sampleRate: "8000",
          audioContent: out.toString("base64")
        }
      });
      if (!firstBlockLogged) {
        firstBlockLogged = true;
        if (this.turnStartTime > 0) {
          console.log(`[AudioSession:${this.id}] [latency] First TTS audio sent ${Date.now() - this.turnStartTime}ms after turn start`);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, Math.round(out.length / 16)));
    };
    try {
      let pending = Buffer.alloc(0);
      const source = preSynth ? (async function* () {
        yield preSynth;
      })() : this.getTtsStream(text);
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
      if (!stopped() && pending.length > 0) {
        await flush(Buffer.from(pending));
      }
      if (totalBytes > 0 && this.ttsGeneration === drainGeneration) {
        this.addTranscriptEntry("assistant", text);
        this.session.ttsCharacters += text.length;
        this.session.ttsDurationMs += Math.round(totalBytes / 16);
        this.emitPipelineEvent({
          type: "tts_audio",
          sessionId: this.id,
          bytes: totalBytes,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
        console.log(`[AudioSession:${this.id}] speakTextStreaming - FINISHED (${totalBytes} bytes)`);
      } else {
        console.log(`[AudioSession:${this.id}] speakTextStreaming - stopped/empty (bytes=${totalBytes})`);
      }
    } catch (err) {
      console.error(`[AudioSession:${this.id}] streaming TTS error:`, err.message);
    } finally {
      this.isPlayingTts = false;
      this.lastTtsEndTime = Date.now();
      this.vadDetector.reset();
    }
  }
  mixAudioAtOffset(chunk, startOffset) {
    if (this.destroyed || chunk.length === 0) return;
    const endOffset = startOffset + chunk.length;
    if (endOffset > this.pcmBuffer.length) {
      const newBuffer = Buffer.alloc(endOffset);
      this.pcmBuffer.copy(newBuffer);
      this.pcmBuffer = newBuffer;
    }
    const sampleCount = chunk.length >> 1;
    const dst = new Int16Array(
      this.pcmBuffer.buffer,
      this.pcmBuffer.byteOffset + startOffset,
      sampleCount
    );
    if ((chunk.byteOffset & 1) === 0) {
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
  ensureTelephonySampleRate(audio) {
    const configured = this.ttsConfig.outputFormat?.sampleRate;
    if (!configured || configured === 8e3) return audio;
    if (!this.sampleRateWarned) {
      this.sampleRateWarned = true;
      console.warn(`[AudioSession:${this.id}] TTS sample rate ${configured}Hz != 8000Hz playback rate \u2014 resampling to 8kHz to avoid distorted audio`);
    }
    return this.resamplePcm16(audio, configured, 8e3);
  }
  resamplePcm16(audio, fromRate, toRate) {
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
  trimConversationHistory() {
    const MAX_RECENT = 40;
    if (this.conversationMessages.length <= MAX_RECENT + 1) return;
    const system = this.conversationMessages[0];
    const rest = this.conversationMessages.slice(1);
    let start = rest.length - MAX_RECENT;
    while (start < rest.length && rest[start].role === "tool") {
      start++;
    }
    this.conversationMessages = [system, ...rest.slice(start)];
  }
  // ── Private: Interruption Handling ─────────────────────
  handleInterruption() {
    if (!this.isPlayingTts) return;
    this.isPlayingTts = false;
    this.isProcessingLlm = false;
    this.ttsGeneration++;
    this.vadDetector.reset();
    if (this.bargeInPreBuffer.length > 0 && this.sttProvider?.isConnected()) {
      console.log(`[AudioSession:${this.id}] Sending ${this.bargeInPreBuffer.length} bytes of pre-buffered barge-in audio to STT`);
      this.sttProvider.sendAudio(this.bargeInPreBuffer);
      this.bargeInPreBuffer = Buffer.alloc(0);
    }
    this.emitPipelineEvent({
      type: "interruption",
      sessionId: this.id,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    console.log(`[AudioSession:${this.id}] User interrupted TTS`);
  }
  // ── Private: Helpers ───────────────────────────────────
  findSentenceEnd(text) {
    const endings = [". ", "! ", "? ", ".\n", "!\n", "?\n", "\u0964 ", "\u0964\n", "| ", "|\n"];
    let lastEnd = -1;
    for (const ending of endings) {
      const idx = text.lastIndexOf(ending);
      if (idx > lastEnd) {
        lastEnd = idx;
      }
    }
    return lastEnd;
  }
  splitIntoSentences(text) {
    const sentences = [];
    let remaining = text;
    while (remaining.length > 0) {
      const endings = [". ", "! ", "? ", ".\n", "!\n", "?\n", "\u0964 ", "\u0964\n", "| ", "|\n", ".", "!", "?", "\u0964", "|"];
      let earliestIdx = -1;
      let matchedEnding = "";
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
  detectTtsLanguage(text, defaultLang) {
    if (/[\u0900-\u097F]/.test(text)) return "hi-IN";
    if (/[\u0B80-\u0BFF]/.test(text)) return "ta-IN";
    if (/[\u0C00-\u0C7F]/.test(text)) return "te-IN";
    if (/[\u0C80-\u0CFF]/.test(text)) return "kn-IN";
    if (/[\u0D00-\u0D7F]/.test(text)) return "ml-IN";
    if (/[\u0980-\u09FF]/.test(text)) return "bn-IN";
    if (/[\u0A80-\u0AFF]/.test(text)) return "gu-IN";
    if (/[\u0A00-\u0A7F]/.test(text)) return "pa-IN";
    if (/[\u0B00-\u0B7F]/.test(text)) return "od-IN";
    return defaultLang;
  }
  addTranscriptEntry(role, content) {
    this.session.transcript.push({
      role,
      content,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  updateStatus(status) {
    this.session.status = status;
    this.emit("statusChange", status);
  }
  emitPipelineEvent(event) {
    this.emit("pipelineEvent", event);
  }
}
export {
  AudioSession
};
