#!/bin/sh
# Periodic Postgres backups with retention. Runs as the `backup` compose service
# (postgres image). Dumps to /backups every BACKUP_INTERVAL_SECONDS and keeps the
# most recent BACKUP_KEEP files. Restore with:
#   gunzip -c team_coder-YYYYmmdd-HHMMSS.sql.gz | psql "$DATABASE_URL"
set -eu

INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"   # daily by default
KEEP="${BACKUP_KEEP:-7}"
DIR=/backups
mkdir -p "$DIR"

while true; do
  TS=$(date -u +%Y%m%d-%H%M%S)
  OUT="$DIR/team_coder-$TS.sql.gz"
  echo "[backup] dumping → $OUT"
  if pg_dump "$DATABASE_URL" | gzip > "$OUT"; then
    echo "[backup] ok ($(du -h "$OUT" | cut -f1))"
  else
    echo "[backup] FAILED" >&2
    rm -f "$OUT"
  fi
  # retention: keep the newest $KEEP dumps
  ls -1t "$DIR"/team_coder-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
  sleep "$INTERVAL"
done
