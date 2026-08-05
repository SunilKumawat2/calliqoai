import fs from "fs";
import dotenv from "dotenv";
import { DeepgramTtsProvider } from "./services/providers/tts/deepgram-tts.provider";

// Load .env
dotenv.config({
  path: "../../.env",
});

/**
 * Create WAV header for raw PCM audio
 */
function createWavHeader(
  dataLength: number,
  sampleRate: number = 8000,
  channels: number = 1,
  bitsPerSample: number = 16
): Buffer {
  const header = Buffer.alloc(44);

  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);

  header.write("RIFF", 0);
  header.writeUInt32LE(dataLength + 36, 4);
  header.write("WAVE", 8);

  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // Audio format = PCM
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
    const apiKey = process.env.DEEPGRAM_API_KEY;

    if (!apiKey) {
      throw new Error("DEEPGRAM_API_KEY not found in .env");
    }

    console.log(
      "🔑 DEEPGRAM_API_KEY:",
      apiKey.substring(0, 8) + "..."
    );

    const provider = new DeepgramTtsProvider();

    console.log("🎙️ Generating TTS...");

    const audio = await provider.synthesize(
      "Hello Atul, this is a Deepgram text to speech test. Congratulations, your TTS provider is working successfully.",
      {
        provider: "deepgram",
        apiKey,
        voice: "aura-asteria-en",
        outputFormat: {
          encoding: "linear16",
          sampleRate: 8000,
        },
      } as any
    );

    // Save raw PCM
    fs.writeFileSync("deepgram-test.pcm", audio);

    // Convert PCM -> WAV
    const wavBuffer = Buffer.concat([
      createWavHeader(audio.length, 8000),
      audio,
    ]);

    fs.writeFileSync("deepgram-test.wav", wavBuffer);

    console.log("✅ Deepgram TTS Working");
    console.log("📄 PCM File : deepgram-test.pcm");
    console.log("🎵 WAV File : deepgram-test.wav");
    console.log(
      "👉 Double-click 'deepgram-test.wav' to listen to the generated audio."
    );
  } catch (error: any) {
    console.error("❌ TTS Test Failed");
    console.error(error.message || error);
  }
}

// main();