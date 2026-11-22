import { parseBlob } from 'music-metadata';
import type { TrackOrigin } from '../shared/types';
import type { Env } from './env';

/**
 * Turns a pasted URL into the small amount of metadata a room needs.
 *
 * Audio is never downloaded or stored here: link tracks keep pointing at their
 * source and every listener fetches it for themselves. The only exception is
 * YouTube, which cannot be fetched from a browser, so an optional resolver
 * service turns it into a browser-fetchable URL.
 */

const UA = 'Spin/1.0 (link resolver)';
const MAX_URL_LENGTH = 2048;
const MAX_REDIRECTS = 5;
const MAX_PAGE_BYTES = 512 * 1024;
const MAX_TAG_BYTES = 256 * 1024;
const MAX_PLAYLIST_BYTES = 64 * 1024;
const FETCH_TIMEOUT = 15_000;
const RESOLVER_TIMEOUT = 40_000;

const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.m4a', '.mp4', '.aac', '.wav', '.ogg', '.oga', '.flac', '.webm', '.opus',
]);

const DRM_HOSTS = [
  'spotify.com', 'music.apple.com', 'tidal.com', 'deezer.com', 'music.amazon.com',
];

export class LinkError extends Error {
  status: number;
  /** Whether a configured resolver might succeed where native parsing did not. */
  resolvable: boolean;

  constructor(status: number, message: string, resolvable = false) {
    super(message);
    this.name = 'LinkError';
    this.status = status;
    this.resolvable = resolvable;
  }
}

export interface ResolvedLink {
  origin: TrackOrigin;
  srcUrl: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  artUrl: string | null;
  provider: string;
  mime: string;
  size: number | null;
}

interface Hints {
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  artUrl?: string | null;
}

interface PageMeta {
  title: string;
  artist: string;
  album: string;
  artUrl: string | null;
  duration: number;
  audio: string[];
  feeds: string[];
}

export async function resolveLink(env: Env, raw: string): Promise<ResolvedLink> {
  const target = normalizeInput(raw);

  if (isYouTube(target)) {
    if (!env.URL_RESOLVER) {
      throw new LinkError(
        422,
        'YouTube needs the link resolver, and it is not connected to this room yet.',
        true,
      );
    }
    return resolveWithService(env, target);
  }

  if (isDrmHost(target)) {
    throw new LinkError(422, 'Spotify, Apple Music and the like are DRM-protected — Spin cannot play them.');
  }

  try {
    return await resolveNative(target);
  } catch (err) {
    if (err instanceof LinkError && err.resolvable && env.URL_RESOLVER) {
      return resolveWithService(env, target);
    }
    throw err;
  }
}

// ---- native resolution -------------------------------------------------

