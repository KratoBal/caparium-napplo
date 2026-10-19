#!/usr/bin/env bash
# Host-side wrapper: runs the in-container backup with its restore check (scripts/db-backup.sh)
# and copies the newest dump out. Usage: scripts/backup.sh [<output-dir>]
set -euo pipefail
docker compose exec -T db caparium-backup
if [ -n "${1:-}" ]; then
  mkdir -p "$1"
  NEWEST="$(docker compose exec -T db sh -c 'ls -1t /backups/*.dump | head -n 1')"
  docker compose cp "db:$NEWEST" "$1/"
  echo "copied: $1/$(basename "$NEWEST")"
fi
