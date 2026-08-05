/**
 * ============================================================
 * STT Provider Factory
 *
 * Creates STT provider instances based on tenant configuration.
 * Implements the Factory pattern for provider abstraction.
 * ============================================================
 */

import type { SttProvider, SttProviderInterface } from '../../../types';
import { DeepgramSttProvider } from './deepgram-stt.provider';
import { SarvamSttProvider } from './sarvam-stt.provider';

const providerRegistry: Record<SttProvider, new () => SttProviderInterface> = {
  deepgram: DeepgramSttProvider,
  sarvam: SarvamSttProvider,
};

export class SttProviderFactory {
  /**
   * Create an STT provider instance.
   * @throws Error if provider is not registered
   */
  static create(provider: SttProvider): SttProviderInterface {
    const ProviderClass = providerRegistry[provider];
    if (!ProviderClass) {
      throw new Error(`Unknown STT provider: ${provider}. Available: ${Object.keys(providerRegistry).join(', ')}`);
    }
    return new ProviderClass();
  }

  /**
   * Get list of available STT providers
   */
  static getAvailableProviders(): SttProvider[] {
    return Object.keys(providerRegistry) as SttProvider[];
  }

  /**
   * Check if a provider is registered
   */
  static isAvailable(provider: string): provider is SttProvider {
    return provider in providerRegistry;
  }

  /**
   * Register a custom STT provider at runtime (plugin extensibility)
   */
  static register(name: SttProvider, providerClass: new () => SttProviderInterface): void {
    providerRegistry[name] = providerClass;
    console.log(`[STT Factory] Registered custom provider: ${name}`);
  }
}
