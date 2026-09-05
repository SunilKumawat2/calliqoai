import axios from "axios";
import { BaseTtsProvider } from "./tts-provider.interface.js";
import { keepAliveAxiosConfig } from "../http-agent.js";
const SARVAM_API_BASE = "https://api.sarvam.ai";
class SarvamTtsProvider extends BaseTtsProvider {
  name = "sarvam";
  async synthesize(text, config) {
    const language = config.language || "hi-IN";
    let speaker = (config.sarvamSpeaker || config.voice || "kavya").toLowerCase();
    let model = config.sarvamModel || "bulbul:v3";
    const bulbulV3Speakers = [
      "aditya",
      "ritu",
      "ashutosh",
      "priya",
      "neha",
      "rohan",
      "simran",
      "kavya",
      "amit",
      "dev",
      "ishita",
      "shreya",
      "ratan",
      "varun",
      "manan",
      "sumit",
      "roopa",
      "kabir",
      "aayan",
      "shubh",
      "advait",
      "anand",
      "tanya",
      "tarun",
      "sunny",
      "mani",
      "gokul",
      "vijay",
      "shruti",
      "suhani",
      "mohit",
      "kavitha",
      "rehan",
      "soham",
      "rupali",
      "niharika"
    ];
    if (!speaker || !bulbulV3Speakers.includes(speaker)) {
      speaker = "kavya";
    }
    if (!model || model !== "bulbul:v3") {
      model = "bulbul:v3";
    }
    const cleaned = text.replace(/[\s.,!?;:\-–—'"`()\[\]{}]+/g, "").trim();
    if (!cleaned) {
      console.warn(`[TTS:Sarvam] Skipping TTS \u2014 text has no speakable content: "${text.substring(0, 40)}"`);
      return Buffer.alloc(320, 0);
    }
    console.log(`[TTS:Sarvam] Synthesizing: speaker="${speaker}" model="${model}" lang="${language}" sampleRate=${config.outputFormat?.sampleRate || 8e3} text_len=${text.length}`);
    try {
      const response = await axios.post(
        `${SARVAM_API_BASE}/text-to-speech`,
        {
          inputs: [text],
          target_language_code: this.mapLanguage(language),
          speaker,
          model,
          pace: config.speed || 1.05,
          // Natural human speech pace for clear Hindi pronunciation
          speech_sample_rate: 16e3,
          // Request 16kHz high-fidelity audio from Sarvam
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
        let audioBuf = Buffer.from(response.data.audios[0], "base64");
        if (audioBuf.length >= 44 && audioBuf.readUInt32BE(0) === 1380533830) {
          const dataIdx = audioBuf.subarray(0, 100).indexOf("data");
          if (dataIdx !== -1 && dataIdx + 8 <= audioBuf.length) {
            audioBuf = audioBuf.subarray(dataIdx + 8);
          } else {
            audioBuf = audioBuf.subarray(44);
          }
        }
        return audioBuf;
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
        pace: config.speed || 1.3,
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
