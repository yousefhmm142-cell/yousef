#!/usr/bin/env bash
# Builds the real (non-demo) app for the company hosting and puts it in one zip:
#   mukhayyam-2/mukhayyam2-hosting.zip
# Upload that zip in cPanel > File Manager to the folder of m2.abuzaed.ps, then Extract;
# or drop it on Cloudflare Pages (Workers & Pages > Create > Pages > Upload assets).
#
# Needs app/.env.hosting with the Supabase project address and its publishable key
# (both are public: they end up inside the app on every phone anyway):
#   VITE_SUPABASE_URL=https://<project>.supabase.co
#   VITE_SUPABASE_ANON_KEY=sb_publishable_...
set -euo pipefail
app="$(cd "$(dirname "$0")/.." && pwd)"
cd "$app"

if ! grep -q '^VITE_SUPABASE_URL=https://' .env.hosting 2>/dev/null || ! grep -q '^VITE_SUPABASE_ANON_KEY=.\+' .env.hosting; then
  echo "app/.env.hosting is missing the Supabase address or key" >&2
  exit 1
fi

npx tsc --noEmit
npx vitest run
rm -rf dist-hosting
npx vite build --mode hosting --outDir dist-hosting

zip_path="$app/../mukhayyam2-hosting.zip"
rm -f "$zip_path"
(cd dist-hosting && zip -qr "$zip_path" . -x '*.map')
rm -rf dist-hosting
echo "ready: $(cd "$app/.." && pwd)/mukhayyam2-hosting.zip ($(du -h "$zip_path" | cut -f1))"
