#!/usr/bin/env bash
# OPS-002: logical backup of a PostgreSQL database (custom format) + checksum + per-table row counts.
#
#   DATABASE_URL=postgresql://... be/scripts/ops/db-backup.sh [out_dir]
#
# - pg_dump runs in a postgres:17 container (same major as production Prisma Postgres) so the host needs only Docker.
# - The URL is passed through the environment, never printed. localhost/127.0.0.1 is rewritten to host.docker.internal.
# - BACKUP_PASSPHRASE set → the dump is encrypted (openssl AES-256-CBC, PBKDF2 200k) and the plain file is removed.
#   The backup contains customer phone numbers/emails: never store it unencrypted outside this machine.
# Output: <out_dir>/karaokenow-<UTC timestamp>.dump[.enc], .sha256, .counts.tsv
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL must be set}"
OUT_DIR="${1:-$(cd "$(dirname "$0")/../.." && pwd)/backups}"
IMAGE="${PG_IMAGE:-postgres:17-alpine}"
mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BASE="$OUT_DIR/karaokenow-$STAMP"
URL="$(printf '%s' "$DATABASE_URL" | sed -E 's#@(localhost|127\.0\.0\.1)([:/])#@host.docker.internal\2#')"

COUNT_SQL="SELECT table_name, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name), false, true, '')))[1]::text
FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1"

started=$(date +%s)
umask 077
docker run --rm -e PGURL="$URL" "$IMAGE" sh -c 'pg_dump --format=custom --compress=6 --no-owner --no-privileges --dbname="$PGURL"' > "$BASE.dump"
docker run --rm -e PGURL="$URL" -e SQL="$COUNT_SQL" "$IMAGE" sh -c 'psql "$PGURL" -AtF "	" -v ON_ERROR_STOP=1 -c "$SQL"' > "$BASE.counts.tsv"
elapsed=$(( $(date +%s) - started ))

FILE="$BASE.dump"
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$BASE.dump" -out "$BASE.dump.enc" -pass env:BACKUP_PASSPHRASE
  rm -f "$BASE.dump"
  FILE="$BASE.dump.enc"
fi
shasum -a 256 "$FILE" | awk '{print $1}' > "$BASE.sha256"

size=$(wc -c < "$FILE" | tr -d ' ')
tables=$(wc -l < "$BASE.counts.tsv" | tr -d ' ')
echo "backup=$FILE"
echo "bytes=$size tables=$tables seconds=$elapsed encrypted=$([ -n "${BACKUP_PASSPHRASE:-}" ] && echo yes || echo no)"
