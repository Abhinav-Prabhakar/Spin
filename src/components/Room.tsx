import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, CloudUpload } from 'lucide-react';
import type { ToastItem } from './Toasts';
import { Header } from './Header';
import { Hearts } from './Hearts';
import { NowPlaying } from './NowPlaying';
import { Equalizer } from './Equalizer';
import { Queue } from './Queue';
import { UploadTray } from './UploadTray';
import { Toasts } from './Toasts';
import { Brand } from './Brand';
import { useRoom } from '../hooks/useRoom';
import { useAudioEngine } from '../hooks/useAudioEngine';
import { useUploads } from '../hooks/useUploads';
import { inviteUrl } from '../lib/media';

interface RoomProps {
  code: string;
  onHome: () => void;
}

function isFileDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

export function Room({ code, onHome }: RoomProps) {
  const room = useRoom(code);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastId = useRef(0);
  const toastTimers = useRef<number[]>([]);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [slow, setSlow] = useState(false);
  const [eqOpen, setEqOpen] = useState(false);

  const toast = useCallback((message: string) => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev.slice(-2), { id, message }]);
    const timer = window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 3200);
    toastTimers.current.push(timer);
  }, []);

  const uploads = useUploads(code, room.socketId, toast);
  const engine = useAudioEngine({
    code,
    playback: room.playback,
    tracks: room.tracks,
    offsetRef: room.offsetRef,
    onTransport: room.send,
    onEnded: room.playerEnded,
    onMeta: room.reportMeta,
    onError: toast,
  });

  const currentTrack = room.playback?.trackId
    ? room.tracks.find((track) => track.id === room.playback?.trackId) ?? null
    : null;

  useEffect(() => {
    return () => {
      for (const timer of toastTimers.current) window.clearTimeout(timer);
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    };
  }, []);

  useEffect(() => {
    if (room.status !== 'loading') {
      setSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setSlow(true), 4500);
    return () => window.clearTimeout(timer);
  }, [room.status]);

  const openPicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const copyInvite = useCallback(async () => {
    const url = inviteUrl(code);
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      try {
        const field = document.createElement('textarea');
        field.value = url;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        ok = document.execCommand('copy');
        field.remove();
      } catch {
        ok = false;
      }
    }
    if (!ok) {
      toast("Couldn't copy the link.");
      return;
    }
    setCopied(true);
    toast('Invite link copied');
    if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1800);
  }, [code, toast]);

  const shareInvite = useCallback(async () => {
    const url = inviteUrl(code);
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Spin — listen together',
          text: 'Come listen with me.',
          url,
        });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }
    void copyInvite();
  }, [code, copyInvite]);

  // Drag a file anywhere in the room to share it.
  useEffect(() => {
    const onDragEnter = (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const onDragLeave = (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length > 0) uploads.addFiles(files);
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [uploads.addFiles]);

  // Global shortcuts, kept out of the way while typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          'input, textarea, select, button, a, [role="slider"], [contenteditable="true"]',
        )
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (room.status !== 'ready') return;
      if (event.code === 'Space') {
        event.preventDefault();
        const playing = Boolean(room.playback?.playing);
        room.send({ action: playing ? 'pause' : 'play' });
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        engine.seek(engine.getProgress() + 5);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        engine.seek(engine.getProgress() - 5);
      } else if (event.key.toLowerCase() === 'm') {
        event.preventDefault();
        engine.toggleMute();
      } else if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        room.send({ action: 'next' });
      } else if (event.key.toLowerCase() === 'e') {
        event.preventDefault();
        setEqOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine, room]);

  const selectTrack = useCallback(
    (id: string) => {
      if (id === room.playback?.trackId) {
        room.send({ action: room.playback?.playing ? 'pause' : 'play' });
      } else {
        room.send({ action: 'select', trackId: id });
      }
    },
    [room],
  );

  if (room.status === 'error') {
    const notFound = room.error === 'not-found';
    return (
      <div className="room-page">
        <header className="app-header">
          <Brand />
          <span />
          <div className="header-right">
            <button type="button" className="invite-btn" onClick={onHome}>
              <ArrowLeft size={15} strokeWidth={1.8} />
              <span>Home</span>
            </button>
          </div>
        </header>
        <main className="room-error">
          <div className="error-disc" aria-hidden="true">
            <span className="error-disc-label" />
            <span className="error-disc-slash" />
          </div>
          <h1>{notFound ? 'That room is gone.' : "That code doesn't compute."}</h1>
          <p>{notFound ? 'Ask a friend for a fresh invite.' : 'Double-check the six characters and try again.'}</p>
          <button type="button" className="ink-pill" onClick={onHome}>
            Back home
          </button>
        </main>
      </div>
    );
  }

  if (room.status === 'loading' || !room.playback || !room.me) {
    return (
      <div className="room-page">
        <header className="app-header">
          <Brand />
          <div className="room-pill is-static">
            <span className={`room-dot ${room.connected ? 'is-live' : 'is-away'}`} />
            <span className="room-code">{code}</span>
          </div>
          <span />
        </header>
        <main className="boot">
          <div className="boot-disc" aria-hidden="true">
            <span className="boot-groove" />
            <span className="boot-orbit">
              <span />
            </span>
            <span className="boot-label" />
          </div>
          <span className="boot-code">{code}</span>
          <span className={`boot-hint ${slow ? 'is-visible' : ''}`}>still reaching the room</span>
        </main>
      </div>
    );
  }

  return (
    <div className="room-page">
      <Header
        code={code}
        users={room.users}
        me={room.me}
        connected={room.connected}
        copied={copied}
        onHome={onHome}
        onCopy={copyInvite}
        onShare={shareInvite}
      />

      <main className="room-main">
        <NowPlaying
          code={code}
          track={currentTrack}
          playback={room.playback}
          hasTracks={room.tracks.length > 0}
          engine={engine}
          onTransport={room.send}
          onReact={room.react}
          onPick={openPicker}
          onEq={() => setEqOpen((prev) => !prev)}
          eqOpen={eqOpen}
        />
        <Queue
          code={code}
          tracks={room.tracks}
          currentId={room.playback.trackId}
          playing={room.playback.playing}
          getLevels={engine.getLevels}
          onSelect={selectTrack}
          onRemove={room.removeTrack}
          onReorder={room.reorder}
          onPick={openPicker}
          onAddLink={uploads.addLink}
        />
      </main>

      <Equalizer
        open={eqOpen}
        eq={engine.eq}
        available={engine.eqAvailable}
        onClose={() => setEqOpen(false)}
        onEnabled={engine.setEqEnabled}
        onBand={engine.setEqBand}
        onPreset={engine.applyEqPreset}
      />

      <audio ref={engine.audioRef} preload="auto" playsInline crossOrigin="anonymous" />
      <audio ref={engine.plainAudioRef} preload="auto" playsInline />

      <UploadTray items={uploads.items} onCancel={uploads.cancel} />
      <Hearts reactions={room.reactions} />
      <Toasts items={toasts} />

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,.mp3,.m4a,.mp4,.wav,.ogg,.oga,.flac,.webm,.opus"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length > 0) uploads.addFiles(files);
        }}
      />

      <AnimatePresence>
        {dragging && (
          <motion.div
            className="drop-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <div className="drop-target">
              <span className="drop-icon">
                <CloudUpload size={30} strokeWidth={1.5} />
              </span>
              <span className="drop-title">Drop to share</span>
              <span className="drop-sub">mp3 · wav · m4a — or paste a link</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