async function resolveNative(
  target: URL,
  depth = 0,
  hints: Hints | null = null,
): Promise<ResolvedLink> {
  if (depth > 2) throw new LinkError(508, 'That link points at itself.');

  const signal = AbortSignal.timeout(FETCH_TIMEOUT);
  const { res, url } = await openGuarded(target, signal);
  const type = (res.headers.get('content-type') ?? '').toLowerCase();
  const size = sizeFrom(res);
  const extension = extensionOf(url);

  if (extension === '.m3u8' || type.includes('vnd.apple.mpegurl')) {
    throw new LinkError(415, 'HLS playlists are not supported yet.', true);
  }

  if (extension === '.m3u' || extension === '.pls' || type.includes('mpegurl')) {
    const text = decode(await readCapped(res, MAX_PLAYLIST_BYTES));
    if (/^\s*#EXT-X-/m.test(text)) {
      throw new LinkError(415, 'HLS playlists are not supported yet.', true);
    }
    const next = firstPlaylistEntry(text, url);
    if (!next) throw new LinkError(415, 'That playlist is empty.', true);
    return resolveNative(next, depth + 1, hints);
  }

  if (type.startsWith('audio/') || AUDIO_EXTENSIONS.has(extension)) {
    const bytes = await readCapped(res, MAX_TAG_BYTES);
    return buildDirect(url, type, size, bytes, hints);
  }

  const bytes = await readCapped(res, MAX_PAGE_BYTES);
  const text = decode(bytes);

  if (isFeed(type, text)) {
    return parseFeed(text, url, hints);
  }

  if (isHtml(type, text)) {
    const meta = parseHtml(text, url);

    if (isArchiveDetails(url)) {
      const archived = await resolveArchive(url, meta, hints);
      if (archived) return archived;
    }

    for (const candidate of meta.audio.slice(0, 3)) {
      try {
        return await resolveNative(new URL(candidate), depth + 1, {
          title: meta.title || hints?.title,
          artist: meta.artist || hints?.artist,
          album: meta.album || hints?.album,
          duration: meta.duration || hints?.duration,
          artUrl: meta.artUrl || hints?.artUrl,
        });
      } catch {
        /* try the next candidate */
      }
    }

    for (const feed of meta.feeds.slice(0, 2)) {
      try {
        const feedRes = await openGuarded(new URL(feed), AbortSignal.timeout(FETCH_TIMEOUT));
        const feedBytes = await readCapped(feedRes.res, MAX_PAGE_BYTES);
        return parseFeed(decode(feedBytes), feedRes.url, {
          title: hints?.title,
          artist: hints?.artist,
          album: hints?.album,
          artUrl: meta.artUrl || hints?.artUrl,
        });
      } catch {
        /* try the next feed */
      }
    }

    throw new LinkError(
      415,
      'No playable audio found on that page. Try a direct audio link or a podcast episode.',
      true,
    );
  }

  const sniffed = sniffAudio(bytes);
  if (sniffed) return buildDirect(url, sniffed, size, bytes, hints);

  throw new LinkError(415, 'That link is not audio.', true);
}

async function buildDirect(
  url: URL,
  contentType: string,
  size: number | null,
  bytes: Uint8Array,
  hints: Hints | null,
): Promise<ResolvedLink> {
  const ext = extensionOf(url);
  let title = clean(hints?.title, 140) || titleFromUrl(url);
  let artist = clean(hints?.artist, 100);
  let album = clean(hints?.album, 100);
  let duration = hints?.duration && hints.duration > 0 ? hints.duration : 0;

  if (bytes.byteLength > 0) {
    try {
      const blob = new Blob([bytes], { type: mimeFor(contentType, ext) });
      const metadata = await parseBlob(blob, { duration: true, skipPostHeaders: true });
      // A page or feed title is more specific than the file's own tags.
      title = clean(hints?.title, 140) || clean(metadata.common.title, 140) || title;
      artist = clean(metadata.common.artist, 100) || artist;
      album = clean(metadata.common.album, 100) || album;
      if (!duration && metadata.format.duration && metadata.format.duration > 0) {
        duration = metadata.format.duration;
      }
    } catch {
      /* a partial file often has no readable tags; the URL still works */
    }
  }

  return {
    origin: 'link',
    srcUrl: url.toString(),
    title: title || 'Untitled',
    artist,
    album,
    duration,
    artUrl: cleanArtUrl(hints?.artUrl),
    provider: hostOf(url),
    mime: mimeFor(contentType, ext),
    size,
  };
}

// ---- HTML and feeds ----------------------------------------------------

