import WebSocket from "ws";
import { BaseSttProvider } from "./stt-provider.interface.js";
const DEEPGRAM_WS_URL = "wss://api.deepgram.com/v1/listen";
class DeepgramSttProvider extends BaseSttProvider {
  name = "deepgram";
  ws = null;
  reconnectAttempts = 0;
  maxReconnectAttempts = 5;
  keepAliveInterval = null;
  isClosing = false;
  async connect(config, format) {
    this.config = config;
    this.format = format;
    this.isClosing = false;
    return this.createConnection();
  }
  async createConnection() {
    if (!this.config || !this.format) throw new Error("Configuration missing");
    const paramsObj = {
      model: this.config.model || this.config.deepgramModel || "nova-2",
      encoding: this.mapEncoding(this.format.encoding),
      sample_rate: String(this.format.sampleRate),
      channels: String(this.format.channels),
      punctuate: String(this.config.punctuate ?? true),
      interim_results: String(this.config.interimResults ?? true),
      endpointing: String(this.config.endpointing ?? 300),
      utterance_end_ms: "1000",
      vad_events: "true",
      smart_format: "true"
    };
    paramsObj.language = this.mapLanguage(this.config.language || "en");
    const params = new URLSearchParams(paramsObj);
    const url = `${DEEPGRAM_WS_URL}?${params.toString()}`;
    console.log(`[STT:Deepgram] Connecting to URL: ${url.replace(this.config.apiKey, "***")}`);
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url, {
        headers: {
          Authorization: `Token ${this.config.apiKey}`
        }
      });
      this.ws.on("unexpected-response", (req, res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          console.error(`[STT:Deepgram] HTTP 400 Response Body from Deepgram: ${body}`);
        });
      });
      const timeout = setTimeout(() => {
        if (!this.connected) {
          reject(new Error("Deepgram connection timeout"));
          this.ws?.close();
        }
      }, 1e4);
      this.ws.on("open", () => {
        clearTimeout(timeout);
        this.connected = true;
        this.reconnectAttempts = 0;
        console.log("[STT:Deepgram] WebSocket connected");
        this.keepAliveInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: "KeepAlive" }));
          }
        }, 8e3);
        resolve();
      });
      this.ws.on("message", (data) => {
        try {
          const response = JSON.parse(data.toString());
          this.handleResponse(response);
        } catch (err) {
          console.error("[STT:Deepgram] Failed to parse response:", err);
        }
      });
      this.ws.on("error", (err) => {
        clearTimeout(timeout);
        console.error("[STT:Deepgram] WebSocket error:", err);
        if (!this.connected) reject(err);
      });
      this.ws.on("close", (code, reason) => {
        clearTimeout(timeout);
        const wasConnected = this.connected;
        this.connected = false;
        if (this.keepAliveInterval) {
          clearInterval(this.keepAliveInterval);
          this.keepAliveInterval = null;
        }
        if (wasConnected && !this.isClosing && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const delay = Math.pow(2, this.reconnectAttempts) * 1e3;
          console.log(`[STT:Deepgram] Unexpected close (code ${code}), reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
          setTimeout(() => this.createConnection().catch((err) => {
            console.error(`[STT:Deepgram] Reconnect attempt ${this.reconnectAttempts} failed:`, err.message);
          }), delay);
        }
      });
    });
  }
  sendAudio(chunk) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(chunk);
    }
  }
  async close() {
    this.isClosing = true;
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "CloseStream" }));
        await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            this.ws?.terminate();
            resolve();
          }, 2e3);
          this.ws.once("close", () => {
            clearTimeout(timeout);
            resolve();
          });
          this.ws.close();
        });
      }
      this.ws = null;
    }
    this.connected = false;
    this.transcriptCallbacks = [];
    this.errorCallbacks = [];
  }
  handleResponse(response) {
    if (response.type === "Results") {
      const result = response;
      const channel = result.channel;
      if (!channel?.alternatives?.length) return;
      const alt = channel.alternatives[0];
      if (!alt.transcript) return;
      const words = (alt.words || []).map((w) => ({
        word: w.punctuated_word || w.word,
        start: w.start,
        end: w.end,
        confidence: w.confidence
      }));
      this.emitTranscript({
        text: alt.transcript,
        isFinal: result.is_final,
        confidence: alt.confidence,
        words,
        duration: result.duration * 1e3
      });
    } else if (response.type === "UtteranceEnd") {
      this.emitTranscript({ text: "", isFinal: true, confidence: 1, duration: 0 });
    } else if (response.type === "Error") {
      this.emitError(new Error(`Deepgram error: ${response.message || JSON.stringify(response)}`));
    }
  }
  mapEncoding(encoding) {
    switch (encoding) {
      case "linear16":
        return "linear16";
      case "mulaw":
        return "mulaw";
      case "alaw":
        return "alaw";
      case "opus":
        return "opus";
      default:
        return "linear16";
    }
  }
  mapLanguage(lang) {
    if (!lang) return "en";
    const baseLang = lang.split(/[-_]/)[0].toLowerCase();
    const validCodes = ["en", "hi", "ta", "te", "kn", "ml", "mr", "gu", "bn", "pa", "es", "fr", "de"];
    if (validCodes.includes(baseLang)) {
      return baseLang;
    }
    return baseLang || "en";
  }
}
export {
  DeepgramSttProvider
};
