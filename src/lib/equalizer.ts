export interface EqBand {
  frequency: number;
  label: string;
  type: BiquadFilterType;
  q: number;
}

export const EQ_BANDS: EqBand[] = [
  { frequency: 32, label: '32', type: 'lowshelf', q: 0.7 },
  { frequency: 64, label: '64', type: 'peaking', q: 1.1 },
  { frequency: 125, label: '125', type: 'peaking', q: 1.1 },
  { frequency: 250, label: '250', type: 'peaking', q: 1.1 },
  { frequency: 500, label: '500', type: 'peaking', q: 1.1 },
  { frequency: 1000, label: '1k', type: 'peaking', q: 1.1 },
  { frequency: 2000, label: '2k', type: 'peaking', q: 1.1 },
  { frequency: 4000, label: '4k', type: 'peaking', q: 1.1 },
  { frequency: 8000, label: '8k', type: 'peaking', q: 1.1 },
  { frequency: 16000, label: '16k', type: 'highshelf', q: 0.7 },
];

export const EQ_MIN = -12;
export const EQ_MAX = 12;
export const EQ_FLAT: number[] = EQ_BANDS.map(() => 0);

export interface EqPreset {
  id: string;
  name: string;
  gains: number[];
}

const preset = (id: string, name: string, gains: number[]): EqPreset => ({ id, name, gains });

export const EQ_PRESETS: EqPreset[] = [
  preset('flat', 'Flat', EQ_FLAT),
  preset('warm', 'Warm', [4.5, 3.5, 2, 1, 0.5, 0, -0.5, -1, -1.5, -2]),
  preset('bass', 'Bass', [8, 7, 5.5, 3, 1, 0, -0.5, -1, -1, -0.5]),
  preset('vocal', 'Vocal', [-3, -2, -0.5, 1.5, 3.5, 4.5, 3.5, 2, 0, -1.5]),
  preset('bright', 'Bright', [-2, -1.5, -1, 0, 1, 2, 3.5, 5, 5.5, 4]),
  preset('night', 'Night', [3, 2, 1, 0, -0.5, -1.5, -2.5, -4, -6, -8]),
];

export type EqPresetId = string | 'custom';

export interface EqState {
  enabled: boolean;
  gains: number[];
  preset: EqPresetId;
}

export const DEFAULT_EQ: EqState = {
  enabled: false,
  gains: [...EQ_FLAT],
  preset: 'flat',
};

const EQ_KEY = 'spin.eq.v1';

export function clampGain(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(EQ_MIN, Math.min(EQ_MAX, Math.round(value * 2) / 2));
}

export function readEq(): EqState {
  try {
    const raw = localStorage.getItem(EQ_KEY);
    if (!raw) return { ...DEFAULT_EQ, gains: [...DEFAULT_EQ.gains] };
    const parsed = JSON.parse(raw) as Partial<EqState>;
    const gains =
      Array.isArray(parsed.gains) && parsed.gains.length === EQ_BANDS.length
        ? parsed.gains.map((gain) => clampGain(Number(gain)))
        : [...EQ_FLAT];
    const preset =
      typeof parsed.preset === 'string' &&
      (parsed.preset === 'custom' || EQ_PRESETS.some((item) => item.id === parsed.preset))
        ? parsed.preset
        : 'custom';
    return { enabled: Boolean(parsed.enabled), gains, preset };
  } catch {
    return { ...DEFAULT_EQ, gains: [...DEFAULT_EQ.gains] };
  }
}

export function storeEq(state: EqState): void {
  try {
    localStorage.setItem(EQ_KEY, JSON.stringify(state));
  } catch {
    /* equalizer still works for this tab */
  }
}

export function presetById(id: EqPresetId): EqPreset | null {
  return EQ_PRESETS.find((presetItem) => presetItem.id === id) ?? null;
}
