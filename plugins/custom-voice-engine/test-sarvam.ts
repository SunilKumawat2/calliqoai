import fs from "fs";
import dotenv from "dotenv";
import { SarvamTtsProvider } from "./services/providers/tts/sarvam-tts.provider";

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
    const apiKey = process.env.SARVAM_API_KEY;

    if (!apiKey) {
      throw new Error("❌ SARVAM_API_KEY not found in .env");
    }

    console.log(
      "🔑 SARVAM_API_KEY =",
      apiKey.substring(0, 8) + "..."
    );

    const provider = new SarvamTtsProvider();

    console.log("🎙️ Generating Sarvam TTS...");

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
          sampleRate: 8000,
        },

        // Optional settings
        speed: 1.0,
        // pitch: 0,
      } as any
    );

    // Save raw PCM
    fs.writeFileSync("sarvam-test.pcm", audio);

    // Convert PCM -> WAV
    const wavBuffer = Buffer.concat([
      createWavHeader(audio.length, 8000),
      audio,
    ]);

    fs.writeFileSync("sarvam-test.wav", wavBuffer);

    console.log("✅ Sarvam TTS Working");
    console.log("📄 PCM File : sarvam-test.pcm");
    console.log("🎵 WAV File : sarvam-test.wav");
    console.log(
      "👉 Open 'sarvam-test.wav' to listen to the generated audio."
    );
  } catch (error: any) {
    console.error("❌ Sarvam TTS Test Failed");

    if (error.response?.data) {
      console.error(
        JSON.stringify(error.response.data, null, 2)
      );
    } else {
      console.error(error.message || error);
    }
  }
}

// main();