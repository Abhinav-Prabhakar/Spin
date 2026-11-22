FROM node:22-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg ca-certificates \
  && pip3 install --no-cache-dir --break-system-packages -U yt-dlp \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server.mjs .

ENV PORT=8787
EXPOSE 8787

CMD ["node", "server.mjs"]
