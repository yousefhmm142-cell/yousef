#!/usr/bin/env bash
# Builds a throwaway local database, applies the migrations and seed, then runs the checks.
# Usage: supabase/tests/run.sh   (needs a local PostgreSQL 15+ and a superuser; set PSQL to override)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(dirname "$here")"
db="${TEST_DB:-m2_checks}"
psql_cmd="${PSQL:-psql}"

$psql_cmd -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $db" -c "create database $db"
run() { $psql_cmd -q -v ON_ERROR_STOP=1 -d "$db" -f "$1"; }

run "$here/auth_stub.sql"
for f in "$root"/migrations/*.sql; do run "$f"; done
run "$root/seed.sql"
$psql_cmd -v ON_ERROR_STOP=1 -d "$db" -f "$here/checks.sql" 2>&1 | grep -E 'PASS|FAIL|ERROR|ALL CHECKS'
