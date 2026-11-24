import { useEffect, useMemo, useState } from 'react';
import type { Track } from '@shared/types';
import { trackCoverUrl } from '../lib/media';
import {
  ambientFromSeed,
  cachedPalette,
  LANDING_AMBIENT,
  paletteFromImage,
  type AmbientPalette,
} from '../lib/palette';

/**
 * The colour of the room. Generated sleeves give a deterministic wash
 * immediately; real artwork upgrades it once its pixels can be sampled.
 */
export function useAmbientPalette(track: Track | null, code?: string): AmbientPalette {
  const seed = track?.id ?? (code ? `room-${code}` : null);
  const fallback = useMemo(
    () => (seed ? ambientFromSeed(seed) : LANDING_AMBIENT),
    [seed],
  );
  const coverUrl = useMemo(
    () => (track && code ? trackCoverUrl(track, code) : null),
    [track, code],
  );
  const [palette, setPalette] = useState<AmbientPalette>(
    () => (coverUrl ? cachedPalette(coverUrl) : null) ?? fallback,
  );

  useEffect(() => {
    const cached = coverUrl ? cachedPalette(coverUrl) : null;
    if (cached) {
      setPalette(cached);
      return;
    }

    setPalette(fallback);
    if (!coverUrl) return;

    let live = true;
    void paletteFromImage(coverUrl).then((next) => {
      if (live && next) setPalette(next);
    });
    return () => {
      live = false;
    };
  }, [fallback, coverUrl]);

  return palette;
}
