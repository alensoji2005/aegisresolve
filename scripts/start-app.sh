#!/usr/bin/env bash
# Run AI service, API and web together (Ctrl-C stops all).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
set -a; . ./.env; set +a
trap 'kill 0' EXIT
ai/.venv/bin/python -m uvicorn ai.main:app --host 127.0.0.1 --port 8001 &
pnpm --filter @aegis/api start &
pnpm --filter @aegis/web dev --host 0.0.0.0 &
wait