function parseHtml(html: string, pageUrl: URL): PageMeta {
  const source = html.replace(/<!--[\s\S]*?-->/g, '');
  const meta: Record<string, string> = {};
  const audio: string[] = [];
  const feeds: string[] = [];

  for (const tag of source.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = parseAttrs(tag);
    const key = (attrs.property || attrs.name || '').toLowerCase();
    const value = attrs.content;
    if (key && value) meta[key] = value;
  }

  for (const tag of source.match(/<(?:audio|source)\b[^>]*>/gi) ?? []) {
    const attrs = parseAttrs(tag);
    if (attrs.src) audio.push(attrs.src);
  }

  for (const tag of source.match(/<link\b[^>]*>/gi) ?? []) {
    const attrs = parseAttrs(tag);
    const rel = (attrs.rel || '').toLowerCase();
    const type = (attrs.type || '').toLowerCase();
    if (attrs.href && (type.includes('rss') || type.includes('atom')) && rel.includes('alternate')) {
      feeds.push(attrs.href);
    }
  }

  for (const match of source.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      collectJsonLd(JSON.parse(match[1]), audio);
    } catch {
      /* ignore malformed structured data */
    }
  }

  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(source)?.[1] ?? '';
  const h1Tag = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(source)?.[1] ?? '';
  const title = cleanText(meta['og:title'] || meta['twitter:title'] || titleTag || h1Tag, 140);
  const artist = cleanText(
    meta['music:musician'] || meta['author'] || meta['article:author'],
    100,
  );
  const album = cleanText(meta['music:album'] || meta['og:audio:album'], 100);

  const durationValue =
    meta['music:duration'] || meta['og:audio:duration'] || meta['music:duration:seconds'] || '';
  const duration = parseDuration(durationValue);

  const artUrl = cleanArtUrl(
    resolveUrl(
      meta['og:image:secure_url'] ||
        meta['og:image'] ||
        meta['twitter:image'] ||
        meta['twitter:image:src'] ||
        '',
      pageUrl,
    ),
  );

  const rawAudio = [
    meta['og:audio:secure_url'],
    meta['og:audio:url'],
    meta['og:audio'],
    meta['twitter:player:stream'],
    ...audio,
  ].filter(Boolean);

  const resolvedAudio = unique(
    rawAudio
      .map((value) => resolveUrl(value, pageUrl))
      .filter((value): value is string => Boolean(value)),
  );
  const resolvedFeeds = unique(
    feeds
      .map((value) => resolveUrl(value, pageUrl))
      .filter((value): value is string => Boolean(value)),
  );

  return {
    title,
    artist,
    album,
    artUrl,
    duration,
    audio: resolvedAudio,
    feeds: resolvedFeeds,
  };
}

