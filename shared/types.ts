export type RepeatMode = 'off' | 'all' | 'one';

export interface User {
  id: string;
  name: string;
  hue: number;
}

export interface Identity {
  name: string;
  hue: number;
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  hasArt: boolean;
  peaks: number[];
  addedAt: number;
  addedBy: Identity | null;
}

export interface Playback {
  trackId: string | null;
  playing: boolean;
  /** Playback position in seconds at `serverTime`. */
  position: number;
  /** Server clock in ms at the moment this snapshot was taken. */
  serverTime: number;
  repeat: RepeatMode;
  shuffle: boolean;
  rev: number;
}

export interface RoomSnapshot {
  code: string;
  tracks: Track[];
  playback: Playback;
  users: User[];
  me: User;
}

export interface JoinPayload {
  code: string;
  identity?: Identity;
}

export type JoinResponse =
  | { ok: true; room: RoomSnapshot }
  | { ok: false; error: 'not-found' | 'bad-code' };

export type TransportEvent =
  | { action: 'play' }
  | { action: 'pause' }
  | { action: 'seek'; position: number }
  | { action: 'select'; trackId: string }
  | { action: 'next' }
  | { action: 'prev' }
  | { action: 'repeat'; mode: RepeatMode }
  | { action: 'shuffle'; value: boolean };

export interface Reaction {
  id: number;
  user: Identity;
}

/** Stored shape inside a room's Durable Object. */
export interface StoredTrack extends Omit<Track, 'hasArt'> {
  ext: string;
  artExt: string | null;
  chunks: number;
}

export type ClientMessage =
  | { t: 'join'; code: string; identity?: Identity; cid: string }
  | { t: 'transport'; event: TransportEvent }
  | { t: 'ended'; trackId: string }
  | { t: 'reorder'; ids: string[] }
  | { t: 'remove'; id: string }
  | { t: 'reaction' }
  | { t: 'clock'; id: number };

export type ServerMessage =
  | { t: 'welcome'; room: RoomSnapshot; cid: string }
  | { t: 'error'; error: 'not-found' | 'bad-code' }
  | { t: 'playback'; playback: Playback }
  | { t: 'tracks'; tracks: Track[] }
  | { t: 'users'; users: User[] }
  | { t: 'reaction'; reaction: Reaction }
  | { t: 'clock'; id: number; serverTime: number };

export interface RoomFileTrack {
  hasArt: boolean;
}
