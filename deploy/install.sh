#!/bin/bash
# deploy/install.sh — Convention-based deploy hook for ws deploy
#
# Builds the game server and client into runnable artifacts on every deploy, so
# the systemd units run BUILT artifacts (node dist/server/index.js; a static
# vite preview of client/dist) instead of `npm run dev`. No tsc/vite/watcher
# runs at service runtime — the units are plain, hardenable node processes.
#
#   - server/: npm install → npm run build
#       (tsc → dist/server/index.js, plus the schema.sql asset copy that tsc
#        does NOT do on its own; see server/package.json "build"/"copy-assets")
#   - client/: npm install → npm run build  (tsc && vite build → client/dist/)
#
# ws deploy --install only handles Python; this hook covers Node.js.
# Safe to re-run: npm install and both builds are idempotent.
#
# Runs as the calling user (krisoye) via the ws deploy hook runner. Uses
# `sudo -u deploy` so dist/ and node_modules/ are owned by the deploy service
# identity (svcapp reads them at runtime via the platform runtime ACL — same
# ownership lesson as the venv fix). set -euo pipefail keeps this FAIL-LOUD: a
# failed install or build aborts the deploy rather than leaving a broken or
# half-built artifact live behind a still-running old process.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

build_package() {
  local name="$1" dir="$2"
  echo "[INFO] Building ${name}: npm install + npm run build..."
  sudo -u deploy bash -c "cd '${dir}' && npm install --prefer-offline 2>&1 && npm run build 2>&1"
  echo "[OK] ${name} built"
}

build_package "server" "${REPO_DIR}/server"
build_package "client" "${REPO_DIR}/client"
