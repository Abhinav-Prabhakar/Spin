import { useCallback, useEffect, useRef, useState } from 'react';
import type { Playback, Track, TransportEvent } from '@shared/types';
import { clamp, trackArtUrl, trackAudioUrl } from '../lib/media';
import {
  EQ_BANDS,
  clampGain,
  presetById,
  readEq,
  storeEq,
  type EqPresetId,
  type EqState,
} from '../lib/equalizer';

interface AudioEngineOptions {
  code: string;
  playback: Playback | null;
  tracks: Track[];
  offsetRef: { current: number };
  onTransport: (event: TransportEvent) => void;
  onEnded: (trackId: string) => void;
}

export interface AudioEngine {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  blocked: boolean;
  buffering: boolean;
  duration: number;
  volume: number;
  muted: boolean;
  setVolume: (value: number) => void;
  toggleMute: () => void;
  retry: () => void;
  seek: (seconds: number) => void;
  getProgress: () => number;
  getLevels: (bands: number) => number[] | null;
  currentTrack: Track | null;
  eq: EqState;
  setEqEnabled: (enabled: boolean) => void;
  setEqBand: (index: number, gain: number) => void;
  applyEqPreset: (id: EqPresetId) => void;
}

interface Graph {
  ctx: AudioContext;
  analyser: AnalyserNode;
  filters: BiquadFilterNode[];
  data: Uint8Array<ArrayBuffer>;
}

const VOLUME_KEY = 'spin.volume';
const MUTED_KEY = 'spin.muted';

function storedVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    const value = raw === null ? Number.NaN : Number(raw);
    if (Number.isFinite(value)) return clamp(value, 0, 1);
  } catch {
    /* noop */
  }
  return 0.82;
}

function storedMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === '1';
  } catch {
    return false;
  }
}

function targetSeconds(playback: Playback | null, offset: number): number {
  if (!playback) return 0;
  if (!playback.playing) return Math.max(0, playback.position);
  return Math.max(0, playback.position + (Date.now() + offset - playback.serverTime) / 1000);
}

function setTime(audio: HTMLAudioElement, seconds: number) {
  try {
    audio.currentTime = Math.max(0, seconds);
  } catch {
    /* the media may not be seekable yet */
  }
}

