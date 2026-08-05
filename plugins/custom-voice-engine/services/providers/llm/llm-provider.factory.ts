/**
 * ============================================================
 * LLM Provider Factory
 * ============================================================
 */

import type { LlmProvider, LlmProviderInterface } from '../../types';
import { OpenRouterLlmProvider } from './openrouter-llm.provider';

const providerRegistry: Record<LlmProvider, new () => LlmProviderInterface> = {
  openrouter: OpenRouterLlmProvider,
};

export class LlmProviderFactory {
  static create(provider: LlmProvider): LlmProviderInterface {
    const ProviderClass = providerRegistry[provider];
    if (!ProviderClass) {
      throw new Error(`Unknown LLM provider: ${provider}. Available: ${Object.keys(providerRegistry).join(', ')}`);
    }
    return new ProviderClass();
  }

  static getAvailableProviders(): LlmProvider[] {
    return Object.keys(providerRegistry) as LlmProvider[];
  }

  static isAvailable(provider: string): provider is LlmProvider {
    return provider in providerRegistry;
  }

  static register(name: LlmProvider, providerClass: new () => LlmProviderInterface): void {
    providerRegistry[name] = providerClass;
    console.log(`[LLM Factory] Registered custom provider: ${name}`);
  }
}
