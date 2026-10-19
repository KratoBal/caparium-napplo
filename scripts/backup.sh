#!/usr/bin/env bash
# Backup of the compose database (ÁLT-17), plus a restore check into a scratch database.
# Usage: scripts/backup.sh <output-dir>
# The check restores the dump into "restore_check" and compares row counts of the core tables;
# a backup that has not been restored once is not counted as a backup.
set -euo pipefail
OUT="${1:?usage: scripts/backup.sh <output-dir>}"
mkdir -p "$OUT"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$OUT/caparium-$STAMP.dump"

docker compose exec -T db pg_dump -U caparium -d caparium -Fc > "$FILE"
echo "backup: $FILE ($(wc -c < "$FILE") bytes)"

docker compose exec -T db dropdb -U caparium --if-exists restore_check
docker compose exec -T db createdb -U caparium restore_check
docker compose exec -T db pg_restore -U caparium -d restore_check --no-owner < "$FILE"

COUNT_SQL="SELECT (SELECT count(*) FROM measurement)||','||(SELECT count(*) FROM audit_entry)||','||(SELECT count(*) FROM app_user)"
SRC="$(docker compose exec -T db psql -U caparium -d caparium -tA -c "$COUNT_SQL")"
DST="$(docker compose exec -T db psql -U caparium -d restore_check -tA -c "$COUNT_SQL")"
docker compose exec -T db dropdb -U caparium restore_check
if [ "$SRC" != "$DST" ]; then
  echo "restore check FAILED: source $SRC, restored $DST" >&2
  exit 1
fi
echo "restore check ok: measurement,audit_entry,app_user = $SRC"
