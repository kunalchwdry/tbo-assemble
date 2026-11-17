#!/usr/bin/env bash
# Verifies docs/security/migrations/2026-11-17-event-ownership.{up,down}.sql against prisma/schema.prisma in an
# ISOLATED database: creates a scratch database, builds today's schema from `main` (git show), simulates Supabase's
# default grants, applies up -> checks Prisma sees no drift -> applies down -> checks the old schema is restored.
# Usage: PGURL=postgresql://postgres@127.0.0.1:55432 bash scripts/security-migration-check.sh
# Refuses to run against anything but localhost.
set -euo pipefail
PGURL=${PGURL:-postgresql://postgres@127.0.0.1:55432}
case "$PGURL" in postgresql://*@127.0.0.1:*|postgresql://*@localhost:*) ;; *) echo "Refusing: PGURL must be a local database" >&2; exit 2;; esac
PSQL=${PSQL:-psql}; DB=tbo_migration_check_$$; M=docs/security/migrations; W=$(mktemp -d)
git show origin/main:prisma/schema.prisma > "$W/main.prisma" 2>/dev/null || git show main:prisma/schema.prisma > "$W/main.prisma"
$PSQL "$PGURL/postgres" -qc "CREATE DATABASE $DB" >/dev/null
trap '$PSQL "$PGURL/postgres" -qc "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1; rm -rf "$W"' EXIT
Q="$PSQL $PGURL/$DB -v ON_ERROR_STOP=1 -qAt"
$Q <<'SQL'
CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;  -- Supabase's default
SQL
export DATABASE_URL="$PGURL/$DB"
drift() { npx prisma migrate diff --from-config-datasource --to-schema "$1" --exit-code >"$W/d.txt" 2>&1 && echo none || { [ $? -eq 2 ] && echo DRIFT || { echo ERROR; cat "$W/d.txt" >&2; }; }; }
npx prisma db push --schema "$W/main.prisma" >/dev/null 2>&1
fail=0; check() { if [ "$2" = "$3" ]; then echo "PASS $1"; else echo "FAIL $1 (got $2, want $3)"; fail=1; fi; }
check "baseline matches main schema" "$(drift "$W/main.prisma")" none
$Q -f $M/2026-11-17-event-ownership.up.sql
check "after up: no drift from prisma/schema.prisma" "$(drift prisma/schema.prisma)" none
check "RLS enabled on both new tables" "$($Q -c "select count(*) from pg_class where relname in ('EventMember','BookingAccess') and relrowsecurity")" 2
check "no grants to anon/authenticated on new tables" "$($Q -c "select count(*) from information_schema.role_table_grants where table_name in ('EventMember','BookingAccess') and grantee in ('anon','authenticated')")" 0
check "existing tables untouched (17 + 2)" "$($Q -c "select count(*) from information_schema.tables where table_schema='public'")" 19
check "re-running up fails atomically" "$($Q -f $M/2026-11-17-event-ownership.up.sql >/dev/null 2>&1 && echo applied || echo refused)" refused
$Q -c "insert into \"Agent\"(id,name,email,password) values ('a1','A','a@x.test','x')"
$Q -c "insert into \"Event\"(id,name,slug,type,venue,location,\"checkIn\",\"checkOut\",\"agentId\") values ('e1','E','e1','t','v','l',now(),now(),'a1')"
check "bad role rejected" "$($Q -c "insert into \"EventMember\"(id,\"eventId\",\"authUserId\",role) values ('m1','e1',gen_random_uuid(),'admin')" >/dev/null 2>&1 && echo accepted || echo rejected)" rejected
check "email as approval reference rejected" "$($Q -c "insert into \"EventMember\"(id,\"eventId\",\"authUserId\",\"grantedBy\") values ('m2','e1',gen_random_uuid(),'someone@example.test')" >/dev/null 2>&1 && echo accepted || echo rejected)" rejected
check "raw token in tokenHash rejected" "$($Q -c "insert into \"BookingAccess\"(id,\"bookingId\",kind,\"tokenHash\",\"expiresAt\") values ('b1','nobooking','link','short',now()+interval '1 day')" >/dev/null 2>&1 && echo accepted || echo rejected)" rejected
check "deleting an event removes its memberships" "$($Q -c "insert into \"EventMember\"(id,\"eventId\",\"authUserId\") values ('m3','e1',gen_random_uuid()); delete from \"Event\" where id='e1'; select count(*) from \"EventMember\"")" 0
$Q -f $M/2026-11-17-event-ownership.down.sql
check "after down: matches main schema again" "$(drift "$W/main.prisma")" none
check "after down: only the 2 new tables removed" "$($Q -c "select count(*) from information_schema.tables where table_schema='public'")" 17
check "agent row kept through up/down" "$($Q -c "select count(*) from \"Agent\"")" 1
exit $fail
