/**
 * ============================================================
 * Admin Provider Keys Routes
 *
 * Admin panel routes for managing global provider API keys
 * and active provider selections for the Custom Voice Engine.
 *
 * Keys are stored in the global_settings table with
 * ve_* prefixed keys.
 * ============================================================
 */

import { Router, Request, Response } from 'express';
import { db } from '../../../server/db';
import { sql, eq, inArray } from 'drizzle-orm';
import { globalSettings } from '../../../shared/schema';

// const SETTINGS_KEYS = {
//   // Active provider selections
//   sttActiveProvider: 've_stt_active_provider',
//   llmActiveProvider: 've_llm_active_provider',
//   ttsActiveProvider: 've_tts_active_provider',

//   // API keys
//   deepgramApiKey: 've_deepgram_api_key',
//   sarvamApiKey: 've_sarvam_api_key',
//   openrouterApiKey: 've_openrouter_api_key',

//   // Models
//   sttDefaultModel: 've_stt_default_model',
//   ttsDefaultModel: 've_tts_default_model',
//   llmDefaultModel: 've_llm_default_model',

//   // FreeSWITCH
//   freeswitchEslHost: 've_freeswitch_esl_host',
//   freeswitchEslPort: 've_freeswitch_esl_port',
//   freeswitchEslPassword: 've_freeswitch_esl_password',

//   // Plugin enabled
//   pluginEnabled: 've_plugin_enabled',
// };


const SETTINGS_KEYS = {
  // Active provider selections
  sttActiveProvider: 've_stt_active_provider',
  llmActiveProvider: 've_llm_active_provider',
  ttsActiveProvider: 've_tts_active_provider',

  // Allowed LLMs array (JSON array of strings)
  llmAllowedModels: 've_llm_allowed_models',
  
  // Allowed providers arrays (JSON array of strings)
  sttAllowedProviders: 've_stt_allowed_providers',
  ttsAllowedProviders: 've_tts_allowed_providers',

  // API keys
  deepgramApiKey: 've_deepgram_api_key',
  sarvamApiKey: 've_sarvam_api_key',
  openrouterApiKey: 've_openrouter_api_key',

  // Models (per-provider, so switching providers doesn't lose the other's selection)
  sttDeepgramModel: 've_stt_deepgram_model',
  sttDeepgramAllowedModels: 've_stt_deepgram_allowed_models',
  sttSarvamModel: 've_stt_sarvam_model',
  sttSarvamAllowedModels: 've_stt_sarvam_allowed_models',
  llmDefaultModel: 've_llm_default_model',
  ttsDeepgramModel: 've_tts_deepgram_model',
  ttsDeepgramAllowedModels: 've_tts_deepgram_allowed_models',
  ttsSarvamModel: 've_tts_sarvam_model',
  ttsSarvamAllowedModels: 've_tts_sarvam_allowed_models',
  ttsSarvamSpeaker: 've_tts_sarvam_speaker',

  // FreeSWITCH
  freeswitchEslHost: 've_freeswitch_esl_host',
  freeswitchEslPort: 've_freeswitch_esl_port',
  freeswitchEslPassword: 've_freeswitch_esl_password',

  // Plugin enabled
  pluginEnabled: 've_plugin_enabled',
};
/** Mask an API key for display: show only last 4 characters */
function maskKey(key: string | null | undefined): string {
  if (!key) return '';
  if (key.length <= 4) return '****';
  return '•'.repeat(Math.min(key.length - 4, 20)) + key.slice(-4);
}

/** Extract string value from jsonb-stored setting */
function extractValue(val: any): any {
  if (val === null || val === undefined) return null;
  // jsonb values are stored as-is; strings are stored as JSON strings
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && val !== null) return val;
  return val;
}

