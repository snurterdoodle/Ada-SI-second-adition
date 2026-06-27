#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo ""
echo "Ada-SI Docker install"
echo ""

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker not found. Install Docker Engine: https://docs.docker.com/engine/install/" >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin not found. Install docker-compose-plugin." >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  if [[ ! -f .env.example ]]; then
    echo "Missing .env.example" >&2
    exit 1
  fi
  cp .env.example .env
  echo "Created .env from .env.example"
  echo "Edit .env and add your API keys before starting Ada-SI."
else
  echo ".env already exists"
fi

mkdir -p chat/staging chat/custom_tools logs
echo "Runtime directories ready"

echo ""
echo "Docker install complete."
echo "Next: edit .env if needed, then run ./start-docker.sh"
echo ""
