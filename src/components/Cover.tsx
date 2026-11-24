import { useEffect, useId, useMemo, useState } from 'react';
import type { Track } from '@shared/types';
import { coverPalette, hashString, samplePeaks, trackCoverUrl } from '../lib/media';

interface CoverProps {
  track: Track;
  code: string;
  priority?: boolean;
  className?: string;
}

const DISCS = [
  { cx: 78, cy: 22, r: 26 },
  { cx: 24, cy: 24, r: 25 },
  { cx: 50, cy: 33, r: 30 },
];

const MARKS = [
  { x: 10, y: 68, size: 54, anchor: 'start' as const },
  { x: 90, y: 68, size: 50, anchor: 'end' as const },
  { x: 50, y: 64, size: 44, anchor: 'middle' as const },
];

/** The first letter that will actually draw, so emoji titles still get a mark. */
function monogram(track: Track): string {
  const source = track.title?.trim() || track.artist?.trim() || '';
  const letter = Array.from(source).find((char) => /[\p{L}\p{N}]/u.test(char));
  return (letter ?? '♪').toUpperCase();
}

/**
 * Embedded artwork when a file has it, otherwise a generated sleeve: a
 * pressed-paper ground, a cropped record, an editorial monogram and the
 * track's own waveform. Every sleeve is deterministic, so it is the same
 * thumbnail in the queue, on the stage and in the landing card.
 */
export function Cover({ track, code, priority = false, className = '' }: CoverProps) {
  const palette = useMemo(() => coverPalette(track.id), [track.id]);
  const bars = useMemo(() => samplePeaks(track.peaks, 30, track.id), [track.id, track.peaks]);
  const variant = useMemo(() => hashString(track.id) % DISCS.length, [track.id]);
  const disc = DISCS[variant];
  const mark = MARKS[variant];
  const letter = useMemo(() => monogram(track), [track.title, track.artist]);
  const uid = `c${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const coverUrl = trackCoverUrl(track, code);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [coverUrl]);

  if (coverUrl && !failed) {
    return (
      <img
        className={`cover-img ${className}`}
        src={coverUrl}
        alt=""
        draggable={false}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }

  const barWidth = 82 / bars.length;
  return (
    <div
      className={`cover-generated ${className}`}
      style={{ background: palette.from }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id={`${uid}-ground`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={palette.from} />
            <stop offset="1" stopColor={palette.to} />
          </linearGradient>
          <radialGradient id={`${uid}-light`} cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.62" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect width="100" height="100" fill={`url(#${uid}-ground)`} />
        <ellipse cx="22" cy="14" rx="48" ry="40" fill={`url(#${uid}-light)`} />

        <circle cx={disc.cx} cy={disc.cy} r={disc.r} fill={palette.ink} opacity="0.07" />
        <circle
          cx={disc.cx}
          cy={disc.cy}
          r={disc.r}
          fill="none"
          stroke={palette.ink}
          strokeOpacity="0.18"
          strokeWidth="0.45"
        />
        <circle
          cx={disc.cx}
          cy={disc.cy}
          r={disc.r * 0.72}
          fill="none"
          stroke={palette.ink}
          strokeOpacity="0.13"
          strokeWidth="0.35"
        />
        <circle
          cx={disc.cx}
          cy={disc.cy}
          r={disc.r * 0.43}
          fill="none"
          stroke={palette.ink}
          strokeOpacity="0.1"
          strokeWidth="0.3"
        />
        <circle
          cx={disc.cx}
          cy={disc.cy}
          r={disc.r * 0.13}
          fill={palette.accent}
          opacity="0.85"
        />

        <text
          x={mark.x}
          y={mark.y}
          textAnchor={mark.anchor}
          fontSize={mark.size}
          fontFamily="'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif"
          fontStyle="italic"
          fontWeight="500"
          fill={palette.ink}
          fillOpacity="0.9"
          letterSpacing="-2"
        >
          {letter}
        </text>

        {bars.map((value, index) => {
          const height = Math.max(2.5, value * 13);
          return (
            <rect
              key={index}
              x={9 + index * barWidth}
              y={84 - height}
              width={Math.max(0.8, barWidth - 1.1)}
              height={height}
              rx={0.6}
              fill={palette.ink}
              opacity={0.42 + value * 0.34}
            />
          );
        })}
        <line
          x1="9"
          y1="85.4"
          x2="91"
          y2="85.4"
          stroke={palette.ink}
          strokeOpacity="0.2"
          strokeWidth="0.4"
        />

        <rect
          x="5.5"
          y="5.5"
          width="89"
          height="89"
          rx="3.5"
          fill="none"
          stroke={palette.ink}
          strokeOpacity="0.12"
          strokeWidth="0.35"
        />
      </svg>
    </div>
  );
}
