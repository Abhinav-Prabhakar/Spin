import { AnimatePresence, motion } from 'framer-motion';
import {
  CloudUpload,
  Headphones,
  Heart,
  Plus,
  Repeat,
  Repeat1,
  Shuffle,
  SlidersHorizontal,
} from 'lucide-react';
import type { Playback, Track, TransportEvent } from '@shared/types';
import type { AudioEngine } from '../hooks/useAudioEngine';
import { formatTime } from '../lib/media';
import { Cover } from './Cover';
import { NextGlyph, PauseGlyph, PlayGlyph, PrevGlyph } from './Glyphs';
import { LiveBars } from './LiveBars';
import { Avatar } from './Avatar';
import { Timeline } from './Timeline';
import { Volume } from './Volume';

interface NowPlayingProps {
  code: string;
  track: Track | null;
  playback: Playback | null;
  hasTracks: boolean;
  engine: AudioEngine;
  onTransport: (event: TransportEvent) => void;
  onReact: () => void;
  onPick: () => void;
  onEq: () => void;
  eqOpen: boolean;
}

export function NowPlaying({
  code,
  track,
  playback,
  hasTracks,
  engine,
  onTransport,
  onReact,
  onPick,
  onEq,
  eqOpen,
}: NowPlayingProps) {
  const playing = Boolean(playback?.playing);
  const repeat = playback?.repeat ?? 'off';
  const shuffle = Boolean(playback?.shuffle);
  const showListenOverlay = Boolean(track && playing && engine.blocked);
  const addedBy = track?.addedBy
    ? { id: 'added-by', name: track.addedBy.name, hue: track.addedBy.hue }
    : null;

  const togglePlay = () => {
    if (!track) {
      onPick();
      return;
    }
    onTransport({ action: playing ? 'pause' : 'play' });
  };

  const cycleRepeat = () => {
    const next = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off';
    onTransport({ action: 'repeat', mode: next });
  };

  return (
    <section className="stage" aria-label="Now playing">
      <div className="cover-stage">
        <AnimatePresence initial={false}>
          <motion.div
            key={track?.id ?? 'empty'}
            className="cover-shell"
            initial={{ opacity: 0, scale: 0.965, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.985 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className={`cover-breathe ${playing && !showListenOverlay ? 'is-playing' : ''}`}>
              {track ? (
                <Cover track={track} code={code} priority />
              ) : (
                <button type="button" className="cover-empty" onClick={onPick}>
                  <span className="cover-empty-icon">
                    <CloudUpload size={26} strokeWidth={1.5} />
                  </span>
                  <span className="cover-empty-label">drop or choose a song</span>
                </button>
              )}
            </div>

            {track && !showListenOverlay && (
              <button
                type="button"
                className="cover-tap"
                onClick={togglePlay}
                aria-label={playing ? 'Pause' : 'Play'}
              >
                <span className="cover-tap-icon">
                  {playing ? <PauseGlyph size={18} /> : <PlayGlyph size={18} />}
                </span>
              </button>
            )}

            <AnimatePresence>
              {showListenOverlay && (
                <motion.button
                  type="button"
                  className="listen-overlay"
                  onClick={engine.retry}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <span className="listen-overlay-icon">
                    <Headphones size={21} strokeWidth={1.6} />
                  </span>
                  <span>tap to listen</span>
                </motion.button>
              )}
            </AnimatePresence>
          </motion.div>
        </AnimatePresence>
        <span className="cover-frame" aria-hidden="true" />
      </div>

      <div className="track-info">
        {track ? (
          <>
            <h1 className="track-title" title={track.title}>
              {track.title}
            </h1>
            <div className="artist-row">
              {track.artist && <span className="track-artist">{track.artist}</span>}
              {track.artist && addedBy && <span className="meta-dot" />}
              {addedBy && <Avatar user={addedBy} size={15} className="added-by" />}
              <LiveBars
                playing={playing}
                bars={4}
                getLevels={engine.getLevels}
                className="title-bars"
              />
            </div>
          </>
        ) : (
          <>
            <h1 className="track-title empty-title">Start with a song</h1>
            <p className="track-artist">Everyone hears it together.</p>
          </>
        )}
      </div>

      {track && engine.sourceError && (
        <button type="button" className="track-source-error" onClick={engine.retry}>
          {engine.sourceError} <span>Try again</span>
        </button>
      )}

      <Timeline
        peaks={track?.peaks ?? []}
        seed={track?.id ?? 'empty-room'}
        duration={track?.duration ?? 0}
        disabled={!track}
        getProgress={engine.getProgress}
        onSeek={engine.seek}
      />

      {track ? (
        <>
          <div className="transport">
            <button
              type="button"
              className={`icon-btn ${shuffle ? 'is-active' : ''}`}
              onClick={() => onTransport({ action: 'shuffle', value: !shuffle })}
              aria-pressed={shuffle}
              aria-label={shuffle ? 'Turn shuffle off' : 'Turn shuffle on'}
              title="Shuffle"
            >
              <Shuffle size={17} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => onTransport({ action: 'prev' })}
              aria-label="Previous track"
              title="Previous"
            >
              <PrevGlyph size={21} />
            </button>
            <button
              type="button"
              className={`play-btn ${playing && engine.buffering ? 'is-buffering' : ''}`}
              onClick={togglePlay}
              aria-label={playing ? 'Pause' : 'Play'}
              title={playing ? 'Pause' : 'Play'}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={playing ? 'pause' : 'play'}
                  initial={{ opacity: 0, scale: 0.7 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.7 }}
                  transition={{ duration: 0.14 }}
                  className="play-glyph"
                >
                  {playing ? <PauseGlyph size={25} /> : <PlayGlyph size={25} />}
                </motion.span>
              </AnimatePresence>
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => onTransport({ action: 'next' })}
              aria-label="Next track"
              title="Next"
            >
              <NextGlyph size={21} />
            </button>
            <button
              type="button"
              className={`icon-btn ${repeat !== 'off' ? 'is-active' : ''}`}
              onClick={cycleRepeat}
              aria-label={`Repeat ${repeat}`}
              title={`Repeat: ${repeat}`}
            >
              {repeat === 'one' ? (
                <Repeat1 size={17} strokeWidth={1.8} />
              ) : (
                <Repeat size={17} strokeWidth={1.8} />
              )}
            </button>
          </div>

          <div className="stage-utils">
            <div className="stage-tools">
              <Volume
                volume={engine.volume}
                muted={engine.muted}
                onVolume={engine.setVolume}
                onToggleMute={engine.toggleMute}
              />
              <button
                type="button"
                className={`eq-btn ${eqOpen || engine.eq.enabled ? 'is-active' : ''}`}
                onClick={onEq}
                aria-label="Equalizer"
                aria-expanded={eqOpen}
                title="Equalizer (E)"
              >
                <SlidersHorizontal size={15} strokeWidth={1.8} />
                <span className={`eq-dot ${engine.eq.enabled ? 'is-on' : ''}`} aria-hidden="true" />
              </button>
            </div>
            <motion.button
              type="button"
              className="react-btn"
              onClick={onReact}
              aria-label="Send some love"
              title="Send some love"
              whileTap={{ scale: 0.84 }}
            >
              <Heart size={16} strokeWidth={1.8} />
            </motion.button>
          </div>
        </>
      ) : (
        <div className="empty-actions">
          <button type="button" className="ink-pill" onClick={onPick}>
            <Plus size={16} strokeWidth={2} />
            Share a song
          </button>
          <span className="empty-hint">or drop a file anywhere</span>
        </div>
      )}

      {hasTracks && !track && <span className="sr-only">No track selected</span>}
      {track && (
        <span className="sr-only">
          {track.artist ? `${track.artist}, ` : ''}
          {formatTime(track.duration)}
        </span>
      )}
    </section>
  );
}
