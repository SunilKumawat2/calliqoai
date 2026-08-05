/**
 * ============================================================
 * STT Provider Interface
 *
 * Abstract interface for Speech-to-Text providers.
 * All STT providers must implement this interface to be used
 * in the audio pipeline.
 * ============================================================
 */

import type { SttConfig, SttTranscript, SttProviderInterface, AudioFormat, SttProvider } from '../../../types';

export abstract class BaseSttProvider implements SttProviderInterface {
  abstract readonly name: SttProvider;
  protected config: SttConfig | null = null;
  protected format: AudioFormat | null = null;
  protected connected = false;
  protected transcriptCallbacks: Array<(transcript: SttTranscript) => void> = [];
  protected errorCallbacks: Array<(error: Error) => void> = [];

  abstract connect(config: SttConfig, format: AudioFormat): Promise<void>;
  abstract sendAudio(chunk: Buffer): void;
  abstract close(): Promise<void>;

  onTranscript(callback: (transcript: SttTranscript) => void): void {
    this.transcriptCallbacks.push(callback);
  }

  onError(callback: (error: Error) => void): void {
    this.errorCallbacks.push(callback);
  }

  isConnected(): boolean {
    return this.connected;
  }

  protected emitTranscript(transcript: SttTranscript): void {
    for (const cb of this.transcriptCallbacks) {
      try {
        cb(transcript);
      } catch (err) {
        console.error(`[STT:${this.name}] Transcript callback error:`, err);
      }
    }
  }

  protected emitError(error: Error): void {
    for (const cb of this.errorCallbacks) {
      try {
        cb(error);
      } catch (err) {
        console.error(`[STT:${this.name}] Error callback error:`, err);
      }
    }
  }
}
