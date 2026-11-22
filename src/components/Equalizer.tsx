import { useEffect, useRef, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { RotateCcw, X } from 'lucide-react';
import {
  EQ_BANDS,
  EQ_MAX,
  EQ_PRESETS,
  EQ_MIN,
  type EqPresetId,
  type EqState,
} from '../lib/equalizer';

interface EqualizerProps {
  open: boolean;
  eq: EqState;
  /** Non-CORS sources bypass Web Audio, so the curve cannot be applied. */
  available?: boolean;
  onClose: () => void;
  onEnabled: (enabled: boolean) => void;
  onBand: (index: number, gain: number) => void;
  onPreset: (id: EqPresetId) => void;
}

const CURVE_W = 100;
const CURVE_H = 34;
const CURVE_PAD = 4;

function curvePoints(gains: number[]): Array<readonly [number, number]> {
  return gains.map((gain, index) => {
    const x = CURVE_PAD + (index / (gains.length - 1)) * (CURVE_W - CURVE_PAD * 2);
    const y =
      CURVE_PAD +
      ((EQ_MAX - gain) / (EQ_MAX - EQ_MIN)) * (CURVE_H - CURVE_PAD * 2);
    return [x, y] as const;
  });
}

function curvePath(points: Array<readonly [number, number]>): string {
  return points
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');
}

export function Equalizer({
  open,
  eq,
  available = true,
  onClose,
  onEnabled,
  onBand,
  onPreset,
}: EqualizerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 60);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.clearTimeout(focusTimer);
    };
  }, [open, onClose]);

  const points = curvePoints(eq.gains);
  const path = curvePath(points);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="eq-scrim"
          onPointerDown={(event) => {
            if (panelRef.current && !panelRef.current.contains(event.target as Node)) onClose();
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <motion.div
            ref={panelRef}
            className={`eq-panel ${eq.enabled ? 'is-on' : 'is-off'} ${available ? '' : 'is-unavailable'}`}
            role="dialog"
            aria-modal="true"
            aria-label="Equalizer"
            initial={{ opacity: 0, y: 14, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.99 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            <header className="eq-head">
              <div className="eq-title">
                <span className="eq-title-main">Equalizer</span>
                <span className="eq-title-sub">10 band · ±12 dB</span>
              </div>
              <div className="eq-head-actions">
                <button
                  type="button"
                  className={`eq-toggle ${eq.enabled ? 'is-on' : ''}`}
                  onClick={() => onEnabled(!eq.enabled)}
                  role="switch"
                  aria-checked={eq.enabled && available}
                  aria-label="Equalizer on"
                  disabled={!available}
                >
                  <span className="eq-toggle-knob" />
                </button>
                <button
                  ref={closeRef}
                  type="button"
                  className="eq-close"
                  onClick={onClose}
                  aria-label="Close equalizer"
                >
                  <X size={15} strokeWidth={1.9} />
                </button>
              </div>
            </header>

            <div className="eq-presets" role="group" aria-label="Equalizer presets">
              {EQ_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={`eq-preset ${eq.preset === preset.id ? 'is-active' : ''}`}
                  onClick={() => onPreset(preset.id)}
                  aria-pressed={eq.preset === preset.id}
                  disabled={!available}
                >
                  {preset.name}
                </button>
              ))}
            </div>

            <div className="eq-curve" aria-hidden="true">
              <svg viewBox={`0 0 ${CURVE_W} ${CURVE_H}`} preserveAspectRatio="none">
                <line
                  x1="0"
                  y1={CURVE_H / 2}
                  x2={CURVE_W}
                  y2={CURVE_H / 2}
                  stroke="currentColor"
                  strokeWidth="0.35"
                  strokeDasharray="1.5 1.5"
                  opacity="0.3"
                />
                <path
                  d={`${path} L${CURVE_W - CURVE_PAD},${CURVE_H - CURVE_PAD} L${CURVE_PAD},${CURVE_H - CURVE_PAD} Z`}
                  fill="url(#eq-fill)"
                  opacity={eq.enabled ? 1 : 0.35}
                />
                <path
                  d={path}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="0.9"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  opacity={eq.enabled ? 1 : 0.4}
                />
                {points.map(([x, y], index) => (
                  <circle
                    key={index}
                    cx={x}
                    cy={y}
                    r="1"
                    fill="#fff"
                    stroke="currentColor"
                    strokeWidth="0.65"
                    opacity={eq.enabled ? 0.9 : 0.4}
                  />
                ))}
                <defs>
                  <linearGradient id="eq-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
                    <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                  </linearGradient>
                </defs>
              </svg>
            </div>

            <div className="eq-bands">
              {EQ_BANDS.map((band, index) => {
                const gain = eq.gains[index] ?? 0;
                const fill = ((gain - EQ_MIN) / (EQ_MAX - EQ_MIN)) * 100;
                return (
                  <div className="eq-band" key={band.frequency}>
                    <span className="eq-value" aria-hidden="true">
                      {gain > 0 ? `+${gain}` : gain < 0 ? `${gain}` : '0'}
                    </span>
                    <input
                      type="range"
                      className="eq-slider"
                      min={EQ_MIN}
                      max={EQ_MAX}
                      step={0.5}
                      value={gain}
                      onChange={(event) => onBand(index, Number(event.target.value))}
                      aria-label={`${band.label} hertz`}
                      disabled={!available}
                      style={
                        {
                          '--eq-a': `${Math.min(fill, 50)}%`,
                          '--eq-b': `${Math.max(fill, 50)}%`,
                        } as CSSProperties
                      }
                    />
                    <span className="eq-frequency" aria-hidden="true">
                      {band.label}
                    </span>
                  </div>
                );
              })}
            </div>

            <footer className="eq-foot">
              <span className="eq-state">
                {!available
                  ? 'This source blocks the equalizer'
                  : eq.enabled
                    ? eq.preset === 'custom'
                      ? 'Custom curve'
                      : `${presetName(eq.preset)} curve`
                    : 'Bypassed'}
              </span>
              <button
                type="button"
                className="eq-reset"
                onClick={() => onPreset('flat')}
                title="Reset to flat"
                disabled={!available}
              >
                <RotateCcw size={12} strokeWidth={2} />
                <span>Reset</span>
              </button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function presetName(id: EqPresetId): string {
  return EQ_PRESETS.find((preset) => preset.id === id)?.name ?? 'Custom';
}
