import { clamp } from './media';

export interface AudioFingerprint {
  peaks: number[];
  duration: number;
}

const BARS = 180;

/**
 * Decode the file in the browser, so the rest of the room gets a real
 * waveform immediately and the server doesn't need a decoder.
 */
export async function analyzeAudioFile(file: File): Promise<AudioFingerprint> {
  const buffer = await file.arrayBuffer();
  let duration = 0;

  try {
    const Ctor: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    try {
      const audio = await ctx.decodeAudioData(buffer.slice(0));
      duration = audio.duration;
      const peaks = computePeaks(audio, BARS);
      return { peaks, duration };
    } finally {
      void ctx.close();
    }
  } catch {
    duration = await probeDuration(file);
    return { peaks: [], duration };
  }
}

function computePeaks(audio: AudioBuffer, count: number): number[] {
  const length = audio.length;
  const channels = Math.min(2, audio.numberOfChannels);
  const data: Float32Array[] = [];
  for (let c = 0; c < channels; c++) data.push(audio.getChannelData(c));

  const block = Math.max(1, Math.floor(length / count));
  const raw: number[] = [];
  const stride = Math.max(1, Math.floor(block / 240));

  for (let i = 0; i < count; i++) {
    const start = i * block;
    const end = Math.min(length, start + block);
    let sumSq = 0;
    let peak = 0;
    let n = 0;
    for (let j = start; j < end; j += stride) {
      let sample = 0;
      for (let c = 0; c < channels; c++) sample += Math.abs(data[c][j] ?? 0);
      sample /= channels;
      sumSq += sample * sample;
      peak = Math.max(peak, sample);
      n++;
    }
    const rms = Math.sqrt(sumSq / Math.max(1, n));
    raw.push(rms * 0.72 + peak * 0.28);
  }

  const sorted = [...raw].sort((a, b) => a - b);
  const reference = sorted[Math.floor(sorted.length * 0.97)] || sorted[sorted.length - 1] || 1;
  const scale = reference > 0 ? 1 / reference : 1;

  return raw.map((value) => Number(Math.pow(clamp(value * scale, 0, 1), 0.68).toFixed(3)));
}

function probeDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement('audio');
    const cleanup = () => {
      URL.revokeObjectURL(url);
      audio.removeAttribute('src');
    };
    const timer = window.setTimeout(() => {
      cleanup();
      resolve(0);
    }, 5000);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      window.clearTimeout(timer);
      const value = Number.isFinite(audio.duration) ? audio.duration : 0;
      cleanup();
      resolve(value);
    };
    audio.onerror = () => {
      window.clearTimeout(timer);
      cleanup();
      resolve(0);
    };
    audio.src = url;
  });
}
