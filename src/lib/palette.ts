import { coverPalette } from './media';

/** The room's colour wash: one near-white ground and three soft tints. */
export interface AmbientPalette {
  base: string;
  tints: [string, string, string];
  accent: string;
}

/** The landing page keeps its own warm, brand-adjacent wash. */
export const LANDING_AMBIENT: AmbientPalette = {
  base: '#fbf7f0',
  tints: ['#f6e2ce', '#e8eee0', '#f4e7db'],
  accent: '#e2603c',
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function rgbToHsl(r255: number, g255: number, b255: number): [number, number, number] {
  const r = r255 / 255;
  const g = g255 / 255;
  const b = b255 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s * 100, l * 100];
}

function hexToHsl(hex: string): [number, number, number] {
  const raw = hex.replace('#', '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((char) => char + char)
          .join('')
      : raw;
  const value = Number.parseInt(full, 16);
  return rgbToHsl((value >> 16) & 255, (value >> 8) & 255, value & 255);
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%)`;
}

/** A wash that matches the deterministic sleeve palette for this track. */
export function ambientFromSeed(seed: string): AmbientPalette {
  const cover = coverPalette(seed);
  const [fromHue, fromSat] = hexToHsl(cover.from);
  const [toHue] = hexToHsl(cover.to);
  const [accentHue] = hexToHsl(cover.accent);
  const tintSat = clamp(fromSat * 0.9 + 12, 30, 48);

  return {
    base: hsl(fromHue, Math.min(26, fromSat * 0.55), 97),
    tints: [
      hsl(fromHue, tintSat, 89),
      hsl(toHue, tintSat - 4, 87),
      hsl(accentHue, tintSat - 2, 91),
    ],
    accent: hsl(accentHue, 62, 55),
  };
}

function hueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

interface Bucket {
  hue: number;
  sat: number;
  light: number;
  weight: number;
  count: number;
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.referrerPolicy = 'no-referrer';
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('cover art unavailable'));
    image.src = url;
  });
}

async function extract(url: string): Promise<AmbientPalette | null> {
  const image = await loadImage(url);
  const size = 40;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, size, size);

  let pixels: Uint8ClampedArray;
  try {
    pixels = context.getImageData(0, 0, size, size).data;
  } catch {
    return null;
  }

  const buckets = new Map<number, Bucket>();
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < 180) continue;
    const [hue, sat, light] = rgbToHsl(
      pixels[index],
      pixels[index + 1],
      pixels[index + 2],
    );
    if (light < 16 || light > 90 || sat < 14) continue;
    const key = Math.round(hue / 30) % 12;
    const weight = (sat / 100) * (1 - Math.abs(light - 52) / 100) + 0.05;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.hue += hue;
      bucket.sat += sat;
      bucket.light += light;
      bucket.weight += weight;
      bucket.count += 1;
    } else {
      buckets.set(key, { hue, sat, light, weight, count: 1 });
    }
  }

  const ranked = [...buckets.values()].sort((a, b) => b.weight - a.weight);
  const picks: Bucket[] = [];
  for (const bucket of ranked) {
    const hue = bucket.hue / bucket.count;
    if (picks.every((pick) => hueDistance(pick.hue / pick.count, hue) >= 42)) {
      picks.push(bucket);
    }
    if (picks.length === 3) break;
  }
  if (picks.length === 0) return null;

  const colors = picks.map((pick) => ({
    hue: pick.hue / pick.count,
    sat: pick.sat / pick.count,
  }));
  const lead = colors[0];
  const tints = [0, 1, 2].map((index) => {
    const color = colors[index] ?? lead;
    return hsl(color.hue, clamp(color.sat * 0.55 + 14, 30, 52), [89, 87, 90][index]);
  }) as [string, string, string];

  return {
    base: hsl(lead.hue, 24, 97),
    tints,
    accent: hsl(lead.hue, clamp(lead.sat * 0.9 + 10, 45, 68), 54),
  };
}

const resolved = new Map<string, AmbientPalette>();
const pending = new Map<string, Promise<AmbientPalette | null>>();

/** The last extracted palette for a cover, available synchronously. */
export function cachedPalette(url: string): AmbientPalette | null {
  return resolved.get(url) ?? null;
}

/**
 * Pull three distinct hues out of a cover image. Cross-origin art that
 * refuses canvas access simply falls back to the deterministic wash.
 */
export function paletteFromImage(url: string): Promise<AmbientPalette | null> {
  const known = resolved.get(url);
  if (known) return Promise.resolve(known);

  const inFlight = pending.get(url);
  if (inFlight) return inFlight;

  const job = extract(url)
    .then((palette) => {
      if (palette) resolved.set(url, palette);
      return palette;
    })
    .catch(() => null)
    .finally(() => {
      pending.delete(url);
    });

  pending.set(url, job);
  if (resolved.size > 64) {
    const oldest = resolved.keys().next().value;
    if (oldest) resolved.delete(oldest);
  }
  return job;
}
