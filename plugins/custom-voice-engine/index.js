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
      if (process.env.DISABLE_FREESWITCH_ESL === "true" || process.env.DISABLE_FREESWITCH_ESL === "1") {
        console.log("[AI Voice Engine] FreeSWITCH ESL connection initialization disabled via DISABLE_FREESWITCH_ESL environment variable.");
        return;
      }
      const os = await import("os");
      const getServerIp = () => {
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
        return process.env.FREESWITCH_WS_HOST || "127.0.0.1";
      };
      const serverIp = getServerIp();
      const wsUrl = `ws://${serverIp}:${process.env.PORT || "5000"}/voice-engine/ws/audio`;
      console.log(`[AI Voice Engine] Audio WebSocket URL: ${wsUrl}`);
      try {
        const { db } = await import("../../server/db.js");
        const { sql } = await import("drizzle-orm");
        const eslHost = process.env.FREESWITCH_ESL_HOST || "127.0.0.1";
        const eslPort = parseInt(process.env.FREESWITCH_ESL_PORT || "8021", 10);
        const eslPassword = process.env.FREESWITCH_ESL_PASSWORD || "ClueCon";
        const sipHost = process.env.FREESWITCH_SIP_HOST || eslHost;
        const sipPort = parseInt(process.env.FREESWITCH_SIP_PORT || "5060", 10);
        const existingNodes = await db.execute(
          sql`SELECT id FROM ve_freeswitch_nodes LIMIT 1`
        );
        if (existingNodes.rows.length === 0) {
          console.log("[AI Voice Engine] No FreeSWITCH nodes found \u2014 auto-registering local node...");
          await db.execute(sql`
            INSERT INTO ve_freeswitch_nodes
              (name, esl_host, esl_port, esl_password, sip_host, sip_port, ws_port, max_calls, status)
            VALUES
              ('local', ${eslHost}, ${eslPort}, ${eslPassword}, ${sipHost}, ${sipPort}, 8089, 100, 'online')
            ON CONFLICT DO NOTHING
          `);
          console.log(`[AI Voice Engine] \u2705 Local FreeSWITCH node registered (ESL: ${eslHost}:${eslPort})`);
        } else {
          console.log("[AI Voice Engine] FreeSWITCH node(s) already exist in DB, skipping auto-register.");
        }
      } catch (dbErr) {
        console.warn("[AI Voice Engine] Could not auto-register local FreeSWITCH node:", dbErr.message);
      }
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
