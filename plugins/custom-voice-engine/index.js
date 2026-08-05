import { createAdminSettingsRouter } from "./routes/admin-settings.routes.js";
import { createAdminProviderKeysRouter } from "./routes/admin-provider-keys.routes.js";
import { createAdminStorageRouter } from "./routes/admin-storage.routes.js";
import { createTenantConfigRouter } from "./routes/tenant-config.routes.js";
import { createCallsRouter } from "./routes/calls.routes.js";
import { createRecordingsRouter } from "./routes/recordings.routes.js";
import { createMemoryRouter } from "./routes/memory.routes.js";
import { createAnalyticsRouter } from "./routes/analytics.routes.js";
import { createAgentsRouter } from "./routes/agents.routes.js";
import { AudioWebSocketServer } from "./services/audio-pipeline/ws-audio-server.js";
import { MetricsCollector } from "./services/monitoring/metrics-collector.js";
export * from "./types.js";
const PLUGIN_VERSION = "1.0.0";
const PLUGIN_NAME = "ai-voice-engine";
let audioWsServer = null;
let metricsCollector = null;
function registerAiVoiceEngineRoutes(app, options) {
  const { sessionAuthMiddleware, adminAuthMiddleware, httpServer } = options;
  app.use("/api/voice-engine/admin/settings", adminAuthMiddleware, createAdminSettingsRouter());
  app.use("/api/voice-engine/admin/freeswitch", adminAuthMiddleware, createAdminSettingsRouter());
  app.use("/api/voice-engine/admin/provider-keys", adminAuthMiddleware, createAdminProviderKeysRouter());
  app.use("/api/voice-engine/admin/storage", adminAuthMiddleware, createAdminStorageRouter());
  app.use("/api/voice-engine/config", sessionAuthMiddleware, createTenantConfigRouter());
  app.use("/api/voice-engine/calls", sessionAuthMiddleware, createCallsRouter());
  app.use("/api/voice-engine/recordings", sessionAuthMiddleware, createRecordingsRouter());
  app.use("/api/voice-engine/memory", sessionAuthMiddleware, createMemoryRouter());
  app.use("/api/voice-engine/analytics", sessionAuthMiddleware, createAnalyticsRouter());
  app.use("/api/voice-engine/agents", sessionAuthMiddleware, createAgentsRouter());
  if (httpServer) {
    try {
      if (audioWsServer) {
        audioWsServer.shutdown();
      }
      audioWsServer = new AudioWebSocketServer(httpServer);
      console.log("[AI Voice Engine]   - WebSocket audio server initialized");
    } catch (err) {
      console.warn("[AI Voice Engine] WebSocket server init failed:", err.message);
    }
  }
  try {
    metricsCollector = MetricsCollector.getInstance();
    console.log("[AI Voice Engine]   - Metrics collector initialized");
  } catch (err) {
    console.warn("[AI Voice Engine] Metrics collector init failed:", err.message);
  }
  (async () => {
    try {
      const os = await import("os");
      const getContainerIp = () => {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
          for (const net of interfaces[name] || []) {
            if (net.family === "IPv4" && !net.internal) {
              if (net.address.startsWith("10.") || net.address.startsWith("172.") || net.address.startsWith("192.168.")) {
                return net.address;
              }
            }
          }
        }
        return "127.0.0.1";
      };
      const containerIp = getContainerIp();
      if (containerIp === "127.0.0.1") return;
      if (process.env.DISABLE_FREESWITCH_ESL === "true" || process.env.DISABLE_FREESWITCH_ESL === "1") {
        console.log("[AI Voice Engine] FreeSWITCH ESL connection initialization disabled via DISABLE_FREESWITCH_ESL environment variable.");
        return;
      }
      const wsUrl = `ws://${containerIp}:${process.env.PORT || "5000"}/voice-engine/ws/audio`;
      if (audioWsServer) {
        await audioWsServer.initializeEslConnections(wsUrl);
      }
    } catch (err) {
      console.warn(`[AI Voice Engine] Failed to configure FreeSWITCH nodes and ESL connections on startup:`, err.message);
    }
  })();
  console.log("[AI Voice Engine] Plugin registered (v1.0.0)");
  console.log("[AI Voice Engine] Endpoints:");
  console.log("  - /api/voice-engine/admin/settings (admin auth)");
  console.log("  - /api/voice-engine/admin/freeswitch (admin auth)");
  console.log("  - /api/voice-engine/admin/provider-keys (admin auth)");
  console.log("  - /api/voice-engine/config (user auth)");
  console.log("  - /api/voice-engine/calls (user auth)");
  console.log("  - /api/voice-engine/recordings (user auth)");
  console.log("  - /api/voice-engine/memory (user auth)");
  console.log("  - /api/voice-engine/analytics (user auth)");
  console.log("  - /api/voice-engine/agents (user auth)");
  console.log("[AI Voice Engine] Providers:");
  console.log("  - STT: Deepgram, Sarvam");
  console.log("  - LLM: OpenRouter (GPT-4o-mini, Gemini Flash)");
  console.log("  - TTS: Deepgram Nova-2, Sarvam");
  console.log("\u2705 AI Voice Engine Plugin initialized");
}
function getAudioWsServer() {
  return audioWsServer;
}
function getMetricsCollector() {
  return metricsCollector;
}
var index_default = {
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  register: registerAiVoiceEngineRoutes
};
export {
  PLUGIN_NAME,
  PLUGIN_VERSION,
  index_default as default,
  getAudioWsServer,
  getMetricsCollector,
  registerAiVoiceEngineRoutes
};
