FROM node:22-slim

# yt-dlp needs ffmpeg; usque routes YouTube traffic through Cloudflare WARP so
# the extractor is not rejected with "Sign in to confirm you're not a bot".
ARG USQUE_VERSION=v4.2.1

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg ca-certificates curl unzip \
  && pip3 install --no-cache-dir --break-system-packages -U yt-dlp \
  && curl -fsSL -o /tmp/usque.zip \
       "https://github.com/Diniboy1123/usque/releases/download/${USQUE_VERSION}/usque_${USQUE_VERSION#v}_linux_amd64.zip" \
  && unzip -o /tmp/usque.zip -d /tmp/usque \
  && find /tmp/usque -name usque -type f -exec install -m 0755 {} /usr/local/bin/usque \; \
  && rm -rf /tmp/usque /tmp/usque.zip \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server.mjs .
COPY start.sh .
RUN chmod +x start.sh

ENV PORT=8787
EXPOSE 8787

CMD ["./start.sh"]
