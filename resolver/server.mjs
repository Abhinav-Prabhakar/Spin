import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';

/**
 * Minimal Spin URL resolver.
 *
 * yt-dlp downloads the audio once into a temporary folder; every Spin client
 * then fetches that file for itself over Range requests. This is deliberately
 * separate from the Worker: YouTube blocks extraction from datacenter IPs, and
 * downloading inside a Worker is not possible anyway.
 *
 * Contract expected by worker/link.ts:
 *   POST /resolve  { "url": "https://…" }  ->  { audioUrl, title, artist, … }
 *   GET  /media/:id                        ->  audio bytes with Range + CORS
 */

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.PORT || 8787);
const KEY = process.env.RESOLVER_KEY || '';
const YTDLP = process.env.YTDLP_BIN || 'yt-dlp';
const YTDLP_CLIENT = (process.env.YTDLP_CLIENT || '').trim();
const YTDLP_PROXY = (process.env.YTDLP_PROXY || '').trim();
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const TTL_MS = Number(process.env.TTL_MS || 6 * 60 * 60 * 1000);
const MAX_ACTIVE = Number(process.env.MAX_ACTIVE || 3);
const DOWNLOAD_TIMEOUT = Number(process.env.DOWNLOAD_TIMEOUT_MS || 180_000);
const MAX_BYTES = Number(process.env.MAX_BYTES || 150 * 1024 * 1024);
const METADATA_TIMEOUT = 45_000;
const ALLOW_INSECURE = process.env.ALLOW_INSECURE === '1';
const ALLOW_HOSTS = (process.env.ALLOW_HOSTS || '')
  .split(',')
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
};

const AUDIO_MIME = {
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/opus',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.webm': 'audio/webm',
};

/** @type {Map<string, { file: string, dir: string, size: number, mime: string, createdAt: number }>} */
const entries = new Map();
let active = 0;

if (!KEY && !ALLOW_INSECURE) {
  console.error('Set RESOLVER_KEY (and the same value in the Worker) before starting.');
  process.exit(1);
}

