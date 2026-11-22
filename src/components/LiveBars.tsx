import { useEffect, useRef } from 'react';

interface LiveBarsProps {
  playing: boolean;
  bars?: number;
  getLevels?: (bands: number) => number[] | null;
  className?: string;
}

/**
 * A tiny equalizer. Reads the real analyser when Web Audio is available and
 * falls back to a gentle synthetic movement while waiting for a gesture.
 */
export function LiveBars({ playing, bars = 4, getLevels, className = '' }: LiveBarsProps) {
  const containerRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const elements = Array.from(
      containerRef.current?.querySelectorAll<HTMLElement>('.live-bar') ?? [],
    );
    if (elements.length === 0) return;

    if (!playing) {
      elements.forEach((element, index) => {
        element.style.transform = `scaleY(${0.18 + (index % 3) * 0.08})`;
      });
      return;
    }

    let frame = 0;
    let last = 0;
    const tick = (time: number) => {
      if (time - last > 55) {
        last = time;
        const levels = getLevels?.(elements.length) ?? null;
        elements.forEach((element, index) => {
          const value = levels
            ? Math.max(0.12, levels[index] ?? 0)
            : 0.28 + 0.5 * Math.abs(Math.sin(time / 260 + index * 0.85));
          element.style.transform = `scaleY(${Math.min(1, Math.max(0.1, value)).toFixed(3)})`;
        });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, bars, getLevels]);

  return (
    <span ref={containerRef} className={`live-bars ${className}`} aria-hidden="true">
      {Array.from({ length: bars }, (_, index) => (
        <span key={index} className="live-bar" />
      ))}
    </span>
  );
}
