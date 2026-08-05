/**
 * ============================================================
 * Tenant Configuration Routes
 *
 * Per-user STT/LLM/TTS provider configuration.
 * ============================================================
 */

import { Router, Request, Response } from 'express';
import { db } from '../../../server/db';
import { sql } from 'drizzle-orm';

export function createTenantConfigRouter(): Router {
  const router = Router();

  /** GET /api/voice-engine/config - Get current tenant config */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

      const result = await db.execute(
        sql`SELECT * FROM ve_provider_configs WHERE user_id = ${userId} LIMIT 1`
      );

      if ((result.rows as any[]).length === 0) {
        // Return defaults
        return res.json({
          success: true,
          data: {
            sttProvider: 'deepgram',
            llmProvider: 'openrouter',
            llmModel: 'openai/gpt-4o-mini',
            ttsProvider: 'deepgram',
            ttsVoice: 'aura-asteria-en',
            maxConcurrentCalls: 10,
            recordingEnabled: true,
            memoryEnabled: true,
            cacheEnabled: true,
            isDefault: true,
          },
        });
      }

      const config = result.rows[0] as any;
      // Mask API keys
      if (config.stt_api_key) config.stt_api_key = '***' + config.stt_api_key.slice(-4);
      if (config.llm_api_key) config.llm_api_key = '***' + config.llm_api_key.slice(-4);
      if (config.tts_api_key) config.tts_api_key = '***' + config.tts_api_key.slice(-4);

      res.json({ success: true, data: config });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /** PUT /api/voice-engine/config - Update tenant config */
  router.put('/', async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

      const {
        sttProvider, sttApiKey,
        llmProvider, llmApiKey, llmModel,
        ttsProvider, ttsApiKey, ttsVoice,
        maxConcurrentCalls, recordingEnabled, recordingStorage, recordingRetentionDays,
        memoryEnabled, cacheEnabled, cacheTtlSeconds,
      } = req.body;

      const result = await db.execute(sql`
        INSERT INTO ve_provider_configs (user_id, stt_provider, stt_api_key, llm_provider, llm_api_key, llm_model, tts_provider, tts_api_key, tts_voice, max_concurrent_calls, recording_enabled, recording_storage, recording_retention_days, memory_enabled, cache_enabled, cache_ttl_seconds)
        VALUES (${userId}, ${sttProvider || 'deepgram'}, ${sttApiKey || null}, ${llmProvider || 'openrouter'}, ${llmApiKey || null}, ${llmModel || 'openai/gpt-4o-mini'}, ${ttsProvider || 'deepgram'}, ${ttsApiKey || null}, ${ttsVoice || 'aura-asteria-en'}, ${maxConcurrentCalls || 10}, ${recordingEnabled ?? true}, ${recordingStorage || 'local'}, ${recordingRetentionDays || 30}, ${memoryEnabled ?? true}, ${cacheEnabled ?? true}, ${cacheTtlSeconds || 3600})
        ON CONFLICT (user_id) DO UPDATE SET
          stt_provider = COALESCE(EXCLUDED.stt_provider, ve_provider_configs.stt_provider),
          stt_api_key = CASE WHEN ${sttApiKey || null} IS NOT NULL THEN ${sttApiKey || null} ELSE ve_provider_configs.stt_api_key END,
          llm_provider = COALESCE(EXCLUDED.llm_provider, ve_provider_configs.llm_provider),
          llm_api_key = CASE WHEN ${llmApiKey || null} IS NOT NULL THEN ${llmApiKey || null} ELSE ve_provider_configs.llm_api_key END,
          llm_model = COALESCE(EXCLUDED.llm_model, ve_provider_configs.llm_model),
          tts_provider = COALESCE(EXCLUDED.tts_provider, ve_provider_configs.tts_provider),
          tts_api_key = CASE WHEN ${ttsApiKey || null} IS NOT NULL THEN ${ttsApiKey || null} ELSE ve_provider_configs.tts_api_key END,
          tts_voice = COALESCE(EXCLUDED.tts_voice, ve_provider_configs.tts_voice),
          max_concurrent_calls = COALESCE(EXCLUDED.max_concurrent_calls, ve_provider_configs.max_concurrent_calls),
          recording_enabled = COALESCE(EXCLUDED.recording_enabled, ve_provider_configs.recording_enabled),
          recording_storage = COALESCE(EXCLUDED.recording_storage, ve_provider_configs.recording_storage),
          recording_retention_days = COALESCE(EXCLUDED.recording_retention_days, ve_provider_configs.recording_retention_days),
          memory_enabled = COALESCE(EXCLUDED.memory_enabled, ve_provider_configs.memory_enabled),
          cache_enabled = COALESCE(EXCLUDED.cache_enabled, ve_provider_configs.cache_enabled),
          cache_ttl_seconds = COALESCE(EXCLUDED.cache_ttl_seconds, ve_provider_configs.cache_ttl_seconds),
          updated_at = NOW()
        RETURNING *
      `);

      res.json({ success: true, data: result.rows[0] });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}
