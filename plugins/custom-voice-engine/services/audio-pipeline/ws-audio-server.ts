/**
 * ============================================================
 * WebSocket Audio Server
 *
 * Receives audio streams from FreeSWITCH mod_audio_fork and
 * routes them to the appropriate AudioSession pipeline.
 *
 * mod_audio_fork sends raw PCM audio over WebSocket.
 * This server also sends synthesized TTS audio back.
 *
 * WebSocket URL formats:
 *   ws://host:port/voice-engine/audio/{sessionId}
 *   ws://host:port/api/voice-engine/ws/audio/{sessionId}
 * ============================================================
 */

import { WebSocketServer, WebSocket } from 'ws';
import * as net from 'net';
import fs from 'fs';
import type { Server as HttpServer, IncomingMessage } from 'http';
import { AudioSession } from './audio-session.js';
import { db } from '../../../../server/db.js';
import { sql } from 'drizzle-orm';
import { EslConnection } from '../freeswitch/esl-connection.js';
import type { VoiceSession, VoiceAgentConfig, SttConfig, LlmConfig, TtsConfig, LlmToolDefinition } from '../../types';

// Helper to convert snake_case DB fields to camelCase TS properties
function camelizeKeys(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(v => camelizeKeys(v));
  } else if (obj !== null && obj.constructor === Object) {
    return Object.keys(obj).reduce((result, key) => {
      const camelKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
      result[camelKey] = camelizeKeys(obj[key]);
      return result;
    }, {} as any);
  }
  return obj;
}

export class AudioWebSocketServer {
  private wss: WebSocketServer;
  private sessions: Map<string, AudioSession> = new Map();
  private eslConnections: EslConnection[] = [];
  /** Tracks FreeSWITCH outbound TCP sockets (port 8024) keyed by channel UUID.
   *  The call stays alive only while this socket stays open, so we hold it
   *  until CHANNEL_DESTROY fires for that UUID. */
  private outboundSockets: Map<string, net.Socket> = new Map();