function parseFeed(xml: string, feedUrl: URL, hints: Hints | null): ResolvedLink {
  const channelTitle = cleanText(tagText(xml, 'title'), 140);
  const channelArtist =
    cleanText(tagText(xml, 'itunes:author'), 100) ||
    cleanText(tagText(xml, 'managingeditor'), 100) ||
    channelTitle;
  const channelArt = artFromFeed(
    attrFromTag(xml, 'itunes:image', 'href') ||
      /<image\b[\s\S]*?<url>([\s\S]*?)<\/url>/i.exec(xml)?.[1] ||
      tagText(xml, 'logo'),
    feedUrl,
  );

  const items = [
    ...(xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? []),
    ...(xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? []),
  ];
  if (items.length > 1) {
    const first = Date.parse(tagText(items[0], 'pubdate') || tagText(items[0], 'published'));
    const last = Date.parse(
      tagText(items[items.length - 1], 'pubdate') || tagText(items[items.length - 1], 'published'),
    );
    if (Number.isFinite(first) && Number.isFinite(last) && last > first) items.reverse();
  }
  const blocks = items.length > 0 ? items : [xml];

  for (const block of blocks) {
    let audioUrl = attrFromTag(block, 'enclosure', 'url');
    let enclosureType = attrFromTag(block, 'enclosure', 'type');
    let enclosureSize = Number(attrFromTag(block, 'enclosure', 'length'));

    if (!audioUrl) {
      const media = tagMatch(block, 'media:content');
      if (media && /audio/i.test(parseAttrs(media).type || '')) {
        audioUrl = parseAttrs(media).url;
        enclosureType = parseAttrs(media).type;
      }
    }

    if (!audioUrl) {
      for (const tag of block.match(/<link\b[^>]*>/gi) ?? []) {
        const attrs = parseAttrs(tag);
        const isEnclosure =
          attrs.rel === 'enclosure' ||
          (attrs.type || '').toLowerCase().startsWith('audio/');
        if (attrs.href && isEnclosure) {
          audioUrl = attrs.href;
          enclosureType = attrs.type;
          break;
        }
      }
    }

    if (!audioUrl) continue;

    const resolved = resolveUrl(audioUrl, feedUrl);
    if (!resolved) continue;

    const title =
      cleanText(tagText(block, 'title'), 140) ||
      clean(hints?.title, 140) ||
      channelTitle ||
      titleFromUrl(new URL(resolved));
    const duration =
      parseDuration(tagText(block, 'itunes:duration') || tagText(block, 'duration')) ||
      (hints?.duration ?? 0);
    const artUrl =
      artFromFeed(attrFromTag(block, 'itunes:image', 'href'), feedUrl) ||
      channelArt ||
      cleanArtUrl(hints?.artUrl);

    return {
      origin: 'link',
      srcUrl: resolved,
      title: title || 'Untitled',
      artist: clean(hints?.artist, 100) || channelArtist,
      album: clean(hints?.album, 100) || channelTitle,
      duration,
      artUrl,
      provider: hostOf(new URL(resolved)),
      mime: mimeFor(enclosureType || '', extensionOf(new URL(resolved))),
      size: Number.isFinite(enclosureSize) && enclosureSize > 0 ? enclosureSize : null,
    };
  }

  throw new LinkError(415, 'That feed has no audio episodes.', true);
}

// ---- archive.org -------------------------------------------------------

function isArchiveDetails(url: URL): boolean {
  return /(^|\.)archive\.org$/i.test(url.hostname) && /^\/details\/[^/]+/i.test(url.pathname);
}

