#!/usr/bin/env bash
# Run AI service, API and web together (Ctrl-C stops all).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
set -a; . ./.env; set +a
# A codespace restart stops all containers; bring Fabric and Postgres back (their data lives in volumes).
stopped=$(docker ps -aq --filter status=exited)
[ -n "$stopped" ] && docker start $stopped >/dev/null
docker compose up -d
until docker compose exec -T postgres pg_isready -U aegis >/dev/null 2>&1; do sleep 1; done
trap 'kill 0' EXIT
ai/.venv/bin/python -m uvicorn ai.main:app --host 127.0.0.1 --port 8001 &
pnpm --filter @aegis/api start &
pnpm --filter @aegis/web dev --host 0.0.0.0 &
wait
