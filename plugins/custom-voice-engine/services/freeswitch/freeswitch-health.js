import { EslConnection } from "./esl-connection.js";
import os from "os";
function getContainerIp() {
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
}
class FreeSwitchHealthMonitor {
  constructor(intervalMs = 3e4) {
    this.intervalMs = intervalMs;
  }
  checkInterval = null;
  connections = /* @__PURE__ */ new Map();
  /**
   * Check health of a single FreeSWITCH node
   */
  async checkNode(node) {
    const startTime = Date.now();
    let esl = null;
    try {
      esl = new EslConnection({
        host: node.eslHost,
        port: node.eslPort,
        password: node.eslPassword,
        reconnect: false
      });
      esl.on("error", (err) => {
        console.error("[ESL] Client error during health check:", err.message);
      });
      await esl.connect();
      const wsUrl = `wss://calliqoai.com/voice-engine/ws/audio`;
      try {
        await esl.api(`global_setvar ve_audio_ws_url ${wsUrl}`);
        console.log(`[FreeSWITCH Health] Updated global ve_audio_ws_url to ${wsUrl} on node ${node.name}`);
      } catch (setvarErr) {
        console.warn(`[FreeSWITCH Health] Failed to set ve_audio_ws_url on node ${node.name}:`, setvarErr.message);
      }
      const activeCalls = await esl.getActiveChannelCount();
      let uptime;
      try {
        const uptimeResult = await esl.api("uptime");
        const match = uptimeResult.match(/(\d+)/);
        if (match) uptime = parseInt(match[1], 10);
      } catch {
      }
      let version;
      try {
        const versionResult = await esl.api("version");
        version = versionResult.trim();
      } catch {
      }
      await esl.disconnect();
      const latencyMs = Date.now() - startTime;
      const status = activeCalls >= node.maxCalls * 0.9 ? "degraded" : "online";
      return {
        nodeId: node.id,
        status,
        activeCalls,
        uptime,
        version,
        latencyMs
      };
    } catch (err) {
      if (esl) {
        try {
          await esl.disconnect();
        } catch {
        }
      }
      return {
        nodeId: node.id,
        status: "offline",
        activeCalls: 0,
        errorMessage: err.message,
        latencyMs: Date.now() - startTime
      };
    }
  }
  /**
   * Check health of all registered nodes
   */
  async checkAllNodes(nodes) {
    const results = await Promise.allSettled(
      nodes.map((node) => this.checkNode(node))
    );
    return results.map((result, idx) => {
      if (result.status === "fulfilled") {
        return result.value;
      }
      return {
        nodeId: nodes[idx].id,
        status: "offline",
        activeCalls: 0,
        errorMessage: result.reason?.message || "Unknown error",
        latencyMs: 0
      };
    });
  }
  /**
   * Select the best node for a new call (least loaded)
   */
  selectNode(nodes) {
    const onlineNodes = nodes.filter(
      (n) => n.status === "online" && n.activeCalls < n.maxCalls
    );
    if (onlineNodes.length === 0) return null;
    onlineNodes.sort((a, b) => {
      const loadA = a.activeCalls / a.maxCalls;
      const loadB = b.activeCalls / b.maxCalls;
      return loadA - loadB;
    });
    return onlineNodes[0];
  }
  /**
   * Stop periodic health checks
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    for (const [, esl] of this.connections) {
      esl.disconnect().catch(() => {
      });
    }
    this.connections.clear();
  }
}
export {
  FreeSwitchHealthMonitor
};
