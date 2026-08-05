import { DeepgramSttProvider } from "./deepgram-stt.provider.js";
import { SarvamSttProvider } from "./sarvam-stt.provider.js";
const providerRegistry = {
  deepgram: DeepgramSttProvider,
  sarvam: SarvamSttProvider
};
class SttProviderFactory {
  /**
   * Create an STT provider instance.
   * @throws Error if provider is not registered
   */
  static create(provider) {
    const ProviderClass = providerRegistry[provider];
    if (!ProviderClass) {
      throw new Error(`Unknown STT provider: ${provider}. Available: ${Object.keys(providerRegistry).join(", ")}`);
    }
    return new ProviderClass();
  }
  /**
   * Get list of available STT providers
   */
  static getAvailableProviders() {
    return Object.keys(providerRegistry);
  }
  /**
   * Check if a provider is registered
   */
  static isAvailable(provider) {
    return provider in providerRegistry;
  }
  /**
   * Register a custom STT provider at runtime (plugin extensibility)
   */
  static register(name, providerClass) {
    providerRegistry[name] = providerClass;
    console.log(`[STT Factory] Registered custom provider: ${name}`);
  }
}
export {
  SttProviderFactory
};
