#!/usr/bin/env bash
# Deploy one commit of main to this machine: back up the account database, build the new images while the old ones
# keep trading, swap the containers, and wait until all three answer their health checks.
# Run on the VPS from the checkout, by hand or by the Deploy workflow over SSH:
#   infra/deploy.sh [commit]        (default: the tip of origin/main)
# Host Caddy setup (infra/docker-compose.host-caddy.yml). Stopping the server cancels its resting orders before it
# exits; it starts again quoting if it was quoting. Never point this at a second machine trading the same accounts.
set -euo pipefail

cd "$(dirname "$0")/.."
SHA="${1:-}"

echo "== fetch"
git fetch --quiet origin main
git checkout --quiet main
# Only forward along main: a machine with commits of its own stops here instead of losing them.
git merge --ff-only --quiet "${SHA:-origin/main}"
echo "now at $(git log --oneline -1)"

echo "== back up the account database"
if command -v sqlite3 >/dev/null; then
  scripts/backup-db.sh
else
  echo "sqlite3 not installed: no backup taken" >&2
fi

COMPOSE=(docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.host-caddy.yml)

echo "== build"
"${COMPOSE[@]}" build

echo "== swap containers"
"${COMPOSE[@]}" up -d --remove-orphans

echo "== wait for health"
check() { curl -fsS -o /dev/null --max-time 5 "$1"; }
for i in $(seq 1 40); do
  if check http://127.0.0.1:3101/api/health && check http://127.0.0.1:3102/api/stats/health && check http://127.0.0.1:3100/; then
    echo "healthy after $((i * 3))s: server, stats and web"
    "${COMPOSE[@]}" ps
    exit 0
  fi
  sleep 3
done

echo "not healthy after 120s" >&2
"${COMPOSE[@]}" ps >&2
"${COMPOSE[@]}" logs --tail 80 server stats web >&2
exit 1
