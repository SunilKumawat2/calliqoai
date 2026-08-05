/**
 * ============================================================
 * Deepgram TTS Provider (Aura)
 *
 * Text-to-Speech using Deepgram's Aura API.
 * Supports streaming audio output with multiple voices.
 *
 * Models: aura-asteria-en, aura-luna-en, aura-stella-en,
 *         aura-athena-en, aura-hera-en, aura-orion-en,
 *         aura-arcas-en, aura-perseus-en, aura-angus-en,
 *         aura-orpheus-en, aura-helios-en, aura-zeus-en
 * ============================================================
 */

import axios from 'axios';
import type { TtsConfig } from '../../../types';
import { BaseTtsProvider } from './tts-provider.interface';
import { keepAliveAxiosConfig } from '../http-agent';

const DEEPGRAM_TTS_URL = 'https://api.deepgram.com/v1/speak';

export class DeepgramTtsProvider extends BaseTtsProvider {
  readonly name = 'deepgram' as const;

  async synthesize(text: string, config: TtsConfig): Promise<Buffer> {
    let model = config.voice || config.deepgramModel || 'aura-asteria-en';
    if (model === 'aura-2') model = 'aura-2-asteria-en';
    if (model === 'aura') model = 'aura-asteria-en';

    const params = new URLSearchParams({
      model,
    });

    // Determine output encoding based on config
    const encoding = config.outputFormat?.encoding || 'linear16';
    const sampleRate = config.outputFormat?.sampleRate || 8000;

    if (encoding === 'linear16') {
      params.set('encoding', 'linear16');
      params.set('sample_rate', String(sampleRate));
      params.set('container', 'none');
    } else if (encoding === 'mulaw') {
      params.set('encoding', 'mulaw');
      params.set('sample_rate', String(sampleRate));
      params.set('container', 'none');
    } else if (encoding === 'alaw') {
      params.set('encoding', 'alaw');
      params.set('sample_rate', String(sampleRate));
      params.set('container', 'none');
    }

    const response = await axios.post(
      `${DEEPGRAM_TTS_URL}?${params.toString()}`,
      { text },
      {
        ...keepAliveAxiosConfig,
        headers: {
          Authorization: `Token ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        responseType: 'arraybuffer',
        timeout: 30000,
      }
    );

    return Buffer.from(response.data);
  }

  async *synthesizeStream(text: string, config: TtsConfig): AsyncIterable<Buffer> {
    let model = config.voice || config.deepgramModel || 'aura-asteria-en';
    if (model === 'aura-2') model = 'aura-2-asteria-en';
    if (model === 'aura') model = 'aura-asteria-en';
    const sampleRate = config.outputFormat?.sampleRate || 8000;
    const encoding = config.outputFormat?.encoding || 'linear16';

    const params = new URLSearchParams({
      model,
      encoding: encoding === 'mulaw' ? 'mulaw' : encoding === 'alaw' ? 'alaw' : 'linear16',
      sample_rate: String(sampleRate),
      container: 'none',
    });

    const response = await axios.post(
      `${DEEPGRAM_TTS_URL}?${params.toString()}`,
      { text },
      {
        ...keepAliveAxiosConfig,
        headers: {
          Authorization: `Token ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        responseType: 'stream',
        timeout: 30000,
      }
    );

    const stream = response.data as NodeJS.ReadableStream;
    const chunkSize = 640; // 40ms of 8kHz 16-bit mono = 640 bytes

    let buffer = Buffer.alloc(0);

    for await (const data of stream) {
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length >= chunkSize) {
        yield buffer.subarray(0, chunkSize);
        buffer = buffer.subarray(chunkSize);
      }
    }

    // Yield any remaining data
    if (buffer.length > 0) {
      yield buffer;
    }
  }
}
