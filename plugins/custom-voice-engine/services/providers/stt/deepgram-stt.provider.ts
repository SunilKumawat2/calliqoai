/**
 * ============================================================
 * Deepgram STT Provider
 *
 * Streaming Speech-to-Text using Deepgram's WebSocket API.
 * Supports real-time transcription with interim results,
 * word-level timestamps, and language detection.
 * ============================================================
 */

import WebSocket from 'ws';
import type { SttConfig, SttTranscript, AudioFormat, SttWord } from '../../../types';
import { BaseSttProvider } from './stt-provider.interface';

const DEEPGRAM_WS_URL = 'wss://api.deepgram.com/v1/listen';

interface DeepgramWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
  punctuated_word?: string;
}

interface DeepgramAlternative {
  transcript: string;
  confidence: number;
  words: DeepgramWord[];
}

interface DeepgramChannel {
  alternatives: DeepgramAlternative[];
}

interface DeepgramResult {
  type: string;
  channel_index: number[];
  duration: number;
  start: number;
  is_final: boolean;
  speech_final: boolean;
  channel: DeepgramChannel;
}

export class DeepgramSttProvider extends BaseSttProvider {
  readonly name = 'deepgram' as const;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private keepAliveInterval: ReturnType<typeof setInterval> | null = null;
  private isClosing = false;

  async connect(config: SttConfig, format: AudioFormat): Promise<void> {
    this.config = config;
    this.format = format;
    this.isClosing = false;
    return this.createConnection();
  }

  private async createConnection(): Promise<void> {
    if (!this.config || !this.format) throw new Error('Configuration missing');

    const paramsObj: Record<string, string> = {
      model: this.config.model || this.config.deepgramModel || 'nova-2',
      encoding: this.mapEncoding(this.format.encoding),
      sample_rate: String(this.format.sampleRate),
      channels: String(this.format.channels),
      punctuate: String(this.config.punctuate ?? true),
      interim_results: String(this.config.interimResults ?? true),
      endpointing: String(this.config.endpointing ?? 300),
      utterance_end_ms: '1000',
      vad_events: 'true',
      smart_format: 'true',
    };

    // Note: Deepgram streaming WebSocket API does not support detect_language=true.
    // If passed, it returns a 400 Bad Request. We must always specify a target language.
    paramsObj.language = this.mapLanguage(this.config.language || 'en');

    const params = new URLSearchParams(paramsObj);

    const url = `${DEEPGRAM_WS_URL}?${params.toString()}`;
    console.log(`[STT:Deepgram] Connecting to URL: ${url.replace(this.config!.apiKey, '***')}`);

    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(url, {
        headers: {
          Authorization: `Token ${this.config!.apiKey}`,
        },
      });

      this.ws.on('unexpected-response', (req, res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          console.error(`[STT:Deepgram] HTTP 400 Response Body from Deepgram: ${body}`);
        });
      });

      const timeout = setTimeout(() => {
        if (!this.connected) {
          reject(new Error('Deepgram connection timeout'));
          this.ws?.close();
        }
      }, 10000);

      this.ws.on('open', () => {
        clearTimeout(timeout);
        this.connected = true;
        this.reconnectAttempts = 0;
        console.log('[STT:Deepgram] WebSocket connected');

        this.keepAliveInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'KeepAlive' }));
          }
        }, 8000);

        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const response = JSON.parse(data.toString());
          this.handleResponse(response);
        } catch (err) {
          console.error('[STT:Deepgram] Failed to parse response:', err);
        }
      });

      this.ws.on('error', (err) => {
        clearTimeout(timeout);
        console.error('[STT:Deepgram] WebSocket error:', err);
        // Only reject the initial connect promise — don't reject again if already connected
        if (!this.connected) reject(err);
      });

      this.ws.on('close', (code, reason) => {
        clearTimeout(timeout);
        const wasConnected = this.connected;
        this.connected = false;
        if (this.keepAliveInterval) {
          clearInterval(this.keepAliveInterval);
          this.keepAliveInterval = null;
        }

        // Only auto-reconnect if we had a successful connection before.
        // If wasConnected is false, this was a failed initial connect — the
        // promise already rejected, so don't retry here (would be unhandled).
        if (wasConnected && !this.isClosing && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const delay = Math.pow(2, this.reconnectAttempts) * 1000;
          console.log(`[STT:Deepgram] Unexpected close (code ${code}), reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
          // Always catch the reconnect promise so it never becomes an unhandled rejection
          setTimeout(() => this.createConnection().catch((err) => {
            console.error(`[STT:Deepgram] Reconnect attempt ${this.reconnectAttempts} failed:`, err.message);
          }), delay);
        }
      });
    });
  }

  sendAudio(chunk: Buffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(chunk);
    }
  }

  async close(): Promise<void> {
    this.isClosing = true;
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }

    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'CloseStream' }));
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => { this.ws?.terminate(); resolve(); }, 2000);
          this.ws!.once('close', () => { clearTimeout(timeout); resolve(); });
          this.ws!.close();
        });
      }
      this.ws = null;
    }

    this.connected = false;
    this.transcriptCallbacks = [];
    this.errorCallbacks = [];
  }

  private handleResponse(response: any): void {
    if (response.type === 'Results') {
      const result = response as DeepgramResult;
      const channel = result.channel;
      if (!channel?.alternatives?.length) return;
      const alt = channel.alternatives[0];
      if (!alt.transcript) return;
      const words: SttWord[] = (alt.words || []).map((w: DeepgramWord) => ({
        word: w.punctuated_word || w.word,
        start: w.start,
        end: w.end,
        confidence: w.confidence,
      }));
      this.emitTranscript({
        text: alt.transcript,
        isFinal: result.is_final,
        confidence: alt.confidence,
        words,
        duration: result.duration * 1000,
      });
    } else if (response.type === 'UtteranceEnd') {
      this.emitTranscript({ text: '', isFinal: true, confidence: 1.0, duration: 0 });
    } else if (response.type === 'Error') {
      this.emitError(new Error(`Deepgram error: ${response.message || JSON.stringify(response)}`));
    }
  }

  private mapEncoding(encoding: string): string {
    switch (encoding) {
      case 'linear16': return 'linear16';
      case 'mulaw': return 'mulaw';
      case 'alaw': return 'alaw';
      case 'opus': return 'opus';
      default: return 'linear16';
    }
  }

  private mapLanguage(lang: string): string {
    if (!lang) return 'en-IN';
    if (lang.includes('-')) return lang;

    const langMap: Record<string, string> = {
      en: 'en-IN',
      hi: 'hi',
      ta: 'ta',
      te: 'te',
      kn: 'kn',
      ml: 'ml',
      mr: 'mr',
      gu: 'gu',
      bn: 'bn',
      pa: 'pa',
    };
    return langMap[lang] || lang;
  }
}
