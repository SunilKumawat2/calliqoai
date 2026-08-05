import axios from "axios";
import { BaseTtsProvider } from "./tts-provider.interface.js";
import { keepAliveAxiosConfig } from "../http-agent.js";
const SARVAM_API_BASE = "https://api.sarvam.ai";
class SarvamTtsProvider extends BaseTtsProvider {
  name = "sarvam";
  async synthesize(text, config) {
    const language = config.language || "en-IN";
    const speaker = config.sarvamSpeaker || config.voice || "meera";
    const model = config.sarvamModel || "bulbul:v3";
    console.log(`[TTS:Sarvam] Synthesizing: speaker="${speaker}" model="${model}" lang="${language}" sampleRate=${config.outputFormat?.sampleRate || 8e3}`);
    try {
      const response = await axios.post(
        `${SARVAM_API_BASE}/text-to-speech`,
        {
          inputs: [text],
          target_language_code: this.mapLanguage(language),
          speaker,
          model,
          pace: config.speed || 1.15,
          // Increased from 1.0 to 1.15 for a more natural speed
          speech_sample_rate: config.outputFormat?.sampleRate || 8e3,
          enable_preprocessing: true
        },
        {
          ...keepAliveAxiosConfig,
          headers: {
            "API-Subscription-Key": config.apiKey,
            "Content-Type": "application/json"
          },
          timeout: 3e4
        }
      );
      if (response.data?.audios?.[0]) {
        return Buffer.from(response.data.audios[0], "base64");
      }
      console.error(`[TTS:Sarvam] No audio in response:`, JSON.stringify(response.data));
      throw new Error(`Sarvam TTS returned no audio data (speaker="${speaker}", model="${model}")`);
    } catch (err) {
      if (err.response?.data) {
        console.error(`[TTS:Sarvam] API error response:`, JSON.stringify(err.response.data, null, 2));
      }
      console.error(`[TTS:Sarvam] Request body:`, JSON.stringify({
        inputs: [text],
        target_language_code: this.mapLanguage(language),
        speaker,
        model,
        pitch: config.pitch || 0,
        pace: config.speed || 1.15,
        loudness: 1.5,
        speech_sample_rate: config.outputFormat?.sampleRate || 8e3,
        enable_preprocessing: true
      }));
      throw err;
    }
  }
  async *synthesizeStream(text, config) {
    const audioBuffer = await this.synthesize(text, config);
    const chunkSize = 640;
    for (let offset = 0; offset < audioBuffer.length; offset += chunkSize) {
      const end = Math.min(offset + chunkSize, audioBuffer.length);
      yield audioBuffer.subarray(offset, end);
    }
  }
  mapLanguage(lang) {
    if (lang.includes("-")) return lang;
    const langMap = {
      en: "en-IN",
      hi: "hi-IN",
      ta: "ta-IN",
      te: "te-IN",
      kn: "kn-IN",
      ml: "ml-IN",
      mr: "mr-IN",
      gu: "gu-IN",
      bn: "bn-IN",
      pa: "pa-IN",
      or: "od-IN"
    };
    return langMap[lang] || "en-IN";
  }
}
export {
  SarvamTtsProvider
};