async function resolveArchive(
  pageUrl: URL,
  page: PageMeta,
  hints: Hints | null,
): Promise<ResolvedLink | null> {
  const identifier = pageUrl.pathname.match(/^\/details\/([^/]+)/i)?.[1];
  if (!identifier) return null;

  try {
    const res = await fetch(`https://archive.org/metadata/${encodeURIComponent(identifier)}`, {
      headers: { 'user-agent': UA },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      metadata?: { title?: string; creator?: string | string[]; album?: string };
      files?: Array<{ name?: string; format?: string; size?: string; length?: string }>;
    };
    const files = data.files ?? [];
    const audioFiles = files.filter((file) => {
      const name = (file.name ?? '').toLowerCase();
      if (!/\.(mp3|m4a|ogg|oga|flac|wav)$/.test(name)) return false;
      if (name.includes('spectrogram') || name.includes('sample')) return false;
      return true;
    });
    if (audioFiles.length === 0) return null;

    const preferred =
      audioFiles.find((file) => /vbr mp3|mp3/i.test(file.format ?? '')) ?? audioFiles[0];
    const name = preferred.name;
    if (!name) return null;

    const srcUrl = `https://archive.org/download/${encodeURIComponent(identifier)}/${name
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`;
    const creator = Array.isArray(data.metadata?.creator)
      ? data.metadata?.creator[0]
      : data.metadata?.creator;

    return {
      origin: 'link',
      srcUrl,
      title:
        clean(hints?.title, 140) ||
        clean(data.metadata?.title, 140) ||
        clean(page.title, 140) ||
        titleFromUrl(pageUrl),
      artist: clean(hints?.artist, 100) || clean(creator, 100) || page.artist,
      album: clean(hints?.album, 100) || clean(data.metadata?.album, 100),
      duration: hints?.duration || parseDuration(preferred.length ?? '') || page.duration,
      artUrl: `https://archive.org/services/img/${encodeURIComponent(identifier)}`,
      provider: 'archive.org',
      mime: mimeFor('', extensionOf(new URL(srcUrl))),
      size: Number(preferred.size) > 0 ? Number(preferred.size) : null,
    };
  } catch {
    return null;
  }
}

// ---- resolver service --------------------------------------------------

async function resolveWithService(env: Env, target: URL): Promise<ResolvedLink> {
  const base = (env.URL_RESOLVER ?? '').trim().replace(/\/+$/, '');
  if (!base) {
    throw new LinkError(422, 'That link needs a resolver, and none is configured.');
  }

  let res: Response;
  try {
    res = await fetch(`${base}/resolve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.URL_RESOLVER_KEY ? { authorization: `Bearer ${env.URL_RESOLVER_KEY}` } : {}),
      },
      body: JSON.stringify({ url: target.toString() }),
      signal: AbortSignal.timeout(RESOLVER_TIMEOUT),
    });
  } catch {
    throw new LinkError(502, 'The link resolver did not answer.', true);
  }

  if (!res.ok) {
    let message = 'The link resolver could not read that page.';
    try {
      const body = (await res.json()) as { error?: string };
      if (typeof body.error === 'string' && body.error.trim()) message = body.error.trim();
    } catch {
      /* keep the default */
    }
    throw new LinkError(422, message, true);
  }

  const data = (await res.json()) as Record<string, unknown>;
  const audio = typeof data.audioUrl === 'string' ? data.audioUrl : data.url;
  if (typeof audio !== 'string' || !audio) {
    throw new LinkError(502, 'The link resolver returned no audio.');
  }

  let src: URL;
  try {
    src = new URL(audio);
  } catch {
    throw new LinkError(502, 'The link resolver returned an invalid URL.');
  }
  if (src.protocol !== 'http:' && src.protocol !== 'https:') {
    throw new LinkError(502, 'The link resolver returned an invalid URL.');
  }

  const duration = Number(data.duration);
  const size = Number(data.size);
  return {
    origin: isYouTube(target) ? 'youtube' : 'link',
    srcUrl: src.toString(),
    title: clean(data.title, 140) || titleFromUrl(target),
    artist: clean(data.artist, 100),
    album: clean(data.album, 100),
    duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
    artUrl: cleanArtUrl(typeof data.artUrl === 'string' ? data.artUrl : null),
    provider: hostOf(target),
    mime: typeof data.mime === 'string' && data.mime.startsWith('audio/') ? data.mime : 'audio/mpeg',
    size: Number.isFinite(size) && size > 0 ? size : null,
  };
}

// ---- fetching ----------------------------------------------------------

async function openGuarded(
  target: URL,
  signal: AbortSignal,
): Promise<{ res: Response; url: URL }> {
  let current = target;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    assertPublicUrl(current);

    let res: Response;
    try {
      res = await fetch(current.toString(), {
        redirect: 'manual',
        signal,
        headers: { 'user-agent': UA, accept: '*/*' },
      });
    } catch (err) {
      if (err instanceof LinkError) throw err;
      throw new LinkError(502, 'That link could not be reached.');
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new LinkError(502, 'That link redirected nowhere.');
      current = new URL(location, current);
      continue;
    }

    if (!res.ok) {
      throw new LinkError(
        res.status === 404 ? 404 : 502,
        res.status === 404 ? 'That link was not found.' : 'That link refused to be read.',
      );
    }

    return { res, url: current };
  }

  throw new LinkError(502, 'That link redirected too many times.');
}

async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  if (!res.body) {
    const buffer = new Uint8Array(await res.arrayBuffer());
    return buffer.subarray(0, max);
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (total < max) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      const room = max - total;
      const slice = value.byteLength > room ? value.subarray(0, room) : value;
      chunks.push(slice);
      total += slice.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

// ---- URL safety --------------------------------------------------------

function normalizeInput(raw: string): URL {
  if (typeof raw !== 'string') throw new LinkError(400, 'Paste a link first.');
  let value = raw.trim();
  if (!value || value.length > MAX_URL_LENGTH) {
    throw new LinkError(400, 'That link is too long.');
  }
  // `example.com:8080` is a host, not a scheme: only keep a real `scheme://`.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new LinkError(400, "That doesn't look like a link.");
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new LinkError(400, 'Only http and https links can be shared.');
  }
  url.hash = '';
  return url;
}

/**
 * Workers cannot reach private networks, so this is mostly a guard against
 * making the resolver endpoint a useful SSRF stepping stone.
 */
function assertPublicUrl(url: URL): void {
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.home.arpa') ||
    host.endsWith('.lan') ||
    host === 'metadata.google.internal' ||
    isPrivateAddress(host)
  ) {
    throw new LinkError(400, 'That address is not reachable from here.');
  }
}

function isPrivateAddress(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, '');

  if (bare.includes(':')) {
    const v6 = bare.toLowerCase();
    if (v6 === '::' || v6 === '::1') return true;
    if (/^f[cd][0-9a-f]{2}:/.test(v6)) return true;
    if (/^fe[89ab][0-9a-f]:/.test(v6)) return true;
    if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
    return false;
  }

  const parts = bare.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255)) return true;
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isYouTube(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  return (
    host === 'youtu.be' ||
    host === 'youtube.com' ||
    host.endsWith('.youtube.com') ||
    host === 'youtube-nocookie.com' ||
    host.endsWith('.youtube-nocookie.com')
  );
}

