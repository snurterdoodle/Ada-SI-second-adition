#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "Missing .env — run ./install-docker.sh first" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker not found." >&2
  exit 1
fi

echo ""
echo "Starting Ada-SI (Docker)..."
echo ""

docker compose up -d --build

echo ""
echo "Ada-SI is running."
echo "  App:  http://localhost:8080"
echo "  Logs: docker compose logs -f"
echo "  Stop: ./stop-docker.sh"
echo ""
