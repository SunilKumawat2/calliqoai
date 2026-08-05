/**
 * ============================================================
 * TTS Provider Interface
 *
 * Abstract interface for Text-to-Speech providers.
 * Supports both full synthesis and streaming synthesis.
 * ============================================================
 */

import type { TtsConfig, TtsProviderInterface, TtsProvider } from '../../../types';

export abstract class BaseTtsProvider implements TtsProviderInterface {
  abstract readonly name: TtsProvider;

  abstract synthesize(text: string, config: TtsConfig): Promise<Buffer>;
  abstract synthesizeStream(text: string, config: TtsConfig): AsyncIterable<Buffer>;
}
