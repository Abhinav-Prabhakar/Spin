import { parseBlob } from 'music-metadata';
import type { StoredTrack, Track } from '../shared/types';
import type { Env } from './env';
import { LinkError, resolveLink, type ResolvedLink } from './link';
import { RoomDO } from './room';

export { RoomDO };

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_BYTES = 20 * 1024 * 1024;
const AUDIO_CHUNK = 20 * 1024 * 1024;
const MAX_ART_BYTES = 12 * 1024 * 1024;

const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.m4a', '.mp4', '.aac', '.wav', '.ogg', '.oga', '.flac', '.webm', '.opus',
]);

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Range',
  'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length, ETag',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    try {
      return await route(request, env);
    } catch (err) {
      console.error('[spin]', err instanceof Error ? err.stack ?? err.message : err);
      return json({ error: 'Something went wrong.' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);

  if (path === '/' || path === '/api') {
    return json({ name: 'spin', ok: true, realtime: 'durable-objects' });
  }

  if (path === '/api/health') {
    return json({ ok: true, time: Date.now() });
  }

  if (parts[0] === 'api' && parts[1] === 'rooms') {
    if (parts.length === 2) {
      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      return createRoom(env);
    }

    const code = normalizeCode(parts[2]);
    if (!code) return json({ error: 'Bad room code.' }, 400);

    if (parts.length === 3) {
      if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
      const info = await roomStub(env, code).info();
      if (!info.exists) return json({ exists: false }, 404);
      return json({ exists: true, code: info.code, trackCount: info.trackCount });
    }

    if (parts.length === 4 && parts[3] === 'tracks') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      return uploadTrack(request, env, code);
    }

    if (parts.length === 4 && parts[3] === 'link') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      return addLink(request, env, code);
    }

    return json({ error: 'Not found.' }, 404);
  }

  if (parts[0] === 'media' && (parts.length === 3 || parts.length === 4)) {
    const code = normalizeCode(parts[1]);
    if (!code) return new Response('Not found', { status: 404, headers: CORS });
    const id = parts[2];
    if (!/^[A-Za-z0-9-]{6,64}$/.test(id)) {
      return new Response('Not found', { status: 404, headers: CORS });
    }
    const art = parts.length === 4 && parts[3] === 'art';
    if (parts.length === 4 && !art) return new Response('Not found', { status: 404, headers: CORS });
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: CORS });
    }
    return serveMedia(request, env, code, id, art);
  }

  if (path === '/ws') {
    const code = normalizeCode(url.searchParams.get('code') ?? '');
    if (!code) return new Response('Bad room code', { status: 400, headers: CORS });
    return roomStub(env, code).fetch(request);
  }

  return json({ error: 'Not found.' }, 404);
}

// ---- rooms -------------------------------------------------------------

function roomStub(env: Env, code: string) {
  return env.ROOMS.get(env.ROOMS.idFromName(code));
}

async function createRoom(env: Env): Promise<Response> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = Array.from(
      { length: 6 },
      () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)],
    ).join('');
    if (await roomStub(env, code).create(code)) {
      return json({ code }, 201);
    }
  }
  return json({ error: 'Could not open a room. Try again.' }, 503);
}

// ---- uploads -----------------------------------------------------------

