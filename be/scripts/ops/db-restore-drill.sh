#!/usr/bin/env bash
# OPS-002: restore drill. Restores a backup from db-backup.sh into a throw-away postgres:17 container, compares
# per-table row counts with the backup's .counts.tsv, checks the migration table, and reports the restore time (RTO).
#
#   be/scripts/ops/db-restore-drill.sh be/backups/karaokenow-<stamp>.dump[.enc]
#
# Encrypted backups need BACKUP_PASSPHRASE. Nothing is written to any existing database. Exit code 1 on any mismatch.
set -euo pipefail
FILE="${1:?usage: db-restore-drill.sh <backup.dump|backup.dump.enc>}"
IMAGE="${PG_IMAGE:-postgres:17-alpine}"
BASE="${FILE%.enc}"; BASE="${BASE%.dump}"
[ -f "$BASE.sha256" ] && [ -f "$BASE.counts.tsv" ] || { echo "missing $BASE.sha256 or $BASE.counts.tsv" >&2; exit 1; }
[ "$(shasum -a 256 "$FILE" | awk '{print $1}')" = "$(cat "$BASE.sha256")" ] || { echo "checksum mismatch" >&2; exit 1; }

WORK="$(mktemp -d)"; NAME="kn-restore-drill-$$"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
DUMP="$FILE"
if [ "${FILE##*.}" = "enc" ]; then
  : "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required for an encrypted backup}"
  DUMP="$WORK/restore.dump"
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$FILE" -out "$DUMP" -pass env:BACKUP_PASSPHRASE
fi

docker run -d --name "$NAME" -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=restore "$IMAGE" >/dev/null
for _ in $(seq 1 60); do docker exec "$NAME" pg_isready -U postgres -d restore >/dev/null 2>&1 && break; sleep 1; done
sleep 1

started=$(date +%s)
docker exec -i "$NAME" pg_restore --no-owner --no-privileges --exit-on-error -U postgres -d restore < "$DUMP"
rto=$(( $(date +%s) - started ))

COUNT_SQL="SELECT table_name, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name), false, true, '')))[1]::text
FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1"
docker exec "$NAME" psql -U postgres -d restore -AtF "	" -v ON_ERROR_STOP=1 -c "$COUNT_SQL" > "$WORK/restored.tsv"
migrations=$(docker exec "$NAME" psql -U postgres -d restore -At -c "SELECT count(*)||' (latest '||max(name)||')' FROM pgmigrations")

if diff -u "$BASE.counts.tsv" "$WORK/restored.tsv" > "$WORK/diff.txt"; then match=yes; else match=no; fi
rows=$(awk -F'\t' '{s+=$2} END {print s+0}' "$WORK/restored.tsv")
echo "restore_seconds=$rto tables=$(wc -l < "$WORK/restored.tsv" | tr -d ' ') rows=$rows counts_match=$match migrations=$migrations"
[ "$match" = yes ] || { cat "$WORK/diff.txt" >&2; exit 1; }
