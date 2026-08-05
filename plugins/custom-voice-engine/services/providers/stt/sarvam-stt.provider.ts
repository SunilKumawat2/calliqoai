/**
 * ============================================================
 * Sarvam AI STT Provider
 *
 * Streaming Speech-to-Text using Sarvam AI's API.
 * Supports Indian languages and multilingual transcription.
 *
 * Sarvam uses a REST-based chunked streaming approach:
 * audio is buffered and sent in chunks for processing.
 * ============================================================
 */

import axios from 'axios';
import type { SttConfig, SttTranscript, AudioFormat } from '../../../types';
import { BaseSttProvider } from './stt-provider.interface';
import { keepAliveAxiosConfig } from '../http-agent';

const SARVAM_API_BASE = 'https://api.sarvam.ai';
// Periodic safety-net flush. The primary flush is VAD-triggered on speech-end
// (force flush), so this interval only catches audio when VAD misses an
// endpoint. Lowered from 5000ms to 3000ms to shorten worst-case STT lag while
// still keeping request volume low (Sarvam is REST, not a WebSocket).
const BUFFER_FLUSH_INTERVAL_MS = 3000;
// ~2 seconds of 16kHz 16-bit mono audio before we bother sending.
// Tiny chunks produce fragmented transcripts ("Let us", "begin with", etc.)
const MIN_BUFFER_SIZE = 64000;
// Minimum milliseconds between successive API calls to avoid rate limit errors.
// Lowered from 3000ms to 1200ms: back-to-back utterances within a single
// conversation are rare, and the cooldown was adding multiple seconds of lag to
// turn responses. 1200ms still guards against burst rate-limit errors.
const MIN_API_CALL_INTERVAL_MS = 1200;

export class SarvamSttProvider extends BaseSttProvider {
  readonly name = 'sarvam' as const;
  private audioBuffer: Buffer[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private totalBufferSize = 0;
  private isFlushing = false;
  private retryFlushPending = false;
  private closed = false;
  private lastApiCallTime = 0; // timestamp of last Sarvam API call (rate limiting)

  async connect(config: SttConfig, format: AudioFormat): Promise<void> {
    this.config = config;
    this.format = format;
    this.connected = true;
    this.closed = false;
    this.audioBuffer = [];
    this.totalBufferSize = 0;
    this.retryFlushPending = false;

    console.log(`[STT:Sarvam] Connecting with format:`, format);

    // Validate API key with a lightweight request
    try {
      await axios.get(`${SARVAM_API_BASE}/v1/models`, {
        ...keepAliveAxiosConfig,
        headers: { 'api-subscription-key': config.apiKey },
        timeout: 5000,
      });
      console.log('[STT:Sarvam] API key validated successfully');
    } catch (err: any) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        throw new Error('Sarvam API key is invalid');
      }
      console.warn('[STT:Sarvam] API key validation warning (non-auth error):', err.message);
    }

    // Start periodic buffer flush (safety net, VAD-triggered flush is primary)
    this.flushInterval = setInterval(() => {
      this.flushBuffer(false).catch((err) => {
        this.emitError(new Error(`Sarvam flush error: ${err.message}`));
      });
    }, BUFFER_FLUSH_INTERVAL_MS);