function allowedHost(hostname) {
  if (ALLOW_HOSTS.length === 0) return true;
  const host = hostname.toLowerCase();
  return ALLOW_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

async function run(args, timeout) {
  const { stdout } = await execFileAsync(YTDLP, args, {
    timeout,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

/** Pin the YouTube client when the default one is rejected (e.g. bot checks). */
function clientArgs(client) {
  const name = (client || YTDLP_CLIENT).trim();
  return name ? ['--extractor-args', `youtube:player_client=${name}`] : [];
}

/** Route requests through a SOCKS/HTTP proxy (e.g. the local WARP tunnel). */
function proxyArgs() {
  return YTDLP_PROXY ? ['--proxy', YTDLP_PROXY] : [];
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    ...CORS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function readJson(req, limit = 8 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > limit) {
        reject(Object.assign(new Error('That link is too long.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (total === 0) return reject(Object.assign(new Error('Send JSON.'), { status: 400 }));
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Send valid JSON.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function pickThumbnail(info) {
  if (Array.isArray(info.thumbnails) && info.thumbnails.length > 0) {
    const best = [...info.thumbnails].sort(
      (a, b) => (Number(b.width) || 0) - (Number(a.width) || 0),
    )[0];
    if (typeof best?.url === 'string') return best.url;
  }
  return typeof info.thumbnail === 'string' ? info.thumbnail : null;
}

async function resolveUrl(url) {
  let target;
  try {
    target = new URL(url);
  } catch {
    throw Object.assign(new Error("That doesn't look like a link."), { status: 400 });
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw Object.assign(new Error('Only http and https links can be resolved.'), { status: 400 });
  }
  if (!allowedHost(target.hostname)) {
    throw Object.assign(new Error('That host is not allowed by this resolver.'), { status: 422 });
  }

  let info;
  try {
    const stdout = await run(
      [
        '--no-playlist',
        '--no-warnings',
        '--no-update',
        '--skip-download',
        '-J',
        ...clientArgs(),
        ...proxyArgs(),
        target.toString(),
      ],
      METADATA_TIMEOUT,
    );
    info = JSON.parse(stdout);
  } catch (err) {
    throw Object.assign(new Error(`The resolver could not read that page: ${short(err)}`), {
      status: 422,
    });
  }

  if (info?.is_live) {
    throw Object.assign(new Error('Live streams cannot be added to a room.'), { status: 422 });
  }

  const dir = await mkdtemp(join(tmpdir(), 'spin-resolver-'));
  try {
    // A single bestaudio stream needs no muxing; m4a plays everywhere.
    try {
      await run(
        [
          '--no-playlist',
          '--no-warnings',
          '--no-update',
          '--no-progress',
          '-f',
          'bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio',
          '-o',
          join(dir, 'audio.%(ext)s'),
          ...clientArgs(),
          ...proxyArgs(),
          target.toString(),
        ],
        DOWNLOAD_TIMEOUT,
      );
    } catch (err) {
      throw Object.assign(new Error(`The resolver could not download that audio: ${short(err)}`), {
        status: 502,
      });
    }

    const files = await readdir(dir);
    const name = files.find((file) => /^audio\./i.test(file) && !file.endsWith('.part'));
    if (!name) {
      throw Object.assign(new Error('The resolver downloaded no audio.'), { status: 502 });
    }

    const file = join(dir, name);
    const stats = await stat(file);
    if (stats.size === 0) {
      throw Object.assign(new Error('The resolver downloaded an empty file.'), { status: 502 });
    }
    if (stats.size > MAX_BYTES) {
      throw Object.assign(new Error('That audio is too large for this resolver.'), { status: 413 });
    }

    const id = randomUUID();
    entries.set(id, {
      file,
      dir,
      size: stats.size,
      mime: AUDIO_MIME[extname(name).toLowerCase()] || 'audio/mpeg',
      createdAt: Date.now(),
    });

    return {
      audioUrl: `${PUBLIC_URL}/media/${id}`,
      title: clean(info.track) || clean(info.title) || 'Untitled',
      artist: clean(info.artist) || clean(info.uploader) || clean(info.channel) || '',
      album: clean(info.album) || '',
      duration: Number(info.duration) > 0 ? Number(info.duration) : 0,
      artUrl: pickThumbnail(info),
      mime: AUDIO_MIME[extname(name).toLowerCase()] || 'audio/mpeg',
      size: stats.size,
    };
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

function clean(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, 200);
}

function short(err) {
  const stderr = typeof err?.stderr === 'string' ? err.stderr.trim() : '';
  const message = err instanceof Error ? err.message : String(err);
  const lines = (stderr || message)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const errorLine = lines.find((line) => /^ERROR:/i.test(line));
  return (errorLine || lines[0] || 'unknown error').slice(0, 300);
}

function parseRange(header, total) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header || '');
  if (!match) return null;
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : total - 1;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 0 || start >= total || end < start) return null;
  return { start, end: Math.min(end, total - 1) };
}

function serveMedia(req, res, id) {
  const entry = entries.get(id);
  if (!entry || Date.now() - entry.createdAt > TTL_MS) {
    json(res, 404, { error: 'That audio has expired.' });
    return;
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', entry.mime);
  res.setHeader('Cache-Control', 'private, max-age=3600');

  if (req.method === 'HEAD') {
    res.writeHead(200, { 'Content-Length': entry.size });
    res.end();
    return;
  }

  const range = req.headers.range ? parseRange(String(req.headers.range), entry.size) : null;
  if (req.headers.range && !range) {
    res.writeHead(416, {
      'Content-Range': `bytes */${entry.size}`,
      'Content-Length': '0',
    });
    res.end();
    return;
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? entry.size - 1;
  const length = end - start + 1;
  if (range) {
    res.writeHead(206, {
      'Content-Length': length,
      'Content-Range': `bytes ${start}-${end}/${entry.size}`,
    });
  } else {
    res.writeHead(200, { 'Content-Length': length });
  }

  const stream = createReadStream(entry.file, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

function cleanup() {
  const now = Date.now();
  for (const [id, entry] of entries) {
    if (now - entry.createdAt <= TTL_MS) continue;
    entries.delete(id);
    void rm(entry.dir, { recursive: true, force: true }).catch(() => {});
  }
}

setInterval(cleanup, 10 * 60 * 1000).unref();

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      ...CORS,
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    json(res, 200, { ok: true });
    return;
  }

  // Diagnostic: ask yt-dlp for metadata with a specific YouTube client.
  if (req.method === 'GET' && url.pathname === '/probe') {
    if (KEY && req.headers.authorization !== `Bearer ${KEY}`) {
      json(res, 401, { error: 'Unauthorized.' });
      return;
    }
    const target = url.searchParams.get('url') || '';
    const client = (url.searchParams.get('client') || '').trim();
    const started = Date.now();
    try {
      const stdout = await run(
        [
          '--no-playlist',
          '--no-warnings',
          '--no-update',
          '--skip-download',
          '-J',
          ...clientArgs(client),
          ...proxyArgs(),
          target,
        ],
        METADATA_TIMEOUT,
      );
      const info = JSON.parse(stdout);
      json(res, 200, {
        ok: true,
        client: client || 'default',
        title: info.title,
        formats: Array.isArray(info.formats) ? info.formats.length : 0,
        ms: Date.now() - started,
      });
    } catch (err) {
      json(res, 200, { ok: false, client: client || 'default', error: short(err), ms: Date.now() - started });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/resolve') {
    if (KEY && req.headers.authorization !== `Bearer ${KEY}`) {
      json(res, 401, { error: 'Unauthorized.' });
      return;
    }
    if (active >= MAX_ACTIVE) {
      json(res, 429, { error: 'The resolver is busy. Try again in a moment.' });
      return;
    }

    active += 1;
    try {
      const body = await readJson(req);
      const audio = await resolveUrl(typeof body.url === 'string' ? body.url.trim() : '');
      json(res, 200, audio);
    } catch (err) {
      const status = Number(err?.status) || 502;
      console.error('[resolver]', err);
      json(res, status, { error: short(err) });
    } finally {
      active -= 1;
      cleanup();
    }
    return;
  }

  if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname.startsWith('/media/')) {
    serveMedia(req, res, url.pathname.slice('/media/'.length));
    return;
  }

  json(res, 404, { error: 'Not found.' });
});

server.listen(PORT, () => {
  console.log(`Spin resolver listening on :${PORT}`);
});
