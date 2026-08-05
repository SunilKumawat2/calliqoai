/**
 * ============================================================
 * FreeSWITCH Health Monitor
 *
 * Periodically checks FreeSWITCH node health via ESL
 * and updates status in the database.
 * ============================================================
 */

import { EslConnection } from './esl-connection';
import type { FreeSwitchNode, FreeSwitchNodeStatus } from '../../types';
import os from 'os';

function getContainerIp(): string {
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
}

interface HealthCheckResult {
  nodeId: string;
  status: FreeSwitchNodeStatus;
  activeCalls: number;
  uptime?: number;
  version?: string;
  errorMessage?: string;
  latencyMs: number;
}

export class FreeSwitchHealthMonitor {
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private connections: Map<string, EslConnection> = new Map();

  constructor(private intervalMs: number = 30000) {}

  /**
   * Check health of a single FreeSWITCH node
   */
  async checkNode(node: FreeSwitchNode): Promise<HealthCheckResult> {
    const startTime = Date.now();
    let esl: EslConnection | null = null;

    try {
      esl = new EslConnection({
        host: node.eslHost,
        port: node.eslPort,
        password: node.eslPassword,
        reconnect: false,
      });

      // Register error handler to prevent uncaught exceptions
      esl.on('error', (err) => {
        console.error('[ESL] Client error during health check:', err.message);
      });

      await esl.connect();

      // Set the dynamic WebSocket URL as a global variable in FreeSWITCH
      const containerIp = getContainerIp();
      if (containerIp !== '127.0.0.1') {
        const wsUrl = `ws://${containerIp}:${process.env.PORT || '5000'}/voice-engine/ws/audio`;
        try {
          await esl.api(`global_setvar ve_audio_ws_url ${wsUrl}`);
          console.log(`[FreeSWITCH Health] Updated global ve_audio_ws_url to ${wsUrl} on node ${node.name}`);
        } catch (setvarErr: any) {
          console.warn(`[FreeSWITCH Health] Failed to set ve_audio_ws_url on node ${node.name}:`, setvarErr.message);
        }
      }

      // Get active call count
      const activeCalls = await esl.getActiveChannelCount();

      // Get uptime
      let uptime: number | undefined;
      try {
        const uptimeResult = await esl.api('uptime');
        const match = uptimeResult.match(/(\d+)/);
        if (match) uptime = parseInt(match[1], 10);
      } catch { /* optional */ }

      // Get version
      let version: string | undefined;
      try {
        const versionResult = await esl.api('version');
        version = versionResult.trim();
      } catch { /* optional */ }

      await esl.disconnect();

      const latencyMs = Date.now() - startTime;
      const status: FreeSwitchNodeStatus =
        activeCalls >= node.maxCalls * 0.9 ? 'degraded' : 'online';

      return {
        nodeId: node.id,
        status,
        activeCalls,
        uptime,
        version,
        latencyMs,
      };
    } catch (err: any) {
      if (esl) {
        try { await esl.disconnect(); } catch { /* ignore */ }
      }

      return {
        nodeId: node.id,
        status: 'offline',
        activeCalls: 0,
        errorMessage: err.message,
        latencyMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Check health of all registered nodes
   */
  async checkAllNodes(nodes: FreeSwitchNode[]): Promise<HealthCheckResult[]> {
    const results = await Promise.allSettled(
      nodes.map((node) => this.checkNode(node))
    );

    return results.map((result, idx) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      return {
        nodeId: nodes[idx].id,
        status: 'offline' as FreeSwitchNodeStatus,
        activeCalls: 0,
        errorMessage: (result.reason as Error)?.message || 'Unknown error',
        latencyMs: 0,
      };
    });
  }

  /**
   * Select the best node for a new call (least loaded)
   */
  selectNode(nodes: FreeSwitchNode[]): FreeSwitchNode | null {
    const onlineNodes = nodes.filter(
      (n) => n.status === 'online' && n.activeCalls < n.maxCalls
    );

    if (onlineNodes.length === 0) return null;

    // Sort by load (active calls / max calls ratio)
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
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    for (const [, esl] of this.connections) {
      esl.disconnect().catch(() => {});
    }
    this.connections.clear();
  }
}
