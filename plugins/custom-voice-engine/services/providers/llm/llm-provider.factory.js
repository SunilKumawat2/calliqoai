import { OpenRouterLlmProvider } from "./openrouter-llm.provider.js";
const providerRegistry = {
  openrouter: OpenRouterLlmProvider
};
class LlmProviderFactory {
  static create(provider) {
    const ProviderClass = providerRegistry[provider];
    if (!ProviderClass) {
      throw new Error(`Unknown LLM provider: ${provider}. Available: ${Object.keys(providerRegistry).join(", ")}`);
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
    console.log(`[LLM Factory] Registered custom provider: ${name}`);
  }
}
export {
  LlmProviderFactory
};
