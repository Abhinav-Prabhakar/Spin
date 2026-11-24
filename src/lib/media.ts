import type { Track } from '@shared/types';
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

export function trackCoverUrl(track: Track, code: string): string | null {
  return track.artUrl || (track.hasArt ? trackArtUrl(code, track.id) : null);
}

export function isLinkTrack(track: Track | null | undefined): boolean {
  return track?.origin === 'link' || track?.origin === 'youtube';
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
  accent: string;
  ring: string;
}

/**
 * Pressed-paper sleeves: muted grounds with one deeper ink and a single
 * saturated accent. The cover and the room's ambient wash both derive from
 * these, so a generated sleeve never fights its background.
 */
const PALETTES: CoverPalette[] = [
  { from: '#f3e6d2', to: '#d9b98c', ink: '#3a2f21', accent: '#b5653f', ring: 'rgba(255,255,255,.45)' },
  { from: '#e6ebdf', to: '#b9c9ac', ink: '#26301f', accent: '#6d8a5a', ring: 'rgba(255,255,255,.5)' },
  { from: '#e4e9f2', to: '#b6c6dd', ink: '#22303f', accent: '#5a789e', ring: 'rgba(255,255,255,.48)' },
  { from: '#f2e2dc', to: '#ddb6aa', ink: '#3a2620', accent: '#b76a55', ring: 'rgba(255,255,255,.45)' },
  { from: '#ece3f0', to: '#cdb9d9', ink: '#322638', accent: '#8b6aa3', ring: 'rgba(255,255,255,.5)' },
  { from: '#efe9dc', to: '#d3c4a6', ink: '#332d20', accent: '#9c8150', ring: 'rgba(255,255,255,.5)' },
  { from: '#f6ecd2', to: '#e8d29b', ink: '#3a301b', accent: '#b99433', ring: 'rgba(255,255,255,.5)' },
  { from: '#dfeae7', to: '#aecbc5', ink: '#1f302d', accent: '#4f8279', ring: 'rgba(255,255,255,.5)' },
  { from: '#f0e3d8', to: '#d8b9a4', ink: '#372a20', accent: '#a4694a', ring: 'rgba(255,255,255,.45)' },
  { from: '#eae8e3', to: '#c7c2b8', ink: '#2b2a26', accent: '#7d776a', ring: 'rgba(255,255,255,.45)' },
  { from: '#e8eadb', to: '#c6ccab', ink: '#2c301f', accent: '#7f8a4c', ring: 'rgba(255,255,255,.48)' },
  { from: '#ece2e6', to: '#d0b4c0', ink: '#342229', accent: '#9a5f76', ring: 'rgba(255,255,255,.45)' },
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
