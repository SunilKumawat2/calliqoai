/**
 * ============================================================
 * FreeSWITCH ESL Connection Manager
 *
 * Manages connections to FreeSWITCH via Event Socket Library.
 * Uses a TCP socket to send commands and receive events.
 *
 * ESL Protocol:
 * - Inbound connection (our app connects to FreeSWITCH)
 * - Sends commands: api, bgapi, execute, etc.
 * - Receives events: CHANNEL_CREATE, CHANNEL_ANSWER, etc.
 * ============================================================
 */

import { Socket } from 'net';
import { EventEmitter } from 'events';
import type { FreeSwitchEvent, EslCommand } from '../../types';

interface EslConfig {
  host: string;
  port: number;
  password: string;
  reconnect?: boolean;
  reconnectIntervalMs?: number;
  maxReconnectAttempts?: number;
}

export class EslConnection extends EventEmitter {
  private socket: Socket | null = null;
  private config: EslConfig;
  private connected = false;
  private authenticated = false;
  private reconnecting = false;
  private expectedDiscards = 0;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private buffer = '';
  private pendingCommands: Array<{
    resolve: (value: string) => void;
    reject: (err: Error) => void;
  }> = [];

  constructor(config: EslConfig) {
    super();
    this.config = {
      reconnect: true,
      reconnectIntervalMs: 5000,
      maxReconnectAttempts: 10,
      ...config,
    };
  }

  /**
   * Connect to FreeSWITCH ESL
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = new Socket();
      this.socket.setEncoding('utf8');

      const timeout = setTimeout(() => {
        this.off('ready', onReady);
        this.off('error', onError);
        reject(new Error(`ESL connection timeout to ${this.config.host}:${this.config.port}`));
        this.socket?.destroy();
      }, 10000);

      const onReady = () => {
        clearTimeout(timeout);
        this.off('error', onError);
        resolve();
      };

      const onError = (err: Error) => {
        clearTimeout(timeout);
        this.off('ready', onReady);
        reject(err);
      };

      this.once('ready', onReady);
      this.once('error', onError);

      this.socket.on('connect', () => {
        console.log(`[ESL] Socket connected to ${this.config.host}:${this.config.port}, waiting for authentication...`);
      });

      this.socket.on('data', (data: string) => {
        this.buffer += data;
        this.processBuffer();
      });

      this.socket.on('error', (err) => {
        console.error('[ESL] Socket error:', err.message);
        this.emit('error', err);
      });

      this.socket.on('close', () => {
        const wasAuthenticated = this.authenticated;
        this.connected = false;
        this.authenticated = false;
        console.log('[ESL] Connection closed');
        this.emit('disconnect');

        if (!wasAuthenticated) {
          this.emit('error', new Error(`ESL connection to ${this.config.host}:${this.config.port} closed before authentication completed — check ESL password and FreeSWITCH ESL config`));
        }

        if (this.config.reconnect && !this.reconnecting) {
          this.scheduleReconnect();
        }
      });

      this.socket.connect(this.config.port, this.config.host);
    });
  }

  /**
   * Send an API command to FreeSWITCH
   */
  async api(command: string): Promise<string> {
    return this.sendCommand(`api ${command}`);
  }

  /**
   * Send a background API command
   */
  async bgapi(command: string): Promise<string> {
    return this.sendCommand(`bgapi ${command}`);
  }

  /**
   * Execute an application on a channel
   */
  async execute(uuid: string, app: string, arg?: string): Promise<string> {
    const cmd = arg
      ? `sendmsg ${uuid}\ncall-command: execute\nexecute-app-name: ${app}\nexecute-app-arg: ${arg}`
      : `sendmsg ${uuid}\ncall-command: execute\nexecute-app-name: ${app}`;
    return this.sendCommand(cmd);
  }

  /**
   * Originate an outbound call
   */
  async originate(
    dialString: string,
    destination: string,
    options: Record<string, string> = {}
  ): Promise<string> {
    const vars = Object.entries(options)
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    const varsStr = vars ? `{${vars}}` : '';
    return this.bgapi(`originate ${varsStr}${dialString} ${destination}`);
  }

  /**
   * Start audio forking on a channel (sends audio to WebSocket)
   */
  async startAudioFork(uuid: string, wsUrl: string): Promise<string> {
    return this.execute(uuid, 'audio_fork', wsUrl);
  }

  /**
   * Stop audio forking on a channel
   */
  async stopAudioFork(uuid: string): Promise<string> {
    return this.execute(uuid, 'stop_audio_fork');
  }

  /**
   * Hang up a channel
   */
  async hangup(uuid: string, cause?: string): Promise<string> {
    return this.api(`uuid_kill ${uuid} ${cause || 'NORMAL_CLEARING'}`);
  }

  /**
   * Get channel variable
   */
  async getVariable(uuid: string, variable: string): Promise<string> {
    return this.api(`uuid_getvar ${uuid} ${variable}`);
  }

  /**
   * Set channel variable
   */
  async setVariable(uuid: string, variable: string, value: string): Promise<string> {
    return this.api(`uuid_setvar ${uuid} ${variable} ${value}`);
  }

  /**
   * Get active channel count
   */
  async getActiveChannelCount(): Promise<number> {
    const result = await this.api('show calls count');
    const match = result.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * Disconnect from FreeSWITCH
   */
  async disconnect(): Promise<void> {
    this.config.reconnect = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }

    this.connected = false;
    this.authenticated = false;
    console.log('[ESL] Disconnected');
  }

  isConnected(): boolean {
    return this.connected && this.authenticated;
  }

  // ── Private Methods ────────────────────────────────────

