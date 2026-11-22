import { useMemo } from 'react';
import type { Track } from '@shared/types';
import { samplePeaks } from '../lib/media';
import { Cover } from './Cover';
import { PlayGlyph } from './Glyphs';

/**
 * The landing illustration: a record at the centre of three listeners,
 * with a small player card resting on the frame.
 */
export function Orbit() {
  const ticks = useMemo(() => {
    const count = 112;
    const center = 300;
    return Array.from({ length: count }, (_, index) => {
      const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
      const weight =
        0.24 +
        0.76 *
          Math.abs(Math.sin(index * 1.63 + 0.6)) *
          (0.55 + 0.45 * Math.sin(index * 0.21 + 1.3));
      const inner = 218;
      const outer = inner + 4 + weight * 30;
      return {
        x1: center + Math.cos(angle) * inner,
        y1: center + Math.sin(angle) * inner,
        x2: center + Math.cos(angle) * outer,
        y2: center + Math.sin(angle) * outer,
        opacity: 0.34 + weight * 0.5,
      };
    });
  }, []);

  const demo = useMemo<Track>(
    () => ({
      id: 'landing-hush',
      title: 'Slow Motion',
      artist: 'Plum & Sage',
      album: '',
      duration: 194,
      hasArt: false,
      peaks: samplePeaks([], 80, 'landing-hush'),
      addedAt: 0,
      addedBy: null,
    }),
    [],
  );

  const demoBars = useMemo(() => samplePeaks([], 24, 'landing-bars'), []);

  return (
    <div className="orbit-frame" aria-hidden="true">
      <div className="orbit-tint" />
      <div className="orbit-ring orbit-ring-a" />
      <div className="orbit-ring orbit-ring-b" />
      <div className="orbit-ring orbit-ring-c" />

      <svg className="orbit-ticks" viewBox="0 0 600 600">
        {ticks.map((tick, index) => (
          <line
            key={index}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
            stroke="#d7d7d2"
            strokeWidth="1.4"
            strokeLinecap="round"
            opacity={tick.opacity}
          />
        ))}
      </svg>

      <div className="orbit-center">
        <span className="record-groove record-groove-a" />
        <span className="record-groove record-groove-b" />
        <span className="record-label" />
      </div>

      <div className="orbit-orbit orbit-orbit-a">
        <span className="orb orb-a" />
      </div>
      <div className="orbit-orbit orbit-orbit-b">
        <span className="orb orb-b" />
      </div>
      <div className="orbit-orbit orbit-orbit-c">
        <span className="orb orb-c" />
      </div>

      <div className="orbit-card">
        <span className="orbit-card-art">
          <Cover track={demo} code="landing" />
        </span>
        <div className="orbit-card-middle">
          <div className="orbit-card-wave">
            {demoBars.map((value, index) => (
              <i
                key={index}
                style={{ height: `${Math.max(12, Math.round(value * 100))}%` }}
                className={index < 9 ? 'is-played' : ''}
              />
            ))}
          </div>
          <div className="orbit-card-people">
            <span className="mini-avatar mini-avatar-a" />
            <span className="mini-avatar mini-avatar-b" />
            <span className="mini-avatar mini-avatar-c" />
            <span className="orbit-card-time">1:24 / 3:14</span>
          </div>
        </div>
        <span className="orbit-card-play">
          <PlayGlyph size={14} />
        </span>
      </div>
    </div>
  );
}
