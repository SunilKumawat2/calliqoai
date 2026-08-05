import axios from "axios";
import { BaseTtsProvider } from "./tts-provider.interface.js";
import { keepAliveAxiosConfig } from "../http-agent.js";
const DEEPGRAM_TTS_URL = "https://api.deepgram.com/v1/speak";
class DeepgramTtsProvider extends BaseTtsProvider {
  name = "deepgram";
  async synthesize(text, config) {
    let model = config.voice || config.deepgramModel || "aura-asteria-en";
    if (model === "aura-2") model = "aura-2-asteria-en";
    if (model === "aura") model = "aura-asteria-en";
    const params = new URLSearchParams({
      model
    });
    const encoding = config.outputFormat?.encoding || "linear16";
    const sampleRate = config.outputFormat?.sampleRate || 8e3;
    if (encoding === "linear16") {
      params.set("encoding", "linear16");
      params.set("sample_rate", String(sampleRate));
      params.set("container", "none");
    } else if (encoding === "mulaw") {
      params.set("encoding", "mulaw");
      params.set("sample_rate", String(sampleRate));
      params.set("container", "none");
    } else if (encoding === "alaw") {
      params.set("encoding", "alaw");
      params.set("sample_rate", String(sampleRate));
      params.set("container", "none");
    }
    const response = await axios.post(
      `${DEEPGRAM_TTS_URL}?${params.toString()}`,
      { text },
      {
        ...keepAliveAxiosConfig,
        headers: {
          Authorization: `Token ${config.apiKey}`,
          "Content-Type": "application/json"
        },
        responseType: "arraybuffer",
        timeout: 3e4
      }
    );
    return Buffer.from(response.data);
  }
  async *synthesizeStream(text, config) {
    let model = config.voice || config.deepgramModel || "aura-asteria-en";
    if (model === "aura-2") model = "aura-2-asteria-en";
    if (model === "aura") model = "aura-asteria-en";
    const sampleRate = config.outputFormat?.sampleRate || 8e3;
    const encoding = config.outputFormat?.encoding || "linear16";
    const params = new URLSearchParams({
      model,
      encoding: encoding === "mulaw" ? "mulaw" : encoding === "alaw" ? "alaw" : "linear16",
      sample_rate: String(sampleRate),
      container: "none"
    });
    const response = await axios.post(
      `${DEEPGRAM_TTS_URL}?${params.toString()}`,
      { text },
      {
        ...keepAliveAxiosConfig,
        headers: {
          Authorization: `Token ${config.apiKey}`,
          "Content-Type": "application/json"
        },
        responseType: "stream",
        timeout: 3e4
      }
    );
    const stream = response.data;
    const chunkSize = 640;
    let buffer = Buffer.alloc(0);
    for await (const data of stream) {
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= chunkSize) {
        yield buffer.subarray(0, chunkSize);
        buffer = buffer.subarray(chunkSize);
      }
    }
    if (buffer.length > 0) {
      yield buffer;
    }
  }
}
export {
  DeepgramTtsProvider
};