async function uploadTrack(request: Request, env: Env, code: string): Promise<Response> {
  const stub = roomStub(env, code);
  const info = await stub.info();
  if (!info.exists) return json({ error: 'Room not found.' }, 404);
  if (info.trackCount >= 500) return json({ error: 'This room is full.' }, 507);

  const contentType = request.headers.get('Content-Type') ?? '';
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    return json({ error: 'Upload a multipart form with an audio file.' }, 400);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'Upload failed.' }, 400);
  }

  const file = form.get('audio');
  if (!(file instanceof File) || file.size === 0) {
    return json({ error: 'No audio received.' }, 400);
  }
  if (file.size > MAX_BYTES) return json({ error: 'That file is larger than 20 MB.' }, 413);

  const originalName = file.name || 'audio.mp3';
  const ext = safeExtension(originalName);
  if (!AUDIO_EXTENSIONS.has(ext)) {
    return json({ error: 'Please share an audio file (mp3, m4a, wav, ogg, flac).' }, 400);
  }

  const id = crypto.randomUUID();
  const fallbackTitle = clean(originalName.replace(/\.[^.]+$/, ''), 140) || 'Untitled';
  const clientDuration = Number(form.get('duration'));
  const peaks = parsePeaks(form.get('peaks'));

  let title = fallbackTitle;
  let artist = '';
  let album = '';
  let duration = Number.isFinite(clientDuration) && clientDuration > 0 ? clientDuration : 0;
  let art: { bytes: Uint8Array; ext: string } | null = null;

  try {
    const metadata = await parseBlob(file, { duration: true, skipPostHeaders: true });
    title = clean(metadata.common.title, 140) || title;
    artist = clean(metadata.common.artist, 100);
    album = clean(metadata.common.album, 100);
    if (metadata.format.duration && metadata.format.duration > 0) {
      duration = metadata.format.duration;
    }
    const picture = metadata.common.picture?.[0];
    if (picture?.data && picture.data.length > 0 && picture.data.length <= MAX_ART_BYTES) {
      art = { bytes: picture.data, ext: pictureExtension(picture.format) };
    }
  } catch (err) {
    console.warn('[spin] metadata read failed for', originalName, err instanceof Error ? err.message : err);
  }

  if (!Number.isFinite(duration) || duration < 0) duration = 0;

  const metaKey = `meta/${code}/${id}`;
  const artKey = `art/${code}/${id}`;
  const audioKeys: string[] = [];
  let audioSize = 0;

  try {
    const buffer = await file.arrayBuffer();
    audioSize = buffer.byteLength;
    const count = Math.max(1, Math.ceil(audioSize / AUDIO_CHUNK));
    for (let index = 0; index < count; index++) {
      const key = `audio/${code}/${id}/${index}`;
      const start = index * AUDIO_CHUNK;
      await env.AUDIO.put(key, buffer.slice(start, Math.min(audioSize, start + AUDIO_CHUNK)));
      audioKeys.push(key);
    }
    if (art) await env.AUDIO.put(artKey, art.bytes);
    await env.AUDIO.put(
      metaKey,
      JSON.stringify({
        size: audioSize,
        chunks: Math.max(1, Math.ceil(audioSize / AUDIO_CHUNK)),
        type: audioMime(ext),
        artType: art ? artMime(art.ext) : null,
      }),
    );
  } catch (err) {
    console.error('[spin] kv put failed', err);
    await deleteKeys(env, [...audioKeys, artKey, metaKey]);
    return json({ error: 'Could not store that file.' }, 502);
  }

  const sid = typeof form.get('sid') === 'string' ? String(form.get('sid')) : '';
  const addedBy = sid ? await stub.userFor(sid) : null;

  const stored: StoredTrack = {
    id,
    title,
    artist,
    album,
    duration,
    peaks,
    addedAt: Date.now(),
    addedBy,
    ext,
    artExt: art?.ext ?? null,
    chunks: Math.max(1, Math.ceil(audioSize / AUDIO_CHUNK)),
  };

  let track: Track | null = null;
  try {
    track = await stub.addTrack(stored);
  } catch (err) {
    console.error('[spin] addTrack failed', err);
  }

  if (!track) {
    await deleteKeys(env, [...audioKeys, artKey, metaKey]);
    return json({ error: 'This room is full.' }, 507);
  }

  return json(track, 201);
}

// ---- links -------------------------------------------------------------

