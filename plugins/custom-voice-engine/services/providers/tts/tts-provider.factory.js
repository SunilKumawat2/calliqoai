import { DeepgramTtsProvider } from "./deepgram-tts.provider.js";
import { SarvamTtsProvider } from "./sarvam-tts.provider.js";
const providerRegistry = {
  deepgram: DeepgramTtsProvider,
  sarvam: SarvamTtsProvider
};
class TtsProviderFactory {
  static create(provider) {
    const ProviderClass = providerRegistry[provider];
    if (!ProviderClass) {
      throw new Error(`Unknown TTS provider: ${provider}. Available: ${Object.keys(providerRegistry).join(", ")}`);
    }
    return new ProviderClass();
  }
  static getAvailableProviders() {
    return Object.keys(providerRegistry);
  }
  static isAvailable(provider) {
    return provider in providerRegistry;
  }
  static register(name, providerClass) {
    providerRegistry[name] = providerClass;
    console.log(`[TTS Factory] Registered custom provider: ${name}`);
  }
}
export {
  TtsProviderFactory
};
