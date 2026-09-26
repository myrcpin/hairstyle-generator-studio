#!/usr/bin/env bash
# Applies all migrations to a throwaway local Postgres and runs SQL assertions.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
PGBIN="${PGBIN:-$(dirname "$(command -v initdb)")}"
TMP="$(mktemp -d)"
PORT="${PGPORT_TEST:-54329}"
cleanup() { "$PGBIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
RUNAS=""
if [ "$(id -u)" = "0" ]; then chown -R postgres "$TMP" 2>/dev/null && RUNAS="runuser -u postgres --"; fi
$RUNAS "$PGBIN/initdb" -D "$TMP/data" -U postgres -A trust >/dev/null
$RUNAS "$PGBIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null
PSQL=(psql -h "$TMP" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -c "create database app"
"${PSQL[@]}" -d app -f "$ROOT/tests/db/00_supabase_stubs.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do echo "applying $(basename "$f")"; "${PSQL[@]}" -d app -f "$f"; done
"${PSQL[@]}" -d app -f "$ROOT/tests/db/10_credits_test.sql"
