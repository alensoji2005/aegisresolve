#!/usr/bin/env bash
# Start Fabric (2 orgs + CAs), deploy chaincode, start Postgres + MinIO, seed. Safe to re-run after `network/down.sh`.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export FABRIC_SAMPLES="$HOME/fabric-samples" PATH="$HOME/fabric-samples/bin:$PATH" AEGIS_ROOT="$ROOT"
cd "$ROOT"
bash network/up.sh
bash network/deploy.sh "${1:-1}"
docker compose up -d
until docker compose exec -T postgres pg_isready -U aegis >/dev/null 2>&1; do sleep 1; done
pnpm --filter @aegis/api seed
echo "Fabric is up and seeded. Next: bash scripts/start-app.sh"
