/**
 * ============================================================
 * OpenRouter LLM Provider
 *
 * LLM adapter for OpenRouter API, which provides access to
 * GPT-4o-mini, Gemini Flash, Claude, and many other models
 * through a unified API.
 *
 * OpenRouter uses the OpenAI-compatible API format.
 * ============================================================
 */

import axios from 'axios';
import type { LlmConfig, LlmMessage, LlmResponse, LlmStreamChunk, LlmToolDefinition } from '../../types';
import { BaseLlmProvider } from './llm-provider.interface';
import { keepAliveAxiosConfig } from '../http-agent';

const resolveApiKey = (apiKey?: string) => {
  let key = apiKey || '';
  if (!key || key.includes('your_openrouter_api_key') || key.includes('placeholder')) {
    key = process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY || '';
  }
  return key;
};

const getApiUrl = (apiKey?: string) => {
  const key = resolveApiKey(apiKey);
  if (key.startsWith('sk-proj-') || (key.startsWith('sk-') && !key.startsWith('sk-or-'))) {
    return 'https://api.openai.com/v1/chat/completions';
  }
  return OPENROUTER_API_URL;
};

const getModelName = (model: string, isOpenAi: boolean) => {
  if (model === 'gpt-realtime-1.5' || model === 'gpt-realtime-mini' || model === 'gpt-realtime' || model.includes('realtime')) {
    return isOpenAi ? 'gpt-4o-mini' : 'openai/gpt-4o-mini';
  }
  if (isOpenAi) {
    if (model.startsWith('openai/')) {
      return model.substring(7);
    }
    // Default to gpt-4o-mini if it's a completely different model provider name but they use OpenAI key
    if (model.includes('/') && !model.startsWith('openai/')) {
      return 'gpt-4o-mini';
    }
    return model;
  }
  return model;
};

export class OpenRouterLlmProvider extends BaseLlmProvider {
  readonly name = 'openrouter' as const;

  async complete(
    messages: LlmMessage[],
    config: LlmConfig,
    tools?: LlmToolDefinition[]
  ): Promise<LlmResponse> {
    const startTime = Date.now();
    const isOpenAi = getApiUrl(config.apiKey).includes('openai.com');
    const targetModel = getModelName(config.model || '', isOpenAi);

    const payload: Record<string, unknown> = {
      model: targetModel,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
        ...(m.toolCalls ? { tool_calls: m.toolCalls } : {}),
      })),
      temperature: config.temperature ?? 0.7,
      max_tokens: config.maxTokens ?? 500,
      top_p: config.topP ?? 1.0,
      frequency_penalty: config.frequencyPenalty ?? 0,
      presence_penalty: config.presencePenalty ?? 0,
    };

    if (tools && tools.length > 0) {
      payload.tools = tools;
      payload.tool_choice = 'auto';
    }

    try {
      const effectiveApiKey = resolveApiKey(config.apiKey);
      const apiUrl = getApiUrl(effectiveApiKey);
      console.log(`[OpenRouterLlmProvider] Routing complete() to: ${apiUrl} (model: ${targetModel})`);
      const response = await axios.post(apiUrl, payload, {
        ...keepAliveAxiosConfig,
        headers: {
          Authorization: `Bearer ${effectiveApiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://agentlabs.io',
          'X-Title': 'AgentLabs AI Voice Engine',
        },
        timeout: 60000,
      });

      const data = response.data;
      const choice = data.choices?.[0];
      const latencyMs = Date.now() - startTime;

      return {
        content: choice?.message?.content || null,
        toolCalls: choice?.message?.tool_calls,
        finishReason: choice?.finish_reason || 'stop',
        usage: {
          promptTokens: data.usage?.prompt_tokens || 0,
          completionTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0,
        },
        model: data.model || config.model,
        latencyMs,
      };
    } catch (err: any) {
      const statusCode = err.response?.status;
      const errorMsg = err.response?.data?.error?.message || err.message;

      if (statusCode === 429) {
        throw new Error(`OpenRouter rate limited: ${errorMsg}`);
      }
      if (statusCode === 402) {
        throw new Error(`OpenRouter insufficient credits: ${errorMsg}`);
      }
      throw new Error(`OpenRouter LLM error (${statusCode}): ${errorMsg}`);
    }
  }

  async *stream(
    messages: LlmMessage[],
    config: LlmConfig,
    tools?: LlmToolDefinition[]
  ): AsyncIterable<LlmStreamChunk> {
    const isOpenAi = getApiUrl(config.apiKey).includes('openai.com');
    const targetModel = getModelName(config.model || '', isOpenAi);

    const payload: Record<string, unknown> = {
      model: targetModel,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
        ...(m.toolCalls ? { tool_calls: m.toolCalls } : {}),
      })),
      temperature: config.temperature ?? 0.7,
      max_tokens: config.maxTokens ?? 500,
      top_p: config.topP ?? 1.0,
      stream: true,
    };

    if (tools && tools.length > 0) {
      payload.tools = tools;
      payload.tool_choice = 'auto';
    }

    // AbortController lets us cancel the request if the stream stalls
    const controller = new AbortController();

    // Per-chunk inactivity timeout: if no data arrives for 30s, abort
    const STREAM_CHUNK_TIMEOUT_MS = 30_000;
    let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
    const resetInactivityTimer = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        controller.abort();
      }, STREAM_CHUNK_TIMEOUT_MS);
    };

    resetInactivityTimer(); // Start the clock before we even get the first byte

    try {
      const effectiveApiKey = resolveApiKey(config.apiKey);
      const apiUrl = getApiUrl(effectiveApiKey);
      console.log(`[OpenRouterLlmProvider] Routing stream() to: ${apiUrl} (model: ${targetModel})`);
      const response = await axios.post(apiUrl, payload, {
        ...keepAliveAxiosConfig,
        headers: {
          Authorization: `Bearer ${effectiveApiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://agentlabs.io',
          'X-Title': 'AgentLabs AI Voice Engine',
        },
        responseType: 'stream',
        timeout: 60000,
        signal: controller.signal,
      });

      const stream = response.data as NodeJS.ReadableStream;
      let buffer = '';

      for await (const rawChunk of stream) {
        resetInactivityTimer(); // Reset on every received chunk
        buffer += rawChunk.toString();

        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6); // Remove 'data: ' prefix
          if (data === '[DONE]') {
            if (inactivityTimer) clearTimeout(inactivityTimer);
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;
            const finishReason = parsed.choices?.[0]?.finish_reason;

            if (delta) {
              const chunk: LlmStreamChunk = {};
              if (delta.content) chunk.content = delta.content;
              if (delta.tool_calls) chunk.toolCalls = delta.tool_calls;
              if (finishReason) chunk.finishReason = finishReason;
              yield chunk;
            }
          } catch {
            // Skip malformed SSE chunks
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || err.code === 'ERR_CANCELED' || controller.signal.aborted) {
        throw new Error(`OpenRouter stream timed out after ${STREAM_CHUNK_TIMEOUT_MS / 1000}s of inactivity`);
      }
      throw err;
    } finally {
      if (inactivityTimer) clearTimeout(inactivityTimer);
    }
  }
}