  constructor(httpServer: HttpServer) {
    this.wss = new WebSocketServer({
      noServer: true,
      perMessageDeflate: false, // Disable compression for low-latency audio
      maxPayload: 64 * 1024, // 64KB max per message
    });

    // ---------------------------------------------------------------------------
    // TCP Outbound Socket Server (port 8024)
    //
    // FreeSWITCH calls are originated with `&socket(127.0.0.1:8024)` as the
    // dialplan destination. FreeSWITCH connects here and keeps the call alive
    // FOR AS LONG AS THIS TCP CONNECTION STAYS OPEN. An empty or idle socket
    // is closed by the OS, causing a "Socket Error!" in FreeSWITCH which
    // triggers an immediate NORMAL_CLEARING hangup (~18s later).
    //
    // Fix: set keepAlive + zero timeout, parse the outbound socket greeting
    // to extract the channel UUID, then hold the socket open until
    // CHANNEL_DESTROY fires.
    // ---------------------------------------------------------------------------
    try {
      const tcpServer = net.createServer((socket) => {
        console.log('[TCP Outbound] FreeSWITCH socket connection accepted');

        // Prevent Node from closing idle sockets and prevent OS-level idle close.
        socket.setKeepAlive(true, 5000);
        socket.setTimeout(0);  // disable idle timeout
        socket.ref();          // keep Node event loop alive while socket is open

        let uuid: string | null = null;
        let buffer = '';

        // Unblock FreeSWITCH immediately by initiating the outbound socket handshake
        socket.write('connect\n\n');

        socket.on('data', (data) => {
          buffer += data.toString();
          // FreeSWITCH sends the outbound socket greeting which contains the
          // channel headers including Unique-ID. Parse it once on first data.
          if (!uuid) {
            const match = buffer.match(/(?:Unique-ID|Channel-Unique-ID|Channel-Call-UUID):\s*([^\r\n]+)/i);
            if (match) {
              uuid = match[1].trim();
              this.outboundSockets.set(uuid, socket);
              console.log(`[TCP Outbound] Socket mapped to UUID: ${uuid}`);
            } else {
              console.log(`[TCP Outbound] Greeting chunk received:\n${buffer}`);
            }
          }
        });

        socket.on('error', (err) => {
          console.log('[TCP Outbound] Socket error:', err.message);
          if (uuid) this.outboundSockets.delete(uuid);
        });

        socket.on('close', () => {
          console.log(`[TCP Outbound] Socket closed${uuid ? ` (uuid=${uuid})` : ''}`);
          if (uuid) this.outboundSockets.delete(uuid);
        });
      });

      tcpServer.on('error', (err) => {
        console.error('[TCP Outbound] Failed to start TCP helper server:', err.message);
      });

      tcpServer.listen(8024, '0.0.0.0', () => {
        console.log('[TCP Outbound] TCP helper socket server listening on port 8024');
      });
    } catch (err: any) {
      console.error('[TCP Outbound] Failed to start TCP helper server:', err.message);
    }

    // Handle WebSocket upgrade manually to support dynamic session IDs in the URL path
    httpServer.on('upgrade', (req, socket, head) => {
      const pathname = req.url?.split('?')[0] || '';
      
      // Do not intercept Vite HMR WebSockets
      if (req.headers['sec-websocket-protocol'] === 'vite-hmr') {
        return;
      }

      console.log(`[Upgrade] Request for: ${pathname}`);
      if (
        pathname.startsWith('/voice-engine/audio/') ||
        pathname.startsWith('/api/voice-engine/ws/audio/') ||
        pathname.startsWith('/voice-engine/ws/audio/') ||
        pathname === '/'
      ) {
        console.log(`[Upgrade] Passing through: ${pathname}`);
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          this.wss.emit('connection', ws, req);
        });
      }
    });

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      this.handleConnection(ws, req);
    });

    this.wss.on('error', (err) => {
      console.error('[AudioWS] Server error:', err);
    });

    console.log('[AudioWS] WebSocket audio server started');
  }

  /**
   * Register an AudioSession to receive audio
   */
  registerSession(session: AudioSession): void {
    this.sessions.set(session.id, session);
    console.log(`[AudioWS] Session registered: ${session.id}`);
  }

  /**
   * Unregister an AudioSession
   */
  unregisterSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    console.log(`[AudioWS] Session unregistered: ${sessionId}`);
  }

  /**
   * Get active session count
   */
  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Initialize persistent FreeSWITCH ESL connections for event monitoring and commands
   */
  async initializeEslConnections(wsUrl: string): Promise<void> {
    // Clean up any existing persistent ESL connections
    await this.closeEslConnections();

    try {
      // Find all online FreeSWITCH nodes
      const nodesResult = await db.execute(sql`
        SELECT * FROM ve_freeswitch_nodes WHERE status = 'online'
      `);

      for (const node of camelizeKeys(nodesResult.rows) as any[]) {
        const eslHost = node.eslHost;
        const eslPort = node.eslPort;
        const eslPassword = node.eslPassword || 'ClueCon';

        try {
          const esl = new EslConnection({
            host: eslHost,
            port: eslPort,
            password: eslPassword,
            reconnect: true,
          });

          esl.on('error', (err) => {
            console.error(`[AudioWS] ESL Connection error for node ${node.name || eslHost}:`, err.message);
          });

          // Handle custom events (specifically mod_audio_fork::play_audio)
          esl.on('event:CUSTOM', async (evt) => {
            const eventSubclass = evt.eventSubclass || evt.headers['Event-Subclass'];
            if (eventSubclass === 'mod_audio_fork::play_audio') {
              try {
                const bodyStr = evt.body;
                if (!bodyStr) return;
                const payload = JSON.parse(bodyStr);
                const file = payload.file;
                const channelUuid = evt.headers['Unique-ID'];
                if (file && channelUuid) {
                  await esl.api(`uuid_broadcast ${channelUuid} ${file}`);
                }
              } catch (err: any) {
                console.error(`[AudioWS] Error handling play_audio event:`, err.message);
              }
            }
          });

          // Handle channel answer event to start recording and play welcoming TTS greeting
          esl.on('event:CHANNEL_ANSWER', async (evt) => {
            try {
              const channelUuid = evt.headers['Unique-ID'] || evt.headers['Channel-Call-UUID'];
              if (channelUuid) {
                const session = this.sessions.get(channelUuid);
                if (session) {
                  console.log(`[AudioWS] CHANNEL_ANSWER event received for session ${channelUuid}. Calling markCallAnswered.`);
                  await session.markCallAnswered();
                }
              }
            } catch (err: any) {
              console.error(`[AudioWS] Error handling CHANNEL_ANSWER event:`, err.message);
            }
          });

          // Handle channel hangup to properly end the session
          esl.on('event:CHANNEL_HANGUP', async (evt) => {
            try {
              const channelUuid = evt.headers['Unique-ID'] || evt.headers['Channel-Call-UUID'];
              if (!channelUuid) return;

              const hangupCause = evt.headers['Hangup-Cause'] || '';
              console.log(`[AudioWS] CHANNEL_HANGUP event received: uuid=${channelUuid}, cause=${hangupCause}, duration=${evt.headers['variable_duration']}, billsec=${evt.headers['variable_billsec']}`);
              const unansweredCauses = [
                'NO_ANSWER', 'USER_BUSY', 'NO_ROUTE_DESTINATION', 'CALL_REJECTED',
                'NUMBER_CHANGED', 'SUBSCRIBER_ABSENT', 'UNALLOCATED_NUMBER',
                'NORMAL_UNSPECIFIED', 'RECOVERY_ON_TIMER_EXPIRE',
              ];
              const isUnanswered = unansweredCauses.includes(hangupCause);

              const session = this.sessions.get(channelUuid);
              if (session) {
                if (isUnanswered) {
                  // Call was never answered — mark directly in DB without running the
                  // full session teardown (which would save a 0-byte recording, etc.)
                  console.log(`[AudioWS] CHANNEL_HANGUP (${hangupCause}) — call never answered for ${channelUuid}. Marking as failed.`);
                  try {
                    await db.execute(sql`
                      UPDATE ve_sessions
                      SET status = 'failed',
                          end_reason = ${hangupCause.toLowerCase()},
                          ended_at = NOW(),
                          updated_at = NOW()
                      WHERE id = ${channelUuid}
                    `);
                    await db.execute(sql`
                      UPDATE calls
                      SET status = 'failed',
                          ended_at = NOW()
                      WHERE id = ${channelUuid} OR (metadata->>'sessionUuid' = ${channelUuid})
                    `);
                  } catch (dbErr: any) {
                    console.error(`[AudioWS] Failed to update unanswered session status:`, dbErr.message);
                  }
                  // Destroy the session object without saving recording/transcript
                  (session as any).destroyed = true;
                  session.removeAllListeners();
                  this.unregisterSession(channelUuid);
                } else {
                  console.log(`[AudioWS] CHANNEL_HANGUP (${hangupCause}) for session ${channelUuid}. Ending session.`);
                  await session.end('hangup');
                  this.unregisterSession(channelUuid);
                }
              } else {
                // Session not in memory (e.g. call never connected to audio WS, or already completed/transferred)
                if (isUnanswered) {
                  console.log(`[AudioWS] CHANNEL_HANGUP (${hangupCause}) — no session in memory for ${channelUuid}, updating DB status.`);
                  try {
                    await db.execute(sql`
                      UPDATE ve_sessions
                      SET status = 'failed',
                          end_reason = ${hangupCause.toLowerCase()},
                          ended_at = NOW(),
                          updated_at = NOW()
                      WHERE id = ${channelUuid} AND status IN ('initializing', 'active')
                    `);
                    await db.execute(sql`
                      UPDATE calls
                      SET status = 'failed',
                          ended_at = NOW()
                      WHERE (id = ${channelUuid} OR (metadata->>'sessionUuid' = ${channelUuid})) AND status IN ('pending', 'initiated', 'in-progress')
                    `);
                  } catch (dbErr: any) {
                    console.error(`[AudioWS] Failed to update orphaned session status:`, dbErr.message);
                  }
                } else {
                  // Call answered and now hung up (no session in memory = already transferred/completed).
                  // FreeSWITCH plain event subscriptions do NOT include variable_duration/variable_billsec
                  // in CHANNEL_HANGUP headers. Instead, use the DB started_at to compute real total duration.
                  try {
                    const sessionResult = await db.execute(sql`
                      SELECT * FROM ve_sessions WHERE id = ${channelUuid} LIMIT 1
                    `);
                    const sessionData = sessionResult.rows?.[0] as any;
                    // Only process if this was a transferred call (end_reason='transferred')
                    if (sessionData && sessionData.status === 'completed' && sessionData.end_reason === 'transferred') {
                      const oldDuration = sessionData.duration_seconds || 0;
                      // Compute wall-clock total duration from when the call started
                      const startedAt = sessionData.started_at ? new Date(sessionData.started_at).getTime() : null;
                      const totalDuration = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0;

                      console.log(`[AudioWS] final CHANNEL_HANGUP for transferred session ${channelUuid}. oldDuration=${oldDuration}s, wallClock=${totalDuration}s`);

                      if (totalDuration > oldDuration) {
                        const oldMinutes = Math.ceil(oldDuration / 60);
                        const newMinutes = Math.ceil(totalDuration / 60);
                        const additionalMinutes = newMinutes - oldMinutes;

                        let newCreditsUsed = sessionData.credits_used || 0;

                        if (additionalMinutes > 0) {
                          const creditPriceResult = await db.execute(sql`
                            SELECT value FROM global_settings WHERE key = 'credit_price_per_minute' LIMIT 1
                          `);
                          const creditPriceSetting = creditPriceResult.rows?.[0] as { value: string } | undefined;
                          let creditPricePerMinute = 1;
                          if (creditPriceSetting?.value) {
                            const parsed = Number(creditPriceSetting.value);
                            if (Number.isFinite(parsed) && parsed >= 0) {
                              creditPricePerMinute = parsed;
                            }
                          }

                          const creditsToDeduct = additionalMinutes * creditPricePerMinute;
                          const deductCallCredits = (global as any).deductCallCredits;
                          if (deductCallCredits) {
                            const creditResult = await deductCallCredits({
                              userId: sessionData.user_id,
                              creditsToDeduct,
                              callId: `${channelUuid}-adjustment`,
                              fromNumber: sessionData.from_number || 'Unknown',
                              toNumber: sessionData.to_number || 'Unknown',
                              durationSeconds: totalDuration - oldDuration,
                              engine: 'custom-voice-engine',
                            });

                            if (creditResult.success || creditResult.alreadyDeducted) {
                              newCreditsUsed += creditsToDeduct;
                              console.log(`[AudioWS] Charged additional ${creditsToDeduct} credits for transferred session ${channelUuid}. Total duration: ${totalDuration}s, old: ${oldDuration}s`);
                            }
                          }
                        }

                        // Update database record with final duration and credits
                        await db.execute(sql`
                          UPDATE ve_sessions
                          SET duration_seconds = ${totalDuration},
                              credits_used = ${newCreditsUsed},
                              updated_at = NOW()
                          WHERE id = ${channelUuid}
                        `);
                        await db.execute(sql`
                          UPDATE calls
                          SET duration = ${totalDuration}
                          WHERE id = ${channelUuid} OR (metadata->>'sessionUuid' = ${channelUuid})
                        `);
                      }
                    }
                  } catch (err: any) {
                    console.error(`[AudioWS] Failed to process final hangup billing for ${channelUuid}:`, err.message);
                  }
                }
              }
            } catch (err: any) {
              console.error(`[AudioWS] Error handling CHANNEL_HANGUP event:`, err.message);
            }
          });

          // When a channel is fully destroyed, close the outbound TCP socket that
          // was keeping the call alive. This prevents socket leaks on the server.
          esl.on('event:CHANNEL_DESTROY', async (evt) => {
            try {
              const channelUuid = evt.headers['Unique-ID'] || evt.headers['Channel-Call-UUID'];
              if (!channelUuid) return;
              const sock = this.outboundSockets.get(channelUuid);
              if (sock) {
                console.log(`[TCP Outbound] CHANNEL_DESTROY for ${channelUuid} — closing outbound socket.`);
                sock.destroy();
                this.outboundSockets.delete(channelUuid);
              }
            } catch (err: any) {
              console.error('[AudioWS] Error handling CHANNEL_DESTROY (outbound socket close):', err.message);
            }
          });

          // Log ESL connection state changes for debugging
          esl.on('esl:ready', () => {
            console.log(`[AudioWS] ESL connection ready for node ${node.name || eslHost}`);
          });
          esl.on('esl:end', () => {
            console.log(`[AudioWS] ESL connection ended for node ${node.name || eslHost}, will auto-reconnect`);
          });

          await esl.connect();
          await esl.api(`global_setvar ve_audio_ws_url ${wsUrl}`);
          this.eslConnections.push(esl);
          console.log(`[AudioWS] Established persistent ESL connection to FreeSWITCH node ${node.name || eslHost}`);
        } catch (nodeErr: any) {
          console.warn(`[AudioWS] Failed to connect to FreeSWITCH node ${node.name || eslHost}:`, nodeErr.message);
        }
      }
    } catch (err: any) {
      console.warn(`[AudioWS] Failed to query FreeSWITCH nodes on initialization:`, err.message);
    }
  }

  /**
   * Close all persistent ESL connections
   */
  async closeEslConnections(): Promise<void> {
    for (const esl of this.eslConnections) {
      try {
        await esl.disconnect();
      } catch { }
    }
    this.eslConnections = [];
  }

  /**
   * Shutdown the WebSocket server
   */
  shutdown(): void {
    for (const client of this.wss.clients) {
      client.close(1001, 'Server shutting down');
    }
    this.wss.close();
    this.sessions.clear();
    this.closeEslConnections().catch(() => { });
    console.log('[AudioWS] Server shut down');
  }

  // ── Private ────────────────────────────────────────────

  private async handleConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
    try {
      // Extract session ID from URL path
      const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
      const pathParts = url.pathname.split('/');
      let sessionId = pathParts[pathParts.length - 1];

      if (!sessionId || sessionId === '') {
        console.log('[AudioWS] Inbound connection on root path. Waiting for metadata/session ID in first text frame...');

        const initHandler = async (data: WebSocket.Data, isBinary: boolean) => {
          if (!isBinary) {
            try {
              const msgStr = data.toString().trim();
              console.log(`[AudioWS] Received initial metadata: "${msgStr}"`);

              // Remove this listener
              ws.removeListener('message', initHandler);

              // The metadata is the sessionId (which might be raw or inside a JSON envelope)
              let targetSessionId = msgStr;
              if (msgStr.startsWith('{')) {
                try {
                  const parsed = JSON.parse(msgStr);
                  targetSessionId = parsed.metadata || parsed.uuid || parsed.sessionId || msgStr;
                } catch (_) { }
              }

              // Now proceed with normal connection setup!
              await this.setupSessionConnection(ws, req, targetSessionId);
            } catch (err: any) {
              console.error('[AudioWS] Failed to parse initial metadata:', err.message);
              ws.close(4000, 'Invalid metadata');
            }
          }
        };
        ws.on('message', initHandler);

        // Timeout if no metadata received in 5 seconds
        setTimeout(() => {
          if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
            const listeners = ws.listeners('message');
            if (listeners.includes(initHandler)) {
              console.warn('[AudioWS] Timeout waiting for metadata on root path connection');
              ws.removeListener('message', initHandler);
              ws.close(4002, 'Metadata timeout');
            }
          }
        }, 5000);
        return;
      }

      await this.setupSessionConnection(ws, req, sessionId);
    } catch (err: any) {
      console.error(`[AudioWS] Error handling connection for ${req.url}:`, err.message);
      ws.close(1011, 'Internal Server Error');
    }
  }

  private async setupSessionConnection(ws: WebSocket, req: IncomingMessage, sessionId: string): Promise<void> {
    // Immediately buffer incoming messages to prevent socket pause and loss of initial frames/metadata
    const messageBuffer: { data: WebSocket.Data; isBinary: boolean }[] = [];
    const tempListener = (data: WebSocket.Data, isBinary: boolean) => {
      messageBuffer.push({ data, isBinary });
    };
    ws.on('message', tempListener);

    try {
      console.log(`[AudioWS] Incoming connection for sessionId: ${sessionId}`);

      let session = this.sessions.get(sessionId);

      if (!session) {
        console.log(`[AudioWS] Session not found in cache. Querying DB/FreeSWITCH for ${sessionId}...`);
        session = await this.resolveSessionDynamically(sessionId);
      }

      // Remove the temporary buffer listener
      ws.removeListener('message', tempListener);

      if (!session) {
        console.warn(`[AudioWS] No session found/resolved: ${sessionId}`);
        ws.close(4001, 'Session not found');
        return;
      }

      console.log(`[AudioWS] Client connected for session: ${sessionId}`);

      // Close the previous WebSocket if it exists to avoid leak
      if ((session as any)._activeWs && (session as any)._activeWs !== ws) {
        console.log(`[AudioWS:${sessionId}] Closing old/stale WebSocket connection`);
        try {
          (session as any)._activeWs.close(1000, 'Replaced by new WebSocket');
        } catch (err: any) {
          console.warn(`[AudioWS:${sessionId}] Error closing old WebSocket:`, err.message);
        }
      }
      (session as any)._activeWs = ws;

      // Set up audio output: save file to disk and play via ESL!
      let audioPlayCount = 0;
      session.onAudioOut(async (audio: Buffer) => {
        try {
          audioPlayCount++;
          // Create WAV file
          const samplesCount = audio.length / 2;
          const wavHeader = Buffer.alloc(44);
          const sampleRate = 8000;
          const numChannels = 1;
          const bitsPerSample = 16;
          const blockAlign = numChannels * (bitsPerSample / 8);
          const byteRate = sampleRate * blockAlign;
          const dataSize = samplesCount * blockAlign;

          wavHeader.write('RIFF', 0);
          wavHeader.writeUInt32LE(36 + dataSize, 4);
          wavHeader.write('WAVE', 8);
          wavHeader.write('fmt ', 12);
          wavHeader.writeUInt32LE(16, 16);
          wavHeader.writeUInt16LE(1, 20); // PCM
          wavHeader.writeUInt16LE(numChannels, 22);
          wavHeader.writeUInt32LE(sampleRate, 24);
          wavHeader.writeUInt32LE(byteRate, 28);
          wavHeader.writeUInt16LE(blockAlign, 32);
          wavHeader.writeUInt16LE(bitsPerSample, 34);
          wavHeader.write('data', 36);
          wavHeader.writeUInt32LE(dataSize, 40);

          const wavBuffer = Buffer.concat([wavHeader, audio]);
          const tempDir = process.platform === 'win32' 
            ? 'C:\\tmp' 
            : '/home/calliqoai/htdocs/calliqoai.com/client/public/uploads/recordings';
          if (!fs.existsSync(tempDir)) {
            try {
              fs.mkdirSync(tempDir, { recursive: true });
            } catch (err: any) {
              console.warn(`[AudioWS] Failed to create temp directory ${tempDir}:`, err.message);
            }
          }
          const filePath = `${tempDir}/${sessionId}_tts_${Date.now()}_${audioPlayCount}.wav`;

          // Async write — a synchronous writeFileSync here blocks the Node event
          // loop for the duration of the disk I/O, stalling every other active
          // call's audio processing. Writing asynchronously keeps the loop free.
          await fs.promises.writeFile(filePath, wavBuffer);
          try {
            await fs.promises.chmod(filePath, 0o644); // Make world-readable for FreeSWITCH
          } catch (chmodErr: any) {
            console.warn(`[AudioWS] Failed to chmod ${filePath}:`, chmodErr.message);
          }
          console.log(`[AudioWS] Wrote TTS audio to ${filePath} (${wavBuffer.length} bytes), playing via ESL uuid_broadcast...`);

          // Always use ESL uuid_broadcast for parked channels.
          // sendmsg via TCP outbound socket does NOT work once the channel is parked
          // (uuid_park puts the channel in CS_HIBERNATE, losing outbound socket control).
          const targetUuid = session!.channelUuid || sessionId;
          let broadcastSent = false;
          for (const esl of this.eslConnections) {
            try {
              if (esl.isConnected()) {
                console.log(`[AudioWS] Sending ESL uuid_broadcast for UUID ${targetUuid} (${filePath})...`);
                const response = await esl.api(`uuid_broadcast ${targetUuid} ${filePath} aleg`);
                console.log(`[AudioWS] FreeSWITCH uuid_broadcast response: ${response.trim()}`);
                broadcastSent = true;
                break; // Only need one successful broadcast
              }
            } catch (err: any) {
              console.error(`[AudioWS] Failed to send uuid_broadcast:`, err.message);
            }
          }
          if (!broadcastSent) {
            console.error(`[AudioWS] No connected ESL connection available to play audio for session ${sessionId}`);
          }
        } catch (err: any) {
          console.error(`[AudioWS] Error in onAudioOut playback handler:`, err.message);
        }
      });

      // Streaming playback: forward control frames (playAudio / killAudio) to
      // mod_audio_fork over this session's websocket.
      session.onControlOut((msg: any) => {
        try {
          if (ws.readyState === WebSocket.OPEN) {
            const dataLen = msg?.data?.audioContent?.length || 0;
            console.log(`[AudioWS:${sessionId}] Sending control message: type=${msg?.type}, dataLen=${dataLen}`);
            ws.send(JSON.stringify(msg));
          } else {
            console.warn(`[AudioWS:${sessionId}] WebSocket not OPEN (state=${ws.readyState}), cannot send control message`);
          }
        } catch (err: any) {
          console.error(`[AudioWS:${sessionId}] Failed to send control message:`, err.message);
        }
      });

      // Listen for interruptions from the VAD/pipeline to issue a uuid_break command
      session.on('pipelineEvent', async (event) => {
        if (event.type === 'interruption') {
          const ttsElapsed = Date.now() - session!.ttsPlayStartTime;
          if (session!.isPlayingTts && ttsElapsed < 300) {
            console.log(`[AudioWS] Suppressed uuid_break within 300ms barge-in guard window (elapsed=${ttsElapsed}ms)`);
            return;
          }
          console.log(`[AudioWS] Interruption detected, breaking playback for session ${sessionId}`);
          for (const esl of this.eslConnections) {
            try {
              if (esl.isConnected()) {
                const targetUuid = session!.channelUuid || sessionId;
                await esl.api(`uuid_break ${targetUuid} all`);
              }
            } catch (err: any) {
              console.error(`[AudioWS] Failed to send uuid_break:`, err.message);
            }
          }
          // Streaming path: also tell mod_audio_fork to drop any audio it still
          // has queued/playing from the playAudio control messages.
          if (session!.isStreamingPlayback) {
            try {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'killAudio' }));
              }
            } catch (err: any) {
              console.error(`[AudioWS] Failed to send killAudio:`, err.message);
            }
          }
        }
      });

      // Listen for transfer event
      session.once('transfer', async (targetNumber: string) => {
        session.isTransferred = true;
        console.log(`[AudioWS] Session ${sessionId} initiating transfer to ${targetNumber}`);

        let gatewayName = 'twilio';
        try {
          const userId = session.userId;
          let activeGateway: any = null;

          if (userId) {
            // Check user's own active SIP gateway
            const userGatewayResult = await db.execute(sql`
              SELECT name FROM user_sip_gateways WHERE user_id = ${userId} AND is_active = true LIMIT 1
            `);
            activeGateway = (userGatewayResult.rows as any[])[0];
          }

          if (activeGateway) {
            gatewayName = activeGateway.name.toLowerCase();
          }
        } catch (err: any) {
          console.error(`[AudioWS] Failed to fetch active gateway for transfer:`, err.message);
        }

        const formattedTo = !targetNumber.startsWith('+') && !targetNumber.startsWith('sip:') ? `+${targetNumber}` : targetNumber;
        const targetUuid = session!.channelUuid || sessionId;
        const dialString = formattedTo.startsWith('sip:') ? formattedTo : `sofia/gateway/${gatewayName}/${formattedTo}`;

        console.log(`[AudioWS] Transferring channel ${targetUuid} to ${dialString}`);

        for (const esl of this.eslConnections) {
          try {
            if (esl.isConnected()) {
              await esl.api(`uuid_transfer ${targetUuid} 'bridge:${dialString}' inline`);
            }
          } catch (err: any) {
            console.error(`[AudioWS] Failed to transfer call for session ${sessionId}:`, err.message);
          }
        }

        // Mark the session as transferred in the DB so the final CHANNEL_HANGUP handler
        // knows it was a transferred call and can calculate the real total duration.
        try {
          await db.execute(sql`
            UPDATE ve_sessions
            SET end_reason = 'transferred',
                updated_at = NOW()
            WHERE id = ${sessionId}
          `);
          console.log(`[AudioWS] Marked session ${sessionId} as transferred in DB`);
        } catch (err: any) {
          console.error(`[AudioWS] Failed to mark session as transferred:`, err.message);
        }

        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1000, 'Call transferred');
        }
        this.unregisterSession(sessionId);
      });

      // Listen for play_audio event
      session.on('play_audio', async (audioUrl: string) => {
        console.log(`[AudioWS] Session ${sessionId} playing audio via ESL uuid_broadcast: ${audioUrl}`);
        const targetUuid = session!.channelUuid || sessionId;
        // Always use ESL uuid_broadcast — TCP outbound socket loses channel control
        // once the call is parked (CS_HIBERNATE state).
        for (const esl of this.eslConnections) {
          try {
            if (esl.isConnected()) {
              const response = await esl.api(`uuid_broadcast ${targetUuid} ${audioUrl} aleg`);
              console.log(`[AudioWS] play_audio uuid_broadcast response: ${response.trim()}`);
              break;
            }
          } catch (err: any) {
            console.error(`[AudioWS] Failed to play audio for session ${sessionId}:`, err.message);
          }
        }
      });

      // When the session ends (idle timeout, end_call tool, max duration, etc.)
      // hang up the FreeSWITCH call so the user's phone actually disconnects.
      session.once('hangup', async (reason: string) => {
        if (session.isTransferred) {
          console.log(`[AudioWS] Session ${sessionId} was transferred. Skipping ESL uuid_kill.`);
          this.unregisterSession(sessionId);
          return;
        }
        console.log(`[AudioWS] Session ${sessionId} ended (reason: ${reason}), issuing ESL uuid_kill`);
        for (const esl of this.eslConnections) {
          try {
            if (esl.isConnected()) {
              const targetUuid = session!.channelUuid || sessionId;
              await esl.api(`uuid_kill ${targetUuid} NORMAL_CLEARING`);
            }
          } catch (err: any) {
            console.error(`[AudioWS] Failed to send uuid_kill for ${sessionId}:`, err.message);
          }
        }
        // Close the WebSocket to FreeSWITCH mod_audio_fork as well
        const activeWs = (session as any)._activeWs || ws;
        if (activeWs.readyState === WebSocket.OPEN) {
          activeWs.close(1000, 'Session ended');
        }
        this.unregisterSession(sessionId);
      });



      // Handle incoming messages from FreeSWITCH mod_audio_fork.
      let binChunkCount = 0;
      let txtMsgCount = 0;
      ws.on('message', (data: WebSocket.Data, isBinary: boolean) => {
        // In modern ws versions, even text frames are returned as Buffer.
        // We must check the isBinary flag explicitly.
        if (isBinary) {
          binChunkCount++;
          const buf = data instanceof Buffer ? data : Buffer.from(data as ArrayBuffer);
          if (binChunkCount % 100 === 1) {
            console.log(`[AudioWS:${sessionId}] Received binary audio frame #${binChunkCount}, size=${buf.length} bytes`);
          }
          session!.processAudio(buf);
        } else {
          txtMsgCount++;
          // Text frame — JSON control message from mod_audio_fork
          try {
            const rawString = data.toString();
            const msg = JSON.parse(rawString);
            const msgType = msg.type || msg.event;
            console.log(`[AudioWS:${sessionId}] Text frame #${txtMsgCount}: ${JSON.stringify(msg)}`);
            if (msgType === 'stop' || msgType === 'clear') {
              console.log(`[AudioWS] mod_audio_fork ${msgType} event for session ${sessionId}`);
            } else if (msgType === 'start') {
              console.log(`[AudioWS] mod_audio_fork start event for session ${sessionId}`);
              if (msg.uuid) {
                session!.channelUuid = msg.uuid;
              }
              session!.markCallAnswered().catch(err => {
                console.error(`[AudioWS] Error marking call answered on start event:`, err.message);
              });
            } else {
              console.log(`[AudioWS] mod_audio_fork JSON message type="${msgType}" for ${sessionId}`);
            }
          } catch {
            console.warn(`[AudioWS:${sessionId}] Text frame #${txtMsgCount} is not valid JSON: ${data.toString().substring(0, 100)}`);
          }
        }
      });

      // Replay any buffered messages that were received during DB resolution
      if (messageBuffer.length > 0) {
        console.log(`[AudioWS] Replaying ${messageBuffer.length} buffered messages for session ${sessionId}`);
        for (const msg of messageBuffer) {
          ws.emit('message', msg.data, msg.isBinary);
        }
      }

      ws.on('close', (code, reason) => {
        console.log(`[AudioWS] Client disconnected: ${sessionId} (${code})`);
        
        // If this WebSocket connection is not the active one, do not end the session.
        if ((session as any)._activeWs && (session as any)._activeWs !== ws) {
          console.log(`[AudioWS:${sessionId}] Stale WebSocket closed. Ignoring.`);
          return;
        }
        
        console.log(`[AudioWS:${sessionId}] Active WebSocket closed (code=${code}). Keeping session alive for self-healing ESL reconnection.`);
      });

      ws.on('error', (err) => {
        console.error(`[AudioWS] Client error for ${sessionId}:`, err.message);
      });

      // If the session is not initialized yet, initialize it now
      if (!session.isInitialized()) {
        console.log(`[AudioWS] Initializing pipeline for session: ${sessionId}`);
        await session.initialize();
        // Trigger greeting play immediately on WebSocket connection since the call must be active/answered
        console.log(`[AudioWS] Call active, triggering greeting for session ${sessionId}.`);
        await session.markCallAnswered();
      }
    } catch (err: any) {
      console.error(`[AudioWS] Error handling connection for ${req.url}:`, err.message);
      ws.close(1011, 'Internal Server Error');
    }
  }

  private async resolveSessionDynamically(sessionId: string): Promise<AudioSession | null> {
    try {
      // 1. Search the DB to check if it's a pre-registered session (outbound call)
      const sessionResult = await db.execute(sql`
        SELECT * FROM ve_sessions WHERE id = ${sessionId} LIMIT 1
      `);

      let sessionData: any = null;
      let isNewSession = false;
      let fromNumber = '';
      let toNumber = '';

      if (sessionResult.rows.length > 0) {
        sessionData = camelizeKeys(sessionResult.rows[0]);
        console.log(`[AudioWS] Found pre-registered session for ID: ${sessionId}`);
      } else {
        // 2. If not pre-registered, it must be an inbound call!
        // Query FreeSWITCH ESL to get the channel variables (destination_number & caller_id_number)
        console.log(`[AudioWS] Inbound call detected. Querying FreeSWITCH for channel ${sessionId}...`);

        // Find nodes
        const nodesResult = await db.execute(sql`
          SELECT * FROM ve_freeswitch_nodes WHERE status = 'online' ORDER BY created_at ASC
        `);
        const nodes = camelizeKeys(nodesResult.rows);

        let fsVars: { destinationNumber: string; callerIdNumber: string } | null = null;

        if (nodes.length > 0) {
          for (const node of nodes) {
            fsVars = await this.getChannelVariablesFromNode(node, sessionId);
            if (fsVars) break;
          }
        } else {
          // Fall back to default local node if no nodes are registered in DB
          const defaultNode = {
            eslHost: process.env.FREESWITCH_ESL_HOST || '127.0.0.1',
            eslPort: parseInt(process.env.FREESWITCH_ESL_PORT || '8021'),
            eslPassword: process.env.FREESWITCH_ESL_PASSWORD || 'ClueCon',
          };
          fsVars = await this.getChannelVariablesFromNode(defaultNode, sessionId);
        }

        if (!fsVars) {
          console.warn(`[AudioWS] Could not retrieve channel variables from FreeSWITCH for ${sessionId}`);
          return null;
        }

        fromNumber = fsVars.callerIdNumber || '';
        toNumber = fsVars.destinationNumber || '';
        isNewSession = true;
      }

      // 3. Find the voice agent
      let agentResult: any = null;
      let targetAgentId: string | null = null;
      if (sessionData) {
        if (sessionData.agentId) {
          targetAgentId = sessionData.agentId;
        } else if (sessionData.metadata) {
          try {
            const meta = typeof sessionData.metadata === 'string'
              ? JSON.parse(sessionData.metadata)
              : sessionData.metadata;
            targetAgentId = meta?.agentId || null;
          } catch { }
        }
      }

      if (!targetAgentId && toNumber) {
        const cleanToNumber = toNumber.startsWith('+') ? toNumber.substring(1) : toNumber;
        const plusToNumber = toNumber.startsWith('+') ? toNumber : '+' + toNumber;

        // Query incoming_connections mapping
        let connResult = await db.execute(sql`
          SELECT agent_id FROM incoming_connections ic
          JOIN phone_numbers pn ON ic.phone_number_id = pn.id
          WHERE pn.phone_number = ${toNumber} OR pn.phone_number = ${cleanToNumber} OR pn.phone_number = ${plusToNumber} LIMIT 1
        `);
        if (connResult.rows.length > 0) {
          targetAgentId = connResult.rows[0].agent_id;
          console.log(`[AudioWS] Found incoming connection mapping for ${toNumber} -> agentId: ${targetAgentId}`);
        } else {
          // Query plivo_phone_numbers mapping directly
          connResult = await db.execute(sql`
            SELECT assigned_agent_id as agent_id FROM plivo_phone_numbers
            WHERE phone_number = ${toNumber} OR phone_number = ${cleanToNumber} OR phone_number = ${plusToNumber} LIMIT 1
          `);
          if (connResult.rows.length > 0 && connResult.rows[0].agent_id) {
            targetAgentId = connResult.rows[0].agent_id;
            console.log(`[AudioWS] Found Plivo incoming connection mapping for ${toNumber} -> agentId: ${targetAgentId}`);
          }
        }

        if (!targetAgentId) {
          // Query user_sip_phone_numbers mapping directly
          connResult = await db.execute(sql`
            SELECT agent_id FROM user_sip_phone_numbers
            WHERE phone_number = ${toNumber} OR phone_number = ${cleanToNumber} OR phone_number = ${plusToNumber} LIMIT 1
          `);
          if (connResult.rows.length > 0 && connResult.rows[0].agent_id) {
            targetAgentId = connResult.rows[0].agent_id;
            console.log(`[AudioWS] Found User SIP incoming connection mapping for ${toNumber} -> agentId: ${targetAgentId}`);
          }
        }
      }

      if (targetAgentId) {
        agentResult = await db.execute(sql`
          SELECT * FROM ve_voice_agents WHERE id = ${targetAgentId} LIMIT 1
        `);
        if (agentResult.rows.length === 0) {
          // Fallback to main agents table
          agentResult = await db.execute(sql`
            SELECT * FROM agents WHERE id = ${targetAgentId} LIMIT 1
          `);
        }
      } else {
        // Try to match agent by dialed destination number in the agent's name/description
        if (toNumber) {
          agentResult = await db.execute(sql`
            SELECT * FROM ve_voice_agents 
            WHERE is_active = true AND (name = ${toNumber} OR description LIKE ${'%' + toNumber + '%'})
            LIMIT 1
          `);
          if (agentResult.rows.length === 0) {
            agentResult = await db.execute(sql`
              SELECT * FROM agents 
              WHERE is_active = true AND telephony_provider = 'custom-voice-engine' AND name = ${toNumber}
              LIMIT 1
            `);
          }
        }

        // Fallback to first active voice agent only for pre-registered/outbound calls, NOT for inbound calls!
        if (!agentResult || agentResult.rows.length === 0) {
          if (isNewSession) {
            console.warn(`[AudioWS] Rejecting inbound call: no agent mapped or matched for destination number ${toNumber || 'unknown'}`);
            // Hang up the call in FreeSWITCH
            for (const esl of this.eslConnections) {
              try {
                if (esl.isConnected()) {
                  await esl.api(`uuid_kill ${sessionId} CALL_REJECTED`);
                }
              } catch (err: any) {
                console.error(`[AudioWS] Failed to send uuid_kill for unmapped call ${sessionId}:`, err.message);
              }
            }
            return null;
          }

          agentResult = await db.execute(sql`
            SELECT * FROM ve_voice_agents WHERE is_active = true ORDER BY created_at ASC LIMIT 1
          `);
          if (agentResult.rows.length === 0) {
            agentResult = await db.execute(sql`
              SELECT * FROM agents WHERE is_active = true AND telephony_provider = 'custom-voice-engine' ORDER BY created_at ASC LIMIT 1
            `);
          }
        }
      }

      if (!agentResult || agentResult.rows.length === 0) {
        console.error(`[AudioWS] No voice agent found for call ${sessionId}`);
        return null;
      }

      const agent = camelizeKeys(agentResult.rows[0]);

      if (agent.firstMessage && fromNumber) {
        const spacedDigits = (fromNumber.startsWith('+') ? 'plus ' : '') + fromNumber.replace(/\+/g, '').split('').join(' ');
        agent.firstMessage = agent.firstMessage.replace(/\{\{(phone|phone_number)\}\}/gi, spacedDigits);
      }

      // If the agent is a flow agent, load the flow and override systemPrompt and firstMessage
      let flow: any = null;

      // 1. Check if there is an active flow execution for this call session (e.g. Test Calls, Campaigns)
      const flowExecResult = await db.execute(sql`
        SELECT * FROM flow_executions WHERE call_id = ${sessionId} AND status = 'running' LIMIT 1
      `);
      if (flowExecResult.rows.length > 0) {
        const flowExec = camelizeKeys(flowExecResult.rows[0]);
        const flowResult = await db.execute(sql`
          SELECT * FROM flows WHERE id = ${flowExec.flowId} LIMIT 1
        `);
        if (flowResult.rows.length > 0) {
          flow = camelizeKeys(flowResult.rows[0]);
          console.log(`[AudioWS] Found active flow execution for call ${sessionId} -> flowId: ${flow.id}`);
          if (flow.compiledSystemPrompt) {
            agent.systemPrompt = flow.compiledSystemPrompt;
            console.log(`[AudioWS] Loaded compiled system prompt from flow: "${flow.compiledSystemPrompt.substring(0, 100)}..."`);
          }
          if (flow.compiledFirstMessage) {
            agent.firstMessage = flow.compiledFirstMessage;
          }
          // Set type and flowId dynamically so any downstream checks recognize it
          agent.type = 'flow';
          agent.flowId = flow.id;
        }
      }

      if (!flow) {
        if (agent.type === 'flow' && agent.flowId) {
          console.log(`[AudioWS] Agent is flow-based, loading flow ${agent.flowId}`);
          const flowResult = await db.execute(sql`
            SELECT * FROM flows WHERE id = ${agent.flowId} LIMIT 1
          `);
          if (flowResult.rows.length > 0) {
            flow = camelizeKeys(flowResult.rows[0]);
            if (flow.compiledSystemPrompt) {
              agent.systemPrompt = flow.compiledSystemPrompt;
              console.log(`[AudioWS] Loaded compiled system prompt from flow: "${flow.compiledSystemPrompt.substring(0, 100)}..."`);
            }
            if (flow.compiledFirstMessage) {
              agent.firstMessage = flow.compiledFirstMessage;
            }
          }
        } else {
          // Fallback for Custom Voice Engine agents where the agent is stored in ve_voice_agents
          // and doesn't have a flowId column directly, but there is an active flow pointing to this agent's ID.
          console.log(`[AudioWS] Agent ${agent.id} type is ${agent.type || 'unknown'}, checking for active flow assigned to this agent`);
          const flowResult = await db.execute(sql`
            SELECT * FROM flows WHERE agent_id = ${agent.id} AND is_active = true LIMIT 1
          `);
          if (flowResult.rows.length > 0) {
            flow = camelizeKeys(flowResult.rows[0]);
            console.log(`[AudioWS] Found active flow ${flow.id} pointing to agent ${agent.id}`);
            if (flow.compiledSystemPrompt) {
              agent.systemPrompt = flow.compiledSystemPrompt;
              console.log(`[AudioWS] Loaded compiled system prompt from flow: "${flow.compiledSystemPrompt.substring(0, 100)}..."`);
            }
            if (flow.compiledFirstMessage) {
              agent.firstMessage = flow.compiledFirstMessage;
            }
            // Set type and flowId dynamically so any downstream checks recognize it
            agent.type = 'flow';
            agent.flowId = flow.id;
          }
        }
      }

      // Add System Tools Prompt Instructions
      if (agent.knowledgeBaseIds && agent.knowledgeBaseIds.length > 0) {
        agent.systemPrompt = `
⚠️ CRITICAL KNOWLEDGE BASE INSTRUCTION ⚠️
You have access to a knowledge base tool called "lookup_knowledge_base".
- When the user asks ANY question that might require information from the knowledge base, you MUST call the "lookup_knowledge_base" tool IMMEDIATELY.
- Do NOT say things like "I will search the knowledge base" or "Let me check" or "Let me look that up".
- Do NOT answer from memory if information could exist in the knowledge base.

${agent.systemPrompt || ''}`;
      }

      if (agent.endConversationEnabled) {
        agent.systemPrompt = `
⚠️ CRITICAL END CALL INSTRUCTION ⚠️
You have access to an "end_call" tool. 
- You MUST call this tool when the conversation naturally concludes, the user says goodbye, or requests to hang up.

${agent.systemPrompt || ''}`;
      }

      // Build tool definitions from flow's compiled tools
      let tools: LlmToolDefinition[] = [];
      let toolMetadata: Map<string, any> = new Map();
      if (flow?.compiledTools && Array.isArray(flow.compiledTools) && flow.compiledTools.length > 0) {
        console.log(`[AudioWS] Found ${flow.compiledTools.length} compiled tools in flow ${flow.id}`);
        for (const ct of flow.compiledTools) {
          if (ct.type === 'function' && ct.function?.name) {
            const toolDef: LlmToolDefinition = {
              type: 'function',
              function: {
                name: ct.function.name,
                description: ct.function.description || '',
                parameters: ct.function.parameters || {},
              },
            };
            tools.push(toolDef);
            const meta = ct._metadata || (ct as any).Metadata || (ct as any)._metadata;
            if (meta) {
              toolMetadata.set(ct.function.name, meta);
            }
          }
        }
        console.log(`[AudioWS] Built ${tools.length} tool definitions for LLM`);
      }

      // Add System Tools (Knowledge Base)
      if (agent.knowledgeBaseIds && agent.knowledgeBaseIds.length > 0) {
        tools.push({
          type: 'function',
          function: {
            name: 'lookup_knowledge_base',
            description: 'Search the knowledge base for relevant information to answer user questions. Use this when you need facts, policies, product details, pricing, or any specific information.',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'The specific search query to look up in the knowledge base.' }
              },
              required: ['query'],
            }
          }
        });
        toolMetadata.set('lookup_knowledge_base', { knowledgeBaseIds: agent.knowledgeBaseIds });
        console.log(`[AudioWS] Added lookup_knowledge_base tool for ${agent.knowledgeBaseIds.length} KBs`);
      }

      // Add System Tools (End Call)
      if (agent.endConversationEnabled) {
        tools.push({
          type: 'function',
          function: {
            name: 'end_call',
            description: 'End the conversation when the user says goodbye or the interaction is complete.',
            parameters: { type: 'object', properties: {} }
          }
        });
        console.log(`[AudioWS] Added end_call tool`);
      }

      const userId = agent.userId;

      // 4. Create database record if it's a new inbound session
      if (isNewSession) {
        // Check if the agent exists in ve_voice_agents to satisfy foreign key constraint
        const checkAgentInVe = await db.execute(sql`
          SELECT id FROM ve_voice_agents WHERE id = ${agent.id} LIMIT 1
        `);
        const isVeAgent = checkAgentInVe.rows.length > 0;
        const dbAgentId = isVeAgent ? agent.id : null;
        const metadata = !isVeAgent ? { agentId: agent.id } : null;

        const insertResult = await db.execute(sql`
          INSERT INTO ve_sessions (
            id, user_id, agent_id, from_number, to_number, direction, status, channel_uuid, metadata
          ) VALUES (
            ${sessionId}, ${userId}, ${dbAgentId}, ${fromNumber || null}, ${toNumber || null}, 'inbound', 'initializing', ${sessionId}, ${metadata ? JSON.stringify(metadata) : null}
          ) RETURNING *
        `);
        sessionData = camelizeKeys(insertResult.rows[0]);
        console.log(`[AudioWS] Created new inbound session in DB for channel ${sessionId}`);

        // Insert tracking call record for call monitoring
        try {
          await db.execute(sql`
            INSERT INTO calls (
              id, user_id, phone_number, from_number, to_number, status, call_direction, engine_type, metadata, agent_id
            ) VALUES (
              ${sessionId}, ${userId}, ${fromNumber || null}, ${fromNumber || null}, ${toNumber || null}, 'initiated', 'incoming', 'custom-voice-engine', ${JSON.stringify({
                sessionUuid: sessionId,
                telephonyProvider: 'custom-voice-engine'
              })}, ${dbAgentId || null}
            )
          `);
          console.log(`[AudioWS] Created tracking call for inbound session ${sessionId}`);
        } catch (callErr: any) {
          console.error('[AudioWS] Failed to create tracking call record for inbound call:', callErr.message);
        }
      }

      // Fetch appointment settings
      let apptSettingsText = '';
      try {
        const apptSettingsResult = await db.execute(sql`
          SELECT * FROM appointment_settings WHERE user_id = ${userId} LIMIT 1
        `);
        const apptSettings = apptSettingsResult.rows?.[0] as any;
        if (apptSettings) {
          let workingDays: string[] = [];
          let workingHoursStart = '09:00';
          let workingHoursEnd = '17:00';

          if (apptSettings.working_hours) {
            const wh = typeof apptSettings.working_hours === 'string'
              ? JSON.parse(apptSettings.working_hours)
              : apptSettings.working_hours;
            workingDays = Object.keys(wh).filter(day => wh[day]?.enabled);
            // Find the first enabled day's times
            for (const day of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']) {
              if (wh[day]?.enabled) {
                workingHoursStart = wh[day].start || workingHoursStart;
                workingHoursEnd = wh[day].end || workingHoursEnd;
                break;
              }
            }
          }

          apptSettingsText = `\n**Appointment Booking Availability & Settings:**\n- Working Days (available for appointments): ${workingDays.length > 0 ? workingDays.join(', ') : 'None'}\n- Working Hours: ${workingHoursStart} to ${workingHoursEnd}\n- Slot Buffer Time: ${apptSettings.buffer_minutes || 0} minutes\n- Allow Overlapping Appointments: ${apptSettings.allow_overlapping ? 'Yes' : 'No'}\n`;
        }
      } catch (apptErr: any) {
        console.warn(`[AudioWS] Failed to fetch appointment settings for user ${userId}:`, apptErr.message);
      }

      // 5. Fetch global settings for fallback
      const globalSettingsResult = await db.execute(sql`
        SELECT key, value FROM global_settings WHERE key IN (
          've_stt_active_provider', 've_llm_active_provider', 've_tts_active_provider',
          've_deepgram_api_key', 've_sarvam_api_key', 've_openrouter_api_key',
          've_stt_deepgram_model', 've_stt_sarvam_model',
          've_llm_default_model',
          've_tts_deepgram_model', 've_tts_sarvam_model',
          've_tts_sarvam_speaker'
        )
      `);
      const globalSettingsMap: Record<string, any> = {};
      for (const row of globalSettingsResult.rows as any[]) {
        globalSettingsMap[row.key] = row.value;
      }

      let sttProvider = globalSettingsMap['ve_stt_active_provider'] || 'deepgram';
      let sttApiKey = sttProvider === 'sarvam' ? (globalSettingsMap['ve_sarvam_api_key'] || process.env.SARVAM_API_KEY || '') : (globalSettingsMap['ve_deepgram_api_key'] || process.env.DEEPGRAM_API_KEY || '');
      let sttModel = sttProvider === 'sarvam'
        ? (globalSettingsMap['ve_stt_sarvam_model'] || 'saaras:v3')
        : (globalSettingsMap['ve_stt_deepgram_model'] || 'nova-2');
      let sttConfig = {};

      let llmProvider = globalSettingsMap['ve_llm_active_provider'] || 'openrouter';
      let rawLlmKey = globalSettingsMap['ve_openrouter_api_key'] || process.env.OPENROUTER_API_KEY || '';
      if (!rawLlmKey || rawLlmKey.includes('your_openrouter_api_key') || rawLlmKey.includes('placeholder')) {
        rawLlmKey = process.env.OPENAI_API_KEY || '';
      }
      let llmApiKey = rawLlmKey;
      let llmModel = globalSettingsMap['ve_llm_default_model'] || 'openai/gpt-4o-mini';
      let llmConfig = {};

      let ttsProvider = globalSettingsMap['ve_tts_active_provider'] || 'deepgram';
      let ttsApiKey = ttsProvider === 'sarvam' ? (globalSettingsMap['ve_sarvam_api_key'] || process.env.SARVAM_API_KEY || '') : (globalSettingsMap['ve_deepgram_api_key'] || process.env.DEEPGRAM_API_KEY || '');
      let ttsModel = ttsProvider === 'sarvam'
        ? (globalSettingsMap['ve_tts_sarvam_model'] || 'bulbul:v3')
        : (globalSettingsMap['ve_tts_deepgram_model'] || 'aura-asteria-en');
      let ttsSpeaker = ttsProvider === 'sarvam' ? (globalSettingsMap['ve_tts_sarvam_speaker'] || 'neha') : '';
      let ttsConfig = {};

      // Fetch provider configurations for this user (tenant override)
      const providerConfigResult = await db.execute(sql`
        SELECT * FROM ve_provider_configs WHERE user_id = ${userId} LIMIT 1
      `);

      if (providerConfigResult.rows.length > 0) {
        const pc = camelizeKeys(providerConfigResult.rows[0]);
        sttProvider = pc.sttProvider || sttProvider;
        sttApiKey = pc.sttApiKey || sttApiKey;
        sttModel = pc.sttModel || sttModel;
        sttConfig = pc.sttConfig || {};

        llmProvider = pc.llmProvider || llmProvider;
        llmApiKey = pc.llmApiKey || llmApiKey;
        llmModel = pc.llmModel || llmModel;
        llmConfig = pc.llmConfig || {};

        ttsProvider = pc.ttsProvider || ttsProvider;
        ttsApiKey = pc.ttsApiKey || ttsApiKey;
        ttsModel = pc.ttsVoice || ttsModel;
        ttsConfig = pc.ttsConfig || {};
      }

      // 6. Build final STT/LLM/TTS configurations, resolving agent overrides.
      // IMPORTANT: resolve API keys AFTER all provider overrides (global → tenant → agent)
      // so that the correct key is used for the final effective provider.
      const effectiveSttProvider = (agent.vaSttProvider || agent.sttProvider || (agent.config as any)?.sttProvider || sttProvider) as string;
      const effectiveTtsProvider = (agent.vaTtsProvider || agent.ttsProvider || (agent.config as any)?.ttsProvider || ttsProvider) as string;

      const resolvedSttApiKey = effectiveSttProvider === 'sarvam'
        ? (globalSettingsMap['ve_sarvam_api_key'] || process.env.SARVAM_API_KEY || '')
        : (globalSettingsMap['ve_deepgram_api_key'] || process.env.DEEPGRAM_API_KEY || '');

      // If tenant has an explicit api key override for the effective provider, prefer that.
      // Otherwise, fall back to the global api key for that provider.
      const providerConfig = providerConfigResult.rows.length > 0 ? camelizeKeys(providerConfigResult.rows[0]) : null;

      const finalSttApiKey = (providerConfig && providerConfig.sttProvider === effectiveSttProvider && providerConfig.sttApiKey)
        ? providerConfig.sttApiKey
        : resolvedSttApiKey;

      const resolvedTtsApiKey = effectiveTtsProvider === 'sarvam'
        ? (globalSettingsMap['ve_sarvam_api_key'] || process.env.SARVAM_API_KEY || '')
        : (globalSettingsMap['ve_deepgram_api_key'] || process.env.DEEPGRAM_API_KEY || '');

      const finalTtsApiKey = (providerConfig && providerConfig.ttsProvider === effectiveTtsProvider && providerConfig.ttsApiKey)
        ? providerConfig.ttsApiKey
        : resolvedTtsApiKey;

      console.log(`[AudioWS] Provider config resolved — STT: ${effectiveSttProvider}, TTS: ${effectiveTtsProvider}, LLM: ${llmProvider}`);

      const pc = providerConfigResult.rows.length > 0 ? camelizeKeys(providerConfigResult.rows[0]) : null;

      const finalSttModel = (pc && pc.sttProvider === effectiveSttProvider && pc.sttModel)
        ? pc.sttModel
        : (effectiveSttProvider === 'sarvam'
          ? (globalSettingsMap['ve_stt_sarvam_model'] || 'saaras:v3')
          : (globalSettingsMap['ve_stt_deepgram_model'] || 'nova-2'));

      // finalTtsModel = the actual model identifier (e.g. 'bulbul:v3' for Sarvam, 'aura-asteria-en' for Deepgram)
      // NEVER use pc.ttsVoice here — that field stores the speaker/voice name, not the model
      const finalTtsModel = (effectiveTtsProvider === 'sarvam'
        ? (globalSettingsMap['ve_tts_sarvam_model'] || 'bulbul:v3')
        : (pc && pc.ttsProvider === effectiveTtsProvider && pc.ttsVoice
          ? pc.ttsVoice
          : (globalSettingsMap['ve_tts_deepgram_model'] || 'aura-asteria-en')));

      // finalTtsSpeaker = the Sarvam speaker/voice name (e.g. 'priya', 'neha')
      // For Sarvam: prefer pc.ttsVoice (the stored speaker name), then global setting, then fallback
      const finalTtsSpeaker = (pc && pc.ttsProvider === effectiveTtsProvider && pc.ttsVoice && effectiveTtsProvider === 'sarvam')
        ? pc.ttsVoice
        : (pc && pc.ttsProvider === effectiveTtsProvider && pc.ttsConfig?.sarvamSpeaker)
          ? pc.ttsConfig.sarvamSpeaker
          : (effectiveTtsProvider === 'sarvam'
            ? (globalSettingsMap['ve_tts_sarvam_speaker'] || 'neha')
            : '');

      const sttConfigObj: SttConfig = {
        provider: effectiveSttProvider as any,
        apiKey: finalSttApiKey,
        language: agent.language || 'en',
        model: agent.sttModel || finalSttModel,
        deepgramModel: agent.sttModel || finalSttModel, // Backward compatibility
        sarvamModel: agent.sttModel || finalSttModel,   // Backward compatibility
        detectLanguage: agent.detectLanguageEnabled || false,
        ...sttConfig,
      };

      // Inject current date/time, customer number, and appointment settings into system prompt
      const isOutbound = sessionData?.direction === 'outbound';
      const rawCustomerPhone = isOutbound
        ? (sessionData?.toNumber || toNumber || '')
        : (sessionData?.fromNumber || fromNumber || '');
      const customerPhone = (rawCustomerPhone.startsWith('+') ? 'plus ' : '') + rawCustomerPhone.replace(/\+/g, '').split('').join(' ');
      const today = new Date();
      const dateContext = `\n\n[SYSTEM CONTEXT]
- Current Date and Time: ${today.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })} (IST)
- Today is a: ${today.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' })}
- ISO Date: ${today.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })}
- Always interpret relative dates (like "today", "tomorrow", "this Sunday", "next Monday") based on this current date.
${customerPhone ? `- Customer's Phone Number (the number they are using for this call): ${customerPhone}
- IF the customer says "use my own number", "same number", "use the number I am calling from", "use the number you called", or similar, do NOT ask them to repeat or say it. You already have it. Simply confirm it with them: "So you want to use ${customerPhone}, is that correct?" and then proceed.` : ''}
${agent.detectLanguageEnabled ? `- Dynamic Language Switching: If the customer speaks to you in Hindi, Tamil, Telugu, Kannada, or any language other than English, you MUST immediately switch your response and speak ONLY in that same language. Do not speak English if they speak to you in a different language.` : ''}
${apptSettingsText}`;

      // Inject language instruction into system prompt based on current agent language
      // Uses Intl.DisplayNames — supports ALL BCP 47 language codes natively, no hardcoded map needed
      const langDisplayNames = new Intl.DisplayNames(['en'], { type: 'language' });
      const agentLanguage = agent.language || 'en';
      const languageName = langDisplayNames.of(agentLanguage) || agentLanguage;
      let systemPrompt = agent.systemPrompt || '';
      // Strip any stale language instruction baked into compiled system prompts
      // This handles both formats:
      //   "# CRITICAL LANGUAGE REQUIREMENT\nYou MUST..." (compiler)
      //   "CRITICAL LANGUAGE REQUIREMENT: You MUST..." (runtime injection)
      systemPrompt = systemPrompt.replace(/#{0,2}\s*CRITICAL LANGUAGE REQUIREMENT[\s\S]*?(?=\n\n|$)/g, '').trim();
      // Append date context first
      systemPrompt += dateContext;
      // Append language instruction at the END as a final override — this ensures it
      // takes precedence over any language-specific examples baked into flow states
      if (agentLanguage !== 'en') {
        systemPrompt += `\n\n## CRITICAL LANGUAGE REQUIREMENT (FINAL OVERRIDE)
You MUST speak ONLY in ${languageName}. From the very first word you say, speak in ${languageName}. Do NOT speak English or any other language. This overrides any previous language instructions in this prompt. This is mandatory.`;
      }

      systemPrompt += `\n\n## MANDATORY CONVERSATIONAL & RESPONSE RULES:
1. CONTEXT RETENTION & SITE VISIT RESPECT:
   - Always retain customer preferences shared during the call (budget, location, BHK type, purpose).
   - If the customer requests property details/images/location on WhatsApp or email, or explicitly states they do NOT want a site visit right now, IMMEDIATELY acknowledge their request ("Bilkul, main WhatsApp par saari details share kar deti hoon"), confirm WhatsApp delivery, and NEVER ask or push for a site visit again in that call!
2. INFORMATION CAPTURE & NO CONFUSION FALLBACKS:
   - Never output generic confusion phrases like "Aap kya keh rahe hain", "samajh nahi paa rahi hoon", or "Mujhe samajh nahi aaya".
   - If a customer utterance is short or partially noisy, state what you already understood (e.g. "Aapne 1 BHK Gurugram budget 30-40 Lakh bataya tha...") and politely ask only for the specific missing detail.
3. DYNAMIC RESPONSES & NO REPETITIVE FILLERS:
   - NEVER start consecutive responses with repetitive filler words like "Achha", "Achha, samajh rahi hoon", "Sahi hai", or "Okay". Use natural, contextually rich, varied sentence openings.
4. GENDER & RESPECTFUL ADDRESS:
   - Always address the customer using polite respectful plural verbs (e.g. "dekh rahe hain", "chahte hain", "karenge"). Avoid gender-specific singular forms (like "dekh rahi hain", "karengi").
5. RESPONSE FORMAT:
   - Keep responses extremely short, direct, and conversational (1-2 sentences max). Always end sentences with punctuation ('.', '।', '?', '!'). Never use bullet points or lists.
6. DATE vs TIME ACCURACY:
   - Do NOT confuse date numbers (e.g. "5 September se 10 September") with time of day (e.g. "10 baje").
   - If the customer specifies a date range like "5 September se 10 September ke beech", acknowledge the date range ("5 se 10 September ke beech") and politely ask for their preferred time ("Aap kis date aur kis time aana pasand karenge?").
7. WHATSAPP PHOTOS & FAREWELL COMPLETION:
   - When a customer requests site visit photos or details on WhatsApp, state: "Ji bilkul! Main aapke WhatsApp number par site visit ki photos aur details share kar deti hoon."
   - Always speak a complete polite farewell message ("Thank you for connecting with Tricity Homes. Have a great day!") before invoking end_call tool.
8. NO ALREADY-PROVIDED QUESTIONS:
   - If the customer has already stated a detail (e.g. location, budget, or property type like "Vaishali, 1 CR, Residential"), NEVER ask for that detail again in subsequent turns!
9. NO ROBOTIC RE-SUMMARIZATION:
   - Do NOT repeat the exact same summary sentence back-to-back across consecutive turns (e.g. do not say "Aapne 1 Cr Vaishali ki baat ki" twice). Speak naturally like a helpful human consultant.
10. NATURAL PHONE NUMBER CONFIRMATION:
   - Do NOT spell out phone numbers digit-by-digit with spaces (like "9 1 7 0 2..."). Ask naturally: "Aapke isi registered mobile number par WhatsApp details bhej doon, sahi hai?"
11. STRICT RESPONSE FORMAT & SHORT SENTENCES:
   - Reply in MAXIMUM 1 SHORT SENTENCE (max 10-12 words) per turn. NO LONG PARAGRAPHS. NO BULLET POINTS.
   - Never combine multiple sentences or questions into one reply.
12. ONE QUESTION PER TURN & MANDATORY LISTENING:
   - Ask EXACTLY ONE question per response turn.
   - After asking ONE question, STOP speaking immediately and WAIT for the customer's answer.
13. AFFIRMATION HANDLING ("Haan" / "Ji" / "Acha"):
   - If the customer says "Haan", "Ji", "Haan ji", or "Acha", acknowledge politely and smoothly advance the conversation by asking the next relevant question about their property preferences (e.g. location, budget, or 2BHK/3BHK). Never repeat "Ji bilkul, batayein!" in a loop.
14. MANDATORY PATIENT LISTENING & 3-4 SECOND SILENCE WAIT:
   - After speaking your message, STOP speaking immediately and wait patiently for 3 to 4 seconds for the customer to answer.
   - Listen to the customer's FULL response completely before replying. Never speak by yourself or generate unprompted turns while the customer is talking or within 3-4 seconds of silence.
15. STRICT STEP-BY-STEP FLOW EXECUTION:
   - Always progress through survey questions in exact step-by-step sequence (Step 1 -> Step 2 -> Step 3 -> Step 4 -> Step 5 -> Conclusion).
   - NEVER skip questions, never ask already-answered questions, and never end the survey early before completing all questions.
16. NO REPETITIVE QUESTION LOOPS:
   - If the customer gives a vague answer or repeats a single word (like "mudda" or "haan"), DO NOT repeat the exact same question again.
   - Give the 3 clear choices directly (e.g. "Kya aap Rozgar, Mehangai niyantran, ya Shiksha mein se chunna chahenge?") and smoothly advance to the next step. Never get stuck repeating a question for more than 2 turns!`;

      const llmConfigObj: LlmConfig = {
        provider: llmProvider,
        apiKey: llmApiKey,
        model: agent.llmModel || llmModel,
        temperature: agent.temperature || 0.7,
        maxTokens: agent.maxTokens || 500,
        systemPrompt,
        ...llmConfig,
      };

      // Resolve and sanitize TTS voice/speaker to prevent cross-provider settings contamination
      // For Sarvam: voice = speaker name (e.g. 'priya'/'neha'), model = 'bulbul:v2' etc — keep them separate
      // For Deepgram: voice = model name (e.g. 'aura-asteria-en')
      let resolvedTtsVoice: string;
      let resolvedSarvamSpeaker: string;

      if (effectiveTtsProvider === 'sarvam') {
        const nonSarvamVoices = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer', 'ash', 'ballad', 'coral', 'sage', 'verse'];
        const agentSpeaker = (agent.ttsVoice && !agent.ttsVoice.startsWith('aura-') && !nonSarvamVoices.includes(agent.ttsVoice.toLowerCase())) ? agent.ttsVoice
          : (agent.openaiVoice && !agent.openaiVoice.startsWith('aura-') && !nonSarvamVoices.includes(agent.openaiVoice.toLowerCase())) ? agent.openaiVoice
            : null;
        resolvedSarvamSpeaker = agentSpeaker || finalTtsSpeaker || 'neha';
        resolvedTtsVoice = resolvedSarvamSpeaker; // voice field = speaker name for Sarvam
      } else {
        // Deepgram: voice must be an 'aura-' model name
        const agentDeepgramVoice = (agent.ttsVoice && agent.ttsVoice.startsWith('aura-')) ? agent.ttsVoice
          : (agent.openaiVoice && agent.openaiVoice.startsWith('aura-')) ? agent.openaiVoice
            : null;
        resolvedTtsVoice = agentDeepgramVoice || finalTtsModel;
        resolvedSarvamSpeaker = ''; // not used for Deepgram
      }

      const ttsConfigObj: TtsConfig = {
        provider: effectiveTtsProvider as any,
        apiKey: finalTtsApiKey,
        voice: resolvedTtsVoice,
        language: agent.language || 'en',
        deepgramModel: (effectiveTtsProvider === 'deepgram' && agent.ttsModel && agent.ttsModel.startsWith('aura')) ? agent.ttsModel : resolvedTtsVoice,
        sarvamModel: (effectiveTtsProvider === 'sarvam' && agent.ttsModel && agent.ttsModel.startsWith('bulbul')) ? agent.ttsModel : finalTtsModel,
        sarvamSpeaker: resolvedSarvamSpeaker,
        outputFormat: {
          encoding: 'linear16',
          sampleRate: effectiveTtsProvider === 'sarvam' ? 16000 : 8000,
          channels: 1,
          bitDepth: 16,
        },
        ...ttsConfig,
      };

      // 7. Instantiate and initialize AudioSession
      const audioSession = new AudioSession(
        sessionId,
        sessionData as VoiceSession,
        agent as VoiceAgentConfig,
        sttConfigObj,
        llmConfigObj,
        ttsConfigObj,
        undefined,
        tools,
        toolMetadata
      );

      // Register hook to sync session state back to the database in real-time
      this.setupDatabaseSync(audioSession);

      // Register session in our active pool
      this.registerSession(audioSession);

      // Automatically restart mod_audio_fork when a TTS playback finishes
      audioSession.on('playback_finished', async () => {
        if (audioSession.isTransferred || (audioSession as any).destroyed) return;
        
        // If we are using streaming playback, we do not need to restart mod_audio_fork
        // because the media bug was never detached.
        if ((audioSession as any).streamingPlayback) {
          console.log(`[AudioWS:${sessionId}] Playback finished (streaming). No restart needed.`);
          return;
        }
        
        console.log(`[AudioWS:${sessionId}] Playback finished. Continuous audio_fork active.`);
      });

      return audioSession;
    } catch (err: any) {
      console.error(`[AudioWS] Failed to resolve session ${sessionId} dynamically:`, err.message);
      return null;
    }
  }

  private async getChannelVariablesFromNode(node: any, channelUuid: string) {
    // 1. Try to reuse an existing persistent ESL connection if it matches and is connected
    const existingEsl = this.eslConnections.find(e =>
      (e as any).config.host === node.eslHost &&
      (e as any).config.port === node.eslPort &&
      e.isConnected()
    );

    if (existingEsl) {
      try {
        let destinationNumber = await existingEsl.getVariable(channelUuid, 'destination_number');
        let callerIdNumber = await existingEsl.getVariable(channelUuid, 'caller_id_number');

        if (destinationNumber === '_undef_') destinationNumber = undefined as any;
        if (callerIdNumber === '_undef_') callerIdNumber = undefined as any;

        return { destinationNumber, callerIdNumber };
      } catch (err: any) {
        console.warn(`[AudioWS] Failed to get variables using existing connection to ${node.eslHost}:`, err.message);
        // Fall back to creating a new connection if the existing one fails
      }
    }

    // 2. Fallback to creating a temporary ESL connection
    const esl = new EslConnection({
      host: node.eslHost,
      port: node.eslPort,
      password: node.eslPassword,
      reconnect: false,
    });

    // Register error handler to prevent uncaught exceptions
    esl.on('error', (err) => {
      console.error('[ESL] Client error during channel variables retrieval:', err.message);
    });

    try {
      await esl.connect();
      let destinationNumber = await esl.getVariable(channelUuid, 'destination_number');
      let callerIdNumber = await esl.getVariable(channelUuid, 'caller_id_number');
      await esl.disconnect();

      if (destinationNumber === '_undef_') destinationNumber = undefined as any;
      if (callerIdNumber === '_undef_') callerIdNumber = undefined as any;

      return { destinationNumber, callerIdNumber };
    } catch (err: any) {
      console.error(`[AudioWS] Failed to get variables on ${node.eslHost}:${node.eslPort}:`, err.message);
      try { await esl.disconnect(); } catch { }
      return null;
    }
  }

  private setupDatabaseSync(session: AudioSession): void {
    const saveSession = async () => {
      try {
        const sess = session.getSession();

        // Ensure channel_uuid is set to session.id if not present
        const channelUuid = sess.channelUuid || session.id;

        await db.execute(sql`
          UPDATE ve_sessions
          SET status = ${sess.status},
              duration_seconds = GREATEST(duration_seconds, ${sess.durationSeconds || 0}),
              ended_at = ${sess.endedAt || null},
              transcript = ${JSON.stringify(sess.transcript)},
              stt_duration_ms = ${sess.sttDurationMs || 0},
              llm_prompt_tokens = ${sess.llmPromptTokens || 0},
              llm_completion_tokens = ${sess.llmCompletionTokens || 0},
              tts_duration_ms = ${sess.ttsDurationMs || 0},
              tts_characters = ${sess.ttsCharacters || 0},
              credits_used = GREATEST(credits_used, ${sess.creditsUsed || 0}),
              channel_uuid = ${channelUuid},
              updated_at = NOW()
          WHERE id = ${session.id}
        `);

        // Keep calls table in sync for call monitoring
        const mappedStatus = sess.status === 'initializing' ? 'initiated' : (sess.status === 'completed' ? 'completed' : (sess.status === 'failed' ? 'failed' : 'in-progress'));
        const transcriptText = typeof sess.transcript === 'string'
          ? sess.transcript
          : (Array.isArray(sess.transcript)
              ? sess.transcript.map((t: any) => `${t.role === 'user' ? 'Customer' : 'Agent'}: ${t.content || t.text || ''}`).join('\n')
              : JSON.stringify(sess.transcript || []));

        await db.execute(sql`
          UPDATE calls
          SET status = ${mappedStatus},
              duration = GREATEST(COALESCE(duration, 0), ${sess.durationSeconds || 0}),
              ended_at = ${sess.endedAt || null},
              transcript = ${transcriptText},
              classification = ${sess.classification || null},
              sentiment = ${sess.sentiment || null},
              ai_summary = ${sess.aiSummary || null}
          WHERE id = ${session.id} OR (metadata->>'sessionUuid' = ${session.id})
        `);
      } catch (err: any) {
        console.error(`[AudioWS] Failed to save session ${session.id} to DB:`, err.message);
      }
    };

    session.on('statusChange', async (status) => {
      if (status === 'completed' || session.getSession().status === 'completed') {
        try {
          const sess = session.getSession();
          const duration = sess.durationSeconds || 0;
          if (duration > 0) {
            // Get credit price per minute
            const creditPriceResult = await db.execute(sql`
              SELECT value FROM global_settings WHERE key = 'credit_price_per_minute' LIMIT 1
            `);
            const creditPriceSetting = creditPriceResult.rows?.[0] as { value: string } | undefined;
            let creditPricePerMinute = 1;
            if (creditPriceSetting?.value) {
              const parsed = Number(creditPriceSetting.value);
              if (Number.isFinite(parsed) && parsed >= 0) {
                creditPricePerMinute = parsed;
              }
            }
            const minutes = Math.ceil(duration / 60);
            const creditsToDeduct = Math.ceil(minutes * creditPricePerMinute);

            const deductCallCredits = (global as any).deductCallCredits;
            if (!deductCallCredits) {
              throw new Error("deductCallCredits is not registered globally");
            }
            const creditResult = await deductCallCredits({
              userId: sess.userId,
              creditsToDeduct,
              callId: session.id,
              fromNumber: sess.fromNumber || 'Unknown',
              toNumber: sess.toNumber || 'Unknown',
              durationSeconds: duration,
              engine: 'custom-voice-engine',
            });

            if (creditResult.success || creditResult.alreadyDeducted) {
              (session as any).session.creditsUsed = creditsToDeduct;
              console.log(`[AudioWS] Deducted ${creditsToDeduct} credits for custom-voice-engine session ${session.id}`);
            }
          }
        } catch (creditErr: any) {
          console.error(`[AudioWS] Failed to deduct credits for session ${session.id}:`, creditErr.message);
        }
      }

      await saveSession();

      if (status === 'completed' || session.getSession().status === 'completed') {
        try {
          let CRMLeadProcessor = (global as any).CRMLeadProcessor;
          if (!CRMLeadProcessor) {
            // Fallback for development where it might not be registered globally yet
            const module = await import('../../../../server/engines/crm/lead-processor.service');
            CRMLeadProcessor = module.CRMLeadProcessor;
          }
          await CRMLeadProcessor.processCustomVoiceEngineCall(session.id);
        } catch (err: any) {
          console.error(`[AudioWS] Failed to process lead generation for session ${session.id}:`, err.message);
        }
      }
    });

    session.on('callAnswered', async () => {
      console.log(`[AudioWS] Session ${session.id} marked as answered, syncing to DB.`);
      await saveSession();
    });

    session.on('pipelineEvent', async (event) => {
      // Sync on key pipeline events to have near real-time transcripts
      if (
        (event.type === 'stt_transcript' && event.transcript.isFinal) ||
        event.type === 'llm_response' ||
        event.type === 'session_end'
      ) {
        await saveSession();
      }
    });
  }
}