import { DurableObject } from 'cloudflare:workers';
import type {
  ClientMessage,
  Identity,
  Playback,
  Reaction,
  RepeatMode,
  RoomSnapshot,
  ServerMessage,
  StoredTrack,
  Track,
  TransportEvent,
  User,
} from '../shared/types';
import type { Env } from './env';
import { sanitizeIdentity } from './names';

const MAX_TRACKS = 500;
const EMPTY: PlaybackState = {
  trackId: null,
  playing: false,
  position: 0,
  anchor: 0,
  repeat: 'off',
  shuffle: false,
  rev: 0,
};

interface PlaybackState {
  trackId: string | null;
  playing: boolean;
  /** Seconds elapsed when the anchor was set. */
  position: number;
  /** Epoch ms. */
  anchor: number;
  repeat: RepeatMode;
  shuffle: boolean;
  rev: number;
}

interface StoredMeta {
  code: string;
  createdAt: number;
}

interface Attachment {
  cid: string;
  name: string;
  hue: number;
}

/**
 * One Durable Object per room. It owns the track order, the authoritative
 * playback clock and the set of live listeners, so every screen agrees on
 * the same second of the same song.
 */
export class RoomDO extends DurableObject<Env> {
  private ready: Promise<boolean> | null = null;
  private meta: StoredMeta | null = null;
  private order: string[] = [];
  private tracks = new Map<string, StoredTrack>();
  private pb: PlaybackState = { ...EMPTY };
  private recentEnds = new Map<string, number>();

  // ---- storage --------------------------------------------------------

  private ensure(): Promise<boolean> {
    this.ready ??= (async () => {
      const [meta, order, playback] = await Promise.all([
        this.ctx.storage.get<StoredMeta>('meta'),
        this.ctx.storage.get<string[]>('order'),
        this.ctx.storage.get<PlaybackState>('playback'),
      ]);
      this.meta = meta ?? null;
      this.order = Array.isArray(order) ? order : [];
      this.pb = playback ? { ...EMPTY, ...playback } : { ...EMPTY, anchor: Date.now() };

      const entries = await Promise.all(
        this.order.map((id) => this.ctx.storage.get<StoredTrack>(`track:${id}`)),
      );
      for (const track of entries) {
        if (track) this.tracks.set(track.id, track);
      }
      return this.meta !== null;
    })();
    return this.ready;
  }

  async create(code: string): Promise<boolean> {
    await this.ensure();
    if (this.meta) return false;
    this.meta = { code, createdAt: Date.now() };
    await this.ctx.storage.put('meta', this.meta);
    this.ready = Promise.resolve(true);
    return true;
  }

  async info(): Promise<{ exists: boolean; code: string; trackCount: number }> {
    const exists = await this.ensure();
    return {
      exists,
      code: this.meta?.code ?? '',
      trackCount: exists ? this.order.length : 0,
    };
  }

  async addTrack(track: StoredTrack): Promise<Track | null> {
    const exists = await this.ensure();
    if (!exists || this.order.length >= MAX_TRACKS) return null;

    this.tracks.set(track.id, track);
    this.order.push(track.id);
    await this.ctx.storage.put({
      [`track:${track.id}`]: track,
      order: this.order,
    });

    this.broadcast({ t: 'tracks', tracks: this.publicTracks() });

    if (!this.pb.trackId) {
      this.pb = {
        ...this.pb,
        trackId: track.id,
        playing: true,
        position: 0,
        anchor: Date.now(),
        rev: this.pb.rev + 1,
      };
      await this.persistPlayback();
      this.broadcastPlayback();
      await this.schedule();
    }

    return toPublicTrack(track);
  }

  async userFor(cid: string): Promise<Identity | null> {
    if (!cid) return null;
    for (const ws of this.ctx.getWebSockets()) {
      const user = this.userOf(ws);
      if (user?.cid === cid) return { name: user.name, hue: user.hue };
    }
    return null;
  }

