#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "Stopping Ada-SI (Docker)..."
docker compose down
echo "Done."