async function addLink(request: Request, env: Env, code: string): Promise<Response> {
  const stub = roomStub(env, code);
  const info = await stub.info();
  if (!info.exists) return json({ error: 'Room not found.' }, 404);
  if (info.trackCount >= 500) return json({ error: 'This room is full.' }, 507);

  const contentType = request.headers.get('Content-Type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return json({ error: 'Send { "url": "https://…" }.' }, 400);
  }
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > 8 * 1024) {
    return json({ error: 'That link is too long.' }, 413);
  }

  let body: { url?: unknown; sid?: unknown };
  try {
    body = (await request.json()) as { url?: unknown; sid?: unknown };
  } catch {
    return json({ error: 'Send { "url": "https://…" }.' }, 400);
  }

  const rawUrl = typeof body.url === 'string' ? body.url.trim() : '';
  if (!rawUrl) return json({ error: 'Paste a link first.' }, 400);

  let resolved: ResolvedLink;
  try {
    resolved = await resolveLink(env, rawUrl);
  } catch (err) {
    if (err instanceof LinkError) return json({ error: err.message }, err.status);
    console.error('[spin] link resolve failed', err);
    return json({ error: 'Could not read that link.' }, 502);
  }

  const sid = typeof body.sid === 'string' ? body.sid : '';
  const addedBy = sid ? await stub.userFor(sid) : null;
  const ext = extensionForMime(resolved.mime);

  const stored: StoredTrack = {
    id: crypto.randomUUID(),
    title: resolved.title,
    artist: resolved.artist,
    album: resolved.album,
    duration: resolved.duration,
    peaks: [],
    addedAt: Date.now(),
    addedBy,
    origin: resolved.origin,
    srcUrl: resolved.srcUrl,
    artUrl: resolved.artUrl ?? undefined,
    provider: resolved.provider,
    size: resolved.size,
    ext,
    artExt: null,
    chunks: 0,
  };

  let track: Track | null = null;
  try {
    track = await stub.addTrack(stored);
  } catch (err) {
    console.error('[spin] addTrack failed', err);
  }
  if (!track) return json({ error: 'This room is full.' }, 507);
  return json(track, 201);
}

// ---- media -------------------------------------------------------------

const IMMUTABLE = 'public, max-age=31536000, immutable';

interface AudioMeta {
  size: number;
  chunks: number;
  type: string;
  artType: string | null;
}

async function deleteKeys(env: Env, keys: string[]): Promise<void> {
  await Promise.all(keys.map((key) => env.AUDIO.delete(key))).catch(() => {});
}

async function readMeta(env: Env, code: string, id: string): Promise<AudioMeta | null> {
  const meta = await env.AUDIO.get<AudioMeta>(`meta/${code}/${id}`, 'json');
  if (!meta || typeof meta.size !== 'number' || meta.size < 0) return null;
  return meta;
}

