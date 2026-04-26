#!/usr/bin/env bash
# Launches headless Chromium with remote debugging bound to 0.0.0.0:$PORT so
# the JARVIS web app can connect over CDP. --user-data-dir points at /data
# (Fly volume) so the profile survives restarts.

set -euo pipefail

PORT="${PORT:-9222}"
PROFILE_DIR="${PROFILE_DIR:-/data/profile}"

mkdir -p "$PROFILE_DIR"

# --no-sandbox is required inside the container. --disable-dev-shm-usage
# avoids Chrome crashes on small /dev/shm. --remote-debugging-address 0.0.0.0
# exposes CDP over the wire (Fly routes the public port to this).
exec /ms-playwright/chromium-*/chrome-linux/chrome \
    --headless=new \
    --no-sandbox \
    --disable-dev-shm-usage \
    --disable-gpu \
    --no-first-run \
    --remote-debugging-address=0.0.0.0 \
    --remote-debugging-port="$PORT" \
    --user-data-dir="$PROFILE_DIR" \
    --disable-blink-features=AutomationControlled \
    "about:blank"
