import fs from 'fs';
import path from 'path';
import { DeepgramSttProvider } from './deepgram-stt.provider';
import { SarvamSttProvider } from './sarvam-stt.provider';
import { type SttConfig, type AudioFormat } from '../../../types';

/**
 * Enhanced STT Test Script
 * 
 * Automatically detects WAV format (Sample Rate/Channels) from the file header.
 */

function parseWavHeader(buffer: Buffer): AudioFormat {
  // Simple WAV header parser
  const sampleRate = buffer.readUInt32LE(24);
  const channels = buffer.readUInt16LE(22) as 1 | 2;
  const bitDepth = buffer.readUInt16LE(34) as 16 | 24 | 32;

  return {
    encoding: 'linear16',
    sampleRate: sampleRate as any,
    channels: channels,
    bitDepth: bitDepth
  };
}

async function runTest() {
  const providerType = (process.env.STT_PROVIDER || 'deepgram') as 'deepgram' | 'sarvam';
  const apiKey = process.env.STT_API_KEY;
  const audioFilePath = process.env.AUDIO_FILE;

  if (!apiKey) {
    console.error('❌ Error: STT_API_KEY environment variable is required');
    process.exit(1);
  }

  if (!audioFilePath || !fs.existsSync(audioFilePath)) {
    console.error(`❌ Error: Audio file not found at ${audioFilePath}`);
    process.exit(1);
  }

  const audioBuffer = fs.readFileSync(audioFilePath);
  const format = parseWavHeader(audioBuffer);

  console.log(`\n🚀 Starting STT Test for [${providerType}]`);
  console.log(`📂 Audio File: ${audioFilePath}`);
  console.log(`📊 Format: ${format.sampleRate}Hz, ${format.channels === 1 ? 'Mono' : 'Stereo'}, ${format.bitDepth}-bit`);

  // 1. Initialize Provider
  const provider = providerType === 'deepgram' 
    ? new DeepgramSttProvider() 
    : new SarvamSttProvider();

  // 2. Setup Callbacks
  provider.onTranscript((transcript) => {
    if (transcript.text.trim()) {
      const prefix = transcript.isFinal ? '✅ [FINAL]' : '⏳ [INTERIM]';
      console.log(`${prefix} ${transcript.text}`);
    }
  });

  provider.onError((error) => {
    console.error('❌ STT Error:', error.message);
  });

  // 3. Connect
  const model = process.env.STT_MODEL;
  const config: SttConfig = {
    provider: providerType,
    apiKey: apiKey,
    language: process.env.LANGUAGE || 'en',
    model: model,
    deepgramModel: model,
    sarvamModel: model,
    interimResults: true,
  };

  try {
    await provider.connect(config, format);
    console.log('📡 Connected to provider successfully');

    // 4. Stream Audio in Chunks
    // Skip the 44-byte WAV header
    const audioData = audioBuffer.slice(44);
    const chunkSize = Math.floor(format.sampleRate * 0.2); // 200ms chunk

    console.log(`📤 Streaming audio...`);

    if (providerType === 'sarvam') {
      // Sarvam is a REST API — every flush = 1 HTTP request.
      // Feed all audio into the buffer instantly so it accumulates as one large
      // chunk, then close() sends it in a single well-sized API call.
      // Adding 100ms delays here would make the periodic timer fire many times
      // and trigger rate_limit_exceeded_error.
      for (let i = 0; i < audioData.length; i += chunkSize) {
        provider.sendAudio(audioData.slice(i, i + chunkSize));
      }
      console.log(`📦 All audio buffered (${(audioData.length / 1024).toFixed(1)} KB). Closing to send...`);
    } else {
      // Deepgram uses a persistent WebSocket — simulate real-time streaming
      for (let i = 0; i < audioData.length; i += chunkSize) {
        provider.sendAudio(audioData.slice(i, i + chunkSize));
        // Simulate real-time streaming delay (100ms per chunk)
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      console.log('📥 End of file. Waiting for final transcripts...');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    // 5. Close
    await provider.close();
    console.log('🏁 Test completed.\n');

  } catch (err: any) {
    console.error('❌ Failed to run test:', err.message);
    process.exit(1);
  }
}

runTest().catch(console.error);
