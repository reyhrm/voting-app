#!/usr/bin/env bash
# One-command deployment to Cloudflare (free plan). Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")"
export WRANGLER_SEND_METRICS=false
DB_NAME="event-vote-db"

say() { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }
die() { printf '\n\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

command -v node >/dev/null || die "Node.js is not installed. Install it from https://nodejs.org (LTS), then run this script again."
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] || die "Node.js 20 or newer is required (you have $(node -v)). Update from https://nodejs.org"

say "1/6  Installing dependencies"
npm install --silent

say "2/6  Logging in to Cloudflare (a browser window will open: click Allow)"
if ! npx wrangler whoami 2>/dev/null | grep -qi "associated with"; then npx wrangler login; fi

say "3/6  Creating the database (skipped if it already exists)"
get_id() { npx wrangler d1 list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);const x=a.find(d=>d.name==="'"$DB_NAME"'");if(x)process.stdout.write(x.uuid||x.id||"")}catch(e){}})'; }
DB_ID="$(get_id)"
if [ -z "$DB_ID" ]; then npx wrangler d1 create "$DB_NAME" >/dev/null; DB_ID="$(get_id)"; fi
[ -n "$DB_ID" ] || die "Could not find or create the database. Check that you are logged in (npx wrangler whoami)."
node -e 'const fs=require("fs");const p="wrangler.jsonc";let s=fs.readFileSync(p,"utf8");s=s.replace(/"database_id":\s*"[^"]*"/,`"database_id": "'"$DB_ID"'"`);fs.writeFileSync(p,s)'
echo "   database id: $DB_ID"

say "4/6  Creating the tables"
echo y | npx wrangler d1 migrations apply "$DB_NAME" --remote

say "5/6  Deploying the website"
OUT="$(npx wrangler deploy 2>&1 | tee /dev/stderr)"
URL="$(printf '%s' "$OUT" | grep -Eo 'https://[A-Za-z0-9.-]+\.workers\.dev' | head -1 || true)"

say "6/6  Setting your admin password"
if [ -n "${ADMIN_PASSWORD:-}" ]; then PW="$ADMIN_PASSWORD"; else
  while :; do
    read -r -s -p "   Choose an admin password (at least 10 characters): " PW; echo
    [ "${#PW}" -ge 10 ] && break || echo "   Too short, try again."
  done
fi
printf '%s' "$PW" | npx wrangler secret put ADMIN_PASSWORD >/dev/null
# Random key used to sign admin login cookies (generated here, never shown or stored in files).
node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))' | npx wrangler secret put SESSION_SECRET >/dev/null

printf '\n\033[32m✔ Done!\033[0m\n'
if [ -n "$URL" ]; then
  echo "   Voting page : $URL/"
  echo "   Admin page  : $URL/admin"
  echo "   Results     : $URL/results.html"
  echo "   QR code     : run  npx qrcode \"$URL/\"  (or paste the link into any QR generator)"
else
  echo "   Your address is printed above (ends in .workers.dev). Add /admin to open the admin page."
fi
echo "   Next: log in to /admin, set names/photos, generate codes, press 'Abrir votación'."
