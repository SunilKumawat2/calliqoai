import { WebSocketServer, WebSocket } from "ws";
import fs from "fs";
import { AudioSession } from "./audio-session.js";
import { db } from "../../../../server/db.js";
import { sql } from "drizzle-orm";
import { EslConnection } from "../freeswitch/esl-connection.js";
function camelizeKeys(obj) {
  if (Array.isArray(obj)) {
    return obj.map((v) => camelizeKeys(v));
  } else if (obj !== null && obj.constructor === Object) {
    return Object.keys(obj).reduce((result, key) => {
      const camelKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
      result[camelKey] = camelizeKeys(obj[key]);
      return result;
    }, {});
  }
  return obj;
}
class AudioWebSocketServer {
  wss;
  sessions = /* @__PURE__ */ new Map();
  eslConnections = [];
  constructor(httpServer) {
    this.wss = new WebSocketServer({
      noServer: true,
      perMessageDeflate: false,
      // Disable compression for low-latency audio
      maxPayload: 64 * 1024
      // 64KB max per message
    });
    httpServer.on("upgrade", (req, socket, head) => {
      const pathname = req.url?.split("?")[0] || "";
      if (pathname.startsWith("/voice-engine/audio/") || pathname.startsWith("/api/voice-engine/ws/audio/") || pathname.startsWith("/voice-engine/ws/audio/")) {
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          this.wss.emit("connection", ws, req);
        });
      }
    });
    this.wss.on("connection", (ws, req) => {
      this.handleConnection(ws, req);
    });
    this.wss.on("error", (err) => {
      console.error("[AudioWS] Server error:", err);
    });
    console.log("[AudioWS] WebSocket audio server started");
  }
  /**
   * Register an AudioSession to receive audio
   */
  registerSession(session) {
    this.sessions.set(session.id, session);
    console.log(`[AudioWS] Session registered: ${session.id}`);
  }
  /**
   * Unregister an AudioSession
   */
  unregisterSession(sessionId) {
    this.sessions.delete(sessionId);
    console.log(`[AudioWS] Session unregistered: ${sessionId}`);
  }
  /**
   * Get active session count
   */
  getActiveSessionCount() {
    return this.sessions.size;
  }
  /**
   * Initialize persistent FreeSWITCH ESL connections for event monitoring and commands
   */
  async initializeEslConnections(wsUrl) {
    await this.closeEslConnections();
    try {
      const nodesResult = await db.execute(sql`
        SELECT * FROM ve_freeswitch_nodes WHERE status = 'online'
      `);
      for (const node of camelizeKeys(nodesResult.rows)) {
        const eslHost = node.eslHost;
        const eslPort = node.eslPort;
        const eslPassword = node.eslPassword || "ClueCon";
        try {
          const esl = new EslConnection({
            host: eslHost,
            port: eslPort,
            password: eslPassword,
            reconnect: true
          });
          esl.on("error", (err) => {
            console.error(`[AudioWS] ESL Connection error for node ${node.name || eslHost}:`, err.message);
          });
          esl.on("event:CUSTOM", async (evt) => {
            const eventSubclass = evt.eventSubclass || evt.headers["Event-Subclass"];
            if (eventSubclass === "mod_audio_fork::play_audio") {
              try {
                const bodyStr = evt.body;
                if (!bodyStr) return;
                const payload = JSON.parse(bodyStr);
                const file = payload.file;
                const channelUuid = evt.headers["Unique-ID"];
                if (file && channelUuid) {
                  await esl.api(`uuid_broadcast ${channelUuid} ${file} aleg`);
                }
              } catch (err) {
                console.error(`[AudioWS] Error handling play_audio event:`, err.message);
              }
            }
          });
          esl.on("event:CHANNEL_ANSWER", async (evt) => {
            try {
              const channelUuid = evt.headers["Unique-ID"] || evt.headers["Channel-Call-UUID"];
              if (channelUuid) {
                const session = this.sessions.get(channelUuid);
                if (session) {
                  console.log(`[AudioWS] CHANNEL_ANSWER event received for session ${channelUuid}. Calling markCallAnswered.`);
                  await session.markCallAnswered();
                }
              }
            } catch (err) {
              console.error(`[AudioWS] Error handling CHANNEL_ANSWER event:`, err.message);
            }
          });
          esl.on("event:CHANNEL_HANGUP", async (evt) => {
            try {
              const channelUuid = evt.headers["Unique-ID"] || evt.headers["Channel-Call-UUID"];
              if (!channelUuid) return;
              const hangupCause = evt.headers["Hangup-Cause"] || "";
              console.log(`[AudioWS] CHANNEL_HANGUP event received: uuid=${channelUuid}, cause=${hangupCause}, duration=${evt.headers["variable_duration"]}, billsec=${evt.headers["variable_billsec"]}`);
              const unansweredCauses = [
                "NO_ANSWER",
                "USER_BUSY",
                "NO_ROUTE_DESTINATION",
                "CALL_REJECTED",
                "NUMBER_CHANGED",
                "SUBSCRIBER_ABSENT",
                "UNALLOCATED_NUMBER",
                "NORMAL_UNSPECIFIED",
                "RECOVERY_ON_TIMER_EXPIRE"
              ];
              const isUnanswered = unansweredCauses.includes(hangupCause);
              const session = this.sessions.get(channelUuid);
              if (session) {
                if (isUnanswered) {
                  console.log(`[AudioWS] CHANNEL_HANGUP (${hangupCause}) \u2014 call never answered for ${channelUuid}. Marking as failed.`);
                  try {
                    await db.execute(sql`
                      UPDATE ve_sessions
                      SET status = 'failed',
                          end_reason = ${hangupCause.toLowerCase()},
                          ended_at = NOW(),
                          updated_at = NOW()
                      WHERE id = ${channelUuid}
                    `);
                  } catch (dbErr) {
                    console.error(`[AudioWS] Failed to update unanswered session status:`, dbErr.message);
                  }
                  session.destroyed = true;
                  session.removeAllListeners();
                  this.unregisterSession(channelUuid);
                } else {
                  console.log(`[AudioWS] CHANNEL_HANGUP (${hangupCause}) for session ${channelUuid}. Ending session.`);
                  await session.end("hangup");
                  this.unregisterSession(channelUuid);
                }
              } else {
                if (isUnanswered) {
                  console.log(`[AudioWS] CHANNEL_HANGUP (${hangupCause}) \u2014 no session in memory for ${channelUuid}, updating DB status.`);
                  try {
                    await db.execute(sql`
                      UPDATE ve_sessions
                      SET status = 'failed',
                          end_reason = ${hangupCause.toLowerCase()},
                          ended_at = NOW(),
                          updated_at = NOW()
                      WHERE id = ${channelUuid} AND status IN ('initializing', 'active')
                    `);
                  } catch (dbErr) {
                    console.error(`[AudioWS] Failed to update orphaned session status:`, dbErr.message);
                  }
                } else {
                  try {
                    const sessionResult = await db.execute(sql`
                      SELECT * FROM ve_sessions WHERE id = ${channelUuid} LIMIT 1
                    `);
                    const sessionData = sessionResult.rows?.[0];
                    if (sessionData && sessionData.status === "completed" && sessionData.end_reason === "transferred") {
                      const oldDuration = sessionData.duration_seconds || 0;
                      const startedAt = sessionData.started_at ? new Date(sessionData.started_at).getTime() : null;
                      const totalDuration = startedAt ? Math.floor((Date.now() - startedAt) / 1e3) : 0;
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
                          const creditPriceSetting = creditPriceResult.rows?.[0];
                          let creditPricePerMinute = 1;
                          if (creditPriceSetting?.value) {
                            const parsed = Number(creditPriceSetting.value);
                            if (Number.isFinite(parsed) && parsed >= 0) {
                              creditPricePerMinute = parsed;
                            }
                          }
                          const creditsToDeduct = additionalMinutes * creditPricePerMinute;
                          const deductCallCredits = global.deductCallCredits;
                          if (deductCallCredits) {
                            const creditResult = await deductCallCredits({
                              userId: sessionData.user_id,
                              creditsToDeduct,
                              callId: `${channelUuid}-adjustment`,
                              fromNumber: sessionData.from_number || "Unknown",
                              toNumber: sessionData.to_number || "Unknown",
                              durationSeconds: totalDuration - oldDuration,
                              engine: "custom-voice-engine"
                            });
                            if (creditResult.success || creditResult.alreadyDeducted) {
                              newCreditsUsed += creditsToDeduct;
                              console.log(`[AudioWS] Charged additional ${creditsToDeduct} credits for transferred session ${channelUuid}. Total duration: ${totalDuration}s, old: ${oldDuration}s`);
                            }
                          }
                        }
                        await db.execute(sql`
                          UPDATE ve_sessions
                          SET duration_seconds = ${totalDuration},
                              credits_used = ${newCreditsUsed},
                              updated_at = NOW()
                          WHERE id = ${channelUuid}
                        `);
                      }
                    }
                  } catch (err) {
                    console.error(`[AudioWS] Failed to process final hangup billing for ${channelUuid}:`, err.message);
                  }
                }
              }
            } catch (err) {
              console.error(`[AudioWS] Error handling CHANNEL_HANGUP event:`, err.message);
            }
          });
          esl.on("esl:ready", () => {
            console.log(`[AudioWS] ESL connection ready for node ${node.name || eslHost}`);
          });
          esl.on("esl:end", () => {
            console.log(`[AudioWS] ESL connection ended for node ${node.name || eslHost}, will auto-reconnect`);
          });
          await esl.connect();
          await esl.api(`global_setvar ve_audio_ws_url ${wsUrl}`);
          this.eslConnections.push(esl);
          console.log(`[AudioWS] Established persistent ESL connection to FreeSWITCH node ${node.name || eslHost}`);
        } catch (nodeErr) {
          console.warn(`[AudioWS] Failed to connect to FreeSWITCH node ${node.name || eslHost}:`, nodeErr.message);
        }
      }
    } catch (err) {
      console.warn(`[AudioWS] Failed to query FreeSWITCH nodes on initialization:`, err.message);
    }
  }
  /**
   * Close all persistent ESL connections
   */
  async closeEslConnections() {
    for (const esl of this.eslConnections) {
      try {
        await esl.disconnect();
      } catch {
      }
    }
    this.eslConnections = [];
  }
  /**
   * Shutdown the WebSocket server
   */
  shutdown() {
    for (const client of this.wss.clients) {
      client.close(1001, "Server shutting down");
    }
    this.wss.close();
    this.sessions.clear();
    this.closeEslConnections().catch(() => {
    });
    console.log("[AudioWS] Server shut down");
  }
  // ── Private ────────────────────────────────────────────
  async handleConnection(ws, req) {
    try {
      const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
      const pathParts = url.pathname.split("/");
      const sessionId = pathParts[pathParts.length - 1];
      if (!sessionId) {
        console.warn("[AudioWS] Connection without session ID");
        ws.close(4e3, "Missing session ID");
        return;
      }
      console.log(`[AudioWS] Incoming connection for sessionId: ${sessionId}`);
      let session = this.sessions.get(sessionId);
      if (!session) {
        console.log(`[AudioWS] Session not found in cache. Querying DB/FreeSWITCH for ${sessionId}...`);
        session = await this.resolveSessionDynamically(sessionId);
      }
      if (!session) {
        console.warn(`[AudioWS] No session found/resolved: ${sessionId}`);
        ws.close(4001, "Session not found");
        return;
      }
      console.log(`[AudioWS] Client connected for session: ${sessionId}`);
      let audioPlayCount = 0;
      session.onAudioOut(async (audio) => {
        try {
          audioPlayCount++;
          const samplesCount = audio.length / 2;
          const wavHeader = Buffer.alloc(44);
          const sampleRate = 8e3;
          const numChannels = 1;
          const bitsPerSample = 16;
          const blockAlign = numChannels * (bitsPerSample / 8);
          const byteRate = sampleRate * blockAlign;
          const dataSize = samplesCount * blockAlign;
          wavHeader.write("RIFF", 0);
          wavHeader.writeUInt32LE(36 + dataSize, 4);
          wavHeader.write("WAVE", 8);
          wavHeader.write("fmt ", 12);
          wavHeader.writeUInt32LE(16, 16);
          wavHeader.writeUInt16LE(1, 20);
          wavHeader.writeUInt16LE(numChannels, 22);
          wavHeader.writeUInt32LE(sampleRate, 24);
          wavHeader.writeUInt32LE(byteRate, 28);
          wavHeader.writeUInt16LE(blockAlign, 32);
          wavHeader.writeUInt16LE(bitsPerSample, 34);
          wavHeader.write("data", 36);
          wavHeader.writeUInt32LE(dataSize, 40);
          const wavBuffer = Buffer.concat([wavHeader, audio]);
          const filePath = `/tmp/${sessionId}_tts_${Date.now()}_${audioPlayCount}.wav`;
          await fs.promises.writeFile(filePath, wavBuffer);
          console.log(`[AudioWS] Wrote TTS audio to ${filePath} (${wavBuffer.length} bytes), playing via ESL uuid_broadcast...`);
          for (const esl of this.eslConnections) {
            try {
              if (esl.isConnected()) {
                const targetUuid = session.channelUuid || sessionId;
                await esl.api(`uuid_broadcast ${targetUuid} ${filePath}`);
              }
            } catch (err) {
              console.error(`[AudioWS] Failed to send uuid_broadcast:`, err.message);
            }
          }
        } catch (err) {
          console.error(`[AudioWS] Error in onAudioOut playback handler:`, err.message);
        }
      });
      session.onControlOut((msg) => {
        try {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
          }
        } catch (err) {
          console.error(`[AudioWS] Failed to send control message:`, err.message);
        }
      });
      session.on("pipelineEvent", async (event) => {
        if (event.type === "interruption") {
          console.log(`[AudioWS] Interruption detected, breaking playback for session ${sessionId}`);
          for (const esl of this.eslConnections) {
            try {
              if (esl.isConnected()) {
                const targetUuid = session.channelUuid || sessionId;
                await esl.api(`uuid_break ${targetUuid} all`);
              }
            } catch (err) {
              console.error(`[AudioWS] Failed to send uuid_break:`, err.message);
            }
          }
          if (session.isStreamingPlayback) {
            try {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "killAudio" }));
              }
            } catch (err) {
              console.error(`[AudioWS] Failed to send killAudio:`, err.message);
            }
          }
        }
      });
      session.once("transfer", async (targetNumber) => {
        session.isTransferred = true;
        console.log(`[AudioWS] Session ${sessionId} initiating transfer to ${targetNumber}`);
        let gatewayName = "twilio";
        try {
          const activeGatewayResult = await db.execute(sql`
            SELECT name FROM ve_sip_gateways WHERE is_active = true LIMIT 1
          `);
          const activeGateway = activeGatewayResult.rows[0];
          if (activeGateway) {
            gatewayName = activeGateway.name.toLowerCase();
          }
        } catch (err) {
          console.error(`[AudioWS] Failed to fetch active gateway for transfer:`, err.message);
        }
        const formattedTo = !targetNumber.startsWith("+") && !targetNumber.startsWith("sip:") ? `+${targetNumber}` : targetNumber;
        const targetUuid = session.channelUuid || sessionId;
        const dialString = formattedTo.startsWith("sip:") ? formattedTo : `sofia/gateway/${gatewayName}/${formattedTo}`;
        console.log(`[AudioWS] Transferring channel ${targetUuid} to ${dialString}`);
        for (const esl of this.eslConnections) {
          try {
            if (esl.isConnected()) {
              await esl.api(`uuid_transfer ${targetUuid} 'bridge:${dialString}' inline`);
            }
          } catch (err) {
            console.error(`[AudioWS] Failed to transfer call for session ${sessionId}:`, err.message);
          }
        }
        try {
          await db.execute(sql`
            UPDATE ve_sessions
            SET end_reason = 'transferred',
                updated_at = NOW()
            WHERE id = ${sessionId}
          `);
          console.log(`[AudioWS] Marked session ${sessionId} as transferred in DB`);
        } catch (err) {
          console.error(`[AudioWS] Failed to mark session as transferred:`, err.message);
        }
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1e3, "Call transferred");
        }
        this.unregisterSession(sessionId);
      });
      session.on("play_audio", async (audioUrl) => {
        console.log(`[AudioWS] Session ${sessionId} playing audio: ${audioUrl}`);
        const targetUuid = session.channelUuid || sessionId;
        for (const esl of this.eslConnections) {
          try {
            if (esl.isConnected()) {
              await esl.api(`uuid_broadcast ${targetUuid} ${audioUrl}`);
            }
          } catch (err) {
            console.error(`[AudioWS] Failed to play audio for session ${sessionId}:`, err.message);
          }
        }
      });
      session.once("hangup", async (reason) => {
        if (session.isTransferred) {
          console.log(`[AudioWS] Session ${sessionId} was transferred. Skipping ESL uuid_kill.`);
          this.unregisterSession(sessionId);
          return;
        }
        console.log(`[AudioWS] Session ${sessionId} ended (reason: ${reason}), issuing ESL uuid_kill`);
        for (const esl of this.eslConnections) {
          try {
            if (esl.isConnected()) {
              const targetUuid = session.channelUuid || sessionId;
              await esl.api(`uuid_kill ${targetUuid} NORMAL_CLEARING`);
            }
          } catch (err) {
            console.error(`[AudioWS] Failed to send uuid_kill for ${sessionId}:`, err.message);
          }
        }
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1e3, "Session ended");
        }
        this.unregisterSession(sessionId);
      });
      ws.on("message", (data, isBinary) => {
        if (isBinary || data instanceof Buffer) {
          const buf = data instanceof Buffer ? data : Buffer.from(data);
          session.processAudio(buf);
        } else if (data instanceof ArrayBuffer) {
          session.processAudio(Buffer.from(data));
        } else {
          try {
            const msg = JSON.parse(data.toString());
            const msgType = msg.type || msg.event;
            if (msgType === "stop" || msgType === "clear") {
              console.log(`[AudioWS] mod_audio_fork ${msgType} event for session ${sessionId}`);
            } else if (msgType === "start") {
              console.log(`[AudioWS] mod_audio_fork start event for session ${sessionId}`);
              if (msg.uuid) {
                session.channelUuid = msg.uuid;
              }
              session.markCallAnswered().catch((err) => {
                console.error(`[AudioWS] Error marking call answered on start event:`, err.message);
              });
            } else {
              console.log(`[AudioWS] mod_audio_fork JSON message type="${msgType}" for ${sessionId}`);
            }
          } catch {
          }
        }
      });
      ws.on("close", (code, reason) => {
        console.log(`[AudioWS] Client disconnected: ${sessionId} (${code})`);
        session.end("websocket_closed").catch(() => {
        });
        this.unregisterSession(sessionId);
      });
      ws.on("error", (err) => {
        console.error(`[AudioWS] Client error for ${sessionId}:`, err.message);
      });
      if (!session.isInitialized()) {
        console.log(`[AudioWS] Initializing pipeline for session: ${sessionId}`);
        await session.initialize();
        if (session.direction === "inbound") {
          console.log(`[AudioWS] Inbound call, triggering greeting for session ${sessionId}.`);
          await session.markCallAnswered();
        } else {
          console.log(`[AudioWS] Outbound call, waiting for CHANNEL_ANSWER for session ${sessionId}.`);
        }
      }
    } catch (err) {
      console.error(`[AudioWS] Error handling connection for ${req.url}:`, err.message);
      ws.close(1011, "Internal Server Error");
    }
  }
  async resolveSessionDynamically(sessionId) {
    try {
      const sessionResult = await db.execute(sql`
        SELECT * FROM ve_sessions WHERE id = ${sessionId} LIMIT 1
      `);
      let sessionData = null;
      let isNewSession = false;
      let fromNumber = "";
      let toNumber = "";
      if (sessionResult.rows.length > 0) {
        sessionData = camelizeKeys(sessionResult.rows[0]);
        console.log(`[AudioWS] Found pre-registered session for ID: ${sessionId}`);
      } else {
        console.log(`[AudioWS] Inbound call detected. Querying FreeSWITCH for channel ${sessionId}...`);
        const nodesResult = await db.execute(sql`
          SELECT * FROM ve_freeswitch_nodes WHERE status = 'online' ORDER BY created_at ASC
        `);
        const nodes = camelizeKeys(nodesResult.rows);
        let fsVars = null;
        if (nodes.length > 0) {
          for (const node of nodes) {
            fsVars = await this.getChannelVariablesFromNode(node, sessionId);
            if (fsVars) break;
          }
        } else {
          const defaultNode = {
            eslHost: process.env.FREESWITCH_ESL_HOST || "127.0.0.1",
            eslPort: parseInt(process.env.FREESWITCH_ESL_PORT || "8021"),
            eslPassword: process.env.FREESWITCH_ESL_PASSWORD || "ClueCon"
          };
          fsVars = await this.getChannelVariablesFromNode(defaultNode, sessionId);
        }
        if (!fsVars) {
          console.warn(`[AudioWS] Could not retrieve channel variables from FreeSWITCH for ${sessionId}`);
          return null;
        }
        fromNumber = fsVars.callerIdNumber || "";
        toNumber = fsVars.destinationNumber || "";
        isNewSession = true;
      }
      let agentResult = null;
      let targetAgentId = null;
      if (sessionData) {
        if (sessionData.agentId) {
          targetAgentId = sessionData.agentId;
        } else if (sessionData.metadata) {
          try {
            const meta = typeof sessionData.metadata === "string" ? JSON.parse(sessionData.metadata) : sessionData.metadata;
            targetAgentId = meta?.agentId || null;
          } catch {
          }
        }
      }
      if (!targetAgentId && toNumber) {
        const cleanToNumber = toNumber.startsWith("+") ? toNumber.substring(1) : toNumber;
        const plusToNumber = toNumber.startsWith("+") ? toNumber : "+" + toNumber;
        let connResult = await db.execute(sql`
          SELECT agent_id FROM incoming_connections ic
          JOIN phone_numbers pn ON ic.phone_number_id = pn.id
          WHERE pn.phone_number = ${toNumber} OR pn.phone_number = ${cleanToNumber} OR pn.phone_number = ${plusToNumber} LIMIT 1
        `);
        if (connResult.rows.length > 0) {
          targetAgentId = connResult.rows[0].agent_id;
          console.log(`[AudioWS] Found incoming connection mapping for ${toNumber} -> agentId: ${targetAgentId}`);
        } else {
          connResult = await db.execute(sql`
            SELECT assigned_agent_id as agent_id FROM plivo_phone_numbers
            WHERE phone_number = ${toNumber} OR phone_number = ${cleanToNumber} OR phone_number = ${plusToNumber} LIMIT 1
          `);
          if (connResult.rows.length > 0 && connResult.rows[0].agent_id) {
            targetAgentId = connResult.rows[0].agent_id;
            console.log(`[AudioWS] Found Plivo incoming connection mapping for ${toNumber} -> agentId: ${targetAgentId}`);
          }
        }
      }
      if (targetAgentId) {
        agentResult = await db.execute(sql`
          SELECT * FROM ve_voice_agents WHERE id = ${targetAgentId} LIMIT 1
        `);
        if (agentResult.rows.length === 0) {
          agentResult = await db.execute(sql`
            SELECT * FROM agents WHERE id = ${targetAgentId} LIMIT 1
          `);
        }
      } else {
        if (toNumber) {
          agentResult = await db.execute(sql`
            SELECT * FROM ve_voice_agents 
            WHERE is_active = true AND (name = ${toNumber} OR description LIKE ${"%" + toNumber + "%"})
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
        if (!agentResult || agentResult.rows.length === 0) {
          if (isNewSession) {
            console.warn(`[AudioWS] Rejecting inbound call: no agent mapped or matched for destination number ${toNumber || "unknown"}`);
            for (const esl of this.eslConnections) {
              try {
                if (esl.isConnected()) {
                  await esl.api(`uuid_kill ${sessionId} CALL_REJECTED`);
                }
              } catch (err) {
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
        const spacedDigits = (fromNumber.startsWith("+") ? "plus " : "") + fromNumber.replace(/\+/g, "").split("").join(" ");
        agent.firstMessage = agent.firstMessage.replace(/\{\{(phone|phone_number)\}\}/gi, spacedDigits);
      }
      let flow = null;
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
          agent.type = "flow";
          agent.flowId = flow.id;
        }
      }
      if (!flow) {
        if (agent.type === "flow" && agent.flowId) {
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
          console.log(`[AudioWS] Agent ${agent.id} type is ${agent.type || "unknown"}, checking for active flow assigned to this agent`);
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
            agent.type = "flow";
            agent.flowId = flow.id;
          }
        }
      }
      if (agent.knowledgeBaseIds && agent.knowledgeBaseIds.length > 0) {
        agent.systemPrompt = `
\u26A0\uFE0F CRITICAL KNOWLEDGE BASE INSTRUCTION \u26A0\uFE0F
You have access to a knowledge base tool called "lookup_knowledge_base".
- When the user asks ANY question that might require information from the knowledge base, you MUST call the "lookup_knowledge_base" tool IMMEDIATELY.
- Do NOT say things like "I will search the knowledge base" or "Let me check" or "Let me look that up".
- Do NOT answer from memory if information could exist in the knowledge base.

${agent.systemPrompt || ""}`;
      }
      if (agent.endConversationEnabled) {
        agent.systemPrompt = `
\u26A0\uFE0F CRITICAL END CALL INSTRUCTION \u26A0\uFE0F
You have access to an "end_call" tool. 
- You MUST call this tool when the conversation naturally concludes, the user says goodbye, or requests to hang up.

${agent.systemPrompt || ""}`;
      }
      let tools = [];
      let toolMetadata = /* @__PURE__ */ new Map();
      if (flow?.compiledTools && Array.isArray(flow.compiledTools) && flow.compiledTools.length > 0) {
        console.log(`[AudioWS] Found ${flow.compiledTools.length} compiled tools in flow ${flow.id}`);
        for (const ct of flow.compiledTools) {
          if (ct.type === "function" && ct.function?.name) {
            const toolDef = {
              type: "function",
              function: {
                name: ct.function.name,
                description: ct.function.description || "",
                parameters: ct.function.parameters || {}
              }
            };
            tools.push(toolDef);
            const meta = ct._metadata || ct.Metadata || ct._metadata;
            if (meta) {
              toolMetadata.set(ct.function.name, meta);
            }
          }
        }
        console.log(`[AudioWS] Built ${tools.length} tool definitions for LLM`);
      }
      if (agent.knowledgeBaseIds && agent.knowledgeBaseIds.length > 0) {
        tools.push({
          type: "function",
          function: {
            name: "lookup_knowledge_base",
            description: "Search the knowledge base for relevant information to answer user questions. Use this when you need facts, policies, product details, pricing, or any specific information.",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string", description: "The specific search query to look up in the knowledge base." }
              },
              required: ["query"]
            }
          }
        });
        toolMetadata.set("lookup_knowledge_base", { knowledgeBaseIds: agent.knowledgeBaseIds });
        console.log(`[AudioWS] Added lookup_knowledge_base tool for ${agent.knowledgeBaseIds.length} KBs`);
      }
      if (agent.endConversationEnabled) {
        tools.push({
          type: "function",
          function: {
            name: "end_call",
            description: "End the conversation when the user says goodbye or the interaction is complete.",
            parameters: { type: "object", properties: {} }
          }
        });
        console.log(`[AudioWS] Added end_call tool`);
      }
      const userId = agent.userId;
      if (isNewSession) {
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
      }
      let apptSettingsText = "";
      try {
        const apptSettingsResult = await db.execute(sql`
          SELECT * FROM appointment_settings WHERE user_id = ${userId} LIMIT 1
        `);
        const apptSettings = apptSettingsResult.rows?.[0];
        if (apptSettings) {
          let workingDays = [];
          let workingHoursStart = "09:00";
          let workingHoursEnd = "17:00";
          if (apptSettings.working_hours) {
            const wh = typeof apptSettings.working_hours === "string" ? JSON.parse(apptSettings.working_hours) : apptSettings.working_hours;
            workingDays = Object.keys(wh).filter((day) => wh[day]?.enabled);
            for (const day of ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]) {
              if (wh[day]?.enabled) {
                workingHoursStart = wh[day].start || workingHoursStart;
                workingHoursEnd = wh[day].end || workingHoursEnd;
                break;
              }
            }
          }
          apptSettingsText = `
**Appointment Booking Availability & Settings:**
- Working Days (available for appointments): ${workingDays.length > 0 ? workingDays.join(", ") : "None"}
- Working Hours: ${workingHoursStart} to ${workingHoursEnd}
- Slot Buffer Time: ${apptSettings.buffer_minutes || 0} minutes
- Allow Overlapping Appointments: ${apptSettings.allow_overlapping ? "Yes" : "No"}
`;
        }
      } catch (apptErr) {
        console.warn(`[AudioWS] Failed to fetch appointment settings for user ${userId}:`, apptErr.message);
      }
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
      const globalSettingsMap = {};
      for (const row of globalSettingsResult.rows) {
        globalSettingsMap[row.key] = row.value;
      }
      let sttProvider = globalSettingsMap["ve_stt_active_provider"] || "deepgram";
      let sttApiKey = sttProvider === "sarvam" ? globalSettingsMap["ve_sarvam_api_key"] || process.env.SARVAM_API_KEY || "" : globalSettingsMap["ve_deepgram_api_key"] || process.env.DEEPGRAM_API_KEY || "";
      let sttModel = sttProvider === "sarvam" ? globalSettingsMap["ve_stt_sarvam_model"] || "saaras:v3" : globalSettingsMap["ve_stt_deepgram_model"] || "nova-2";
      let sttConfig = {};
      let llmProvider = globalSettingsMap["ve_llm_active_provider"] || "openrouter";
      let llmApiKey = globalSettingsMap["ve_openrouter_api_key"] || process.env.OPENROUTER_API_KEY || "";
      let llmModel = globalSettingsMap["ve_llm_default_model"] || "openai/gpt-4o-mini";
      let llmConfig = {};
      let ttsProvider = globalSettingsMap["ve_tts_active_provider"] || "deepgram";
      let ttsApiKey = ttsProvider === "sarvam" ? globalSettingsMap["ve_sarvam_api_key"] || process.env.SARVAM_API_KEY || "" : globalSettingsMap["ve_deepgram_api_key"] || process.env.DEEPGRAM_API_KEY || "";
      let ttsModel = ttsProvider === "sarvam" ? globalSettingsMap["ve_tts_sarvam_model"] || "bulbul:v3" : globalSettingsMap["ve_tts_deepgram_model"] || "aura-asteria-en";
      let ttsSpeaker = ttsProvider === "sarvam" ? globalSettingsMap["ve_tts_sarvam_speaker"] || "neha" : "";
      let ttsConfig = {};
      const providerConfigResult = await db.execute(sql`
        SELECT * FROM ve_provider_configs WHERE user_id = ${userId} LIMIT 1
      `);
      if (providerConfigResult.rows.length > 0) {
        const pc2 = camelizeKeys(providerConfigResult.rows[0]);
        sttProvider = pc2.sttProvider || sttProvider;
        sttApiKey = pc2.sttApiKey || sttApiKey;
        sttModel = pc2.sttModel || sttModel;
        sttConfig = pc2.sttConfig || {};
        llmProvider = pc2.llmProvider || llmProvider;
        llmApiKey = pc2.llmApiKey || llmApiKey;
        llmModel = pc2.llmModel || llmModel;
        llmConfig = pc2.llmConfig || {};
        ttsProvider = pc2.ttsProvider || ttsProvider;
        ttsApiKey = pc2.ttsApiKey || ttsApiKey;
        ttsModel = pc2.ttsVoice || ttsModel;
        ttsConfig = pc2.ttsConfig || {};
      }
      const effectiveSttProvider = agent.sttProvider || agent.config?.sttProvider || sttProvider;
      const effectiveTtsProvider = agent.ttsProvider || agent.config?.ttsProvider || ttsProvider;
      const resolvedSttApiKey = effectiveSttProvider === "sarvam" ? globalSettingsMap["ve_sarvam_api_key"] || process.env.SARVAM_API_KEY || "" : globalSettingsMap["ve_deepgram_api_key"] || process.env.DEEPGRAM_API_KEY || "";
      const providerConfig = providerConfigResult.rows.length > 0 ? camelizeKeys(providerConfigResult.rows[0]) : null;
      const finalSttApiKey = providerConfig && providerConfig.sttProvider === effectiveSttProvider && providerConfig.sttApiKey ? providerConfig.sttApiKey : resolvedSttApiKey;
      const resolvedTtsApiKey = effectiveTtsProvider === "sarvam" ? globalSettingsMap["ve_sarvam_api_key"] || process.env.SARVAM_API_KEY || "" : globalSettingsMap["ve_deepgram_api_key"] || process.env.DEEPGRAM_API_KEY || "";
      const finalTtsApiKey = providerConfig && providerConfig.ttsProvider === effectiveTtsProvider && providerConfig.ttsApiKey ? providerConfig.ttsApiKey : resolvedTtsApiKey;
      console.log(`[AudioWS] Provider config resolved \u2014 STT: ${effectiveSttProvider}, TTS: ${effectiveTtsProvider}, LLM: ${llmProvider}`);
      const pc = providerConfigResult.rows.length > 0 ? camelizeKeys(providerConfigResult.rows[0]) : null;
      const finalSttModel = pc && pc.sttProvider === effectiveSttProvider && pc.sttModel ? pc.sttModel : effectiveSttProvider === "sarvam" ? globalSettingsMap["ve_stt_sarvam_model"] || "saaras:v3" : globalSettingsMap["ve_stt_deepgram_model"] || "nova-2";
      const finalTtsModel = effectiveTtsProvider === "sarvam" ? globalSettingsMap["ve_tts_sarvam_model"] || "bulbul:v3" : pc && pc.ttsProvider === effectiveTtsProvider && pc.ttsVoice ? pc.ttsVoice : globalSettingsMap["ve_tts_deepgram_model"] || "aura-asteria-en";
      const finalTtsSpeaker = pc && pc.ttsProvider === effectiveTtsProvider && pc.ttsVoice && effectiveTtsProvider === "sarvam" ? pc.ttsVoice : pc && pc.ttsProvider === effectiveTtsProvider && pc.ttsConfig?.sarvamSpeaker ? pc.ttsConfig.sarvamSpeaker : effectiveTtsProvider === "sarvam" ? globalSettingsMap["ve_tts_sarvam_speaker"] || "neha" : "";
      const sttConfigObj = {
        provider: effectiveSttProvider,
        apiKey: finalSttApiKey,
        language: agent.language || "en",
        model: agent.sttModel || finalSttModel,
        deepgramModel: agent.sttModel || finalSttModel,
        // Backward compatibility
        sarvamModel: agent.sttModel || finalSttModel,
        // Backward compatibility
        detectLanguage: agent.detectLanguageEnabled || false,
        ...sttConfig
      };
      const isOutbound = sessionData?.direction === "outbound";
      const rawCustomerPhone = isOutbound ? sessionData?.toNumber || toNumber || "" : sessionData?.fromNumber || fromNumber || "";
      const customerPhone = (rawCustomerPhone.startsWith("+") ? "plus " : "") + rawCustomerPhone.replace(/\+/g, "").split("").join(" ");
      const today = /* @__PURE__ */ new Date();
      const dateContext = `

[SYSTEM CONTEXT]
- Current Date and Time: ${today.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })} (IST)
- Today is a: ${today.toLocaleDateString("en-US", { weekday: "long", timeZone: "Asia/Kolkata" })}
- ISO Date: ${today.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })}
- Always interpret relative dates (like "today", "tomorrow", "this Sunday", "next Monday") based on this current date.
${customerPhone ? `- Customer's Phone Number (the number they are using for this call): ${customerPhone}
- IF the customer says "use my own number", "same number", "use the number I am calling from", "use the number you called", or similar, do NOT ask them to repeat or say it. You already have it. Simply confirm it with them: "So you want to use ${customerPhone}, is that correct?" and then proceed.` : ""}
${agent.detectLanguageEnabled ? `- Dynamic Language Switching: If the customer speaks to you in Hindi, Tamil, Telugu, Kannada, or any language other than English, you MUST immediately switch your response and speak ONLY in that same language. Do not speak English if they speak to you in a different language.` : ""}
${apptSettingsText}`;
      const langDisplayNames = new Intl.DisplayNames(["en"], { type: "language" });
      const agentLanguage = agent.language || "en";
      const languageName = langDisplayNames.of(agentLanguage) || agentLanguage;
      let systemPrompt = agent.systemPrompt || "";
      systemPrompt = systemPrompt.replace(/#{0,2}\s*CRITICAL LANGUAGE REQUIREMENT[\s\S]*?(?=\n\n|$)/g, "").trim();
      systemPrompt += dateContext;
      if (agentLanguage !== "en") {
        systemPrompt += `

## CRITICAL LANGUAGE REQUIREMENT (FINAL OVERRIDE)
You MUST speak ONLY in ${languageName}. From the very first word you say, speak in ${languageName}. Do NOT speak English or any other language. This overrides any previous language instructions in this prompt. This is mandatory.`;
      }
      const llmConfigObj = {
        provider: llmProvider,
        apiKey: llmApiKey,
        model: agent.llmModel || llmModel,
        temperature: agent.temperature || 0.7,
        maxTokens: agent.maxTokens || 500,
        systemPrompt,
        ...llmConfig
      };
      let resolvedTtsVoice;
      let resolvedSarvamSpeaker;
      if (effectiveTtsProvider === "sarvam") {
        const agentSpeaker = agent.ttsVoice && !agent.ttsVoice.startsWith("aura-") ? agent.ttsVoice : agent.openaiVoice && !agent.openaiVoice.startsWith("aura-") ? agent.openaiVoice : null;
        resolvedSarvamSpeaker = agentSpeaker || finalTtsSpeaker || "neha";
        resolvedTtsVoice = resolvedSarvamSpeaker;
      } else {
        const agentDeepgramVoice = agent.ttsVoice && agent.ttsVoice.startsWith("aura-") ? agent.ttsVoice : agent.openaiVoice && agent.openaiVoice.startsWith("aura-") ? agent.openaiVoice : null;
        resolvedTtsVoice = agentDeepgramVoice || finalTtsModel;
        resolvedSarvamSpeaker = "";
      }
      const ttsConfigObj = {
        provider: effectiveTtsProvider,
        apiKey: finalTtsApiKey,
        voice: resolvedTtsVoice,
        language: agent.language || "en",
        deepgramModel: resolvedTtsVoice,
        sarvamModel: agent.ttsModel || finalTtsModel,
        sarvamSpeaker: resolvedSarvamSpeaker,
        outputFormat: {
          encoding: "linear16",
          sampleRate: 8e3,
          channels: 1,
          bitDepth: 16
        },
        ...ttsConfig
      };
      const audioSession = new AudioSession(
        sessionId,
        sessionData,
        agent,
        sttConfigObj,
        llmConfigObj,
        ttsConfigObj,
        void 0,
        tools,
        toolMetadata
      );
      this.setupDatabaseSync(audioSession);
      this.registerSession(audioSession);
      return audioSession;
    } catch (err) {
      console.error(`[AudioWS] Failed to resolve session ${sessionId} dynamically:`, err.message);
      return null;
    }
  }
  async getChannelVariablesFromNode(node, channelUuid) {
    const existingEsl = this.eslConnections.find(
      (e) => e.config.host === node.eslHost && e.config.port === node.eslPort && e.isConnected()
    );
    if (existingEsl) {
      try {
        let destinationNumber = await existingEsl.getVariable(channelUuid, "destination_number");
        let callerIdNumber = await existingEsl.getVariable(channelUuid, "caller_id_number");
        if (destinationNumber === "_undef_") destinationNumber = void 0;
        if (callerIdNumber === "_undef_") callerIdNumber = void 0;
        return { destinationNumber, callerIdNumber };
      } catch (err) {
        console.warn(`[AudioWS] Failed to get variables using existing connection to ${node.eslHost}:`, err.message);
      }
    }
    const esl = new EslConnection({
      host: node.eslHost,
      port: node.eslPort,
      password: node.eslPassword,
      reconnect: false
    });
    esl.on("error", (err) => {
      console.error("[ESL] Client error during channel variables retrieval:", err.message);
    });
    try {
      await esl.connect();
      let destinationNumber = await esl.getVariable(channelUuid, "destination_number");
      let callerIdNumber = await esl.getVariable(channelUuid, "caller_id_number");
      await esl.disconnect();
      if (destinationNumber === "_undef_") destinationNumber = void 0;
      if (callerIdNumber === "_undef_") callerIdNumber = void 0;
      return { destinationNumber, callerIdNumber };
    } catch (err) {
      console.error(`[AudioWS] Failed to get variables on ${node.eslHost}:${node.eslPort}:`, err.message);
      try {
        await esl.disconnect();
      } catch {
      }
      return null;
    }
  }
  setupDatabaseSync(session) {
    const saveSession = async () => {
      try {
        const sess = session.getSession();
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
      } catch (err) {
        console.error(`[AudioWS] Failed to save session ${session.id} to DB:`, err.message);
      }
    };
    session.on("statusChange", async (status) => {
      if (status === "completed" || session.getSession().status === "completed") {
        try {
          const sess = session.getSession();
          const duration = sess.durationSeconds || 0;
          if (duration > 0) {
            const creditPriceResult = await db.execute(sql`
              SELECT value FROM global_settings WHERE key = 'credit_price_per_minute' LIMIT 1
            `);
            const creditPriceSetting = creditPriceResult.rows?.[0];
            let creditPricePerMinute = 1;
            if (creditPriceSetting?.value) {
              const parsed = Number(creditPriceSetting.value);
              if (Number.isFinite(parsed) && parsed >= 0) {
                creditPricePerMinute = parsed;
              }
            }
            const minutes = Math.ceil(duration / 60);
            const creditsToDeduct = Math.ceil(minutes * creditPricePerMinute);
            const deductCallCredits = global.deductCallCredits;
            if (!deductCallCredits) {
              throw new Error("deductCallCredits is not registered globally");
            }
            const creditResult = await deductCallCredits({
              userId: sess.userId,
              creditsToDeduct,
              callId: session.id,
              fromNumber: sess.fromNumber || "Unknown",
              toNumber: sess.toNumber || "Unknown",
              durationSeconds: duration,
              engine: "custom-voice-engine"
            });
            if (creditResult.success || creditResult.alreadyDeducted) {
              session.session.creditsUsed = creditsToDeduct;
              console.log(`[AudioWS] Deducted ${creditsToDeduct} credits for custom-voice-engine session ${session.id}`);
            }
          }
        } catch (creditErr) {
          console.error(`[AudioWS] Failed to deduct credits for session ${session.id}:`, creditErr.message);
        }
      }
      await saveSession();
      if (status === "completed" || session.getSession().status === "completed") {
        try {
          let CRMLeadProcessor = global.CRMLeadProcessor;
          if (!CRMLeadProcessor) {
            const module = await import("../../../../server/engines/crm/lead-processor.service.js");
            CRMLeadProcessor = module.CRMLeadProcessor;
          }
          await CRMLeadProcessor.processCustomVoiceEngineCall(session.id);
        } catch (err) {
          console.error(`[AudioWS] Failed to process lead generation for session ${session.id}:`, err.message);
        }
      }
    });
    session.on("callAnswered", async () => {
      console.log(`[AudioWS] Session ${session.id} marked as answered, syncing to DB.`);
      await saveSession();
    });
    session.on("pipelineEvent", async (event) => {
      if (event.type === "stt_transcript" && event.transcript.isFinal || event.type === "llm_response" || event.type === "session_end") {
        await saveSession();
      }
    });
  }
}
export {
  AudioWebSocketServer
};
