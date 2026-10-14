/**
 * Ambient Sound Player for ElevenLabs Background Sound Preview
 * Generates and plays rich, audible, looping ambient soundscapes in the browser.
 */

class AmbientSoundPlayer {
  private audioCtx: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private currentSound: string | null = null;
  private bufferCache: Map<string, AudioBuffer> = new Map();

  private getContext(): AudioContext {
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioCtxClass();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  private generateBuffer(type: string, ctx: AudioContext): AudioBuffer {
    if (this.bufferCache.has(type)) {
      return this.bufferCache.get(type)!;
    }

    const sampleRate = ctx.sampleRate || 44100;
    const duration = 6; // 6 second loop
    const numSamples = sampleRate * duration;
    const buffer = ctx.createBuffer(1, numSamples, sampleRate);
    const data = buffer.getChannelData(0);

    switch (type) {
      case 'keyboard':
        this.generateKeyboard(data, sampleRate, duration);
        break;
      case 'office':
        this.generateOffice(data, sampleRate, duration);
        break;
      case 'cafe':
        this.generateCafe(data, sampleRate, duration);
        break;
      case 'city':
        this.generateCity(data, sampleRate, duration);
        break;
      default:
        break;
    }

    this.bufferCache.set(type, buffer);
    return buffer;
  }

  private generateKeyboard(data: Float32Array, sr: number, duration: number) {
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.005;
    }
    let t = 0.08;
    while (t < duration - 0.15) {
      const startIdx = Math.floor(t * sr);
      const isSpace = Math.random() < 0.18;
      const clickFreq = 2600 + Math.random() * 1600;
      const clickLen = Math.floor(sr * (isSpace ? 0.035 : 0.022));
      const thudFreq = isSpace ? 150 : (280 + Math.random() * 100);
      const thudLen = Math.floor(sr * 0.035);

      for (let i = 0; i < clickLen && startIdx + i < data.length; i++) {
        const p = i / clickLen;
        const env = Math.exp(-p * 7);
        const click = Math.sin(2 * Math.PI * clickFreq * (i / sr)) * env * 0.55;
        const noise = (Math.random() * 2 - 1) * env * 0.35;
        data[startIdx + i] += (click + noise);
      }
      for (let i = 0; i < thudLen && startIdx + i < data.length; i++) {
        const p = i / thudLen;
        const env = Math.exp(-p * 5);
        const thud = Math.sin(2 * Math.PI * thudFreq * (i / sr)) * env * 0.35;
        data[startIdx + i] += thud;
      }
      t += 0.10 + Math.random() * 0.18;
      if (Math.random() < 0.12) t += 0.28; // natural typing pause
    }
  }

