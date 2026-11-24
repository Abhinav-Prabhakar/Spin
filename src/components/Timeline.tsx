import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { clamp, formatTime, samplePeaks } from '../lib/media';

interface TimelineProps {
  peaks: number[];
  seed: string;
  duration: number;
  disabled?: boolean;
  getProgress: () => number;
  onSeek: (seconds: number) => void;
}

const WaveBars = memo(function WaveBars({ heights }: { heights: number[] }) {
  return (
    <>
      {heights.map((height, index) => (
        <span
          key={index}
          className="wave-bar"
          style={
            {
              height: `${Math.max(6, Math.round(height * 100))}%`,
              '--i': index,
            } as CSSProperties
          }
        />
      ))}
    </>
  );
});

export function Timeline({ peaks, seed, duration, disabled = false, getProgress, onSeek }: TimelineProps) {
  const heights = useMemo(() => samplePeaks(peaks, 96, seed), [peaks, seed]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const elapsedRef = useRef<HTMLSpanElement | null>(null);
  const scrubRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const [hover, setHover] = useState<number | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const durationSafe = Number.isFinite(duration) && duration > 0 ? duration : 0;

  useEffect(() => {
    let frame = 0;
    let lastSecond = -1;
    const tick = () => {
      const element = rootRef.current;
      let ratio = 0;
      if (scrubRef.current !== null) {
        ratio = scrubRef.current;
      } else if (durationSafe > 0) {
        ratio = clamp(getProgress() / durationSafe, 0, 1);
      }
      if (element) element.style.setProperty('--p', `${(ratio * 100).toFixed(3)}%`);
      const second = Math.round(ratio * durationSafe);
      if (element && second !== lastSecond) {
        lastSecond = second;
        element.setAttribute('aria-valuenow', String(second));
        element.setAttribute('aria-valuetext', formatTime(second));
        if (elapsedRef.current) elapsedRef.current.textContent = formatTime(ratio * durationSafe);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [durationSafe, getProgress]);

  const ratioAt = (clientX: number) => {
    const element = rootRef.current;
    if (!element) return 0;
    const rect = element.getBoundingClientRect();
    return clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
  };

  const handleDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || durationSafe <= 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingRef.current = true;
    const ratio = ratioAt(event.clientX);
    scrubRef.current = ratio;
    setHover(ratio);
    setScrubbing(true);
  };

  const handleMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || durationSafe <= 0) return;
    const ratio = ratioAt(event.clientX);
    if (draggingRef.current) {
      scrubRef.current = ratio;
      setHover(ratio);
    } else {
      setHover(ratio);
    }
  };

  const handleUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const ratio = ratioAt(event.clientX);
    scrubRef.current = null;
    setScrubbing(false);
    setHover(ratio);
    if (durationSafe > 0) onSeek(ratio * durationSafe);
  };

  const handleCancel = () => {
    draggingRef.current = false;
    scrubRef.current = null;
    setScrubbing(false);
    setHover(null);
  };

  const handleKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled || durationSafe <= 0) return;
    const current = clamp(getProgress(), 0, durationSafe);
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = current + 5;
    else if (event.key === 'ArrowLeft') next = current - 5;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = durationSafe;
    if (next !== null) {
      event.preventDefault();
      onSeek(clamp(next, 0, durationSafe));
    }
  };

  const hoverTime = hover !== null && durationSafe > 0 ? hover * durationSafe : null;

  return (
    <div className={`timeline ${disabled ? 'is-disabled' : ''} ${scrubbing ? 'is-scrubbing' : ''}`}>
      <div
        ref={rootRef}
        className="timeline-track"
        style={{ '--p': '0%' } as React.CSSProperties}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(durationSafe)}
        aria-valuenow={0}
        aria-disabled={disabled || durationSafe <= 0}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleCancel}
        onPointerLeave={() => {
          if (!draggingRef.current) setHover(null);
        }}
        onKeyDown={handleKey}
      >
        <div className="wave-layer wave-idle" key={`idle-${seed}`}>
          <WaveBars heights={heights} />
        </div>
        <div className="wave-layer wave-played" key={`played-${seed}`}>
          <WaveBars heights={heights} />
        </div>
        <div className="timeline-head" />
        {hover !== null && hoverTime !== null && (
          <div className="timeline-hover" style={{ left: `${hover * 100}%` }}>
            <span className="timeline-tip">{formatTime(hoverTime)}</span>
          </div>
        )}
      </div>
      <div className="timeline-times">
        <span className="time" ref={elapsedRef}>
          {formatTime(0)}
        </span>
        <span className="time">{durationSafe > 0 ? formatTime(durationSafe) : '—'}</span>
      </div>
    </div>
  );
}