function isDrmHost(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  return DRM_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

// ---- parsing helpers ---------------------------------------------------

function parseAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const body = tag.replace(/^<\s*[^\s/>]+/, '').replace(/\/?>$/, '');
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body))) {
    const key = match[1].toLowerCase();
    if (!key || key === '/') continue;
    attrs[key] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

function tagMatch(xml: string, name: string): string | null {
  const re = new RegExp(`<${name}\\b[^>]*>`, 'i');
  return re.exec(xml)?.[0] ?? null;
}

function attrFromTag(xml: string, tag: string, attribute: string): string {
  const tagTextValue = tagMatch(xml, tag);
  if (!tagTextValue) return '';
  return parseAttrs(tagTextValue)[attribute] ?? '';
}

function tagText(xml: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)</${escaped}>`, 'i');
  const match = re.exec(xml)?.[1] ?? '';
  return stripCdata(match);
}

function stripCdata(value: string): string {
  return value.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i, '$1').trim();
}

function collectJsonLd(node: unknown, audio: string[]): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectJsonLd(item, audio);
    return;
  }

  const object = node as Record<string, unknown>;
  const type = String(object['@type'] ?? '').toLowerCase();
  if (
    type.includes('audio') ||
    type.includes('music') ||
    type.includes('podcast') ||
    type.includes('video')
  ) {
    for (const key of ['contentUrl', 'url', 'embedUrl']) {
      const value = object[key];
      if (typeof value === 'string' && value) audio.push(value);
    }
    if (object.audio) collectJsonLd(object.audio, audio);
  }

  for (const value of Object.values(object)) {
    if (value && typeof value === 'object') collectJsonLd(value, audio);
  }
}

function firstPlaylistEntry(text: string, playlistUrl: URL): URL | null {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const candidate = /^file\d*\s*=\s*(.+)$/i.exec(trimmed)?.[1] ?? trimmed;
    const resolved = resolveUrl(candidate, playlistUrl);
    if (resolved) return new URL(resolved);
  }
  return null;
}

function isHtml(type: string, text: string): boolean {
  if (type.includes('text/html') || type.includes('application/xhtml')) return true;
  const head = text.slice(0, 400).toLowerCase();
  return head.includes('<html') || head.includes('<!doctype html') || head.includes('<head');
}

function isFeed(type: string, text: string): boolean {
  if (type.includes('rss') || type.includes('atom')) return true;
  const head = text.slice(0, 400).toLowerCase();
  return head.includes('<rss') || head.includes('<feed') || head.includes('<rdf:rdf');
}

function resolveUrl(value: string, base: URL): string | null {
  const decoded = decodeEntities(value).trim();
  if (!decoded) return null;
  try {
    const url = new URL(decoded, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function artFromFeed(value: string | null | undefined, base: URL): string | null {
  if (!value) return null;
  return cleanArtUrl(resolveUrl(value, base));
}

function cleanArtUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = decodeEntities(value).trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function hostOf(url: URL): string {
  return url.hostname.replace(/^www\./, '');
}

function extensionOf(url: URL): string {
  const match = /\.([a-z0-9]{2,5})$/i.exec(url.pathname);
  return match ? `.${match[1].toLowerCase()}` : '';
}

function titleFromUrl(url: URL): string {
  const segment = url.pathname.split('/').filter(Boolean).pop() ?? '';
  let value = segment;
  try {
    value = decodeURIComponent(segment);
  } catch {
    /* keep the raw segment */
  }
  return (
    clean(value.replace(/\.[^.]+$/, '').replace(/[-_+]+/g, ' '), 140) ||
    clean(hostOf(url), 140) ||
    'Untitled'
  );
}

function mimeFor(contentType: string, extension: string): string {
  const base = (contentType ?? '').split(';')[0].trim().toLowerCase();
  if (base.startsWith('audio/')) return base;
  switch (extension) {
    case '.m4a':
    case '.mp4': return 'audio/mp4';
    case '.aac': return 'audio/aac';
    case '.wav': return 'audio/wav';
    case '.ogg':
    case '.oga': return 'audio/ogg';
    case '.flac': return 'audio/flac';
    case '.webm': return 'audio/webm';
    case '.opus': return 'audio/opus';
    default: return 'audio/mpeg';
  }
}

function sizeFrom(res: Response): number | null {
  const range = res.headers.get('content-range');
  if (range) {
    const total = /\/\s*(\d+)\s*$/.exec(range)?.[1];
    if (total) return Number(total);
  }
  const length = Number(res.headers.get('content-length'));
  return Number.isFinite(length) && length > 0 ? length : null;
}

function parseDuration(value: string): number {
  const raw = stripCdata(value).trim();
  if (!raw) return 0;

  const iso = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(raw);
  if (iso) {
    const [, days, hours, minutes, seconds] = iso;
    return (
      (Number(days) || 0) * 86_400 +
      (Number(hours) || 0) * 3600 +
      (Number(minutes) || 0) * 60 +
      (Number(seconds) || 0)
    );
  }

  if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw);

  const parts = raw.split(':').map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function sniffAudio(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return 'audio/mpeg';
  }
  // A raw MPEG frame often has no ID3 tag at the front.
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    return 'audio/mpeg';
  }
  if (ascii(bytes, 0, 4) === 'fLaC') return 'audio/flac';
  if (ascii(bytes, 0, 4) === 'OggS') return 'audio/ogg';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') return 'audio/wav';
  if (ascii(bytes, 4, 4) === 'ftyp') return 'audio/mp4';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return 'audio/webm';
  }
  return null;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i] ?? 0);
  return out;
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (whole, entity: string) => {
    const key = entity.toLowerCase();
    if (key.startsWith('#x')) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    if (key.startsWith('#')) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    const named: Record<string, string> = {
      amp: '&',
      lt: '<',
      gt: '>',
      quot: '"',
      apos: "'",
      nbsp: ' ',
    };
    return named[key] ?? whole;
  });
}

function cleanText(value: string | null | undefined, max: number): string {
  if (!value) return '';
  return clean(decodeEntities(value.replace(/<[^>]*>/g, ' ')), max);
}

function clean(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