async function getChunk(
  env: Env,
  code: string,
  id: string,
  index: number,
): Promise<ArrayBuffer | null> {
  const key = `audio/${code}/${id}/${index}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const value = await env.AUDIO.get(key, 'arrayBuffer');
    if (value) return value;
    if (attempt < 2) await pause(140 * (attempt + 1));
  }
  return null;
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (typeof setTimeout === 'function') setTimeout(resolve, ms);
    else resolve();
  });
}

async function serveMedia(
  request: Request,
  env: Env,
  code: string,
  id: string,
  art: boolean,
): Promise<Response> {
  const meta = await readMeta(env, code, id);
  if (!meta) return new Response('Not found', { status: 404, headers: CORS });

  if (art) {
    if (!meta.artType) return new Response('Not found', { status: 404, headers: CORS });
    const bytes = await env.AUDIO.get(`art/${code}/${id}`, 'arrayBuffer');
    if (!bytes) return new Response('Not found', { status: 404, headers: CORS });
    return new Response(request.method === 'HEAD' ? null : bytes, {
      status: 200,
      headers: {
        ...CORS,
        'Content-Type': meta.artType,
        'Cache-Control': IMMUTABLE,
        'Content-Length': String(bytes.byteLength),
      },
    });
  }

  const size = meta.size;
  const range = parseRange(request.headers.get('Range'), size);

  if (range === 'invalid') {
    return new Response(null, {
      status: 416,
      headers: { ...CORS, 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' },
    });
  }

  const start = range ? range.start : 0;
  const length = range ? range.length : size;
  const end = start + length - 1;

  const headers: Record<string, string> = {
    ...CORS,
    'Content-Type': meta.type || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': IMMUTABLE,
    'Content-Length': String(length),
  };
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;

  const status = range ? 206 : 200;
  if (request.method === 'HEAD') return new Response(null, { status, headers });

  const firstChunk = Math.floor(start / AUDIO_CHUNK);
  const lastChunk = Math.floor(end / AUDIO_CHUNK);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (let index = firstChunk; index <= lastChunk; index++) {
          const chunk = await getChunk(env, code, id, index);
          if (!chunk) {
            controller.error(new Error('Audio chunk unavailable'));
            return;
          }
          const bytes = new Uint8Array(chunk);
          const from = index === firstChunk ? start - index * AUDIO_CHUNK : 0;
          const to = Math.min(
            bytes.length,
            index === lastChunk ? end - index * AUDIO_CHUNK + 1 : AUDIO_CHUNK,
          );
          if (to > from) controller.enqueue(bytes.subarray(from, to));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(stream, { status, headers });
}

function parseRange(
  header: string | null,
  size: number,
): { start: number; length: number } | 'invalid' | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return 'invalid';
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return 'invalid';

  if (!rawStart) {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return 'invalid';
    const length = Math.min(suffix, size);
    return { start: size - length, length };
  }

  const start = Number(rawStart);
  if (!Number.isFinite(start) || start >= size) return 'invalid';
  let end = rawEnd ? Number(rawEnd) : size - 1;
  if (!Number.isFinite(end) || end < start) return 'invalid';
  end = Math.min(end, size - 1);
  return { start, length: end - start + 1 };
}

// ---- helpers -----------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function normalizeCode(value: string | null): string | null {
  const code = String(value ?? '').trim().toUpperCase();
  return /^[A-HJ-NP-Z2-9]{6}$/.test(code) ? code : null;
}

function safeExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  const ext = dot >= 0 ? filename.slice(dot).toLowerCase() : '';
  return AUDIO_EXTENSIONS.has(ext) ? ext : '.mp3';
}

function extensionForMime(mime: string): string {
  switch (mime) {
    case 'audio/mp4': return '.m4a';
    case 'audio/aac': return '.aac';
    case 'audio/wav': return '.wav';
    case 'audio/ogg': return '.ogg';
    case 'audio/flac': return '.flac';
    case 'audio/webm': return '.webm';
    case 'audio/opus': return '.opus';
    default: return '.mp3';
  }
}

function audioMime(ext: string): string {
  switch (ext) {
    case '.mp3': return 'audio/mpeg';
    case '.m4a':
    case '.mp4': return 'audio/mp4';
    case '.aac': return 'audio/aac';
    case '.wav': return 'audio/wav';
    case '.ogg':
    case '.oga': return 'audio/ogg';
    case '.flac': return 'audio/flac';
    case '.webm': return 'audio/webm';
    case '.opus': return 'audio/opus';
    default: return 'application/octet-stream';
  }
}

function artMime(ext: string): string {
  switch (ext) {
    case '.png': return 'image/png';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    default: return 'image/jpeg';
  }
}

function pictureExtension(format: string | undefined): string {
  const value = (format ?? '').toLowerCase();
  if (value.includes('png')) return '.png';
  if (value.includes('webp')) return '.webp';
  if (value.includes('gif')) return '.gif';
  return '.jpg';
}

function parsePeaks(value: unknown): number[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .slice(0, 400)
      .map((n) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0))
      .map((n) => Math.round(n * 1000) / 1000);
  } catch {
    return [];
  }
}

function clean(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
