/**
 * ============================================================
 * Shared keep-alive HTTP(S) agents
 *
 * Provider HTTP calls (OpenRouter LLM, Deepgram/Sarvam TTS,
 * Sarvam STT) previously used a fresh connection per request,
 * paying a full TCP + TLS handshake on every turn (~100-300ms
 * of avoidable latency each). These shared agents keep sockets
 * warm and pooled so repeated calls to the same host reuse an
 * already-established TLS connection.
 * ============================================================
 */

import http from 'http';
import https from 'https';

export const httpKeepAliveAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30_000,
  maxSockets: 50,
  maxFreeSockets: 10,
});

export const httpsKeepAliveAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30_000,
  maxSockets: 50,
  maxFreeSockets: 10,
});

/**
 * Axios config fragment to attach the shared keep-alive agents.
 * Spread into an axios request config: `{ ...keepAliveAxiosConfig, ... }`.
 */
export const keepAliveAxiosConfig = {
  httpAgent: httpKeepAliveAgent,
  httpsAgent: httpsKeepAliveAgent,
} as const;
