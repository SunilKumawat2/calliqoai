/**
 * ============================================================
 * VAD (Voice Activity Detection)
 *
 * Energy-based voice activity detection for determining
 * when the user starts/stops speaking. Used for:
 * - Barge-in (interrupt TTS when user speaks)
 * - Silence detection (end of utterance)
 * - Turn management
 * ============================================================
 */

import type { VadConfig, VadResult, VadState } from '../../types';
import { DEFAULT_VAD_CONFIG } from '../../types';

export class VadDetector {
  private config: VadConfig;
  private state: VadState = 'silence';
  private speechStartTime = 0;
  private silenceStartTime = 0;
  private lastEnergyValues: number[] = [];
  private readonly energyWindowSize = 10;

  constructor(config?: Partial<VadConfig>) {
    this.config = { ...DEFAULT_VAD_CONFIG, ...config };
    this.silenceStartTime = Date.now();
  }

  /**
   * Process a chunk of PCM audio and return VAD result.
   * Audio must be linear16 (signed 16-bit little-endian).
   */
  processChunk(chunk: Buffer, isPlayingTts = false): VadResult {
    const energy = this.calculateEnergy(chunk);
    this.lastEnergyValues.push(energy);
    if (this.lastEnergyValues.length > this.energyWindowSize) {
      this.lastEnergyValues.shift();
    }

    // Use smoothed energy (average of recent frames)
    const smoothedEnergy =
      this.lastEnergyValues.reduce((a, b) => a + b, 0) / this.lastEnergyValues.length;

    // During TTS playback, require higher threshold (0.15) so speaker echo does not cause self-interruption
    const threshold = isPlayingTts ? 0.15 : this.config.energyThreshold;
    const requiredSpeechMs = isPlayingTts ? 350 : this.config.speechThresholdMs;
    const isSpeech = smoothedEnergy > threshold;
    const now = Date.now();

    let isSpeechStart = false;
    let isSpeechEnd = false;

    if (isSpeech) {
      if (this.state === 'silence' || this.state === 'uncertain') {
        if (this.speechStartTime === 0) {
          this.speechStartTime = now;
        }
        // Check if speech has persisted long enough
        if (now - this.speechStartTime >= requiredSpeechMs) {
          if (this.state !== 'speech') {
            isSpeechStart = true;
            this.state = 'speech';
          }
        } else {
          this.state = 'uncertain';
        }
      }
      this.silenceStartTime = 0;
    } else {
      if (this.state === 'speech' || this.state === 'uncertain') {
        if (this.silenceStartTime === 0) {
          this.silenceStartTime = now;
        }
        // Check if silence has persisted long enough
        if (now - this.silenceStartTime >= this.config.silenceThresholdMs) {
          if (this.state === 'speech') {
            isSpeechEnd = true;
          }
          this.state = 'silence';
          this.speechStartTime = 0;
        }
      }
    }

    const speechDurationMs =
      this.state === 'speech' && this.speechStartTime > 0
        ? now - this.speechStartTime
        : 0;

    const silenceDurationMs =
      this.state === 'silence' && this.silenceStartTime > 0
        ? now - this.silenceStartTime
        : 0;

    return {
      state: this.state,
      energy: smoothedEnergy,
      speechDurationMs,
      silenceDurationMs,
      isSpeechStart,
      isSpeechEnd,
    };
  }

  /**
   * Reset VAD state (e.g., after TTS playback ends)
   */
  reset(): void {
    this.state = 'silence';
    this.speechStartTime = 0;
    this.silenceStartTime = Date.now();
    this.lastEnergyValues = [];
  }

  /**
   * Get current state
   */
  getState(): VadState {
    return this.state;
  }

  /**
   * Calculate RMS energy of a PCM buffer (linear16, signed 16-bit LE)
   */
  private calculateEnergy(buffer: Buffer): number {
    if (buffer.length < 2) return 0;

    let sumSquares = 0;
    const sampleCount = Math.floor(buffer.length / 2);

    for (let i = 0; i < buffer.length - 1; i += 2) {
      const sample = buffer.readInt16LE(i);
      const normalized = sample / 32768.0; // Normalize to -1.0 to 1.0
      sumSquares += normalized * normalized;
    }

    return Math.sqrt(sumSquares / sampleCount);
  }
}
