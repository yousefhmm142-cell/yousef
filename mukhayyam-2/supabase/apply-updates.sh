#!/usr/bin/env bash
# Runs on GitHub (or by hand): applies every file in supabase/updates/ that this database has not
# had yet, oldest first, each in one transaction, and remembers it in m2_ops.applied_updates.
# Usage: SUPABASE_DB_URL=postgresql://... supabase/apply-updates.sh
# The connection string is a secret: it lives only in GitHub > Settings > Secrets.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is not set}"
# Pasted values often carry spaces, a newline or quotes around them: drop those.
url="$(printf '%s' "$SUPABASE_DB_URL" | tr -d '\r\n' | sed -e 's/^[[:space:]"'"'"']*//' -e 's/[[:space:]"'"'"']*$//')"
# Explain what is wrong without ever printing the value (it holds the password).
case "$url" in
  postgres://*|postgresql://*) ;;
  *)
    echo "SUPABASE_DB_URL must be the whole connection string starting with postgresql:// (Supabase > Connect > Session pooler > URI)." >&2
    # Only safe facts about it: never any of its characters.
    has() { printf '%s' "$url" | grep -q -- "$1" && echo yes || echo no; }
    echo "What was given: ${#url} characters, contains '://': $(has '://'), contains '@': $(has '@'), contains 'supabase': $(has 'supabase')." >&2
    exit 1 ;;
esac
if printf '%s' "$url" | grep -q 'YOUR-PASSWORD'; then
  echo "SUPABASE_DB_URL still has [YOUR-PASSWORD] in it: put the database password there, without the brackets." >&2
  exit 1
fi
# Read the parts ourselves, so a password with symbols (@ # / ...), brackets left around it or a
# doubled @ still work: user and password before the LAST @, host, port and database after it.
rest="${url#*://}"
after="${rest##*@}"
userinfo="$(printf '%s' "${rest%@*}" | sed -e 's/@*$//')"
export PGUSER="${userinfo%%:*}"
pass="${userinfo#*:}"
pass="${pass#[}"; pass="${pass%]}"
export PGPASSWORD="$pass"
hostport="${after%%/*}"
export PGHOST="${hostport%%:*}"
port="${hostport#*:}"; [ "$port" = "$hostport" ] && port=5432
export PGPORT="$port"
db="${after#*/}"; [ "$db" = "$after" ] && db=postgres
export PGDATABASE="${db%%\?*}"
unset SUPABASE_DB_URL url rest userinfo pass
export PGSSLMODE="${PGSSLMODE:-require}"
echo "connecting to $PGHOST:$PGPORT/$PGDATABASE as $PGUSER"
q() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }

ready="$(q -Atc "select to_regclass('public.employees') is not null")" || { echo "could not connect to the database (check the password in SUPABASE_DB_URL)" >&2; exit 1; }
if [ "$ready" != "t" ]; then
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
  ('update-5.sql', true),
  ('update-6.sql', to_regprocedure('public.save_generator(smallint,text,text,text,numeric,numeric,boolean)') is not null),
  -- update-7.sql also loads the team list: never run it twice (it would reset attendance codes).
  ('update-7.sql', exists (select 1 from information_schema.columns
                           where table_schema = 'public' and table_name = 'employees' and column_name = 'job_title'))
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
