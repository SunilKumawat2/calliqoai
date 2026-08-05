/**
 * ============================================================
 * TTS Provider Factory
 * ============================================================
 */

import type { TtsProvider, TtsProviderInterface } from '../../../types';
import { DeepgramTtsProvider } from './deepgram-tts.provider';
import { SarvamTtsProvider } from './sarvam-tts.provider';

const providerRegistry: Record<TtsProvider, new () => TtsProviderInterface> = {
  deepgram: DeepgramTtsProvider,
  sarvam: SarvamTtsProvider,
};

export class TtsProviderFactory {
  static create(provider: TtsProvider): TtsProviderInterface {
    const ProviderClass = providerRegistry[provider];
    if (!ProviderClass) {
      throw new Error(`Unknown TTS provider: ${provider}. Available: ${Object.keys(providerRegistry).join(', ')}`);
    }
    return new ProviderClass();
  }

  static getAvailableProviders(): TtsProvider[] {
    return Object.keys(providerRegistry) as TtsProvider[];
  }

  static isAvailable(provider: string): provider is TtsProvider {
    return provider in providerRegistry;
  }

  static register(name: TtsProvider, providerClass: new () => TtsProviderInterface): void {
    providerRegistry[name] = providerClass;
    console.log(`[TTS Factory] Registered custom provider: ${name}`);
  }
}
