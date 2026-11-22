#!/bin/sh
set -eu

# Optional Cloudflare WARP tunnel. YouTube rejects yt-dlp on datacenter IPs with
# "Sign in to confirm you're not a bot"; sending the extractor through WARP
# gives it a consumer-facing egress instead. Registration is free and anonymous.
if [ "${WARP_PROXY:-0}" = "1" ]; then
  export YTDLP_PROXY="${YTDLP_PROXY:-socks5://127.0.0.1:8086}"
  CFG=/tmp/usque/config.json
  mkdir -p /tmp/usque

  if [ ! -f "$CFG" ]; then
    attempt=1
    while [ "$attempt" -le 3 ]; do
      echo "usque: registering (attempt $attempt)"
      if usque register -c "$CFG"; then break; fi
      attempt=$((attempt + 1))
      sleep 3
    done
  fi

  if [ -f "$CFG" ]; then
    usque l4-socks -c "$CFG" -b 127.0.0.1 -p 8086 &
    WARP_PID=$!
    i=0
    while [ "$i" -lt 40 ]; do
      if python3 -c "import socket,sys; s=socket.socket(); s.settimeout(0.5); sys.exit(0 if s.connect_ex(('127.0.0.1', 8086)) == 0 else 1)"; then
        echo "usque: socks proxy ready"
        break
      fi
      if ! kill -0 "$WARP_PID" 2>/dev/null; then
        echo "usque: proxy exited"
        unset YTDLP_PROXY
        break
      fi
      i=$((i + 1))
      sleep 1
    done
  else
    echo "usque: registration failed, continuing without a proxy"
    unset YTDLP_PROXY
  fi
fi

exec node server.mjs