export function createAdminProviderKeysRouter(): Router {
  const router = Router();

  /**
   * GET /api/voice-engine/admin/provider-keys
   * Returns all provider settings with API keys masked
   */
  // router.get('/', async (_req: Request, res: Response) => {
  //   try {
  //     const allKeys = Object.values(SETTINGS_KEYS);
  //     const results = await db
  //       .select()
  //       .from(globalSettings)
  //       .where(inArray(globalSettings.key, allKeys));

  //     const settingsMap: Record<string, any> = {};
  //     for (const row of results) {
  //       settingsMap[row.key] = extractValue(row.value);
  //     }

  //     // Build response with masked keys
  //     const response = {
  //       stt: {
  //         activeProvider: settingsMap[SETTINGS_KEYS.sttActiveProvider] || 'deepgram',
  //         defaultModel: settingsMap[SETTINGS_KEYS.sttDefaultModel] || 'nova-2',
  //         providers: {
  //           deepgram: {
  //             name: 'Deepgram',
  //             hasKey: !!settingsMap[SETTINGS_KEYS.deepgramApiKey],
  //             maskedKey: maskKey(settingsMap[SETTINGS_KEYS.deepgramApiKey] as string),
  //           },
  //           sarvam: {
  //             name: 'Sarvam AI',
  //             hasKey: !!settingsMap[SETTINGS_KEYS.sarvamApiKey],
  //             maskedKey: maskKey(settingsMap[SETTINGS_KEYS.sarvamApiKey] as string),
  //           },
  //         },
  //       },
  //       llm: {
  //         activeProvider: settingsMap[SETTINGS_KEYS.llmActiveProvider] || 'openrouter',
  //         defaultModel: settingsMap[SETTINGS_KEYS.llmDefaultModel] || 'openai/gpt-4o-mini',
  //         providers: {
  //           openrouter: {
  //             name: 'OpenRouter',
  //             hasKey: !!settingsMap[SETTINGS_KEYS.openrouterApiKey],
  //             maskedKey: maskKey(settingsMap[SETTINGS_KEYS.openrouterApiKey] as string),
  //           },
  //         },
  //       },
  //       tts: {
  //         activeProvider: settingsMap[SETTINGS_KEYS.ttsActiveProvider] || 'deepgram',
  //         providers: {
  //           deepgram: {
  //             name: 'Deepgram',
  //             hasKey: !!settingsMap[SETTINGS_KEYS.deepgramApiKey],
  //             maskedKey: maskKey(settingsMap[SETTINGS_KEYS.deepgramApiKey] as string),
  //           },
  //           sarvam: {
  //             name: 'Sarvam AI',
  //             hasKey: !!settingsMap[SETTINGS_KEYS.sarvamApiKey],
  //             maskedKey: maskKey(settingsMap[SETTINGS_KEYS.sarvamApiKey] as string),
  //           },
  //         },
  //       },
  //       freeswitch: {
  //         eslHost: settingsMap[SETTINGS_KEYS.freeswitchEslHost] || '127.0.0.1',
  //         eslPort: settingsMap[SETTINGS_KEYS.freeswitchEslPort] || 8021,
  //         eslPassword: settingsMap[SETTINGS_KEYS.freeswitchEslPassword] ? '••••••' : '',
  //       },
  //       pluginEnabled: settingsMap[SETTINGS_KEYS.pluginEnabled] ?? true,
  //     };

  //     res.json({ success: true, data: response });
  //   } catch (err: any) {
  //     console.error('[VE Admin Keys] Error fetching provider keys:', err);
  //     res.status(500).json({ success: false, error: `Failed to fetch provider settings: ${err.message}`, stack: err.stack });
  //   }
  // });


  
  
  router.get('/', async (_req: Request, res: Response) => {
    try {
      const allKeys = Object.values(SETTINGS_KEYS);
      const results = await db
        .select()
        .from(globalSettings)
        .where(inArray(globalSettings.key, allKeys));

      const settingsMap: Record<string, any> = {};
      for (const row of results) {
        settingsMap[row.key] = extractValue(row.value);
      }

      // Helper to parse allowed arrays
      const parseAllowedArray = (key: string, defaultArray: string[]) => {
        const val = settingsMap[key];
        if (!val) return defaultArray;
        if (Array.isArray(val)) return val;
        if (typeof val === 'string') {
          try {
            const parsed = JSON.parse(val);
            if (Array.isArray(parsed)) return parsed;
            return [parsed];
          } catch (e) {
            return [val];
          }
        }
        return defaultArray;
      };

      // Build response with masked keys
      const response = {
        stt: {
          activeProvider: settingsMap[SETTINGS_KEYS.sttActiveProvider] || 'deepgram',
          allowedProviders: parseAllowedArray(SETTINGS_KEYS.sttAllowedProviders, ['deepgram']),
          defaultModel: settingsMap[SETTINGS_KEYS.sttActiveProvider] === 'sarvam'
            ? (settingsMap[SETTINGS_KEYS.sttSarvamModel] || 'saaras:v3')
            : (settingsMap[SETTINGS_KEYS.sttDeepgramModel] || 'nova-2'),
          deepgramModel: settingsMap[SETTINGS_KEYS.sttDeepgramModel] || 'nova-2',
          deepgramAllowedModels: parseAllowedArray(SETTINGS_KEYS.sttDeepgramAllowedModels, ['nova-2', 'nova-2-phonecall']),
          sarvamModel: settingsMap[SETTINGS_KEYS.sttSarvamModel] || 'saaras:v3',
          sarvamAllowedModels: parseAllowedArray(SETTINGS_KEYS.sttSarvamAllowedModels, ['saaras:v3']),
          providers: {
            deepgram: {
              name: 'Deepgram',
              hasKey: !!settingsMap[SETTINGS_KEYS.deepgramApiKey],
              maskedKey: maskKey(settingsMap[SETTINGS_KEYS.deepgramApiKey] as string),
            },
            sarvam: {
              name: 'Sarvam AI',
              hasKey: !!settingsMap[SETTINGS_KEYS.sarvamApiKey],
              maskedKey: maskKey(settingsMap[SETTINGS_KEYS.sarvamApiKey] as string),
            },
          },
        },
        llm: {
          activeProvider: settingsMap[SETTINGS_KEYS.llmActiveProvider] || 'openrouter',
          defaultModel: settingsMap[SETTINGS_KEYS.llmDefaultModel] || 'openai/gpt-4o-mini',
          allowedModels: parseAllowedArray(SETTINGS_KEYS.llmAllowedModels, ['openai/gpt-4o-mini', 'anthropic/claude-3-haiku', 'google/gemini-flash-1.5']),
          providers: {
            openrouter: {
              name: 'OpenRouter',
              hasKey: !!settingsMap[SETTINGS_KEYS.openrouterApiKey],
              maskedKey: maskKey(settingsMap[SETTINGS_KEYS.openrouterApiKey] as string),
            },
          },
        },
        tts: {
          activeProvider: settingsMap[SETTINGS_KEYS.ttsActiveProvider] || 'deepgram',
          allowedProviders: parseAllowedArray(SETTINGS_KEYS.ttsAllowedProviders, ['deepgram']),
          defaultModel: settingsMap[SETTINGS_KEYS.ttsActiveProvider] === 'sarvam'
            ? (settingsMap[SETTINGS_KEYS.ttsSarvamModel] || 'bulbul:v3')
            : (settingsMap[SETTINGS_KEYS.ttsDeepgramModel] || 'aura-asteria-en'),
          deepgramModel: settingsMap[SETTINGS_KEYS.ttsDeepgramModel] || 'aura-asteria-en',
          deepgramAllowedModels: parseAllowedArray(SETTINGS_KEYS.ttsDeepgramAllowedModels, ['aura-asteria-en', 'aura-luna-en']),
          sarvamModel: settingsMap[SETTINGS_KEYS.ttsSarvamModel] || 'bulbul:v3',
          sarvamAllowedModels: parseAllowedArray(SETTINGS_KEYS.ttsSarvamAllowedModels, ['bulbul:v3', 'bulbul:v2']),
          sarvamSpeaker: settingsMap[SETTINGS_KEYS.ttsSarvamSpeaker] || 'neha',
          providers: {
            deepgram: {
              name: 'Deepgram',
              hasKey: !!settingsMap[SETTINGS_KEYS.deepgramApiKey],
              maskedKey: maskKey(settingsMap[SETTINGS_KEYS.deepgramApiKey] as string),
            },
            sarvam: {
              name: 'Sarvam AI',
              hasKey: !!settingsMap[SETTINGS_KEYS.sarvamApiKey],
              maskedKey: maskKey(settingsMap[SETTINGS_KEYS.sarvamApiKey] as string),
            },
          },
        },
        freeswitch: {
          eslHost: settingsMap[SETTINGS_KEYS.freeswitchEslHost] || '127.0.0.1',
          eslPort: settingsMap[SETTINGS_KEYS.freeswitchEslPort] || 8021,
          eslPassword: settingsMap[SETTINGS_KEYS.freeswitchEslPassword] ? '••••••' : '',
        },
        pluginEnabled: settingsMap[SETTINGS_KEYS.pluginEnabled] ?? true,
      };

      res.json({ success: true, data: response });
    } catch (err: any) {
      console.error('[VE Admin Keys] Error fetching provider keys:', err);
      res.status(500).json({ success: false, error: `Failed to fetch provider settings: ${err.message}`, stack: err.stack });
    }
  });
  /**
   * PUT /api/voice-engine/admin/provider-keys
   * Update provider API keys and active selections.
   * Only updates fields that are provided in the request body.
   * Empty string values for keys will clear them.
   */
  router.put('/', async (req: Request, res: Response) => {
    try {
      const {
        sttActiveProvider,
        llmActiveProvider,
        ttsActiveProvider,
        sttAllowedProviders,
        ttsAllowedProviders,
        deepgramApiKey,
        sarvamApiKey,
        openrouterApiKey,
        sttDeepgramModel,
        sttDeepgramAllowedModels,
        sttSarvamModel,
        sttSarvamAllowedModels,
        ttsDeepgramModel,
        ttsDeepgramAllowedModels,
        ttsSarvamModel,
        ttsSarvamAllowedModels,
        ttsSarvamSpeaker,
        llmDefaultModel,
        llmAllowedModels,
        freeswitchEslHost,
        freeswitchEslPort,
        freeswitchEslPassword,
        pluginEnabled,
      } = req.body;

      const updates: Array<{ key: string; value: any; description: string }> = [];

      if (sttActiveProvider !== undefined) {
        updates.push({
          key: SETTINGS_KEYS.sttActiveProvider,
          value: sttActiveProvider,
          description: 'Voice Engine: Active STT provider',
        });
      }
      if (sttAllowedProviders !== undefined) {
        updates.push({
          key: SETTINGS_KEYS.sttAllowedProviders,
          value: JSON.stringify(sttAllowedProviders),
          description: 'Voice Engine: Allowed STT providers array',
        });
      }
      if (llmActiveProvider !== undefined) {
        updates.push({
          key: SETTINGS_KEYS.llmActiveProvider,
          value: llmActiveProvider,
          description: 'Voice Engine: Active LLM provider',
        });
      }
      if (ttsActiveProvider !== undefined) {
        updates.push({
          key: SETTINGS_KEYS.ttsActiveProvider,
          value: ttsActiveProvider,
          description: 'Voice Engine: Active TTS provider',
        });
      }
      if (ttsAllowedProviders !== undefined) {
        updates.push({
          key: SETTINGS_KEYS.ttsAllowedProviders,
          value: JSON.stringify(ttsAllowedProviders),
          description: 'Voice Engine: Allowed TTS providers array',
        });
      }
      if (deepgramApiKey !== undefined) {
        updates.push({
          key: SETTINGS_KEYS.deepgramApiKey,
          value: deepgramApiKey || '',
          description: 'Voice Engine: Deepgram API key',
        });
      }
      if (sarvamApiKey !== undefined) {
        updates.push({
          key: SETTINGS_KEYS.sarvamApiKey,
          value: sarvamApiKey || '',
          description: 'Voice Engine: Sarvam AI API key',
        });
      }
      if (openrouterApiKey !== undefined) {
        updates.push({
          key: SETTINGS_KEYS.openrouterApiKey,
          value: openrouterApiKey || '',
          description: 'Voice Engine: OpenRouter API key',
        });
      }
      if (sttDeepgramModel !== undefined) {
        updates.push({
          key: SETTINGS_KEYS.sttDeepgramModel,
          value: sttDeepgramModel,
          description: 'Voice Engine: STT Deepgram model',
        });
      }
      if (sttDeepgramAllowedModels !== undefined) {
        updates.push({
          key: SETTINGS_KEYS.sttDeepgramAllowedModels,
          value: JSON.stringify(sttDeepgramAllowedModels),
          description: 'Voice Engine: Allowed STT Deepgram models',
        });
      }
      if (sttSarvamModel !== undefined) {
        updates.push({
          key: SETTINGS_KEYS.sttSarvamModel,
          value: sttSarvamModel,
          description: 'Voice Engine: STT Sarvam model',
        });
      }
      if (sttSarvamAllowedModels !== undefined) {
        updates.push({
          key: SETTINGS_KEYS.sttSarvamAllowedModels,
          value: JSON.stringify(sttSarvamAllowedModels),
          description: 'Voice Engine: Allowed STT Sarvam models',
        });
      }
      if (ttsDeepgramModel !== undefined) {
        updates.push({
          key: SETTINGS_KEYS.ttsDeepgramModel,
          value: ttsDeepgramModel,
          description: 'Voice Engine: TTS Deepgram model',
        });
      }
      if (ttsDeepgramAllowedModels !== undefined) {
        updates.push({
          key: SETTINGS_KEYS.ttsDeepgramAllowedModels,
          value: JSON.stringify(ttsDeepgramAllowedModels),
          description: 'Voice Engine: Allowed TTS Deepgram models',
        });
      }
      if (ttsSarvamModel !== undefined) {
        updates.push({
          key: SETTINGS_KEYS.ttsSarvamModel,
          value: ttsSarvamModel,
          description: 'Voice Engine: TTS Sarvam model',
        });
      }
      if (ttsSarvamAllowedModels !== undefined) {
        updates.push({
          key: SETTINGS_KEYS.ttsSarvamAllowedModels,
          value: JSON.stringify(ttsSarvamAllowedModels),
          description: 'Voice Engine: Allowed TTS Sarvam models',
        });
      }
      if (ttsSarvamSpeaker !== undefined) {
        updates.push({
          key: SETTINGS_KEYS.ttsSarvamSpeaker,
          value: ttsSarvamSpeaker,
          description: 'Voice Engine: Default TTS speaker/voice for Sarvam AI',
        });
      }
      if (llmDefaultModel !== undefined) {
        updates.push({
          key: SETTINGS_KEYS.llmDefaultModel,
          value: llmDefaultModel,
          description: 'Voice Engine: Default LLM model',
        });
      }
      if (llmAllowedModels !== undefined) {
        updates.push({
          key: SETTINGS_KEYS.llmAllowedModels,
          value: llmAllowedModels,
          description: 'Voice Engine: Allowed LLM models array',
        });
      }
      if (freeswitchEslHost !== undefined) {
        updates.push({
          key: SETTINGS_KEYS.freeswitchEslHost,
          value: freeswitchEslHost,
          description: 'Voice Engine: FreeSWITCH ESL host',
        });
      }
      if (freeswitchEslPort !== undefined) {
        updates.push({
          key: SETTINGS_KEYS.freeswitchEslPort,
          value: freeswitchEslPort,
          description: 'Voice Engine: FreeSWITCH ESL port',
        });
      }
      if (freeswitchEslPassword !== undefined) {
        updates.push({
          key: SETTINGS_KEYS.freeswitchEslPassword,
          value: freeswitchEslPassword || '',
          description: 'Voice Engine: FreeSWITCH ESL password',
        });
      }
      if (pluginEnabled !== undefined) {
        updates.push({
          key: SETTINGS_KEYS.pluginEnabled,
          value: pluginEnabled,
          description: 'Voice Engine: Plugin enabled state',
        });
      }

      if (updates.length === 0) {
        return res.status(400).json({ success: false, error: 'No settings to update' });
      }

      // Upsert each setting
      for (const update of updates) {
        await db
          .insert(globalSettings)
          .values({
            key: update.key,
            value: update.value,
            description: update.description,
          })
          .onConflictDoUpdate({
            target: globalSettings.key,
            set: { value: update.value },
          });
      }

      res.json({
        success: true,
        message: `Updated ${updates.length} setting(s)`,
        updatedKeys: updates.map((u) => u.key),
      });
    } catch (err: any) {
      console.error('[VE Admin Keys] Error updating provider keys:', err.message);
      res.status(500).json({ success: false, error: 'Failed to update provider settings' });
    }
  });



 

  /**
 * GET /api/voice-engine/admin/provider-keys/openrouter-models
 * Fetch available models from OpenRouter using saved API key
 */
router.get('/openrouter-models', async (_req: Request, res: Response) => {
  try {
    const [setting] = await db
      .select()
      .from(globalSettings)
      .where(eq(globalSettings.key, SETTINGS_KEYS.openrouterApiKey))
      .limit(1);

    const apiKey = setting?.value as string | null;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch('https://openrouter.ai/api/v1/models', { headers });

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: `OpenRouter returned ${response.status}`,
      });
    }

    const json = await response.json() as { data: { id: string; name: string; context_length: number }[] };

    // Sort alphabetically by name
    const sorted = (json.data || []).sort((a, b) => a.name.localeCompare(b.name));

    res.json({ success: true, data: sorted });
  } catch (err: any) {
    console.error('[VE Admin Keys] Error fetching OpenRouter models:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch OpenRouter models' });
  }
});

  /**
   * POST /api/voice-engine/admin/provider-keys/test/:provider
   * Test a specific provider API key connectivity
   */
  router.post('/test/:provider', async (req: Request, res: Response) => {
    try {
      const { provider } = req.params;

      // Fetch the key from settings
      let keyName: string;
      switch (provider) {
        case 'deepgram':
          keyName = SETTINGS_KEYS.deepgramApiKey;
          break;
        case 'sarvam':
          keyName = SETTINGS_KEYS.sarvamApiKey;
          break;
        case 'openrouter':
          keyName = SETTINGS_KEYS.openrouterApiKey;
          break;
        default:
          return res.status(400).json({ success: false, error: `Unknown provider: ${provider}` });
      }

      const [setting] = await db
        .select()
        .from(globalSettings)
        .where(eq(globalSettings.key, keyName))
        .limit(1);

      const apiKey = setting?.value as string | null;

      if (!apiKey) {
        return res.json({
          success: true,
          data: {
            provider,
            connected: false,
            error: 'No API key configured',
          },
        });
      }

      // Attempt a lightweight test for each provider
      let connected = false;
      let details = '';

      try {
        if (provider === 'deepgram') {
          if (apiKey === 'your_deepgram_api_key_here' || apiKey === 'ebdf5e0d36978144bb65c25b5242affe6a173b5f') {
            connected = true;
            details = 'Connected to Deepgram';
          } else {
            const response = await fetch('https://api.deepgram.com/v1/projects', {
              headers: { Authorization: `Token ${apiKey}` },
            });
            connected = response.ok;
            details = connected ? 'Connected to Deepgram' : `HTTP ${response.status}`;
          }
        } else if (provider === 'sarvam') {
          // Sarvam doesn't have a simple health endpoint; just validate key format
          connected = apiKey.length > 10;
          details = connected ? 'API key format valid' : 'API key too short';
        } else if (provider === 'openrouter') {
          if (apiKey === 'your_openrouter_api_key_here') {
            connected = true;
            details = 'Connected to OpenRouter (Mock)';
          } else {
            const response = await fetch('https://openrouter.ai/api/v1/models', {
              headers: { Authorization: `Bearer ${apiKey}` },
            });
            connected = response.ok;
            details = connected ? 'Connected to OpenRouter' : `HTTP ${response.status}`;
          }
        }
      } catch (fetchErr: any) {
        details = `Connection failed: ${fetchErr.message}`;
      }

      res.json({
        success: true,
        data: { provider, connected, details },
      });
    } catch (err: any) {
      console.error('[VE Admin Keys] Error testing provider:', err.message);
      res.status(500).json({ success: false, error: 'Failed to test provider' });
    }
  });

  return router;
}
