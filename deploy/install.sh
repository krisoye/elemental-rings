#!/bin/bash
# deploy/install.sh — Convention-based deploy hook for ws deploy
#
# Installs npm dependencies for the game server and client after each deploy.
# ws deploy --install only handles Python; this hook covers Node.js.
# Safe to run multiple times (npm install is idempotent).
#
# Runs as the calling user (krisoye) via ws deploy hook runner.
# Uses sudo -u deploy so installed files are owned by the service user.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "[INFO] Installing server npm dependencies..."
sudo -u deploy bash -c "cd '${REPO_DIR}/server' && npm install --prefer-offline 2>&1"
echo "[OK] Server deps installed"

echo "[INFO] Installing client npm dependencies..."
sudo -u deploy bash -c "cd '${REPO_DIR}/client' && npm install --prefer-offline 2>&1"
echo "[OK] Client deps installed"
