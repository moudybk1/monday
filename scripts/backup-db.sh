#!/bin/sh
# Daily copy of Monday's account database: users, encrypted Perpl keys, policies and history. The stats database is
# not copied; the stats process rebuilds it. Safe while the server runs (VACUUM INTO reads a snapshot). Needs sqlite3.
# Cron, as the user that owns the checkout:
#   0 3 * * * /home/USER/monday/scripts/backup-db.sh >> /home/USER/monday-backups/backup.log 2>&1
# Copy the backups off this machine too: a dead disk takes these with it. They and .env together can trade the account.
set -eu
DATA="$(cd "$(dirname "$0")/.." && pwd)/apps/server/data"
OUT="${OUT:-$HOME/monday-backups}"
mkdir -p "$OUT"
chmod 700 "$OUT"
for db in "$DATA"/monday-*.sqlite; do
  [ -e "$db" ] || continue
  copy="$OUT/$(basename "$db" .sqlite)-$(date +%F).sqlite"
  rm -f "$copy"
  sqlite3 "$db" "vacuum into '$copy'" # a consistent snapshot as one compact file, taken in a read transaction
  [ "$(sqlite3 "$copy" 'pragma integrity_check')" = ok ] || { echo "integrity check failed: $copy" >&2; exit 1; }
done
find "$OUT" -name 'monday-*.sqlite*' -mtime +14 -delete
echo "$(date -u +%FT%TZ) backed up $(ls "$DATA"/monday-*.sqlite | wc -l | tr -d ' ') database(s) to $OUT"
