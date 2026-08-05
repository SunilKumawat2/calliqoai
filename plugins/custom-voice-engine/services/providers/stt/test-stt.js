import fs from "fs";
import { DeepgramSttProvider } from "./deepgram-stt.provider.js";
import { SarvamSttProvider } from "./sarvam-stt.provider.js";
function parseWavHeader(buffer) {
  const sampleRate = buffer.readUInt32LE(24);
  const channels = buffer.readUInt16LE(22);
  const bitDepth = buffer.readUInt16LE(34);
  return {
    encoding: "linear16",
    sampleRate,
    channels,
    bitDepth
  };
}
async function runTest() {
  const providerType = process.env.STT_PROVIDER || "deepgram";
  const apiKey = process.env.STT_API_KEY;
  const audioFilePath = process.env.AUDIO_FILE;
  if (!apiKey) {
    console.error("\u274C Error: STT_API_KEY environment variable is required");
    process.exit(1);
  }
  if (!audioFilePath || !fs.existsSync(audioFilePath)) {
    console.error(`\u274C Error: Audio file not found at ${audioFilePath}`);
    process.exit(1);
  }
  const audioBuffer = fs.readFileSync(audioFilePath);
  const format = parseWavHeader(audioBuffer);
  console.log(`
\u{1F680} Starting STT Test for [${providerType}]`);
  console.log(`\u{1F4C2} Audio File: ${audioFilePath}`);
  console.log(`\u{1F4CA} Format: ${format.sampleRate}Hz, ${format.channels === 1 ? "Mono" : "Stereo"}, ${format.bitDepth}-bit`);
  const provider = providerType === "deepgram" ? new DeepgramSttProvider() : new SarvamSttProvider();
  provider.onTranscript((transcript) => {
    if (transcript.text.trim()) {
      const prefix = transcript.isFinal ? "\u2705 [FINAL]" : "\u23F3 [INTERIM]";
      console.log(`${prefix} ${transcript.text}`);
    }
  });
  provider.onError((error) => {
    console.error("\u274C STT Error:", error.message);
  });
  const model = process.env.STT_MODEL;
  const config = {
    provider: providerType,
    apiKey,
    language: process.env.LANGUAGE || "en",
    model,
    deepgramModel: model,
    sarvamModel: model,
    interimResults: true
  };
  try {
    await provider.connect(config, format);
    console.log("\u{1F4E1} Connected to provider successfully");
    const audioData = audioBuffer.slice(44);
    const chunkSize = Math.floor(format.sampleRate * 0.2);
    console.log(`\u{1F4E4} Streaming audio...`);
    if (providerType === "sarvam") {
      for (let i = 0; i < audioData.length; i += chunkSize) {
        provider.sendAudio(audioData.slice(i, i + chunkSize));
      }
      console.log(`\u{1F4E6} All audio buffered (${(audioData.length / 1024).toFixed(1)} KB). Closing to send...`);
    } else {
      for (let i = 0; i < audioData.length; i += chunkSize) {
        provider.sendAudio(audioData.slice(i, i + chunkSize));
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      console.log("\u{1F4E5} End of file. Waiting for final transcripts...");
      await new Promise((resolve) => setTimeout(resolve, 3e3));
    }
    await provider.close();
    console.log("\u{1F3C1} Test completed.\n");
  } catch (err) {
    console.error("\u274C Failed to run test:", err.message);
    process.exit(1);
  }
}
runTest().catch(console.error);
