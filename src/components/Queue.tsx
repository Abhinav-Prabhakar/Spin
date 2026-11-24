import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, Reorder, motion, useDragControls } from 'framer-motion';
import { CloudUpload, Disc3, LayoutGrid, Link2, List, Plus, X } from 'lucide-react';
import type { Track } from '@shared/types';
import { formatTime } from '../lib/media';
import { Cover } from './Cover';
import { LiveBars } from './LiveBars';
import { PlayGlyph } from './Glyphs';

type QueueView = 'list' | 'grid';

interface QueueProps {
  code: string;
  tracks: Track[];
  currentId: string | null;
  playing: boolean;
  getLevels: (bands: number) => number[] | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onReorder: (ids: string[]) => void;
  onPick: () => void;
  onAddLink: (url: string) => boolean;
}

export function Queue({
  code,
  tracks,
  currentId,
  playing,
  getLevels,
  onSelect,
  onRemove,
  onReorder,
  onPick,
  onAddLink,
}: QueueProps) {
  const [view, setView] = useState<QueueView>('list');
  const [order, setOrder] = useState<string[]>(() => tracks.map((track) => track.id));
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');

  useEffect(() => {
    const next = tracks.map((track) => track.id);
    setOrder((prev) => {
      if (prev.length === next.length && prev.every((id, index) => id === next[index])) return prev;
      return next;
    });
  }, [tracks]);

  const byId = new Map(tracks.map((track) => [track.id, track]));
  const ordered = order.map((id) => byId.get(id)).filter((track): track is Track => Boolean(track));

  const handleReorder = (nextIds: string[]) => {
    setOrder(nextIds);
    onReorder(nextIds);
  };

  const submitLink = (event: React.FormEvent) => {
    event.preventDefault();
    const value = linkValue.trim();
    if (!value) return;
    if (onAddLink(value)) {
      setLinkValue('');
      setLinkOpen(false);
    }
  };

  const openLink = () => {
    setLinkOpen(true);
  };

  return (
    <aside className="queue-panel" aria-label="Shared playlist">
      <div className="queue-head">
        <div className="view-toggle" role="group" aria-label="Playlist view">
          <button
            type="button"
            className={`view-toggle-btn ${view === 'list' ? 'is-active' : ''}`}
            onClick={() => setView('list')}
            aria-label="List view"
            aria-pressed={view === 'list'}
            title="List view"
          >
            <List size={15} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className={`view-toggle-btn ${view === 'grid' ? 'is-active' : ''}`}
            onClick={() => setView('grid')}
            aria-label="Grid view"
            aria-pressed={view === 'grid'}
            title="Grid view"
          >
            <LayoutGrid size={14} strokeWidth={1.8} />
          </button>
        </div>

        <div className="queue-head-right">
          <span className="queue-count" title={`${tracks.length} shared tracks`}>
            <Disc3 size={13} strokeWidth={1.7} />
            <span>{String(tracks.length).padStart(2, '0')}</span>
          </span>
          <button
            type="button"
            className={`queue-link-toggle ${linkOpen ? 'is-active' : ''}`}
            onClick={() => setLinkOpen((prev) => !prev)}
            aria-label="Add a link"
            aria-expanded={linkOpen}
            title="Add a link"
          >
            <Link2 size={15} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className="queue-add"
            onClick={onPick}
            aria-label="Share a track"
            title="Share a track"
          >
            <Plus size={17} strokeWidth={1.9} />
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {linkOpen && (
          <motion.form
            className="queue-link"
            onSubmit={submitLink}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <Link2 size={14} strokeWidth={1.8} aria-hidden="true" />
            <input
              className="queue-link-input"
              value={linkValue}
              onChange={(event) => setLinkValue(event.target.value)}
              placeholder="Paste any link…"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              aria-label="Link to add"
            />
            <button type="submit" className="queue-link-submit" disabled={!linkValue.trim()}>
              Add
            </button>
          </motion.form>
        )}
      </AnimatePresence>

      <div className="queue-body">
        <AnimatePresence mode="wait" initial={false}>
          {tracks.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            >
              <QueueEmpty onPick={onPick} onLink={openLink} />
            </motion.div>
          ) : view === 'list' ? (
            <motion.div
              key="list"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            >
              <Reorder.Group
                as="div"
                axis="y"
                values={order}
                onReorder={handleReorder}
                className="queue-list"
              >
                <AnimatePresence initial={false}>
                  {ordered.map((track) => (
                    <QueueRow
                      key={track.id}
                      track={track}
                      code={code}
                      active={track.id === currentId}
                      playing={playing && track.id === currentId}
                      getLevels={getLevels}
                      onSelect={onSelect}
                      onRemove={onRemove}
                    />
                  ))}
                </AnimatePresence>
              </Reorder.Group>
            </motion.div>
          ) : (
            <motion.div
              key="grid"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="queue-grid">
                <AnimatePresence initial={false}>
                  {ordered.map((track) => (
                    <QueueTile
                      key={track.id}
                      track={track}
                      code={code}
                      active={track.id === currentId}
                      playing={playing && track.id === currentId}
                      getLevels={getLevels}
                      onSelect={onSelect}
                      onRemove={onRemove}
                    />
                  ))}
                </AnimatePresence>
                <button
                  type="button"
                  className="queue-tile-add"
                  onClick={onPick}
                  aria-label="Share another track"
                  title="Share a track"
                >
                  <span>
                    <Plus size={18} strokeWidth={1.7} />
                  </span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </aside>
  );
}

interface RowProps {
  track: Track;
  code: string;
  active: boolean;
  playing: boolean;
  getLevels: (bands: number) => number[] | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}

function QueueRow({ track, code, active, playing, getLevels, onSelect, onRemove }: RowProps) {
  const controls = useDragControls();
  const lastDrag = useRef(0);

  const select = () => {
    if (Date.now() - lastDrag.current < 250) return;
    onSelect(track.id);
  };

  return (
    <Reorder.Item
      as="div"
      value={track.id}
      dragListener={false}
      dragControls={controls}
      onDragStart={() => {
        lastDrag.current = Date.now();
      }}
      onDragEnd={() => {
        lastDrag.current = Date.now();
      }}
      whileDrag={{ scale: 1.015, zIndex: 6 }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="queue-item"
    >
      <div className={`queue-row ${active ? 'is-active' : ''}`}>
        <button type="button" className="queue-main" onClick={select}>
          <span
            className="queue-art"
            onPointerDown={(event) => {
              if (event.button === 0) controls.start(event);
            }}
            title="Drag to reorder"
          >
            <Cover track={track} code={code} />
            <span className={`queue-art-overlay ${active ? 'is-on' : ''}`}>
              {active && playing ? (
                <LiveBars playing bars={3} getLevels={getLevels} className="on-dark" />
              ) : (
                <PlayGlyph size={13} />
              )}
            </span>
          </span>
          <span className="queue-info">
            <span className="queue-title" title={track.title}>
              {track.title}
            </span>
            <span className="queue-artist">
              {track.artist || (track.addedBy ? `shared by ${track.addedBy.name}` : 'shared track')}
            </span>
          </span>
        </button>
        <span className="queue-duration">{track.duration > 0 ? formatTime(track.duration) : '—'}</span>
        <button
          type="button"
          className="queue-remove"
          onClick={() => onRemove(track.id)}
          aria-label={`Remove ${track.title}`}
          title="Remove"
        >
          <X size={13} strokeWidth={1.9} />
        </button>
      </div>
    </Reorder.Item>
  );
}

interface TileProps {
  track: Track;
  code: string;
  active: boolean;
  playing: boolean;
  getLevels: (bands: number) => number[] | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}

function QueueTile({ track, code, active, playing, getLevels, onSelect, onRemove }: TileProps) {
  return (
    <motion.div
      layout
      className={`queue-tile ${active ? 'is-active' : ''}`}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
    >
      <button type="button" className="tile-art" onClick={() => onSelect(track.id)}>
        <Cover track={track} code={code} />
        <span className={`tile-overlay ${active ? 'is-on' : ''}`}>
          {active && playing ? (
            <LiveBars playing bars={3} getLevels={getLevels} className="on-dark" />
          ) : (
            <span className="tile-play">
              <PlayGlyph size={14} />
            </span>
          )}
        </span>
      </button>
      <button
        type="button"
        className="tile-remove"
        onClick={() => onRemove(track.id)}
        aria-label={`Remove ${track.title}`}
        title="Remove"
      >
        <X size={12} strokeWidth={2} />
      </button>
      <div className="tile-meta">
        <span className="tile-title" title={track.title}>
          {track.title}
        </span>
        <span className="tile-artist">
          {track.artist || (track.addedBy ? `shared by ${track.addedBy.name}` : 'shared track')}
        </span>
      </div>
    </motion.div>
  );
}

function QueueEmpty({ onPick, onLink }: { onPick: () => void; onLink: () => void }) {
  return (
    <div className="queue-empty">
      <span className="queue-empty-icon">
        <CloudUpload size={24} strokeWidth={1.5} />
      </span>
      <span className="queue-empty-title">share a track</span>
      <span className="queue-empty-sub">drop a file, or paste any link</span>
      <span className="queue-empty-actions">
        <button type="button" className="queue-empty-action" onClick={onPick}>
          Choose a file
        </button>
        <button type="button" className="queue-empty-action" onClick={onLink}>
          Paste a link
        </button>
      </span>
    </div>
  );
}
