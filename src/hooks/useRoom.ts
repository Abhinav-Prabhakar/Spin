import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ClientMessage,
  Identity,
  Playback,
  Reaction,
  ServerMessage,
  Track,
  TransportEvent,
  User,
} from '@shared/types';
import { wsUrl } from '../lib/api';

const IDENTITY_KEY = 'spin.identity';
const CLOSE_NORMAL = 1000;

function readIdentity(): Identity | undefined {
  try {
    const raw = sessionStorage.getItem(IDENTITY_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Identity;
    if (typeof parsed?.name === 'string' && typeof parsed?.hue === 'number') return parsed;
  } catch {
    /* noop */
  }
  return undefined;
}

function storeIdentity(identity: Identity) {
  try {
    sessionStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
  } catch {
    /* noop */
  }
}

function newClientId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `c${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }
}

export type RoomError = 'not-found' | 'bad-code' | 'offline';

export interface RoomModel {
  status: 'loading' | 'ready' | 'error';
  error: RoomError | null;
  connected: boolean;
  tracks: Track[];
  users: User[];
  me: User | null;
  playback: Playback | null;
  reactions: Reaction[];
  socketId: string | null;
  offsetRef: { current: number };
  send: (event: TransportEvent) => void;
  reorder: (ids: string[]) => void;
  removeTrack: (id: string) => void;
  react: () => void;
  playerEnded: (trackId: string) => void;
}

export function useRoom(code: string): RoomModel {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');  const [error, setError] = useState<RoomError | null>(null);
  const [connected, setConnected] = useState(false);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [me, setMe] = useState<User | null>(null);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [socketId, setSocketId] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const offsetRef = useRef(0);
  const reactionTimers = useRef<number[]>([]);
  const clockWaiters = useRef(new Map<number, (serverTime: number) => void>());

  useEffect(() => {
    let alive = true;
    let fatal = false;
    let socket: WebSocket | null = null;
    let retryTimer: number | null = null;
    let attempts = 0;
    let clockTimer: number | null = null;
    let clockSeq = 0;
    const cid = newClientId();

    const clearClock = () => {
      if (clockTimer !== null) window.clearTimeout(clockTimer);
      clockTimer = null;
    };

    const askClock = () =>
      new Promise<number | null>((resolve) => {
        const ws = socket;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          resolve(null);
          return;
        }
        const id = ++clockSeq;
        const timer = window.setTimeout(() => {
          clockWaiters.current.delete(id);
          resolve(null);
        }, 2000);
        clockWaiters.current.set(id, (serverTime) => {
          window.clearTimeout(timer);
          clockWaiters.current.delete(id);
          resolve(serverTime);
        });
        ws.send(JSON.stringify({ t: 'clock', id } satisfies ClientMessage));
      });

    const syncClock = async (samples: number) => {
      const results: Array<{ rtt: number; offset: number }> = [];
      for (let i = 0; i < samples; i++) {
        if (!alive) return;
        const started = Date.now();
        const serverTime = await askClock();
        if (serverTime === null) continue;
        const ended = Date.now();
        results.push({ rtt: ended - started, offset: serverTime - (started + ended) / 2 });
      }
      if (!alive || results.length === 0) return;
      results.sort((a, b) => a.rtt - b.rtt);
      offsetRef.current = results[0].offset;
    };

    const send = (message: ClientMessage) => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    };

    const join = () => {
      send({ t: 'join', code, identity: readIdentity(), cid });
    };

    const scheduleRetry = () => {
      if (!alive || fatal || retryTimer !== null) return;
      const delay = Math.min(5000, 350 * Math.pow(1.7, attempts)) + Math.random() * 220;
      attempts += 1;
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        connect();
      }, delay);
    };

    const onMessage = (event: MessageEvent) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      if (!message || typeof message !== 'object') return;

      switch (message.t) {
        case 'welcome': {
          storeIdentity(message.room.me);
          setError(null);
          setStatus('ready');
          setConnected(true);
          setSocketId(message.cid);
          setTracks(message.room.tracks);
          setUsers(message.room.users);
          setMe(message.room.me);
          setPlayback(message.room.playback);
          offsetRef.current = message.room.playback.serverTime - Date.now();
          void syncClock(4);
          if (clockTimer === null) {
            clockTimer = window.setInterval(() => {
              if (socket?.readyState === WebSocket.OPEN) void syncClock(2);
            }, 20_000);
          }
          break;
        }
        case 'error': {
          fatal = true;
          setError(message.error);
          setStatus('error');
          break;
        }
        case 'playback':
          setPlayback(message.playback);
          break;
        case 'tracks':
          setTracks(message.tracks);
          break;
        case 'users':
          setUsers(message.users);
          break;
        case 'reaction': {
          const reaction = message.reaction;
          setReactions((prev) => [...prev.slice(-14), reaction]);
          const timer = window.setTimeout(() => {
            setReactions((prev) => prev.filter((item) => item.id !== reaction.id));
          }, 4200);
          reactionTimers.current.push(timer);
          break;
        }
        case 'clock': {
          const waiter = clockWaiters.current.get(message.id);
          if (waiter) waiter(message.serverTime);
          break;
        }
        default:
          break;
      }
    };

    const connect = () => {
      if (!alive || fatal) return;
      if (
        socket &&
        (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
      ) {
        return;
      }

      const ws = new WebSocket(wsUrl(`/ws?code=${encodeURIComponent(code)}`));
      socket = ws;
      socketRef.current = ws;

      ws.onopen = () => {
        if (!alive || socket !== ws) return;
        attempts = 0;
        setConnected(true);
        join();
      };

      ws.onmessage = onMessage;

      ws.onerror = () => {
        if (socket === ws) setConnected(false);
      };

      ws.onclose = (event) => {
        if (socket === ws) {
          socket = null;
          socketRef.current = null;
          setConnected(false);
        }
        if (!alive || fatal) return;
        if (event.code === CLOSE_NORMAL && event.reason === 'not-found') return;
        setStatus((prev) => (prev === 'ready' ? prev : 'loading'));
        scheduleRetry();
      };
    };

    connect();

    return () => {
      alive = false;
      clearClock();
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      for (const timer of reactionTimers.current) window.clearTimeout(timer);
      reactionTimers.current = [];
      clockWaiters.current.clear();
      const ws = socket;
      socket = null;
      socketRef.current = null;
      if (ws) {
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        ws.close(CLOSE_NORMAL, 'leaving');
      }
    };
  }, [code]);

  const emit = useCallback((message: ClientMessage) => {
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }, []);

  const sendEvent = useCallback((event: TransportEvent) => {
    emit({ t: 'transport', event });
  }, [emit]);

  const reorder = useCallback((ids: string[]) => {
    emit({ t: 'reorder', ids });
  }, [emit]);

  const removeTrack = useCallback((id: string) => {
    emit({ t: 'remove', id });
  }, [emit]);

  const react = useCallback(() => {
    emit({ t: 'reaction' });
  }, [emit]);

  const playerEnded = useCallback((trackId: string) => {
    emit({ t: 'ended', trackId });
  }, [emit]);

  return {
    status,
    error,
    connected,
    tracks,
    users,
    me,
    playback,
    reactions,
    socketId,
    offsetRef,
    send: sendEvent,
    reorder,
    removeTrack,
    react,
    playerEnded,
  };
}