  private generateOffice(data: Float32Array, sr: number, duration: number) {
    // Air conditioning / room tone pink noise
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      const pink = b0 + b1 + b2 + white * 0.5362;
      data[i] = pink * 0.12;
    }
    // Multiple voice chatter murmurs
    const murmurFreqs = [220, 310, 440, 580, 720, 890, 1150, 1400];
    for (let i = 0; i < data.length; i++) {
      const t = i / sr;
      let m = 0;
      for (const f of murmurFreqs) {
        m += Math.sin(2 * Math.PI * f * t + Math.sin(t * 2.5 + f) * 1.2) * 0.025;
      }
      const wave = 0.6 + 0.4 * Math.sin(t * 1.2) * Math.cos(t * 0.7);
      data[i] += m * wave;
    }
    // Soft telephone ring burst at t=1.8s and t=4.5s
    for (const ringT of [1.8, 4.5]) {
      const ringIdx = Math.floor(ringT * sr);
      const ringLen = Math.floor(sr * 0.35);
      for (let i = 0; i < ringLen && ringIdx + i < data.length; i++) {
        const ringEnv = 0.5 * (1 - Math.cos(2 * Math.PI * i / ringLen));
        const tone = (Math.sin(2 * Math.PI * 440 * (i / sr)) + Math.sin(2 * Math.PI * 480 * (i / sr))) * 0.08 * ringEnv;
        data[ringIdx + i] += tone;
      }
    }
    // Soft distant keyboard clicks
    let t = 0.2;
    while (t < duration - 0.2) {
      const idx = Math.floor(t * sr);
      const len = Math.floor(sr * 0.015);
      for (let i = 0; i < len && idx + i < data.length; i++) {
        const env = Math.exp(-(i / len) * 7);
        data[idx + i] += (Math.random() * 2 - 1) * env * 0.15;
      }
      t += 0.18 + Math.random() * 0.35;
    }
  }

  private generateCafe(data: Float32Array, sr: number, _duration: number) {
    // Warm brownian noise baseline
    let lastOut = 0.0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut + (0.04 * white)) / 1.02;
      data[i] = lastOut * 1.2;
    }
    // Gentle crowd murmur frequencies
    const chatterFreqs = [280, 390, 520, 680, 850, 1050];
    for (let i = 0; i < data.length; i++) {
      const t = i / sr;
      let ch = 0;
      for (const f of chatterFreqs) {
        ch += Math.sin(2 * Math.PI * f * t + Math.sin(t * 1.8 + f) * 1.5) * 0.03;
      }
      const swell = 0.7 + 0.3 * Math.sin(t * 0.9) * Math.cos(t * 1.4);
      data[i] += ch * swell;
    }
    // Distinct porcelain cup / saucer clinks
    for (const ct of [0.9, 2.4, 4.1, 5.2]) {
      const idx = Math.floor(ct * sr);
      const len = Math.floor(sr * 0.09);
      const freq1 = 2800 + Math.random() * 600;
      const freq2 = 4100 + Math.random() * 500;
      for (let i = 0; i < len && idx + i < data.length; i++) {
        const env = Math.exp(-(i / len) * 9);
        const clink = (Math.sin(2 * Math.PI * freq1 * (i / sr)) * 0.5 + Math.sin(2 * Math.PI * freq2 * (i / sr)) * 0.5) * env * 0.35;
        data[idx + i] += clink;
      }
    }
  }

  private generateCity(data: Float32Array, sr: number, _duration: number) {
    // Traffic rumble
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = last * 0.98 + white * 0.03;
      const t = i / sr;
      const swell = 0.6 + 0.4 * Math.sin(2 * Math.PI * 0.25 * t + 0.2);
      data[i] = last * 1.5 * swell;
    }
    // Street air ambience
    for (let i = 0; i < data.length; i++) {
      data[i] += (Math.random() * 2 - 1) * 0.035;
    }
    // Distant car horn at t=3.0s
    const hornIdx = Math.floor(3.0 * sr);
    const hornLen = Math.floor(sr * 0.4);
    for (let i = 0; i < hornLen && hornIdx + i < data.length; i++) {
      const env = 0.5 * (1 - Math.cos(2 * Math.PI * i / hornLen));
      const horn = (Math.sin(2 * Math.PI * 340 * (i / sr)) + Math.sin(2 * Math.PI * 410 * (i / sr))) * 0.08 * env;
      data[hornIdx + i] += horn;
    }
  }

  public play(soundKey: string, volume: number = 0.75): boolean {
    if (!soundKey || soundKey === 'none') {
      this.stop();
      return false;
    }

    try {
      this.stop();
      const ctx = this.getContext();
      const buffer = this.generateBuffer(soundKey, ctx);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.01, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.12);

      source.connect(gain);
      gain.connect(ctx.destination);

      source.start(0);

      this.currentSource = source;
      this.gainNode = gain;
      this.currentSound = soundKey;
      return true;
    } catch (e) {
      console.error('Failed to play ambient sound preview:', e);
      return false;
    }
  }

  public stop(): void {
    if (this.currentSource) {
      try {
        if (this.gainNode && this.audioCtx) {
          this.gainNode.gain.linearRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.1);
        }
        this.currentSource.stop(this.audioCtx ? this.audioCtx.currentTime + 0.1 : 0);
      } catch (e) {
        // ignore already stopped
      }
      this.currentSource = null;
    }
    this.currentSound = null;
  }

  public getCurrentSound(): string | null {
    return this.currentSound;
  }

  public isPlaying(): boolean {
    return this.currentSound !== null;
  }
}

export const ambientSoundPlayer = new AmbientSoundPlayer();
