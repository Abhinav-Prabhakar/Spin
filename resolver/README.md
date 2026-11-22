# Spin link resolver

Spin's Worker can read direct audio links, pages with `og:audio` metadata, podcast RSS feeds, `.m3u` / `.pls` playlists and Internet Archive items by itself. YouTube is different: it refuses to serve usable media streams to datacenter IPs, so the Worker cannot extract it.

This folder is a small, dependency-free Node service that closes that gap with [`yt-dlp`](https://github.com/yt-dlp/yt-dlp).

## How it works

1. `POST /resolve` downloads the best audio-only stream into a temporary folder and returns a URL on this service.
2. Each Spin client fetches that URL for itself (`GET /media/:id`), with Range support, so playback stays in sync and one listener never forwards audio to another.
3. Files expire after six hours by default.

The contract is intentionally small, because `worker/link.ts` already speaks it:

```http
POST /resolve
Authorization: Bearer $RESOLVER_KEY
Content-Type: application/json

{ "url": "https://www.youtube.com/watch?v=…" }
```

```json
{
  "audioUrl": "https://resolver.example.com/media/8a…",
  "title": "…",
  "artist": "…",
  "album": "…",
  "duration": 213.4,
  "artUrl": "https://…/cover.jpg",
  "mime": "audio/mp4",
  "size": 3412048
}
```

`GET /media/:id` sends `Access-Control-Allow-Origin: *`, `Accept-Ranges: bytes` and `Content-Range`, so the Spin equalizer can work through Web Audio.

## Run it

With Docker:

```bash
docker build -t spin-resolver resolver
docker run --rm -p 8787:8787 \
  -e RESOLVER_KEY=change-me \
  -e PUBLIC_URL=https://resolver.example.com \
  spin-resolver
```

Without Docker (Node 22+, `yt-dlp` and `ffmpeg` on `PATH`):

```bash
RESOLVER_KEY=change-me PUBLIC_URL=https://resolver.example.com \
  node resolver/server.mjs
```

Deploy it anywhere with a stable HTTPS address — a VPS, Fly.io, Render, Railway, or a home server behind a tunnel. YouTube blocks datacenter IPs for *extraction*, so the image can route yt-dlp through a free Cloudflare WARP tunnel (`WARP_PROXY=1`). A resolver on a residential connection is still the most reliable.

`GET /probe?url=…&client=…` returns yt-dlp's metadata result or error for one link, which is handy for checking a host's IP reputation.

## Point Spin at it

```bash
wrangler secret put URL_RESOLVER       # https://resolver.example.com
wrangler secret put URL_RESOLVER_KEY   # the same RESOLVER_KEY
```

The Worker only calls the resolver for YouTube links (or as a fallback when native parsing finds nothing). Without these secrets, YouTube links return a friendly “resolver not configured” message.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `RESOLVER_KEY` | — | Required. Bearer token for `POST /resolve`. |
| `ALLOW_INSECURE` | unset | Set to `1` to run without `RESOLVER_KEY` (development only). |
| `PUBLIC_URL` | `http://localhost:$PORT` | Origin used for returned media URLs. Use the public HTTPS URL in production. |
| `PORT` | `8787` | Listen port. |
| `YTDLP_BIN` | `yt-dlp` | Path to the yt-dlp binary. |
| `YTDLP_CLIENT` | unset | Pin the YouTube player client, e.g. `tv_simply`. |
| `YTDLP_PROXY` | unset | Proxy passed to yt-dlp, e.g. `socks5://127.0.0.1:8086`. |
| `WARP_PROXY` | unset | Set to `1` to register a free Cloudflare WARP account and route yt-dlp through it. |
| `TTL_MS` | 6 hours | How long downloaded audio is kept. |
| `MAX_BYTES` | 150 MB | Largest download accepted. |
| `MAX_ACTIVE` | `3` | Concurrent resolves before returning 429. |
| `DOWNLOAD_TIMEOUT_MS` | 180000 | yt-dlp download timeout. |
| `ALLOW_HOSTS` | any | Optional comma-separated host allowlist, e.g. `youtube.com,youtu.be`. |

## Notes

- Keep `RESOLVER_KEY` secret. Media URLs are unguessable UUIDs and are intentionally readable without the key, because `<audio>` / `fetch` requests from the browser cannot attach an Authorization header.
- This image installs the latest `yt-dlp` at build time. Rebuild occasionally; YouTube changes its player often.
- Only download content you own or have permission to download. YouTube's terms prohibit downloading without authorization, and yt-dlp is not affiliated with YouTube.
