/**
 * ============================================================
 * LLM Provider Interface
 *
 * Abstract interface for Large Language Model providers.
 * Supports both completion and streaming modes.
 * ============================================================
 */

import type { LlmConfig, LlmMessage, LlmResponse, LlmStreamChunk, LlmToolDefinition, LlmProviderInterface, LlmProvider } from '../../types';

export abstract class BaseLlmProvider implements LlmProviderInterface {
  abstract readonly name: LlmProvider;
  abstract complete(messages: LlmMessage[], config: LlmConfig, tools?: LlmToolDefinition[]): Promise<LlmResponse>;
  abstract stream(messages: LlmMessage[], config: LlmConfig, tools?: LlmToolDefinition[]): AsyncIterable<LlmStreamChunk>;
}