  // ---- sockets --------------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade.', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string') return;
    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }
    if (!message || typeof message !== 'object') return;

    switch (message.t) {
      case 'join':
        await this.join(ws, message);
        return;
      case 'clock':
        this.send(ws, { t: 'clock', id: message.id, serverTime: Date.now() });
        return;
      default:
        break;
    }

    // Everything below needs a joined socket.
    const user = this.userOf(ws);
    if (!user) return;

    switch (message.t) {
      case 'transport':
        await this.applyTransport(message.event);
        break;
      case 'ended':
        await this.onEnded(user, message.trackId);
        break;
      case 'reorder':
        await this.reorder(Array.isArray(message.ids) ? message.ids : []);
        break;
      case 'remove':
        await this.remove(typeof message.id === 'string' ? message.id : '');
        break;
      case 'reaction': {
        const reaction: Reaction = {
          id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
          user: { name: user.name, hue: user.hue },
        };
        this.broadcast({ t: 'reaction', reaction });
        break;
      }
      default:
        break;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const user = this.userOf(ws);
    try {
      ws.close(1000, 'bye');
    } catch {
      /* already closing */
    }
    if (user) this.broadcastUsers();
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    if (this.userOf(ws)) this.broadcastUsers();
  }

  private async join(ws: WebSocket, message: Extract<ClientMessage, { t: 'join' }>): Promise<void> {
    const exists = await this.ensure();
    if (!exists) {
      this.send(ws, { t: 'error', error: 'not-found' });
      try {
        ws.close(1008, 'not-found');
      } catch {
        /* noop */
      }
      return;
    }
    if (message.code && message.code.toUpperCase() !== (this.meta?.code ?? '')) {
      this.send(ws, { t: 'error', error: 'bad-code' });
      return;
    }

    const previous = this.userOf(ws);
    const cid =
      typeof message.cid === 'string' && /^[A-Za-z0-9-]{6,64}$/.test(message.cid)
        ? message.cid
        : crypto.randomUUID();

    const taken = new Set(
      this.users()
        .filter((user) => user.id !== previous?.cid)
        .map((user) => user.name),
    );
    const takenHues = this.users()
      .filter((user) => user.id !== previous?.cid)
      .map((user) => user.hue);
    const identity = sanitizeIdentity(message.identity, taken, takenHues);
    const attachment: Attachment = { cid, name: identity.name, hue: identity.hue };
    ws.serializeAttachment(attachment);

    this.catchUp();

    const me: User = { id: cid, name: identity.name, hue: identity.hue };
    const room: RoomSnapshot = {
      code: this.meta?.code ?? '',
      tracks: this.publicTracks(),
      playback: this.publicPlayback(),
      users: this.users(),
      me,
    };

    this.send(ws, { t: 'welcome', room, cid });
    this.broadcastUsers();
    await this.schedule();
  }

  private userOf(ws: WebSocket): Attachment | null {
    try {
      return (ws.deserializeAttachment() as Attachment | null) ?? null;
    } catch {
      return null;
    }
  }

  private users(): User[] {
    const users: User[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const user = this.userOf(ws);
      if (user) users.push({ id: user.cid, name: user.name, hue: user.hue });
    }
    return users;
  }

  // ---- transport ------------------------------------------------------

  private async applyTransport(event: TransportEvent): Promise<void> {
    if (!event || typeof event !== 'object') return;
    const now = Date.now();
    const pb = this.pb;
    const position = this.positionAt(now);
    const duration = pb.trackId ? this.durationOf(pb.trackId) : 0;

    switch (event.action) {
      case 'play': {
        if (this.order.length === 0) return;
        let trackId = pb.trackId;
        let nextPosition = position;
        if (!trackId) {
          trackId = this.order[0];
          nextPosition = 0;
        }
        if (duration > 0 && nextPosition >= duration - 0.05) nextPosition = 0;
        this.pb = { ...pb, trackId, playing: true, position: nextPosition, anchor: now, rev: pb.rev + 1 };
        break;
      }
      case 'pause':
        this.pb = { ...pb, playing: false, position, anchor: now, rev: pb.rev + 1 };
        break;
      case 'seek': {
        if (!pb.trackId) return;
        const target = Number(event.position);
        if (!Number.isFinite(target)) return;
        const clamped = Math.max(0, duration > 0 ? Math.min(target, duration) : target);
        this.pb = { ...pb, position: clamped, anchor: now, rev: pb.rev + 1 };
        break;
      }
      case 'select': {
        if (typeof event.trackId !== 'string' || !this.tracks.has(event.trackId)) return;
        this.pb = {
          ...pb,
          trackId: event.trackId,
          playing: true,
          position: 0,
          anchor: now,
          rev: pb.rev + 1,
        };
        break;
      }
      case 'next':
        if (this.order.length === 0) return;
        this.step(1, true);
        break;
      case 'prev':
        if (this.order.length === 0) return;
        if (position > 3 && pb.trackId) {
          this.pb = { ...pb, position: 0, anchor: now, rev: pb.rev + 1 };
        } else {
          this.step(-1, true);
        }
        break;
      case 'repeat':
        if (event.mode !== 'off' && event.mode !== 'all' && event.mode !== 'one') return;
        this.pb = { ...pb, repeat: event.mode, position, anchor: now, rev: pb.rev + 1 };
        break;
      case 'shuffle':
        this.pb = { ...pb, shuffle: Boolean(event.value), position, anchor: now, rev: pb.rev + 1 };
        break;
      default:
        return;
    }

    await this.persistPlayback();
    this.broadcastPlayback();
    await this.schedule();
  }

  private step(direction: 1 | -1, manual: boolean): void {
    if (this.order.length === 0) return;
    const pb = this.pb;
    const now = Date.now();
    const playing = pb.playing;
    let nextId: string;

    if (pb.shuffle && this.order.length > 1) {
      const others = this.order.filter((id) => id !== pb.trackId);
      nextId = others[Math.floor(Math.random() * others.length)];
    } else {
      const index = pb.trackId ? this.order.indexOf(pb.trackId) : -1;
      if (index === -1) {
        nextId = this.order[0];
      } else {
        const nextIndex = index + direction;
        if (nextIndex < 0) nextId = this.order[this.order.length - 1];
        else if (nextIndex >= this.order.length) nextId = this.order[0];
        else nextId = this.order[nextIndex];
      }
    }

    void manual;
    this.pb = { ...pb, trackId: nextId, playing, position: 0, anchor: now, rev: pb.rev + 1 };
  }

  private advance(manual: boolean): void {
    const pb = this.pb;
    const now = Date.now();
    if (this.order.length === 0) {
      this.pb = { ...pb, trackId: null, playing: false, position: 0, anchor: now, rev: pb.rev + 1 };
      return;
    }

    if (!manual && pb.repeat === 'one' && pb.trackId) {
      this.pb = { ...pb, playing: true, position: 0, anchor: now, rev: pb.rev + 1 };
      return;
    }

    if (pb.shuffle && this.order.length > 1) {
      const others = this.order.filter((id) => id !== pb.trackId);
      const nextId = others[Math.floor(Math.random() * others.length)];
      this.pb = { ...pb, trackId: nextId, playing: true, position: 0, anchor: now, rev: pb.rev + 1 };
      return;
    }

    const index = pb.trackId ? this.order.indexOf(pb.trackId) : -1;
    const nextIndex = index + 1;

    if (nextIndex < this.order.length) {
      this.pb = {
        ...pb,
        trackId: this.order[nextIndex],
        playing: true,
        position: 0,
        anchor: now,
        rev: pb.rev + 1,
      };
      return;
    }

    if (pb.repeat === 'all') {
      this.pb = {
        ...pb,
        trackId: this.order[0],
        playing: true,
        position: 0,
        anchor: now,
        rev: pb.rev + 1,
      };
      return;
    }

    const duration = pb.trackId ? this.durationOf(pb.trackId) : 0;
    this.pb = {
      ...pb,
      playing: false,
      position: duration > 0 ? duration : this.positionAt(now),
      anchor: now,
      rev: pb.rev + 1,
    };
  }

  private async onEnded(_user: Attachment, trackId: string): Promise<void> {
    if (!trackId || trackId !== this.pb.trackId || !this.pb.playing) return;

    const key = `${trackId}:${this.pb.rev}`;
    const last = this.recentEnds.get(key) ?? 0;
    if (Date.now() - last < 3000) return;
    this.recentEnds.set(key, Date.now());
    if (this.recentEnds.size > 40) {
      const oldest = this.recentEnds.keys().next().value;
      if (oldest) this.recentEnds.delete(oldest);
    }

    const duration = this.durationOf(trackId);
    if (duration > 0 && this.positionAt(Date.now()) < duration - 5) return;

    this.advance(false);
    await this.persistPlayback();
    this.broadcastPlayback();
    await this.schedule();
  }

  private async reorder(ids: string[]): Promise<void> {
    if (ids.length !== this.order.length) return;
    const unique = new Set(ids);
    if (unique.size !== ids.length) return;
    for (const id of ids) if (!this.tracks.has(id)) return;

    this.order = ids;
    await this.ctx.storage.put('order', this.order);
    this.broadcast({ t: 'tracks', tracks: this.publicTracks() });
  }

  private async remove(id: string): Promise<void> {
    const index = this.order.indexOf(id);
    if (index === -1) return;

    this.order.splice(index, 1);
    this.tracks.delete(id);
    await this.ctx.storage.delete(`track:${id}`);
    await this.ctx.storage.put('order', this.order);

    if (this.pb.trackId === id) {
      const now = Date.now();
      if (this.order.length === 0) {
        this.pb = { ...this.pb, trackId: null, playing: false, position: 0, anchor: now, rev: this.pb.rev + 1 };
      } else {
        const next = this.order[Math.min(index, this.order.length - 1)];
        this.pb = { ...this.pb, trackId: next, position: 0, anchor: now, rev: this.pb.rev + 1 };
      }
      await this.persistPlayback();
    }

    this.broadcast({ t: 'tracks', tracks: this.publicTracks() });
    this.broadcastPlayback();
    await this.schedule();

    const code = this.meta?.code ?? '';
    const track = this.tracks.get(id);
    const keys = [`meta/${code}/${id}`, `art/${code}/${id}`];
    for (let index = 0; index < (track?.chunks ?? 0); index++) {
      keys.push(`audio/${code}/${id}/${index}`);
    }
    await Promise.all(keys.map((key) => this.env.AUDIO.delete(key))).catch(() => {});
  }

  async alarm(): Promise<void> {
    await this.ensure();
    if (!this.pb.playing || !this.pb.trackId) return;

    const duration = this.durationOf(this.pb.trackId);
    if (duration > 0 && this.positionAt(Date.now()) < duration - 0.15) {
      // Woken early: re-arm rather than skipping a track.
      await this.schedule();
      return;
    }

    this.advance(false);
    await this.persistPlayback();
    this.broadcastPlayback();
    await this.schedule();
  }

  private async schedule(): Promise<void> {
    const pb = this.pb;
    if (!pb.playing || !pb.trackId) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const duration = this.durationOf(pb.trackId);
    if (duration <= 0) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const remaining = duration - this.positionAt(Date.now());
    if (remaining <= 0.05) {
      this.advance(false);
      await this.persistPlayback();
      this.broadcastPlayback();
      await this.schedule();
      return;
    }
    await this.ctx.storage.setAlarm(Date.now() + Math.max(150, remaining * 1000 + 120));
  }

  /** Jump past finished tracks after a room sat unlistened for a while. */
  private catchUp(): void {
    let guard = 0;
    while (this.pb.playing && this.pb.trackId && guard++ < 200) {
      const duration = this.durationOf(this.pb.trackId);
      if (duration <= 0) break;
      if (this.positionAt(Date.now()) < duration + 0.3) break;
      const before = this.pb.rev;
      this.advance(false);
      if (this.pb.rev === before) break;
    }
  }

  // ---- helpers --------------------------------------------------------

  private durationOf(trackId: string): number {
    return this.tracks.get(trackId)?.duration ?? 0;
  }

  private positionAt(now: number): number {
    const pb = this.pb;
    if (!pb.playing) return Math.max(0, pb.position);
    const raw = pb.position + Math.max(0, now - pb.anchor) / 1000;
    const duration = pb.trackId ? this.durationOf(pb.trackId) : 0;
    return duration > 0 ? Math.min(raw, duration) : raw;
  }

  private publicPlayback(): Playback {
    const now = Date.now();
    return {
      trackId: this.pb.trackId,
      playing: this.pb.playing,
      position: this.positionAt(now),
      serverTime: now,
      repeat: this.pb.repeat,
      shuffle: this.pb.shuffle,
      rev: this.pb.rev,
    };
  }

  private publicTracks(): Track[] {
    return this.order
      .map((id) => this.tracks.get(id))
      .filter((track): track is StoredTrack => Boolean(track))
      .map(toPublicTrack);
  }

  private async persistPlayback(): Promise<void> {
    await this.ctx.storage.put('playback', this.pb);
  }

  private broadcastPlayback(): void {
    this.broadcast({ t: 'playback', playback: this.publicPlayback() });
  }

  private broadcastUsers(): void {
    this.broadcast({ t: 'users', users: this.users() });
  }

  private broadcast(message: ServerMessage): void {
    const payload = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        /* the socket is on its way out */
      }
    }
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      /* noop */
    }
  }
}

export function toPublicTrack(track: StoredTrack): Track {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
    hasArt: Boolean(track.artExt),
    peaks: track.peaks,
    addedAt: track.addedAt,
    addedBy: track.addedBy,
  };
}