export function useAudioEngine({
  code,
  playback,
  tracks,
  offsetRef,
  onTransport,
  onEnded,
}: AudioEngineOptions): AudioEngine {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playbackRef = useRef<Playback | null>(playback);
  const tracksRef = useRef<Track[]>(tracks);
  const transportRef = useRef(onTransport);
  const endedRef = useRef(onEnded);

  playbackRef.current = playback;
  tracksRef.current = tracks;
  transportRef.current = onTransport;
  endedRef.current = onEnded;

  const [blocked, setBlocked] = useState(false);
  const blockedRef = useRef(false);
  const [buffering, setBuffering] = useState(false);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(storedVolume);
  const [muted, setMuted] = useState(storedMuted);
  const [eq, setEq] = useState<EqState>(readEq);
  const eqRef = useRef(eq);
  eqRef.current = eq;

  const loadedTrackRef = useRef<string | null>(null);
  const loadTokenRef = useRef(0);
  const playAttemptRef = useRef(false);
  const lastLocalSeekRef = useRef<{ at: number; position: number }>({ at: 0, position: 0 });
  const graphRef = useRef<Graph | null>(null);
  const graphBootRef = useRef<Promise<void> | null>(null);

  const currentTrack = playback?.trackId
    ? tracks.find((track) => track.id === playback.trackId) ?? null
    : null;

  const trackDuration = useCallback((trackId: string | null): number => {
    if (!trackId) return 0;
    return tracksRef.current.find((track) => track.id === trackId)?.duration ?? 0;
  }, []);

  const applyEqGains = useCallback((state: EqState) => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.filters.forEach((filter, index) => {
      filter.gain.value = state.enabled ? state.gains[index] ?? 0 : 0;
    });
  }, []);

  const warm = useCallback(async () => {
    if (!audioRef.current) return;
    const existing = graphRef.current;
    if (existing) {
      if (existing.ctx.state === 'suspended') {
        await existing.ctx.resume().catch(() => {});
      }
      applyEqGains(eqRef.current);
      return;
    }
    if (graphBootRef.current) {
      await graphBootRef.current;
      return;
    }

    graphBootRef.current = (async () => {
      let source: MediaElementAudioSourceNode | null = null;
      let ctx: AudioContext | null = null;
      try {
        const Ctor: typeof AudioContext =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!Ctor || !audioRef.current) return;
        ctx = new Ctor();
        await ctx.resume().catch(() => {});
        if (ctx.state !== 'running' || !audioRef.current) {
          void ctx.close().catch(() => {});
          return;
        }
        source = ctx.createMediaElementSource(audioRef.current);
        const state = eqRef.current;
        const filters = EQ_BANDS.map((band, index) => {
          const filter = ctx!.createBiquadFilter();
          filter.type = band.type;
          filter.frequency.value = band.frequency;
          filter.Q.value = band.q;
          filter.gain.value = state.enabled ? state.gains[index] ?? 0 : 0;
          return filter;
        });
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 128;
        analyser.smoothingTimeConstant = 0.8;
        source.connect(filters[0]);
        for (let i = 0; i < filters.length - 1; i++) {
          filters[i].connect(filters[i + 1]);
        }
        filters[filters.length - 1].connect(analyser);
        analyser.connect(ctx.destination);
        graphRef.current = {
          ctx,
          analyser,
          filters,
          data: new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount)),
        };
      } catch {
        // Never leave the element silent if the graph could not be built.
        if (source && ctx) {
          try {
            source.connect(ctx.destination);
          } catch {
            /* Web Audio is a bonus, never a requirement */
          }
        } else if (ctx) {
          void ctx.close().catch(() => {});
        }
      } finally {
        graphBootRef.current = null;
      }
    })();
    await graphBootRef.current;
  }, [applyEqGains]);

  const attemptPlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !audio.src || blockedRef.current) return;
    if (!audio.paused) return;
    if (playAttemptRef.current) return;
    playAttemptRef.current = true;
    try {
      await audio.play();
      setBuffering(false);
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError') {
        blockedRef.current = true;
        setBlocked(true);
      }
    } finally {
      playAttemptRef.current = false;
    }
  }, []);

  const reconcile = useCallback(() => {
    const audio = audioRef.current;
    const state = playbackRef.current;
    if (!audio) return;

    if (!state?.trackId) {
      if (!audio.paused) audio.pause();
      audio.playbackRate = 1;
      return;
    }
    if (loadedTrackRef.current !== state.trackId) return;
    if (audio.readyState < 1) return;

    const mediaDuration =
      Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : trackDuration(state.trackId);
    const target = clamp(
      targetSeconds(state, offsetRef.current),
      0,
      mediaDuration > 0 ? mediaDuration : Number.MAX_SAFE_INTEGER,
    );

    if (state.playing) {
      if (audio.paused) {
        if (Math.abs(audio.currentTime - target) > 0.25) {
          setTime(audio, target);
        }
        void attemptPlay();
        return;
      }

      const sinceLocalSeek = Date.now() - lastLocalSeekRef.current.at;
      if (sinceLocalSeek < 700) return;

      const drift = audio.currentTime - target;
      if (Math.abs(drift) > 0.4) {
        setTime(audio, target);
        audio.playbackRate = 1;
      } else if (Math.abs(drift) > 0.06) {
        audio.playbackRate = clamp(1 - drift * 0.09, 0.96, 1.04);
      } else if (Math.abs(audio.playbackRate - 1) > 0.001) {
        audio.playbackRate = 1;
      }
    } else {
      if (!audio.paused) audio.pause();
      audio.playbackRate = 1;
      if (Math.abs(audio.currentTime - target) > 0.09) setTime(audio, target);
    }
  }, [attemptPlay, offsetRef, trackDuration]);

  const seek = useCallback(
    (seconds: number) => {
      const audio = audioRef.current;
      const state = playbackRef.current;
      if (!audio || !state?.trackId) return;
      const max = Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : trackDuration(state.trackId);
      const next = clamp(seconds, 0, max > 0 ? max : seconds);
      lastLocalSeekRef.current = { at: Date.now(), position: next };
      setTime(audio, next);
      if (state.playing) void attemptPlay();
      transportRef.current({ action: 'seek', position: next });
    },
    [attemptPlay, trackDuration],
  );

  const retry = useCallback(() => {
    blockedRef.current = false;
    setBlocked(false);
    void warm().then(() => attemptPlay());
  }, [attemptPlay, warm]);

  const setVolume = useCallback((value: number) => {
    const next = clamp(value, 0, 1);
    setVolumeState(next);
    if (next > 0) setMuted(false);
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((prev) => !prev);
  }, []);

  const commitEq = useCallback(
    (next: EqState) => {
      eqRef.current = next;
      setEq(next);
      storeEq(next);
      applyEqGains(next);
      void warm();
    },
    [applyEqGains, warm],
  );

  const setEqEnabled = useCallback(
    (enabled: boolean) => {
      commitEq({ ...eqRef.current, enabled });
    },
    [commitEq],
  );

  const setEqBand = useCallback(
    (index: number, gain: number) => {
      const current = eqRef.current;
      if (index < 0 || index >= current.gains.length) return;
      const gains = [...current.gains];
      gains[index] = clampGain(gain);
      commitEq({ enabled: true, gains, preset: 'custom' });
    },
    [commitEq],
  );

  const applyEqPreset = useCallback(
    (id: EqPresetId) => {
      const preset = presetById(id);
      if (!preset) return;
      const current = eqRef.current;
      commitEq({
        enabled: id === 'flat' ? current.enabled : true,
        gains: [...preset.gains],
        preset: preset.id,
      });
    },
    [commitEq],
  );

  const getProgress = useCallback((): number => {
    const state = playbackRef.current;
    const audio = audioRef.current;
    if (!state?.trackId) return 0;
    if (blockedRef.current || !audio || audio.readyState < 1) {
      return targetSeconds(state, offsetRef.current);
    }
    if (!state.playing && Math.abs(audio.currentTime - state.position) > 0.75) {
      return state.position;
    }
    return audio.currentTime;
  }, [offsetRef]);

  const getLevels = useCallback((bands: number): number[] | null => {
    const graph = graphRef.current;
    if (!graph || graph.ctx.state !== 'running') return null;
    graph.analyser.getByteFrequencyData(graph.data);
    const count = Math.max(2, Math.floor(bands));
    const binCount = graph.data.length;
    const minBin = 1;
    const maxBin = Math.max(8, Math.floor(binCount * 0.72));
    const ratio = maxBin / minBin;
    const levels: number[] = [];
    for (let i = 0; i < count; i++) {
      const start = Math.floor(minBin * Math.pow(ratio, i / count));
      const end = Math.max(start + 1, Math.floor(minBin * Math.pow(ratio, (i + 1) / count)));
      let sum = 0;
      for (let j = start; j < end && j < binCount; j++) sum += graph.data[j] ?? 0;
      const average = sum / Math.max(1, end - start) / 255;
      levels.push(clamp(Math.pow(average * 1.6, 0.72), 0, 1));
    }
    return levels;
  }, []);

  // Load a newly selected track.
  useEffect(() => {
    const audio = audioRef.current;
    const state = playbackRef.current;
    if (!audio) return;

    if (!state?.trackId) {
      loadTokenRef.current++;
      loadedTrackRef.current = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      setDuration(0);
      setBuffering(false);
      blockedRef.current = false;
      setBlocked(false);
      return;
    }

    if (loadedTrackRef.current === state.trackId) return;
    const track = tracksRef.current.find((item) => item.id === state.trackId);
    if (!track) return;

    loadedTrackRef.current = track.id;
    const token = ++loadTokenRef.current;
    blockedRef.current = false;
    setBlocked(false);
    setBuffering(true);
    setDuration(track.duration);
    audio.src = trackAudioUrl(code, track.id);
    audio.load();

    const applyStart = () => {
      if (token !== loadTokenRef.current) return;
      setBuffering(false);
      if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
      const current = playbackRef.current;
      if (!current || current.trackId !== track.id) return;
      const max = Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : track.duration;
      const target = clamp(targetSeconds(current, offsetRef.current), 0, max > 0 ? max : Number.MAX_SAFE_INTEGER);
      setTime(audio, target);
      if (current.playing) void attemptPlay();
    };

    audio.addEventListener('loadedmetadata', applyStart, { once: true });
    audio.addEventListener('canplay', applyStart, { once: true });
  }, [playback?.trackId, tracks, code, attemptPlay, offsetRef]);

  // Reconcile on every room event and once a second.
  useEffect(() => {
    reconcile();
  }, [playback, reconcile]);

  useEffect(() => {
    const timer = window.setInterval(reconcile, 1000);
    const onVisibility = () => {
      if (!document.hidden) reconcile();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [reconcile]);

  // Volume, muting, and persistence.
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = volume;
      audio.muted = muted;
    }
    try {
      localStorage.setItem(VOLUME_KEY, String(volume));
      localStorage.setItem(MUTED_KEY, muted ? '1' : '0');
    } catch {
      /* noop */
    }
  }, [volume, muted]);

  // Element lifecycle events.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onWaiting = () => {
      if (playbackRef.current?.playing && !blockedRef.current) setBuffering(true);
    };
    const onPlaying = () => {
      setBuffering(false);
      blockedRef.current = false;
      setBlocked(false);
      audio.playbackRate = 1;
    };
    const onPause = () => setBuffering(false);
    const onDuration = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
    };
    const onEnded = () => {
      const state = playbackRef.current;
      if (!state?.trackId || !state.playing) return;
      if (loadedTrackRef.current !== state.trackId) return;
      endedRef.current(state.trackId);
    };

    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('stalled', onWaiting);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('durationchange', onDuration);
    audio.addEventListener('loadedmetadata', onDuration);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('stalled', onWaiting);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('durationchange', onDuration);
      audio.removeEventListener('loadedmetadata', onDuration);
      audio.removeEventListener('ended', onEnded);
    };
  }, []);

  // Build the analyser only from a real gesture, so browsers can't silently
  // route playback into a suspended audio context.
  useEffect(() => {
    const gesture = () => {
      void warm();
    };
    window.addEventListener('pointerdown', gesture);
    window.addEventListener('keydown', gesture);
    return () => {
      window.removeEventListener('pointerdown', gesture);
      window.removeEventListener('keydown', gesture);
    };
  }, [warm]);

  useEffect(() => {
    return () => {
      const graph = graphRef.current;
      graphRef.current = null;
      if (graph) void graph.ctx.close().catch(() => {});
    };
  }, []);

  // System media controls.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    const handle = (fn: () => void) => (details?: MediaSessionActionDetails) => {
      void details;
      fn();
    };
    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler | null]> = [
      ['play', handle(() => transportRef.current({ action: 'play' }))],
      ['pause', handle(() => transportRef.current({ action: 'pause' }))],
      ['previoustrack', handle(() => transportRef.current({ action: 'prev' }))],
      ['nexttrack', handle(() => transportRef.current({ action: 'next' }))],
      [
        'seekto',
        (details) => {
          if (typeof details.seekTime === 'number') {
            transportRef.current({ action: 'seek', position: details.seekTime });
          }
        },
      ],
      [
        'seekbackward',
        (details) => {
          const offset = details.seekOffset ?? 10;
          transportRef.current({ action: 'seek', position: Math.max(0, getProgress() - offset) });
        },
      ],
      [
        'seekforward',
        (details) => {
          const offset = details.seekOffset ?? 10;
          transportRef.current({ action: 'seek', position: getProgress() + offset });
        },
      ],
    ];
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        /* unsupported action */
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          session.setActionHandler(action, null);
        } catch {
          /* noop */
        }
      }
    };
  }, [getProgress]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if (!currentTrack) {
      navigator.mediaSession.metadata = null;
      return;
    }
    const artwork: MediaImage[] = currentTrack.hasArt
      ? [
          { src: trackArtUrl(code, currentTrack.id), sizes: '640x640', type: 'image/jpeg' },
        ]
      : [];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.artist || 'Spin',
      album: currentTrack.album || 'Spin room',
      artwork,
    });
  }, [currentTrack, code]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = playback?.playing ? 'playing' : 'paused';
  }, [playback?.playing]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const timer = window.setInterval(() => {
      const audio = audioRef.current;
      const mediaDuration =
        Number.isFinite(audio?.duration) && (audio?.duration ?? 0) > 0
          ? audio?.duration ?? 0
          : duration;
      if (!audio || !playbackRef.current?.trackId || !mediaDuration) return;
      try {
        navigator.mediaSession.setPositionState({
          duration: mediaDuration,
          playbackRate: audio.playbackRate || 1,
          position: clamp(audio.currentTime, 0, mediaDuration),
        });
      } catch {
        /* position state is not critical */
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [duration]);

  return {
    audioRef,
    blocked,
    buffering,
    duration,
    volume,
    muted,
    setVolume,
    toggleMute,
    retry,
    seek,
    getProgress,
    getLevels,
    currentTrack,
    eq,
    setEqEnabled,
    setEqBand,
    applyEqPreset,
  };
}
