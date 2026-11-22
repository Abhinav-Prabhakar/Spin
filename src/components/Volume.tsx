import { Volume1, Volume2, VolumeX } from 'lucide-react';

interface VolumeProps {
  volume: number;
  muted: boolean;
  onVolume: (value: number) => void;
  onToggleMute: () => void;
}

export function Volume({ volume, muted, onVolume, onToggleMute }: VolumeProps) {
  const value = muted ? 0 : volume;
  const Icon = muted || value === 0 ? VolumeX : value < 0.45 ? Volume1 : Volume2;

  return (
    <div className="volume">
      <button
        type="button"
        className="volume-btn"
        onClick={onToggleMute}
        aria-label={muted ? 'Unmute' : 'Mute'}
        title={muted ? 'Unmute' : 'Mute'}
      >
        <Icon size={17} strokeWidth={1.7} />
      </button>
      <input
        className="volume-range"
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        aria-label="Volume"
        onChange={(event) => onVolume(Number(event.target.value))}
        style={{ '--fill': `${Math.round(value * 100)}%` } as React.CSSProperties}
      />
    </div>
  );
}
