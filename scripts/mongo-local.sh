#!/usr/bin/env bash
set -euo pipefail
umask 077

mongo="${MONGOD_EXECUTABLE:-$HOME/.local/share/ev-trust-tools/mongodb/usr/bin/mongod}"
if [[ ! -x "$mongo" ]]; then mongo="$(command -v mongod || true)"; fi
if [[ -z "$mongo" ]]; then
  echo "Install MongoDB Community Server in WSL/Linux, or set MONGOD_EXECUTABLE." >&2
  exit 1
fi

state="$HOME/.local/share/ev-trust-mongodb"
mkdir -p "$state/data"
if (echo > /dev/tcp/127.0.0.1/27017) 2>/dev/null; then
  echo "A service is already listening on port 27017. The trust API will verify that it is MongoDB."
  exit
fi
"$mongo" --bind_ip 127.0.0.1 --port 27017 --dbpath "$state/data" \
  --logpath "$state/mongod.log" --wiredTigerCacheSizeGB 0.5 --fork
