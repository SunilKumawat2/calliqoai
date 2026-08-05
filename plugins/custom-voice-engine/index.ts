/**
 * ============================================================
 * AI Voice Engine Plugin — Main Entry Point
 *
 * Self-hosted AI voice processing engine powered by FreeSWITCH.
 * Provides real-time voice streaming with pluggable STT/LLM/TTS
 * providers and customer memory system.
 *
 * Architecture:
 *   SIP Provider → FreeSWITCH → mod_audio_fork → WebSocket →
 *   AI Gateway → STT → Conversation Engine → LLM → TTS →
 *   FreeSWITCH → Caller
 *
 * Installation:
 * 1. Place in plugins/ai-voice-engine/
 * 2. Run database migration (migrations/001_voice_engine_tables.sql)
 * 3. Configure provider API keys in admin panel
 * 4. Deploy FreeSWITCH with mod_audio_fork
 * ============================================================
 */

import { Router, type Express, type RequestHandler } from 'express';
import type { Server as HttpServer } from 'http';

// Route imports
import { createAdminSettingsRouter } from './routes/admin-settings.routes';
import { createAdminProviderKeysRouter } from './routes/admin-provider-keys.routes';
import { createAdminStorageRouter } from './routes/admin-storage.routes';
import { createTenantConfigRouter } from './routes/tenant-config.routes';
import { createCallsRouter } from './routes/calls.routes';
import { createRecordingsRouter } from './routes/recordings.routes';
import { createMemoryRouter } from './routes/memory.routes';
import { createAnalyticsRouter } from './routes/analytics.routes';
import { createAgentsRouter } from './routes/agents.routes';

// Service imports
import { AudioWebSocketServer } from './services/audio-pipeline/ws-audio-server';
import { MetricsCollector } from './services/monitoring/metrics-collector';

export * from './types';

export const PLUGIN_VERSION = '1.0.0';
export const PLUGIN_NAME = 'ai-voice-engine';

interface PluginLoaderOptions {
  sessionAuthMiddleware: RequestHandler;
  adminAuthMiddleware: RequestHandler;
  httpServer?: HttpServer;
}

// Singleton references for cleanup
let audioWsServer: AudioWebSocketServer | null = null;
let metricsCollector: MetricsCollector | null = null;

/**
 * Main plugin registration function — called by the plugin loader.
 * Mounts all API routes and initializes the audio WebSocket server.
 */
export function registerAiVoiceEngineRoutes(
  app: Express,
  options: PluginLoaderOptions
): void {
  const { sessionAuthMiddleware, adminAuthMiddleware, httpServer } = options;

  // ── Admin Routes (require admin auth) ────────────────────
  app.use('/api/voice-engine/admin/settings', adminAuthMiddleware, createAdminSettingsRouter());
  app.use('/api/voice-engine/admin/freeswitch', adminAuthMiddleware, createAdminSettingsRouter());
  app.use('/api/voice-engine/admin/provider-keys', adminAuthMiddleware, createAdminProviderKeysRouter());
  app.use('/api/voice-engine/admin/storage', adminAuthMiddleware, createAdminStorageRouter());

  // ── User Routes (require session auth) ───────────────────
  app.use('/api/voice-engine/config', sessionAuthMiddleware, createTenantConfigRouter());
  app.use('/api/voice-engine/calls', sessionAuthMiddleware, createCallsRouter());
  app.use('/api/voice-engine/recordings', sessionAuthMiddleware, createRecordingsRouter());
  app.use('/api/voice-engine/memory', sessionAuthMiddleware, createMemoryRouter());
  app.use('/api/voice-engine/analytics', sessionAuthMiddleware, createAnalyticsRouter());
  app.use('/api/voice-engine/agents', sessionAuthMiddleware, createAgentsRouter());

  // ── Initialize Audio WebSocket Server ────────────────────
  if (httpServer) {
    try {
      if (audioWsServer) {
        audioWsServer.shutdown();
      }
      audioWsServer = new AudioWebSocketServer(httpServer);
      console.log('[AI Voice Engine]   - WebSocket audio server initialized');
    } catch (err: any) {
      console.warn('[AI Voice Engine] WebSocket server init failed:', err.message);
    }
  }

  // ── Initialize Metrics Collector ─────────────────────────
  try {
    metricsCollector = MetricsCollector.getInstance();
    console.log('[AI Voice Engine]   - Metrics collector initialized');
  } catch (err: any) {
    console.warn('[AI Voice Engine] Metrics collector init failed:', err.message);
  }

  // ── Set Dynamic WebSocket IP and initialize persistent ESL connections ──
  (async () => {
    try {
      const os = await import('os');

      const getContainerIp = () => {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
          for (const net of interfaces[name] || []) {
            if (net.family === 'IPv4' && !net.internal) {
              if (net.address.startsWith('10.') || net.address.startsWith('172.') || net.address.startsWith('192.168.')) {
                return net.address;
              }
            }
          }
        }
        return '127.0.0.1';
      };

      const containerIp = getContainerIp();
      if (containerIp === '127.0.0.1') return;

      if (process.env.DISABLE_FREESWITCH_ESL === 'true' || process.env.DISABLE_FREESWITCH_ESL === '1') {
        console.log('[AI Voice Engine] FreeSWITCH ESL connection initialization disabled via DISABLE_FREESWITCH_ESL environment variable.');
        return;
      }

      const wsUrl = `ws://${containerIp}:${process.env.PORT || '5000'}/voice-engine/ws/audio`;

      if (audioWsServer) {
        await audioWsServer.initializeEslConnections(wsUrl);
      }
    } catch (err: any) {
      console.warn(`[AI Voice Engine] Failed to configure FreeSWITCH nodes and ESL connections on startup:`, err.message);
    }
  })();

  // ── Log registration ────────────────────────────────────
  console.log('[AI Voice Engine] Plugin registered (v1.0.0)');
  console.log('[AI Voice Engine] Endpoints:');
  console.log('  - /api/voice-engine/admin/settings (admin auth)');
  console.log('  - /api/voice-engine/admin/freeswitch (admin auth)');
  console.log('  - /api/voice-engine/admin/provider-keys (admin auth)');
  console.log('  - /api/voice-engine/config (user auth)');
  console.log('  - /api/voice-engine/calls (user auth)');
  console.log('  - /api/voice-engine/recordings (user auth)');
  console.log('  - /api/voice-engine/memory (user auth)');
  console.log('  - /api/voice-engine/analytics (user auth)');
  console.log('  - /api/voice-engine/agents (user auth)');
  console.log('[AI Voice Engine] Providers:');
  console.log('  - STT: Deepgram, Sarvam');
  console.log('  - LLM: OpenRouter (GPT-4o-mini, Gemini Flash)');
  console.log('  - TTS: Deepgram Nova-2, Sarvam');
  console.log('✅ AI Voice Engine Plugin initialized');
}

/**
 * Get the audio WebSocket server instance
 */
export function getAudioWsServer(): AudioWebSocketServer | null {
  return audioWsServer;
}

/**
 * Get the metrics collector instance
 */
export function getMetricsCollector(): MetricsCollector | null {
  return metricsCollector;
}

export default {
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  register: registerAiVoiceEngineRoutes,
};
