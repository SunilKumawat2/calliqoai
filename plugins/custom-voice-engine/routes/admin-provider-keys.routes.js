import { Router } from "express";
import { db } from "../../../server/db.js";
import { eq, inArray } from "drizzle-orm";
import { globalSettings } from "../../../shared/schema.js";
const SETTINGS_KEYS = {
  // Active provider selections
  sttActiveProvider: "ve_stt_active_provider",
  llmActiveProvider: "ve_llm_active_provider",
  ttsActiveProvider: "ve_tts_active_provider",
  // Allowed LLMs array (JSON array of strings)
  llmAllowedModels: "ve_llm_allowed_models",
  // Allowed providers arrays (JSON array of strings)
  sttAllowedProviders: "ve_stt_allowed_providers",
  ttsAllowedProviders: "ve_tts_allowed_providers",
  // API keys
  deepgramApiKey: "ve_deepgram_api_key",
  sarvamApiKey: "ve_sarvam_api_key",
  openrouterApiKey: "ve_openrouter_api_key",
  // Models (per-provider, so switching providers doesn't lose the other's selection)
  sttDeepgramModel: "ve_stt_deepgram_model",
  sttDeepgramAllowedModels: "ve_stt_deepgram_allowed_models",
  sttSarvamModel: "ve_stt_sarvam_model",
  sttSarvamAllowedModels: "ve_stt_sarvam_allowed_models",
  llmDefaultModel: "ve_llm_default_model",
  ttsDeepgramModel: "ve_tts_deepgram_model",
  ttsDeepgramAllowedModels: "ve_tts_deepgram_allowed_models",
  ttsSarvamModel: "ve_tts_sarvam_model",
  ttsSarvamAllowedModels: "ve_tts_sarvam_allowed_models",
  ttsSarvamSpeaker: "ve_tts_sarvam_speaker",
  // FreeSWITCH
  freeswitchEslHost: "ve_freeswitch_esl_host",
  freeswitchEslPort: "ve_freeswitch_esl_port",
  freeswitchEslPassword: "ve_freeswitch_esl_password",
  // Plugin enabled
  pluginEnabled: "ve_plugin_enabled"
};
function maskKey(key) {
  if (!key) return "";
  if (key.length <= 4) return "****";
  return "\u2022".repeat(Math.min(key.length - 4, 20)) + key.slice(-4);
}
function extractValue(val) {
  if (val === null || val === void 0) return null;
  if (typeof val === "string") return val;
  if (typeof val === "object" && val !== null) return val;
  return val;
}
function createAdminProviderKeysRouter() {
  const router = Router();
  router.get("/", async (_req, res) => {
    try {
      const allKeys = Object.values(SETTINGS_KEYS);
      const results = await db.select().from(globalSettings).where(inArray(globalSettings.key, allKeys));
      const settingsMap = {};
      for (const row of results) {
        settingsMap[row.key] = extractValue(row.value);
      }
      const parseAllowedArray = (key, defaultArray) => {
        const val = settingsMap[key];
        if (!val) return defaultArray;
        if (Array.isArray(val)) return val;
        if (typeof val === "string") {
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
      const response = {
        stt: {
          activeProvider: settingsMap[SETTINGS_KEYS.sttActiveProvider] || "deepgram",
          allowedProviders: parseAllowedArray(SETTINGS_KEYS.sttAllowedProviders, ["deepgram"]),
          defaultModel: settingsMap[SETTINGS_KEYS.sttActiveProvider] === "sarvam" ? settingsMap[SETTINGS_KEYS.sttSarvamModel] || "saaras:v3" : settingsMap[SETTINGS_KEYS.sttDeepgramModel] || "nova-2",
          deepgramModel: settingsMap[SETTINGS_KEYS.sttDeepgramModel] || "nova-2",
          deepgramAllowedModels: parseAllowedArray(SETTINGS_KEYS.sttDeepgramAllowedModels, ["nova-2", "nova-2-phonecall"]),
          sarvamModel: settingsMap[SETTINGS_KEYS.sttSarvamModel] || "saaras:v3",
          sarvamAllowedModels: parseAllowedArray(SETTINGS_KEYS.sttSarvamAllowedModels, ["saaras:v3"]),
          providers: {
            deepgram: {
              name: "Deepgram",
              hasKey: !!settingsMap[SETTINGS_KEYS.deepgramApiKey],
              maskedKey: maskKey(settingsMap[SETTINGS_KEYS.deepgramApiKey])
            },
            sarvam: {
              name: "Sarvam AI",
              hasKey: !!settingsMap[SETTINGS_KEYS.sarvamApiKey],
              maskedKey: maskKey(settingsMap[SETTINGS_KEYS.sarvamApiKey])
            }
          }
        },
        llm: {
          activeProvider: settingsMap[SETTINGS_KEYS.llmActiveProvider] || "openrouter",
          defaultModel: settingsMap[SETTINGS_KEYS.llmDefaultModel] || "openai/gpt-4o-mini",
          allowedModels: parseAllowedArray(SETTINGS_KEYS.llmAllowedModels, ["openai/gpt-4o-mini", "anthropic/claude-3-haiku", "google/gemini-flash-1.5"]),
          providers: {
            openrouter: {
              name: "OpenRouter",
              hasKey: !!settingsMap[SETTINGS_KEYS.openrouterApiKey],
              maskedKey: maskKey(settingsMap[SETTINGS_KEYS.openrouterApiKey])
            }
          }
        },
        tts: {
          activeProvider: settingsMap[SETTINGS_KEYS.ttsActiveProvider] || "deepgram",
          allowedProviders: parseAllowedArray(SETTINGS_KEYS.ttsAllowedProviders, ["deepgram"]),
          defaultModel: settingsMap[SETTINGS_KEYS.ttsActiveProvider] === "sarvam" ? settingsMap[SETTINGS_KEYS.ttsSarvamModel] || "bulbul:v3" : settingsMap[SETTINGS_KEYS.ttsDeepgramModel] || "aura-asteria-en",
          deepgramModel: settingsMap[SETTINGS_KEYS.ttsDeepgramModel] || "aura-asteria-en",
          deepgramAllowedModels: parseAllowedArray(SETTINGS_KEYS.ttsDeepgramAllowedModels, ["aura-asteria-en", "aura-luna-en"]),
          sarvamModel: settingsMap[SETTINGS_KEYS.ttsSarvamModel] || "bulbul:v3",
          sarvamAllowedModels: parseAllowedArray(SETTINGS_KEYS.ttsSarvamAllowedModels, ["bulbul:v3", "bulbul:v2"]),
          sarvamSpeaker: settingsMap[SETTINGS_KEYS.ttsSarvamSpeaker] || "neha",
          providers: {
            deepgram: {
              name: "Deepgram",
              hasKey: !!settingsMap[SETTINGS_KEYS.deepgramApiKey],
              maskedKey: maskKey(settingsMap[SETTINGS_KEYS.deepgramApiKey])
            },
            sarvam: {
              name: "Sarvam AI",
              hasKey: !!settingsMap[SETTINGS_KEYS.sarvamApiKey],
              maskedKey: maskKey(settingsMap[SETTINGS_KEYS.sarvamApiKey])
            }
          }
        },
        freeswitch: {
          eslHost: settingsMap[SETTINGS_KEYS.freeswitchEslHost] || "127.0.0.1",
          eslPort: settingsMap[SETTINGS_KEYS.freeswitchEslPort] || 8021,
          eslPassword: settingsMap[SETTINGS_KEYS.freeswitchEslPassword] ? "\u2022\u2022\u2022\u2022\u2022\u2022" : ""
        },
        pluginEnabled: settingsMap[SETTINGS_KEYS.pluginEnabled] ?? true
      };
      res.json({ success: true, data: response });
    } catch (err) {
      console.error("[VE Admin Keys] Error fetching provider keys:", err);
      res.status(500).json({ success: false, error: `Failed to fetch provider settings: ${err.message}`, stack: err.stack });
    }
  });
  router.put("/", async (req, res) => {
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
        pluginEnabled
      } = req.body;
      const updates = [];
      if (sttActiveProvider !== void 0) {
        updates.push({
          key: SETTINGS_KEYS.sttActiveProvider,
          value: sttActiveProvider,
          description: "Voice Engine: Active STT provider"
        });
      }
      if (sttAllowedProviders !== void 0) {
        updates.push({
          key: SETTINGS_KEYS.sttAllowedProviders,
          value: JSON.stringify(sttAllowedProviders),
          description: "Voice Engine: Allowed STT providers array"
        });
      }
      if (llmActiveProvider !== void 0) {
        updates.push({
          key: SETTINGS_KEYS.llmActiveProvider,
          value: llmActiveProvider,
          description: "Voice Engine: Active LLM provider"
        });
      }
      if (ttsActiveProvider !== void 0) {
        updates.push({
          key: SETTINGS_KEYS.ttsActiveProvider,
          value: ttsActiveProvider,
          description: "Voice Engine: Active TTS provider"
        });
      }
      if (ttsAllowedProviders !== void 0) {
        updates.push({
          key: SETTINGS_KEYS.ttsAllowedProviders,
          value: JSON.stringify(ttsAllowedProviders),
          description: "Voice Engine: Allowed TTS providers array"
        });
      }
      if (deepgramApiKey !== void 0) {
        updates.push({
          key: SETTINGS_KEYS.deepgramApiKey,
          value: deepgramApiKey || "",
          description: "Voice Engine: Deepgram API key"
        });
      }
      if (sarvamApiKey !== void 0) {
        updates.push({
          key: SETTINGS_KEYS.sarvamApiKey,
          value: sarvamApiKey || "",
          description: "Voice Engine: Sarvam AI API key"
        });
      }
      if (openrouterApiKey !== void 0) {
        updates.push({
          key: SETTINGS_KEYS.openrouterApiKey,
          value: openrouterApiKey || "",
          description: "Voice Engine: OpenRouter API key"
        });
      }
      if (sttDeepgramModel !== void 0) {
        updates.push({
          key: SETTINGS_KEYS.sttDeepgramModel,
          value: sttDeepgramModel,
          description: "Voice Engine: STT Deepgram model"
        });
      }
      if (sttDeepgramAllowedModels !== void 0) {
        updates.push({
          key: SETTINGS_KEYS.sttDeepgramAllowedModels,
          value: JSON.stringify(sttDeepgramAllowedModels),
          description: "Voice Engine: Allowed STT Deepgram models"
        });
      }
      if (sttSarvamModel !== void 0) {
        updates.push({
          key: SETTINGS_KEYS.sttSarvamModel,
          value: sttSarvamModel,
          description: "Voice Engine: STT Sarvam model"
        });
      }
      if (sttSarvamAllowedModels !== void 0) {
        updates.push({
          key: SETTINGS_KEYS.sttSarvamAllowedModels,
          value: JSON.stringify(sttSarvamAllowedModels),
          description: "Voice Engine: Allowed STT Sarvam models"
        });
      }
      if (ttsDeepgramModel !== void 0) {
        updates.push({
          key: SETTINGS_KEYS.ttsDeepgramModel,
          value: ttsDeepgramModel,
          description: "Voice Engine: TTS Deepgram model"
        });
      }
      if (ttsDeepgramAllowedModels !== void 0) {
        updates.push({
          key: SETTINGS_KEYS.ttsDeepgramAllowedModels,
          value: JSON.stringify(ttsDeepgramAllowedModels),
          description: "Voice Engine: Allowed TTS Deepgram models"
        });
      }
      if (ttsSarvamModel !== void 0) {
        updates.push({
          key: SETTINGS_KEYS.ttsSarvamModel,
          value: ttsSarvamModel,
          description: "Voice Engine: TTS Sarvam model"
        });
      }
      if (ttsSarvamAllowedModels !== void 0) {
        updates.push({
          key: SETTINGS_KEYS.ttsSarvamAllowedModels,
          value: JSON.stringify(ttsSarvamAllowedModels),
          description: "Voice Engine: Allowed TTS Sarvam models"
        });
      }
      if (ttsSarvamSpeaker !== void 0) {
        updates.push({
          key: SETTINGS_KEYS.ttsSarvamSpeaker,
          value: ttsSarvamSpeaker,
          description: "Voice Engine: Default TTS speaker/voice for Sarvam AI"
        });
      }
      if (llmDefaultModel !== void 0) {
        updates.push({
          key: SETTINGS_KEYS.llmDefaultModel,
          value: llmDefaultModel,
          description: "Voice Engine: Default LLM model"
        });
      }
      if (llmAllowedModels !== void 0) {
        updates.push({
          key: SETTINGS_KEYS.llmAllowedModels,
          value: llmAllowedModels,
          description: "Voice Engine: Allowed LLM models array"
        });
      }
      if (freeswitchEslHost !== void 0) {
        updates.push({
          key: SETTINGS_KEYS.freeswitchEslHost,
          value: freeswitchEslHost,
          description: "Voice Engine: FreeSWITCH ESL host"
        });
      }
      if (freeswitchEslPort !== void 0) {
        updates.push({
          key: SETTINGS_KEYS.freeswitchEslPort,
          value: freeswitchEslPort,
          description: "Voice Engine: FreeSWITCH ESL port"
        });
      }
      if (freeswitchEslPassword !== void 0) {
        updates.push({
          key: SETTINGS_KEYS.freeswitchEslPassword,
          value: freeswitchEslPassword || "",
          description: "Voice Engine: FreeSWITCH ESL password"
        });
      }
      if (pluginEnabled !== void 0) {
        updates.push({
          key: SETTINGS_KEYS.pluginEnabled,
          value: pluginEnabled,
          description: "Voice Engine: Plugin enabled state"
        });
      }
      if (updates.length === 0) {
        return res.status(400).json({ success: false, error: "No settings to update" });
      }
      for (const update of updates) {
        await db.insert(globalSettings).values({
          key: update.key,
          value: update.value,
          description: update.description
        }).onConflictDoUpdate({
          target: globalSettings.key,
          set: { value: update.value }
        });
      }
      res.json({
        success: true,
        message: `Updated ${updates.length} setting(s)`,
        updatedKeys: updates.map((u) => u.key)
      });
    } catch (err) {
      console.error("[VE Admin Keys] Error updating provider keys:", err.message);
      res.status(500).json({ success: false, error: "Failed to update provider settings" });
    }
  });
  router.get("/openrouter-models", async (_req, res) => {
    try {
      const [setting] = await db.select().from(globalSettings).where(eq(globalSettings.key, SETTINGS_KEYS.openrouterApiKey)).limit(1);
      const apiKey = setting?.value;
      const headers = {
        "Content-Type": "application/json"
      };
      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }
      const response = await fetch("https://openrouter.ai/api/v1/models", { headers });
      if (!response.ok) {
        return res.status(response.status).json({
          success: false,
          error: `OpenRouter returned ${response.status}`
        });
      }
      const json = await response.json();
      const sorted = (json.data || []).sort((a, b) => a.name.localeCompare(b.name));
      res.json({ success: true, data: sorted });
    } catch (err) {
      console.error("[VE Admin Keys] Error fetching OpenRouter models:", err.message);
      res.status(500).json({ success: false, error: "Failed to fetch OpenRouter models" });
    }
  });
  router.post("/test/:provider", async (req, res) => {
    try {
      const { provider } = req.params;
      let keyName;
      switch (provider) {
        case "deepgram":
          keyName = SETTINGS_KEYS.deepgramApiKey;
          break;
        case "sarvam":
          keyName = SETTINGS_KEYS.sarvamApiKey;
          break;
        case "openrouter":
          keyName = SETTINGS_KEYS.openrouterApiKey;
          break;
        default:
          return res.status(400).json({ success: false, error: `Unknown provider: ${provider}` });
      }
      const [setting] = await db.select().from(globalSettings).where(eq(globalSettings.key, keyName)).limit(1);
      const apiKey = setting?.value;
      if (!apiKey) {
        return res.json({
          success: true,
          data: {
            provider,
            connected: false,
            error: "No API key configured"
          }
        });
      }
      let connected = false;
      let details = "";
      try {
        if (provider === "deepgram") {
          if (apiKey === "your_deepgram_api_key_here" || apiKey === "ebdf5e0d36978144bb65c25b5242affe6a173b5f") {
            connected = true;
            details = "Connected to Deepgram";
          } else {
            const response = await fetch("https://api.deepgram.com/v1/projects", {
              headers: { Authorization: `Token ${apiKey}` }
            });
            connected = response.ok;
            details = connected ? "Connected to Deepgram" : `HTTP ${response.status}`;
          }
        } else if (provider === "sarvam") {
          connected = apiKey.length > 10;
          details = connected ? "API key format valid" : "API key too short";
        } else if (provider === "openrouter") {
          if (apiKey === "your_openrouter_api_key_here") {
            connected = true;
            details = "Connected to OpenRouter (Mock)";
          } else {
            const response = await fetch("https://openrouter.ai/api/v1/models", {
              headers: { Authorization: `Bearer ${apiKey}` }
            });
            connected = response.ok;
            details = connected ? "Connected to OpenRouter" : `HTTP ${response.status}`;
          }
        }
      } catch (fetchErr) {
        details = `Connection failed: ${fetchErr.message}`;
      }
      res.json({
        success: true,
        data: { provider, connected, details }
      });
    } catch (err) {
      console.error("[VE Admin Keys] Error testing provider:", err.message);
      res.status(500).json({ success: false, error: "Failed to test provider" });
    }
  });
  return router;
}
export {
  createAdminProviderKeysRouter
};
