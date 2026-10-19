#!/bin/sh
# Backup + restore check, run INSIDE the db container (ÁLT-17, JAV-04).
# Mounted at /usr/local/bin/caparium-backup by docker-compose.yml; started by a Coolify
# scheduled task on the db container, or by scripts/backup.sh from the host.
# A backup counts only after it has been restored once: every run restores the new dump
# into a scratch database and compares the row counts of the core tables.
set -eu
DB="${POSTGRES_DB:-caparium}"
USER_NAME="${POSTGRES_USER:-caparium}"
DIR="${BACKUP_DIR:-/backups}"
KEEP="${BACKUP_KEEP:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$DIR/$DB-$STAMP.dump"

COUNT_SQL="SELECT (SELECT count(*) FROM measurement)||' '||(SELECT count(*) FROM audit_entry)||' '||(SELECT count(*) FROM app_user)"
count() { psql -U "$USER_NAME" -d "$1" -tA -c "$COUNT_SQL"; }

mkdir -p "$DIR"
# These tables only grow (no physical delete, append-only audit), so the dump's counts
# must lie between the counts taken just before and just after it.
BEFORE="$(count "$DB")"
pg_dump -U "$USER_NAME" -d "$DB" -Fc -f "$FILE.part"
AFTER="$(count "$DB")"
mv "$FILE.part" "$FILE"
echo "backup: $FILE ($(wc -c < "$FILE") bytes)"

dropdb -U "$USER_NAME" --if-exists restore_check
createdb -U "$USER_NAME" restore_check
pg_restore -U "$USER_NAME" -d restore_check --no-owner "$FILE"
RESTORED="$(count restore_check)"
dropdb -U "$USER_NAME" restore_check

ok=1
set -- $BEFORE; b1=$1 b2=$2 b3=$3
set -- $AFTER; a1=$1 a2=$2 a3=$3
set -- $RESTORED; r1=${1:--1} r2=${2:--1} r3=${3:--1}
for t in "$b1 $r1 $a1" "$b2 $r2 $a2" "$b3 $r3 $a3"; do
  set -- $t
  if [ "$2" -lt "$1" ] || [ "$2" -gt "$3" ]; then ok=0; fi
done
if [ "$ok" != 1 ]; then
  echo "restore check FAILED: before=[$BEFORE] restored=[$RESTORED] after=[$AFTER] (measurement audit_entry app_user)" >&2
  rm -f "$FILE"
  exit 1
fi
echo "restore check ok: measurement audit_entry app_user = $RESTORED"

# keep the newest $KEEP dumps
ls -1t "$DIR"/"$DB"-*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do rm -f "$old"; done
