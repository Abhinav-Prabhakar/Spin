import { apiUrl, appPath, BASE_PATH } from './api';

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.floor(seconds + 0.0001);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function trackAudioUrl(code: string, trackId: string): string {
  return apiUrl(`/media/${encodeURIComponent(code)}/${encodeURIComponent(trackId)}`);
}

export function trackArtUrl(code: string, trackId: string): string {
  return apiUrl(`/media/${encodeURIComponent(code)}/${encodeURIComponent(trackId)}/art`);
}

export function inviteUrl(code: string): string {
  return `${window.location.origin}${appPath(`/r/${code}`)}`;
}

export function parseRoomPath(pathname: string = window.location.pathname): string | null {
  let path = pathname;
  if (BASE_PATH && path.startsWith(BASE_PATH)) path = path.slice(BASE_PATH.length) || '/';
  const match = path.match(/^\/r\/([A-Za-z0-9]{4,12})\/?$/);
  return match ? match[1].toUpperCase() : null;
}

export function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

/** A soft deterministic waveform for tracks that were shared without peaks. */
export function derivePeaks(seed: string, count: number): number[] {
  const h = hashString(seed);
  const phase = (h % 1000) / 1000;
  const peaks: number[] = [];
  for (let i = 0; i < count; i++) {
    const x = i / Math.max(1, count - 1);
    const body = Math.abs(Math.sin(x * Math.PI * (2 + (h % 3)) + phase * Math.PI * 2));
    const texture = Math.abs(Math.sin(x * Math.PI * 9 + phase * 4));
    const breathe = 0.72 + 0.28 * Math.sin(x * Math.PI * 1.5 + phase * 5);
    const value = (0.18 + 0.82 * (body * 0.65 + texture * 0.35)) * breathe;
    peaks.push(Number(Math.min(1, Math.max(0.08, value)).toFixed(3)));
  }
  return peaks;
}

export function samplePeaks(peaks: number[], count: number, seed = 'spin'): number[] {
  const source = peaks.length > 3 ? peaks : derivePeaks(seed, Math.max(count, 72));
  const out: number[] = [];
  const step = source.length / count;
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * step);
    const end = Math.max(start + 1, Math.floor((i + 1) * step));
    let sum = 0;
    for (let j = start; j < end && j < source.length; j++) sum += source[j] ?? 0;
    const value = sum / Math.max(1, end - start);
    out.push(Number(Math.pow(clamp(value, 0, 1), 0.72).toFixed(3)));
  }
  return out;
}

export interface CoverPalette {
  from: string;
  to: string;
  ink: string;
  ring: string;
}

const PALETTES: CoverPalette[] = [
  { from: '#efe4d2', to: '#dcc29b', ink: '#3c3122', ring: 'rgba(255,255,255,.45)' },
  { from: '#e4e9df', to: '#c3d0ba', ink: '#273026', ring: 'rgba(255,255,255,.5)' },
  { from: '#e3e8f0', to: '#c4cfe0', ink: '#25303e', ring: 'rgba(255,255,255,.48)' },
  { from: '#f0e0da', to: '#e0c2b7', ink: '#3a2922', ring: 'rgba(255,255,255,.45)' },
  { from: '#eae2ee', to: '#d3c3de', ink: '#332a3b', ring: 'rgba(255,255,255,.5)' },
  { from: '#e9e7e1', to: '#cdc9c0', ink: '#2e2c28', ring: 'rgba(255,255,255,.5)' },
  { from: '#f3e8d0', to: '#e7cf9f', ink: '#3b3120', ring: 'rgba(255,255,255,.5)' },
  { from: '#dfe8e6', to: '#bed2ce', ink: '#20302d', ring: 'rgba(255,255,255,.5)' },
  { from: '#ece8df', to: '#d8cdb8', ink: '#372f22', ring: 'rgba(255,255,255,.45)' },
  { from: '#e7e3e8', to: '#cbc2cf', ink: '#302934', ring: 'rgba(255,255,255,.45)' },
];

export function coverPalette(id: string): CoverPalette {
  return PALETTES[hashString(id) % PALETTES.length];
}

export function avatarBackground(hue: number): string {
  return `linear-gradient(145deg, hsl(${hue} 58% 74%), hsl(${(hue + 42) % 360} 52% 52%))`;
}

export function heartBackground(hue: number): string {
  return `linear-gradient(140deg, hsl(${hue} 80% 68%), hsl(${(hue + 36) % 360} 76% 54%))`;
}
