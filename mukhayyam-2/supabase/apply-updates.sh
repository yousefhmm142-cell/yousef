#!/usr/bin/env bash
# Runs on GitHub (or by hand): applies every file in supabase/updates/ that this database has not
# had yet, oldest first, each in one transaction, and remembers it in m2_ops.applied_updates.
# Usage: SUPABASE_DB_URL=postgresql://... supabase/apply-updates.sh
# The connection string is a secret: it lives only in GitHub > Settings > Secrets.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is not set}"
export PGSSLMODE="${PGSSLMODE:-require}"
q() { psql "$SUPABASE_DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }

if [ "$(q -Atc "select to_regclass('public.employees') is not null")" != "t" ]; then
  echo "setup.sql was never run on this database: run it once by hand first" >&2
  exit 1
fi

# The list of what was applied, out of reach of the app (not in the public schema).
q <<'SQL'
set client_min_messages = warning;
create schema if not exists m2_ops;
revoke all on schema m2_ops from public;
create table if not exists m2_ops.applied_updates (
  name text primary key,
  applied_at timestamptz not null default now()
);
-- Updates pasted by hand before this list existed: recorded once, never run again.
insert into m2_ops.applied_updates (name)
select n from (values
  ('updates-1-2-3.sql', to_regclass('public.attendance_codes') is not null),
  ('update-4.sql', to_regclass('public.stock_items') is not null),
  -- update-6.sql carries update 5 again, so update 5 never needs to run on its own.
  ('update-5.sql', true)
) as known(n, done)
where done
on conflict do nothing;
SQL

applied=0
for f in $(ls "$here/updates/" | grep -E '\.sql$' | sort -V); do
  name="$(basename "$f")"
  if [ "$(q -Atc "select exists (select 1 from m2_ops.applied_updates where name = '$name')")" = "t" ]; then
    continue
  fi
  echo "applying $name"
  {
    cat "$here/updates/$name"
    printf "\ninsert into m2_ops.applied_updates (name) values ('%s');\n" "$name"
  } | q -1 -f -
  applied=$((applied + 1))
done
echo "database up to date ($applied new update(s))"
