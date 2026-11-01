#!/bin/bash
# Usage: tools/test-layers/serve-layer.sh <layer>
# Stops the dev server on WEB_PORT and API_PORT, loads a fresh copy of that layer's database, and starts it again.
# Claim the ports first (AGENTS.md). Databases are built once, in a temporary folder; the app's own database is not touched.
# Layers: no-db l1-schema-only l2-users-only l3-sites-no-halls l4-hall-no-steps l5-steps-no-schedules
#         l6-one-hall-no-schedule l7-price-null-day l8-day-removed l9-measured-null-day full
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
DBS="${TMPDIR:-/tmp}/hall-test-layers"
WEB_PORT=${WEB_PORT:-5207}
API_PORT=${API_PORT:-3107}
cd "$ROOT" || exit 1

if [ ! -f "$DBS/l9-measured-null-day.db" ]; then
  mkdir -p "$DBS"
  DB_PATH="$DBS/full.db" npm run seed || exit 1
  rm -f "$DBS"/full.db-*
  node --experimental-sqlite --disable-warning=ExperimentalWarning tools/test-layers/build-layers.mjs "$DBS" server/src/schema.sql || exit 1
fi

for pid in $(lsof -nP -t -iTCP:"$API_PORT" -iTCP:"$WEB_PORT" -sTCP:LISTEN); do kill "$pid"; done
sleep 2
rm -f "$DBS"/current.db*
[ "$1" = "no-db" ] || cp "$DBS/$1.db" "$DBS/current.db" || exit 1
WEB_PORT=$WEB_PORT API_PORT=$API_PORT DB_PATH="$DBS/current.db" exec npm run dev
