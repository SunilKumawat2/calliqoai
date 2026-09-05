/**
 * ============================================================
 * Sarvam AI TTS Provider
 *
 * Text-to-Speech using Sarvam AI's API.
 * Supports Indian languages with multiple speaker voices.
 * ============================================================
 */

import axios from 'axios';
import type { TtsConfig } from '../../../types.js';
import { BaseTtsProvider } from './tts-provider.interface.js';
import { keepAliveAxiosConfig } from '../http-agent.js';

const SARVAM_API_BASE = 'https://api.sarvam.ai';

export class SarvamTtsProvider extends BaseTtsProvider {
  readonly name = 'sarvam' as const;

  async synthesize(text: string, config: TtsConfig): Promise<Buffer> {
    const language = config.language || 'hi-IN';
    let speaker = (config.sarvamSpeaker || config.voice || 'kavya').toLowerCase();
    let model = config.sarvamModel || 'bulbul:v3';

    // Sarvam bulbul:v3 supported speakers
    const bulbulV3Speakers = [
      'aditya', 'ritu', 'ashutosh', 'priya', 'neha', 'rohan', 'simran', 'kavya',
      'amit', 'dev', 'ishita', 'shreya', 'ratan', 'varun', 'manan', 'sumit',
      'roopa', 'kabir', 'aayan', 'shubh', 'advait', 'anand', 'tanya', 'tarun',
      'sunny', 'mani', 'gokul', 'vijay', 'shruti', 'suhani', 'mohit', 'kavitha',
      'rehan', 'soham', 'rupali', 'niharika'
    ];

    // Sanitize speaker: fallback to 'kavya' if non-Sarvam or invalid speaker passed
    if (!speaker || !bulbulV3Speakers.includes(speaker)) {
      speaker = 'kavya';
    }

    // Force bulbul:v3 (bulbul:v1 and bulbul:v2 are deprecated by Sarvam AI)
    if (!model || model !== 'bulbul:v3') {
      model = 'bulbul:v3';
    }

    // Sanitize: remove text that has no meaningful language characters.
    // Sarvam rejects inputs that contain ONLY punctuation/symbols (e.g. "." "...").
    const cleaned = text.replace(/[\s.,!?;:\-–—'"`()\[\]{}]+/g, '').trim();
    if (!cleaned) {
      console.warn(`[TTS:Sarvam] Skipping TTS — text has no speakable content: "${text.substring(0, 40)}"`);
      // Return 20ms of silence (160 bytes at 8kHz 16-bit) so the pipeline doesn't stall.
      return Buffer.alloc(320, 0);
    }

    console.log(`[TTS:Sarvam] Synthesizing: speaker="${speaker}" model="${model}" lang="${language}" sampleRate=${config.outputFormat?.sampleRate || 8000} text_len=${text.length}`);

    try {
      const response = await axios.post(
        `${SARVAM_API_BASE}/text-to-speech`,
        {
          inputs: [text],
          target_language_code: this.mapLanguage(language)!,
          speaker,
          model,
          pace: config.speed || 1.05, // Natural human speech pace for clear Hindi pronunciation
          speech_sample_rate: 16000, // Request 16kHz high-fidelity audio from Sarvam
          enable_preprocessing: true,
        },
        {
          ...keepAliveAxiosConfig,
          headers: {
            'API-Subscription-Key': config.apiKey,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );

      if (response.data?.audios?.[0]) {
        let audioBuf = Buffer.from(response.data.audios[0], 'base64');
        // Strip 44-byte standard WAV header if present so audio is pure raw 16-bit linear PCM
        if (audioBuf.length >= 44 && audioBuf.readUInt32BE(0) === 0x52494646) {
          const dataIdx = audioBuf.subarray(0, 100).indexOf('data');
          if (dataIdx !== -1 && dataIdx + 8 <= audioBuf.length) {
            audioBuf = audioBuf.subarray(dataIdx + 8);
          } else {
            audioBuf = audioBuf.subarray(44);
          }
        }
        return audioBuf;
      }

      console.error(`[TTS:Sarvam] No audio in response:`, JSON.stringify(response.data));
      throw new Error(`Sarvam TTS returned no audio data (speaker="${speaker}", model="${model}")`);
    } catch (err: any) {
      if (err.response?.data) {
        console.error(`[TTS:Sarvam] API error response:`, JSON.stringify(err.response.data, null, 2));
      }
      console.error(`[TTS:Sarvam] Request body:`, JSON.stringify({
        inputs: [text],
        target_language_code: this.mapLanguage(language),
        speaker,
        model,
        pitch: config.pitch || 0,
        pace: config.speed || 1.30,
        loudness: 1.5,
        speech_sample_rate: config.outputFormat?.sampleRate || 8000,
        enable_preprocessing: true,
      }));
      throw err;
    }
  }

  async *synthesizeStream(text: string, config: TtsConfig): AsyncIterable<Buffer> {
    // Sarvam doesn't natively support streaming, so we synthesize and chunk
    const audioBuffer = await this.synthesize(text, config);
    const chunkSize = 640; // 40ms at 8kHz 16-bit

    for (let offset = 0; offset < audioBuffer.length; offset += chunkSize) {
      const end = Math.min(offset + chunkSize, audioBuffer.length);
      yield audioBuffer.subarray(offset, end);
    }
  }

  private mapLanguage(lang: string): string {
    // If already a full code, return as-is
    if (lang.includes('-')) return lang;

    const langMap: Record<string, string> = {
      en: 'en-IN',
      hi: 'hi-IN',
      ta: 'ta-IN',
      te: 'te-IN',
      kn: 'kn-IN',
      ml: 'ml-IN',
      mr: 'mr-IN',
      gu: 'gu-IN',
      bn: 'bn-IN',
      pa: 'pa-IN',
      or: 'od-IN',
    };
    return langMap[lang] || 'en-IN';
  }
}
