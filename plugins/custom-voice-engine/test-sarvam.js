import fs from "fs";
import dotenv from "dotenv";
import { SarvamTtsProvider } from "./services/providers/tts/sarvam-tts.provider.js";
dotenv.config({
  path: "../../.env"
});
function createWavHeader(dataLength, sampleRate = 8e3, channels = 1, bitsPerSample = 16) {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  header.write("RIFF", 0);
  header.writeUInt32LE(dataLength + 36, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataLength, 40);
  return header;
}
async function main() {
  try {
    const apiKey = process.env.SARVAM_API_KEY;
    if (!apiKey) {
      throw new Error("\u274C SARVAM_API_KEY not found in .env");
    }
    console.log(
      "\u{1F511} SARVAM_API_KEY =",
      apiKey.substring(0, 8) + "..."
    );
    const provider = new SarvamTtsProvider();
    console.log("\u{1F399}\uFE0F Generating Sarvam TTS...");
    const audio = await provider.synthesize(
      "Hello Atul, this is a Sarvam AI text to speech test. Congratulations, your Sarvam TTS provider is working successfully.",
      {
        provider: "sarvam",
        apiKey,
        language: "en-IN",
        // Use a valid speaker from Sarvam's supported list
        voice: "priya",
        sarvamSpeaker: "priya",
        // Default model
        sarvamModel: "bulbul:v3",
        // Audio format
        outputFormat: {
          encoding: "linear16",
          sampleRate: 8e3
        },
        // Optional settings
        speed: 1
        // pitch: 0,
      }
    );
    fs.writeFileSync("sarvam-test.pcm", audio);
    const wavBuffer = Buffer.concat([
      createWavHeader(audio.length, 8e3),
      audio
    ]);
    fs.writeFileSync("sarvam-test.wav", wavBuffer);
    console.log("\u2705 Sarvam TTS Working");
    console.log("\u{1F4C4} PCM File : sarvam-test.pcm");
    console.log("\u{1F3B5} WAV File : sarvam-test.wav");
    console.log(
      "\u{1F449} Open 'sarvam-test.wav' to listen to the generated audio."
    );
  } catch (error) {
    console.error("\u274C Sarvam TTS Test Failed");
    if (error.response?.data) {
      console.error(
        JSON.stringify(error.response.data, null, 2)
      );
    } else {
      console.error(error.message || error);
    }
  }
}