  private async sendCommand(command: string): Promise<string> {
    if (!this.connected || !this.socket) {
      throw new Error('ESL not connected');
    }

    return new Promise((resolve, reject) => {
      this.pendingCommands.push({ resolve, reject });
      this.sendRaw(`${command}\n\n`);

      // Timeout for command response
      setTimeout(() => {
        const idx = this.pendingCommands.findIndex((p) => p.resolve === resolve);
        if (idx !== -1) {
          this.pendingCommands.splice(idx, 1);
          reject(new Error(`ESL command timeout: ${command.split('\n')[0]}`));
        }
      }, 15000);
    });
  }

  private sendRaw(data: string): void {
    if (this.socket && !this.socket.destroyed) {
      this.socket.write(data);
    }
  }

  private processBuffer(): void {
    // Trim any leading whitespace/newlines
    this.buffer = this.buffer.trimStart();

    while (true) {
      // Find the end of the headers (\n\n)
      const headerEndIndex = this.buffer.indexOf('\n\n');
      if (headerEndIndex === -1) break; // Incomplete headers

      const headerPart = this.buffer.substring(0, headerEndIndex);

      // Parse headers to find Content-Length
      const headers: Record<string, string> = {};
      const lines = headerPart.split('\n');
      for (const line of lines) {
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
          const key = line.substring(0, colonIdx).trim();
          const value = line.substring(colonIdx + 1).trim();
          headers[key] = decodeURIComponent(value);
        }
      }

      const contentLength = headers['Content-Length'] ? parseInt(headers['Content-Length'], 10) : 0;
      const totalMessageLength = headerEndIndex + 2 + contentLength;

      if (this.buffer.length < totalMessageLength) {
        break; // Incomplete body
      }

      // We have the complete message (headers + body)
      const body = this.buffer.substring(headerEndIndex + 2, headerEndIndex + 2 + contentLength);

      // Advance buffer
      this.buffer = this.buffer.substring(totalMessageLength).trimStart();

      this.processMessage(headers, body);
    }
  }

  private processMessage(headers: Record<string, string>, body: string): void {
    const contentType = headers['Content-Type'];
    // Only log key lifecycle events, not every header frame

    // Handle initial auth challenge
    if (contentType === 'auth/request') {
      this.sendRaw(`auth ${this.config.password}\n\n`);
      return;
    }

    // Handle API responses / command replies
    if (contentType === 'api/response' || contentType === 'command/reply') {
      const replyText = headers['Reply-Text'] || body.trim();

      // If we are not authenticated yet, this is our auth response!
      if (!this.authenticated) {
        if (replyText.startsWith('+OK accepted')) {
          this.authenticated = true;
          this.connected = true;
          this.reconnectAttempts = 0;

          // Subscribe to relevant events
          this.sendRaw('event plain CHANNEL_CREATE CHANNEL_ANSWER CHANNEL_HANGUP CHANNEL_DESTROY\n\n');
          this.sendRaw('event plain CUSTOM mod_audio_fork::play_audio\n\n');
          this.expectedDiscards = 2;

          console.log('[ESL] Authenticated successfully, waiting for subscription confirmations...');
        } else if (replyText.startsWith('-ERR')) {
          const err = new Error(`ESL authentication failed: ${replyText}`);
          this.emit('error', err);
          this.socket?.destroy();
        } else {
          const err = new Error(`ESL auth reply unexpected: ${replyText}`);
          this.emit('error', err);
          this.socket?.destroy();
        }
        return;
      }

      if (this.expectedDiscards > 0) {
        this.expectedDiscards--;
        if (this.expectedDiscards === 0) {
          console.log('[ESL] Subscription confirmations received, connection ready');
          this.emit('ready');
        }
        return;
      }

      const pending = this.pendingCommands.shift();
      if (pending) {
        if (replyText.startsWith('-ERR')) {
          pending.reject(new Error(replyText));
        } else {
          pending.resolve(body.trim() || replyText);
        }
      }
      return;
    }

    // Handle events
    if (contentType === 'text/event-plain') {
      const eventHeaders: Record<string, string> = {};
      const lines = body.split('\n');
      let eventBody = '';
      let inEventBody = false;

      for (const line of lines) {
        if (inEventBody) {
          eventBody += line + '\n';
          continue;
        }
        if (line.trim() === '') {
          inEventBody = true;
          continue;
        }
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
          const key = line.substring(0, colonIdx).trim();
          const value = line.substring(colonIdx + 1).trim();
          eventHeaders[key] = decodeURIComponent(value);
        }
      }

      const event: FreeSwitchEvent = {
        eventName: eventHeaders['Event-Name'] || 'UNKNOWN',
        eventSubclass: eventHeaders['Event-Subclass'],
        headers: eventHeaders,
        body: eventBody.trim() || undefined,
      };

      // Only log key channel lifecycle events (not noisy CUSTOM/play_audio events)
      const keyEvents = ['CHANNEL_CREATE', 'CHANNEL_ANSWER', 'CHANNEL_HANGUP', 'CHANNEL_DESTROY'];
      if (keyEvents.includes(event.eventName)) {
        console.log(`[ESL] Received event: ${event.eventName}`);
      }
      this.emit('event', event);
      this.emit(`event:${event.eventName}`, event);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= (this.config.maxReconnectAttempts || 10)) {
      console.error('[ESL] Max reconnect attempts reached');
      this.emit('maxReconnectAttempts');
      return;
    }

    this.reconnecting = true;
    this.reconnectAttempts++;

    const delay = this.config.reconnectIntervalMs || 5000;
    console.log(`[ESL] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
        this.reconnecting = false;
      } catch (err: any) {
        console.error('[ESL] Reconnect failed:', err.message);
        this.reconnecting = false;
        this.scheduleReconnect();
      }
    }, delay);
  }
}