    console.log('[STT:Sarvam] Provider connected');
  }

  sendAudio(chunk: Buffer): void {
    if (!this.connected || this.closed) return;
    this.audioBuffer.push(chunk);
    this.totalBufferSize += chunk.length;
    if (this.totalBufferSize % 6400 === 0) {
      console.log(`[STT:Sarvam] Buffered ${(this.totalBufferSize / 1024).toFixed(1)}KB audio so far`);
    }
  }

  async flush(force = true): Promise<void> {
    if (this.isFlushing) {
      console.log(`[STT:Sarvam] Flush requested but already flushing, queuing retry (force=${force})`);
      this.retryFlushPending = true;
      return;
    }
    await this.flushBuffer(force);
  }

  async close(): Promise<void> {
    this.closed = true;

    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    // Final flush — force=true so we send whatever remains, even if < MIN_BUFFER_SIZE
    if (this.totalBufferSize > 0) {
      console.log(`[STT:Sarvam] Closing with ${(this.totalBufferSize / 1024).toFixed(1)}KB buffered audio, flushing...`);
      await this.flushBuffer(true);
    }

    this.connected = false;
    this.audioBuffer = [];
    this.totalBufferSize = 0;
    this.transcriptCallbacks = [];
    this.errorCallbacks = [];
    console.log('[STT:Sarvam] Provider closed');
  }

  /**
   * Flush buffered audio to Sarvam's speech-to-text REST API.
   *
   * Key constraints of the Sarvam /speech-to-text endpoint:
   *  - Max audio duration: 30 seconds per request (hard API limit)
   *  - Rate limits: too many requests too quickly → rate_limit_exceeded_error
   *
   * Strategy:
   *  1. Drain the entire audio buffer into one raw PCM block.
   *  2. Split that PCM block into ≤25s segments (safe margin under 30s).
   *  3. Send each segment as its own API call, with a rate-limit cooldown
   *     (MIN_API_CALL_INTERVAL_MS) enforced between consecutive calls.
   *  4. Emit a transcript event for each segment that returns text.
   *
   * @param force - skip the minimum-size check (used at close() to drain remaining audio)
   */
  private async flushBuffer(force = false): Promise<void> {
    if (this.isFlushing) {
      console.log(`[STT:Sarvam] flushBuffer called but isFlushing=true, force=${force}`);
      return;
    }
    if (!this.config || !this.format) {
      console.log(`[STT:Sarvam] flushBuffer skipped: config=${!!this.config}, format=${!!this.format}`);
      return;
    }

    // Respect minimum buffer size (~2 seconds of audio) unless force-flushing at close()
    const { sampleRate: flushSampleRate = 8000, channels: flushChannels = 1 } = this.format || {};
    const minBufferSize = flushSampleRate * flushChannels * 2 * 2; // 2 seconds of audio
    if (!force && this.totalBufferSize < minBufferSize) {
      console.log(`[STT:Sarvam] flushBuffer skipped: buffer ${this.totalBufferSize}B < min ${minBufferSize}B (force=${force})`);
      return;
    }
    if (this.totalBufferSize === 0) {
      console.log(`[STT:Sarvam] flushBuffer skipped: buffer is empty (force=${force})`);
      return;
    }

    this.isFlushing = true;
    this.retryFlushPending = false;

    // Drain the whole buffer
    const chunks = this.audioBuffer.splice(0);
    this.totalBufferSize = 0;
    const rawAudio = Buffer.concat(chunks);
    console.log(`[STT:Sarvam] flushBuffer: force=${force}, draining ${chunks.length} chunks, ${(rawAudio.length / 1024).toFixed(1)}KB`);

    try {
      const languageCode = this.config.detectLanguage
        ? 'unknown'
        : (this.config.sarvamLanguageCode || this.mapLanguage(this.config.language));
      const { sampleRate = 16000, channels = 1 } = this.format;

      // Sarvam hard-limits each request to 30s of audio.
      // We use 25s segments to stay safely under that limit.
      const MAX_SEGMENT_SECONDS = 25;
      // bytes per second = sampleRate × channels × 2 (16-bit = 2 bytes/sample)
      const bytesPerSecond = sampleRate * channels * 2;
      const maxSegmentBytes = MAX_SEGMENT_SECONDS * bytesPerSecond;

      const totalSegments = Math.ceil(rawAudio.length / maxSegmentBytes);
      console.log(
        `[STT:Sarvam] Processing ${(rawAudio.length / 1024).toFixed(1)}KB audio ` +
        `as ${totalSegments} segment(s) of ≤${MAX_SEGMENT_SECONDS}s each ` +
        `(lang: ${languageCode}, sampleRate: ${sampleRate})`
      );

      for (let seg = 0; seg < totalSegments; seg++) {
        const start = seg * maxSegmentBytes;
        const segmentPcm = rawAudio.slice(start, start + maxSegmentBytes);
        const segmentDurationS = segmentPcm.length / bytesPerSecond;

        // Rate-limit guard: enforce minimum gap between API calls
        const now = Date.now();
        const timeSinceLast = now - this.lastApiCallTime;
        if (this.lastApiCallTime > 0 && timeSinceLast < MIN_API_CALL_INTERVAL_MS) {
          const waitMs = MIN_API_CALL_INTERVAL_MS - timeSinceLast;
          console.log(`[STT:Sarvam] Rate-limit cooldown: waiting ${waitMs}ms before segment ${seg + 1}/${totalSegments}`);
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }

        // Wrap raw PCM in a WAV header so the REST API can parse it
        const wavHeader = this.createWavHeader(segmentPcm.length, sampleRate, channels);
        const wavData = Buffer.concat([wavHeader, segmentPcm]);

        console.log(
          `[STT:Sarvam] Sending segment ${seg + 1}/${totalSegments}: ` +
          `${segmentDurationS.toFixed(1)}s (${(wavData.length / 1024).toFixed(1)}KB) ` +
          `to ${SARVAM_API_BASE}/speech-to-text`
        );

        const formData = new FormData();
        const blob = new Blob([wavData], { type: 'audio/wav' });
        formData.append('file', blob, 'audio.wav');
        formData.append('model', this.config.sarvamModel || 'saaras:v3');
        formData.append('mode', 'transcribe');
        if (languageCode) {
          formData.append('language_code', languageCode);
        }

        this.lastApiCallTime = Date.now();

        try {
          console.log(`[STT:Sarvam] POST segment ${seg + 1} starting...`);
          const response = await axios.post(
            `${SARVAM_API_BASE}/speech-to-text`,
            formData,
            {
              ...keepAliveAxiosConfig,
              headers: { 'api-subscription-key': this.config.apiKey },
              timeout: 30000,
            }
          );

          console.log(`[STT:Sarvam] Segment ${seg + 1} response status: ${response.status}, has transcript: ${!!response.data?.transcript}`);

          if (response.data?.transcript) {
            const transcript: SttTranscript = {
              text: response.data.transcript,
              isFinal: true,
              confidence: response.data.confidence || 0.85,
              language: response.data.language_code || languageCode,
              duration: segmentDurationS * 1000,
            };
            console.log(`[STT:Sarvam] EMITTING transcript: "${response.data.transcript.substring(0, 100)}"`);
            this.emitTranscript(transcript);
          } else {
            console.warn(`[STT:Sarvam] Segment ${seg + 1} returned no transcript. Full response:`, JSON.stringify(response.data));
          }
        } catch (segErr: any) {
          let errorMsg = segErr.message;
          if (segErr.response?.data) {
            console.error(
              `[STT:Sarvam] Segment ${seg + 1} API Error:`,
              JSON.stringify(segErr.response.data, null, 2)
            );
            errorMsg = segErr.response.data.message || JSON.stringify(segErr.response.data);
          }
          console.error(`[STT:Sarvam] Segment ${seg + 1} error: ${errorMsg}`);
          // Emit error but continue processing remaining segments
          this.emitError(new Error(`Sarvam STT error (segment ${seg + 1}): ${errorMsg}`));
        }
      }
    } catch (outerErr: any) {
      console.error(`[STT:Sarvam] flushBuffer unexpected error:`, outerErr.message);
    } finally {
      this.isFlushing = false;
      if (this.retryFlushPending) {
        console.log(`[STT:Sarvam] Retrying pending flush after current flush completed`);
        this.retryFlushPending = false;
        this.flushBuffer(true).catch((err) => {
          console.error(`[STT:Sarvam] Retry flush error:`, err.message);
        });
      }
    }
  }

  private createWavHeader(dataLength: number, sampleRate: number, channels: number): Buffer {
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataLength, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * channels * 2, 28);
    header.writeUInt16LE(channels * 2, 32);
    header.writeUInt16LE(16, 34); // 16-bit
    header.write('data', 36);
    header.writeUInt32LE(dataLength, 40);
    return header;
  }

  private mapLanguage(lang: string): string {
    if (!lang) return 'en-IN';
    
    // Normalize input (e.g., 'en-US' -> 'en', 'hi_IN' -> 'hi')
    const baseLang = lang.split(/[-_]/)[0].toLowerCase();

    const langMap: Record<string, string> = {
      en: 'en-IN',
      hi: 'hi-IN',
      bn: 'bn-IN',
      kn: 'kn-IN',
      ml: 'ml-IN',
      mr: 'mr-IN',
      od: 'od-IN',
      pa: 'pa-IN',
      ta: 'ta-IN',
      te: 'te-IN',
      gu: 'gu-IN',
      as: 'as-IN',
      ur: 'ur-IN',
      ne: 'ne-IN',
    };

    return langMap[baseLang] || 'en-IN';
  }
}
