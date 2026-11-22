import { useMemo } from 'react';
import type { Track } from '@shared/types';
import { coverPalette, samplePeaks, trackArtUrl } from '../lib/media';

interface CoverProps {
  track: Track;
  code: string;
  priority?: boolean;
  className?: string;
}

/**
 * Embedded artwork when a file has it, otherwise a generated sleeve built from
 * the track's own waveform, so every song still has a real thumbnail.
 */
export function Cover({ track, code, priority = false, className = '' }: CoverProps) {
  const palette = useMemo(() => coverPalette(track.id), [track.id]);
  const bars = useMemo(() => samplePeaks(track.peaks, 34, track.id), [track.id, track.peaks]);

  if (track.hasArt) {
    return (
      <img
        className={`cover-img ${className}`}
        src={trackArtUrl(code, track.id)}
        alt=""
        draggable={false}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
      />
    );
  }

  const width = 80 / bars.length;
  return (
    <div
      className={`cover-generated ${className}`}
      style={{
        background: `linear-gradient(145deg, ${palette.from}, ${palette.to})`,
      }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <circle cx="77" cy="23" r="28" fill="none" stroke={palette.ring} strokeWidth="0.9" />
        <circle cx="77" cy="23" r="19" fill={palette.ring} opacity="0.55" />
        <circle cx="21" cy="79" r="11" fill={palette.ring} opacity="0.35" />
        {bars.map((value, index) => {
          const height = Math.max(1.5, value * 36);
          return (
            <rect
              key={index}
              x={10 + index * width}
              y={69 - height}
              width={Math.max(0.9, width - 0.75)}
              height={height}
              rx={0.5}
              fill={palette.ink}
              opacity={0.82}
            />
          );
        })}
        <line x1="10" y1="71.5" x2="90" y2="71.5" stroke={palette.ink} opacity="0.2" strokeWidth="0.5" />
      </svg>
    </div>
  );
}
