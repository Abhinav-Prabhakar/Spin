<p align="center">
  <img src="assets/wordmark.svg" width="190" alt="Spin">
</p>

<p align="center">
  <strong>One room, one song, same beat.</strong>
</p>

<p align="center">
  <a href="https://abhinav-prabhakar.github.io/Spin/"><img alt="Live" src="https://img.shields.io/badge/GitHub%20Pages-live-101010?style=flat-square&logo=github&logoColor=white"></a>
  <img alt="React 19" src="https://img.shields.io/badge/React-19-101010?style=flat-square&logo=react&logoColor=white">
  <img alt="TypeScript 7" src="https://img.shields.io/badge/TypeScript-7-3178c6?style=flat-square&logo=typescript&logoColor=white">
  <img alt="Vite 8" src="https://img.shields.io/badge/Vite-8-646cff?style=flat-square&logo=vite&logoColor=white">
</p>

<p align="center">
  <img alt="Cloudflare Workers" src="https://img.shields.io/badge/Cloudflare-Workers-f38020?style=flat-square&logo=cloudflare&logoColor=white">
  <img alt="Durable Objects" src="https://img.shields.io/badge/Durable%20Objects-one%20per%20room-f38020?style=flat-square">
  <img alt="Workers KV" src="https://img.shields.io/badge/Workers%20KV-audio%20%2B%20art-f38020?style=flat-square">
  <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-101010?style=flat-square">
</p>

<p align="center">
  <img src="assets/hero.gif" width="100%" alt="A Spin room playing in sync, with the ten-band equalizer, hearts and grid view">
</p>

<p align="center"><sub>A real room, not a screenshot. Everything below is the live app.</sub></p>

Spin is a quiet place to listen with friends. Share a six-character link, drop in MP3s or paste a URL, and every screen hears the same second — with a proper ten-band equalizer and nothing else. No accounts, no library, no feed.

- **Same second.** One Durable Object owns the clock; late joiners, reconnects and phone browsers all land exactly where the room is.
- **Ten bands.** ±12 dB, six presets, and your curve is saved on this device. Built on a real Web Audio filter chain.
- **Files or links.** Upload an MP3, or paste direct audio, an episode page, a podcast feed, a playlist or a YouTube link.
- **Just a link.** Drag to reorder the queue, send hearts, see who is listening, copy an invite. That is the whole product.

<p align="center">
  <img src="assets/landing.png" width="100%" alt="Spin landing page: Listen together.">
</p>

<p align="center"><sub>No sign-up. A room is a link.</sub></p>

<p align="center">
  <img src="assets/room.png" width="100%" alt="Spin room with artwork, waveform, transport and shared queue">
</p>

<p align="center"><sub>Artwork, a waveform you can scrub, one shared queue.</sub></p>

<p align="center">
  <img src="assets/equalizer.png" width="82%" alt="Spin ten-band equalizer with the Warm preset and a custom curve">
</p>

<p align="center"><sub>Ten bands, ±12 dB. Warm, Vocal, Bass, Bright, Night — or your own curve.</sub></p>

<p align="center">
  <img src="assets/grid.png" width="100%" alt="Spin grid view with four album covers">
</p>

<p align="center"><sub>List for the set, grid for the covers.</sub></p>

<p align="center">
  <img src="assets/mobile.png" width="32%" alt="Spin room on a phone">
</p>

<p align="center"><sub>The same room, one thumb.</sub></p>

## Share a link

Paste a URL into the queue and Spin will find the audio:

- direct audio (`mp3`, `m4a`, `aac`, `wav`, `ogg`, `flac`, `webm`, `opus`)
- episode pages with `og:audio`, `<audio>` markup or JSON-LD
- podcast RSS / Atom feeds (the newest episode wins)
- `.m3u` and `.pls` playlists
- Internet Archive `/details/` pages

The room stores only the title, artwork and source URL. Each listener fetches the audio for themselves, which keeps playback in sync and means the server never proxies a byte of it. Duration, and the waveform when the source allows decoding, arrive from the first device that finishes and are shared with the room.

Sources that allow CORS play through Web Audio, so the equalizer and live bars work exactly as they do for uploads. A source that refuses CORS still plays, but uses a plain `<audio>` element and the equalizer panel explains that it cannot shape that source. Files over 32 MB stream from the source instead of being cached as a blob.

**YouTube** needs a resolver: YouTube will not hand usable audio URLs to a Cloudflare Worker's IP, so there is nothing safe to extract server-side. Spin supports an optional resolver service with a small documented contract — see [`resolver/`](resolver/README.md) for a ready-to-deploy `yt-dlp` example. Configure it with:

```bash
wrangler secret put URL_RESOLVER       # e.g. https://resolver.example.com
wrangler secret put URL_RESOLVER_KEY   # the resolver's bearer token
```

Only download content you have the rights to. HLS and DRM services (Spotify, Apple Music, Tidal, Deezer, Amazon Music) are not supported and return a clear message.

## Under the hood

One Worker routes rooms, uploads and media. Each room is a Durable Object with an authoritative clock, presence and a storage alarm that advances the queue. Uploaded audio and artwork live in Workers KV, chunked so Range requests and seeking stay instant; link tracks stay at their source and are fetched per device.

<p align="center">
  <img src="assets/architecture.svg" width="100%" alt="Browsers connect over WebSockets to a Durable Object per room; uploaded audio and art live in Workers KV while links are fetched by each browser">
</p>

## Run it

```bash
npm install
npm run dev          # app on :5173, Worker on :8790
npm run typecheck    # client + Worker
npm run build:pages  # static build in docs/
npm run deploy:api   # wrangler deploy
```

The Pages build reads `VITE_BASE` and `VITE_API_ORIGIN` from `.env.pages`.

<p align="center"><sub>MIT · made for headphones.</sub></p>
