#!/usr/bin/env bash
# Local copy only: starts a fresh, empty copy of Supabase and loads supabase/setup.sql as the
# "postgres" role, the same role the Supabase SQL Editor uses. Everything from before is wiped.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
"$here/../build-setup.sh" > /dev/null
dc() { docker compose -f "$here/docker-compose.yml" "$@"; }

dc down --remove-orphans > /dev/null 2>&1 || true
dc up -d --wait > /dev/null
# The sign-in service creates its own tables on start; wait until it answers.
for _ in $(seq 1 60); do
  curl -fsS http://127.0.0.1:54329/health > /dev/null 2>&1 && break
  sleep 1
done
dc exec -T db psql -q -U postgres -d postgres -v ON_ERROR_STOP=1 < "$here/../setup.sql"
echo "fresh local Supabase with setup.sql applied"
