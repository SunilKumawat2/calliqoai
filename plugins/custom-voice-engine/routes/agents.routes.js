import { Router } from "express";
import { db } from "../../../server/db.js";
import { sql, eq } from "drizzle-orm";
import { globalSettings } from "../../../shared/schema.js";
import { TtsProviderFactory } from "../services/providers/tts/tts-provider.factory.js";
function formatPgArray(arr) {
  if (!arr || !arr.length) return null;
  return `{${arr.map((val) => `"${val.replace(/"/g, '\\"')}"`).join(",")}}`;
}
function createAgentsRouter() {
  const router = Router();
  router.get("/", async (req, res) => {
    try {
      const userId = req.userId;
      const result = await db.execute(sql`SELECT * FROM ve_voice_agents WHERE user_id = ${userId} ORDER BY created_at DESC`);
      res.json({ success: true, data: result.rows });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  router.get("/:id", async (req, res) => {
    try {
      const userId = req.userId;
      const result = await db.execute(sql`SELECT * FROM ve_voice_agents WHERE id = ${req.params.id} AND user_id = ${userId} LIMIT 1`);
      if (result.rows.length === 0) return res.status(404).json({ success: false, error: "Agent not found" });
      res.json({ success: true, data: result.rows[0] });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  router.post("/", async (req, res) => {
    try {
      const userId = req.userId;
      const { name, description, systemPrompt, firstMessage, language, llmModel, temperature, maxTokens, ttsVoice, ttsProvider, sttProvider, sttModel, ttsModel, interruptible, silenceTimeoutMs, maxDurationSeconds, endCallOnSilence, businessRules, knowledgeBaseIds, enabledTools, enableMemory, memoryRetentionDays, detectLanguageEnabled, appointmentBookingEnabled, endConversationEnabled, transferEnabled, transferPhoneNumber, messagingEmailEnabled, messagingWhatsappEnabled, messagingEmailTemplate, messagingWhatsappTemplate } = req.body;
      if (!name || !systemPrompt) return res.status(400).json({ success: false, error: "name and systemPrompt are required" });
      const result = await db.execute(sql`
        INSERT INTO ve_voice_agents (
          user_id, name, description, system_prompt, first_message, language, llm_model, 
          temperature, max_tokens, tts_voice, tts_provider, stt_provider, stt_model, tts_model, interruptible, 
          silence_timeout_ms, max_duration_seconds, end_call_on_silence, business_rules, 
          knowledge_base_ids, enabled_tools, enable_memory, memory_retention_days, 
          detect_language_enabled, appointment_booking_enabled, end_conversation_enabled, 
          transfer_enabled, transfer_phone_number, messaging_email_enabled, 
          messaging_whatsapp_enabled, messaging_email_template, messaging_whatsapp_template
        )
        VALUES (
          ${userId}, ${name}, ${description || null}, ${systemPrompt}, ${firstMessage || "Hello! How can I help you today?"}, 
          ${language || "en"}, ${llmModel || "openai/gpt-4o-mini"}, ${temperature || 0.7}, ${maxTokens || 500}, 
          ${ttsVoice || "aura-asteria-en"}, ${ttsProvider || "deepgram"}, ${sttProvider || "deepgram"}, 
          ${sttModel || (sttProvider === "sarvam" ? "saaras:v3" : null)}, ${ttsModel || (ttsProvider === "sarvam" ? "bulbul:v3" : null)},
          ${interruptible ?? true}, ${silenceTimeoutMs || 5e3}, ${maxDurationSeconds || 600}, 
          ${endCallOnSilence ?? false}, ${JSON.stringify(businessRules || [])}, ${formatPgArray(knowledgeBaseIds)}, 
          ${formatPgArray(enabledTools)}, ${enableMemory ?? true}, ${memoryRetentionDays || 90}, 
          ${detectLanguageEnabled ?? false}, ${appointmentBookingEnabled ?? false}, ${endConversationEnabled ?? false}, 
          ${transferEnabled ?? false}, ${transferPhoneNumber || null}, ${messagingEmailEnabled ?? false}, 
          ${messagingWhatsappEnabled ?? false}, ${messagingEmailTemplate || null}, ${messagingWhatsappTemplate || null}
        )
        RETURNING *
      `);
      res.json({ success: true, data: result.rows[0] });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  router.put("/:id", async (req, res) => {
    try {
      const userId = req.userId;
      const { name, description, systemPrompt, firstMessage, language, llmModel, temperature, maxTokens, ttsVoice, ttsProvider, sttProvider, sttModel, ttsModel, interruptible, silenceTimeoutMs, maxDurationSeconds, endCallOnSilence, businessRules, knowledgeBaseIds, enableMemory, isActive, detectLanguageEnabled, appointmentBookingEnabled, endConversationEnabled, transferEnabled, transferPhoneNumber, messagingEmailEnabled, messagingWhatsappEnabled, messagingEmailTemplate, messagingWhatsappTemplate } = req.body;
      const effectiveSttModel = sttModel !== void 0 ? sttModel || (sttProvider === "sarvam" ? "saaras:v3" : sttModel) : void 0;
      const effectiveTtsModel = ttsModel !== void 0 ? ttsModel || (ttsProvider === "sarvam" ? "bulbul:v3" : ttsModel) : void 0;
      const result = await db.execute(sql`
        UPDATE ve_voice_agents SET
          name = COALESCE(${name}, name), description = COALESCE(${description}, description),
          system_prompt = COALESCE(${systemPrompt}, system_prompt), first_message = COALESCE(${firstMessage}, first_message),
          language = COALESCE(${language}, language), llm_model = COALESCE(${llmModel}, llm_model),
          temperature = COALESCE(${temperature}, temperature), max_tokens = COALESCE(${maxTokens}, max_tokens),
          tts_voice = COALESCE(${ttsVoice}, tts_voice), tts_provider = COALESCE(${ttsProvider}, tts_provider),
          stt_provider = COALESCE(${sttProvider}, stt_provider), stt_model = COALESCE(${effectiveSttModel}, stt_model),
          tts_model = COALESCE(${effectiveTtsModel}, tts_model), interruptible = ${interruptible === void 0 ? sql`interruptible` : interruptible},
          silence_timeout_ms = COALESCE(${silenceTimeoutMs}, silence_timeout_ms),
          max_duration_seconds = COALESCE(${maxDurationSeconds}, max_duration_seconds),
          end_call_on_silence = ${endCallOnSilence === void 0 ? sql`end_call_on_silence` : endCallOnSilence},
          business_rules = COALESCE(${businessRules ? JSON.stringify(businessRules) : null}, business_rules),
          knowledge_base_ids = ${knowledgeBaseIds === void 0 ? sql`knowledge_base_ids` : formatPgArray(knowledgeBaseIds)},
          enable_memory = ${enableMemory === void 0 ? sql`enable_memory` : enableMemory},
          detect_language_enabled = ${detectLanguageEnabled === void 0 ? sql`detect_language_enabled` : detectLanguageEnabled},
          appointment_booking_enabled = ${appointmentBookingEnabled === void 0 ? sql`appointment_booking_enabled` : appointmentBookingEnabled},
          end_conversation_enabled = ${endConversationEnabled === void 0 ? sql`end_conversation_enabled` : endConversationEnabled},
          transfer_enabled = ${transferEnabled === void 0 ? sql`transfer_enabled` : transferEnabled},
          transfer_phone_number = COALESCE(${transferPhoneNumber}, transfer_phone_number),
          messaging_email_enabled = ${messagingEmailEnabled === void 0 ? sql`messaging_email_enabled` : messagingEmailEnabled},
          messaging_whatsapp_enabled = ${messagingWhatsappEnabled === void 0 ? sql`messaging_whatsapp_enabled` : messagingWhatsappEnabled},
          messaging_email_template = COALESCE(${messagingEmailTemplate}, messaging_email_template),
          messaging_whatsapp_template = COALESCE(${messagingWhatsappTemplate}, messaging_whatsapp_template),
          is_active = ${isActive === void 0 ? sql`is_active` : isActive}, updated_at = NOW()
        WHERE id = ${req.params.id} AND user_id = ${userId} RETURNING *
      `);
      if (result.rows.length === 0) return res.status(404).json({ success: false, error: "Not found" });
      try {
        await db.execute(sql`
          UPDATE agents 
          SET name = COALESCE(${name}, name),
              language = COALESCE(${language}, language),
              system_prompt = COALESCE(${systemPrompt}, system_prompt),
              first_message = COALESCE(${firstMessage}, first_message),
              llm_model = COALESCE(${llmModel}, llm_model),
              temperature = COALESCE(${temperature}, temperature)
          WHERE id = ${req.params.id} AND user_id = ${userId}
        `);
      } catch (syncErr) {
        console.error("Failed to sync updated custom voice agent to agents table:", syncErr);
      }
      res.json({ success: true, data: result.rows[0] });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  router.delete("/:id", async (req, res) => {
    try {
      const userId = req.userId;
      await db.execute(sql`DELETE FROM ve_voice_agents WHERE id = ${req.params.id} AND user_id = ${userId}`);
      res.json({ success: true, message: "Agent deleted" });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  router.post("/preview", async (req, res) => {
    try {
      const { voiceId, text, provider, language, ttsModel } = req.body;
      if (!voiceId) {
        return res.status(400).json({ success: false, error: "voiceId is required" });
      }
      const previewText = text || "Hello! This is a preview of how I'll sound. I can adjust my tone and style based on your preferences.";
      const isSarvam = provider === "sarvam";
      const providerName = isSarvam ? "sarvam" : "deepgram";
      const keyName = isSarvam ? "ve_sarvam_api_key" : "ve_deepgram_api_key";
      const [setting] = await db.select().from(globalSettings).where(eq(globalSettings.key, keyName)).limit(1);
      const apiKey = setting?.value;
      if (!apiKey) {
        return res.status(400).json({ success: false, error: `API key for ${providerName} is not configured in settings.` });
      }
      const ttsProvider = TtsProviderFactory.create(providerName);
      const effectiveModel = isSarvam ? ttsModel || "bulbul:v3" : void 0;
      const config = isSarvam ? {
        apiKey,
        voice: voiceId,
        sarvamSpeaker: voiceId,
        sarvamModel: effectiveModel,
        language: language || "en-IN",
        outputFormat: {
          encoding: "linear16",
          sampleRate: 8e3
        },
        speed: 1
      } : {
        apiKey,
        voice: voiceId,
        language: language || "en",
        outputFormat: {
          encoding: "mp3",
          sampleRate: 24e3
        }
      };
      const audioBuffer = await ttsProvider.synthesize(previewText, config);
      res.setHeader("Content-Type", isSarvam ? "audio/wav" : "audio/mpeg");
      res.setHeader("Content-Length", audioBuffer.length);
      res.setHeader("Cache-Control", "no-cache");
      res.send(audioBuffer);
    } catch (err) {
      console.error("[CVE Voice Preview] Error:", err.message);
      const detail = err.response?.data ? JSON.stringify(err.response.data) : null;
      res.status(500).json({ success: false, error: err.message || "Failed to generate voice preview", detail });
    }
  });
  return router;
}
export {
  createAgentsRouter
};
