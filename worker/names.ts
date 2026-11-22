const NAMES = [
  'sage', 'plum', 'moss', 'clay', 'dune', 'fern', 'lilac', 'onyx', 'sky', 'amber',
  'coral', 'frost', 'hazel', 'jade', 'lumen', 'nectar', 'opal', 'pearl', 'quartz',
  'reed', 'slate', 'snow', 'stone', 'sunny', 'teal', 'honey', 'ink', 'iris',
  'juniper', 'kite', 'lark', 'mint', 'nova', 'olive', 'poppy', 'rain', 'robin',
  'rust', 'silk', 'tide', 'vale', 'wren', 'yuzu', 'zephyr', 'birch', 'cedar',
  'clover', 'dawn', 'ember', 'fig', 'gust', 'harbor', 'isle', 'juno', 'kelp',
];

const HUE_STEPS = [12, 28, 48, 78, 104, 142, 168, 188, 206, 228, 252, 276, 296, 320, 342];

export function makeName(taken: Set<string>): string {
  const free = NAMES.filter((n) => !taken.has(n));
  const pool = free.length > 0 ? free : NAMES;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function makeHue(taken: number[] = []): number {
  let best = HUE_STEPS[Math.floor(Math.random() * HUE_STEPS.length)];
  if (taken.length > 0) {
    let bestDistance = -1;
    for (const base of HUE_STEPS) {
      const distance = Math.min(...taken.map((hue) => hueDistance(base, hue)));
      if (distance > bestDistance) {
        bestDistance = distance;
        best = base;
      }
    }
  }
  return (best + Math.floor(Math.random() * 14) - 7 + 360) % 360;
}

function hueDistance(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360;
  return Math.min(raw, 360 - raw);
}

export function sanitizeIdentity(
  value: unknown,
  taken: Set<string>,
  takenHues: number[] = [],
): { name: string; hue: number } {
  if (!value || typeof value !== 'object') {
    return { name: makeName(taken), hue: makeHue(takenHues) };
  }
  const raw = value as { name?: unknown; hue?: unknown };
  let name = typeof raw.name === 'string' ? raw.name.toLowerCase().trim().slice(0, 16) : '';
  name = name.replace(/[^a-z0-9-]/g, '');
  if (!name) name = makeName(taken);
  const hue =
    typeof raw.hue === 'number' && Number.isFinite(raw.hue)
      ? Math.max(0, Math.min(359, Math.round(raw.hue)))
      : makeHue(takenHues);
  return { name, hue };
}
