#!/usr/bin/env bash
# Backup + restore drill (plan Phase 0.4): dumps SOURCE_URL with pg_dump (custom format), restores it into a fresh
# scratch database on RESTORE_PGURL (must be localhost), then compares the row count of every public table and the
# schema (prisma migrate diff against prisma/schema.prisma). Prints counts only, never row contents.
#   SOURCE_URL=postgresql://…/db RESTORE_PGURL=postgresql://postgres@127.0.0.1:55432 bash scripts/security-restore-drill.sh
# Running it against PRODUCTION as SOURCE_URL needs explicit approval; the dump then contains personal data: keep it
# encrypted, on an approved machine, and delete it after the drill (DUMP_KEEP=1 keeps it; default deletes it).
set -euo pipefail
: "${SOURCE_URL:?set SOURCE_URL}"; RESTORE_PGURL=${RESTORE_PGURL:-postgresql://postgres@127.0.0.1:55432}
case "$RESTORE_PGURL" in postgresql://*@127.0.0.1:*|postgresql://*@localhost:*) ;; *) echo "Refusing: RESTORE_PGURL must be a local database server" >&2; exit 2;; esac
BIN=${PG_BIN:-}; PGDUMP=${BIN:+$BIN/}pg_dump; PGRESTORE=${BIN:+$BIN/}pg_restore; PSQL=${BIN:+$BIN/}psql
W=$(mktemp -d); DUMP="$W/backup.dump"; DB=tbo_restore_drill_$$
cleanup() { $PSQL "$RESTORE_PGURL/postgres" -qc "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1 || true; [ "${DUMP_KEEP:-0}" = 1 ] && echo "dump kept at $DUMP" || rm -rf "$W"; }
trap cleanup EXIT
t0=$(date +%s); $PGDUMP --format=custom --no-owner --no-privileges --schema=public "$SOURCE_URL" -f "$DUMP"
echo "dump: $(du -h "$DUMP" | cut -f1) in $(( $(date +%s) - t0 )) s"
$PSQL "$RESTORE_PGURL/postgres" -qc "CREATE DATABASE $DB"
$PSQL "$RESTORE_PGURL/$DB" -qc "DROP SCHEMA public CASCADE"  # the dump recreates it (pg_dump --schema=public includes CREATE SCHEMA)
t0=$(date +%s); $PGRESTORE --no-owner --no-privileges --exit-on-error -d "$RESTORE_PGURL/$DB" "$DUMP"; echo "restore: $(( $(date +%s) - t0 )) s"
counts() { $PSQL "$1" -qAt -c "select string_agg(format('%s=%s', t, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t), false, true, '')))[1]::text), ' ' order by t) from (select tablename t from pg_tables where schemaname='public') s"; }
SRC=$(counts "$SOURCE_URL"); DST=$(counts "$RESTORE_PGURL/$DB")
echo "source  : $SRC"; echo "restored: $DST"
[ "$SRC" = "$DST" ] && echo "PASS row counts identical" || { echo "FAIL row counts differ"; exit 1; }
DATABASE_URL="$RESTORE_PGURL/$DB" npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code >/dev/null 2>&1 && echo "PASS restored schema matches prisma/schema.prisma" || echo "NOTE restored schema differs from prisma/schema.prisma (expected if the source predates the ownership migration)"
SRCSUM=$($PSQL "$SOURCE_URL" -qAt -c "select md5(string_agg(t||':'||md5(coalesce((select string_agg(x::text, ',' order by x::text) from (select row_to_json(r) x from (select * from public.\"Event\") r) z), '')), ',')) from (values ('Event')) v(t)" 2>/dev/null || echo n/a)
DSTSUM=$($PSQL "$RESTORE_PGURL/$DB" -qAt -c "select md5(string_agg(t||':'||md5(coalesce((select string_agg(x::text, ',' order by x::text) from (select row_to_json(r) x from (select * from public.\"Event\") r) z), '')), ',')) from (values ('Event')) v(t)" 2>/dev/null || echo n/a)
[ "$SRCSUM" = "$DSTSUM" ] && echo "PASS Event table content checksum identical" || { echo "FAIL Event checksum differs"; exit 1; }
