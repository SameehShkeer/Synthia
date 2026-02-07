#!/usr/bin/env bash
# start-vnc-stream.sh — Launch macOS Screen Sharing + websockify
#
# Captures the desktop via the built-in VNC server (port 5900) and bridges
# it to a WebSocket on port 6080 so the Synthia react-vnc client can connect.
#
# Usage:
#   ./scripts/start-vnc-stream.sh              # defaults
#   VNC_PORT=5901 WS_PORT=6081 ./scripts/start-vnc-stream.sh
#
# Prerequisites:
#   pip install websockify   (or use a venv — see docs/vnc-setup.md)

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration (override via environment variables)
# ---------------------------------------------------------------------------
VNC_PORT="${VNC_PORT:-5900}"
WS_PORT="${WS_PORT:-6080}"
VNC_PASSWORD="${VNC_PASSWORD:-synthia}"
WEBSOCKIFY="${WEBSOCKIFY:-websockify}"
RETRY_DELAY=5

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }

cleanup() {
  log "Shutting down..."
  # Kill background websockify if running
  [[ -n "${WS_PID:-}" ]] && kill "$WS_PID" 2>/dev/null || true
  exit 0
}
trap cleanup SIGINT SIGTERM

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
if ! command -v "$WEBSOCKIFY" &>/dev/null; then
  echo "ERROR: websockify not found."
  echo "Install it with:  pip install websockify"
  echo "Or activate your venv first:  source ~/vnc-env/bin/activate"
  exit 1
fi

# ---------------------------------------------------------------------------
# Step 1 — Enable macOS Screen Sharing (requires sudo)
# ---------------------------------------------------------------------------
log "Enabling macOS Screen Sharing on :${VNC_PORT}..."
sudo /System/Library/CoreServices/RemoteManagement/ARDAgent.app/Contents/Resources/kickstart \
  -activate \
  -configure \
  -access -on \
  -clientopts -setvnclegacy -vnclegacy yes \
  -clientopts -setvncpw -vncpw "$VNC_PASSWORD" \
  -restart -agent \
  -privs -all

# Give the VNC server a moment to bind
sleep 2

# Verify VNC server is listening
if ! lsof -iTCP:"$VNC_PORT" -sTCP:LISTEN -P -n &>/dev/null; then
  log "WARNING: Nothing listening on :${VNC_PORT} — Screen Sharing may not have started."
fi

# ---------------------------------------------------------------------------
# Step 2 — Start websockify with auto-restart
# ---------------------------------------------------------------------------
log "Starting websockify  ws://localhost:${WS_PORT} -> localhost:${VNC_PORT}"
log "Press Ctrl-C to stop."

while true; do
  "$WEBSOCKIFY" --verbose "$WS_PORT" "localhost:${VNC_PORT}" &
  WS_PID=$!
  wait "$WS_PID" || true
  log "websockify exited — restarting in ${RETRY_DELAY}s..."
  sleep "$RETRY_DELAY"
done
