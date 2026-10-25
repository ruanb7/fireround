#!/bin/sh
# Apply migrations against DATABASE_URL, then serve. `pnpm start` is `next start`; the in-process
# scheduler (lib/scheduler.ts) ticks the cron routes with CRON_SECRET once the server is up.
set -eu
cd /app
echo "fireround: migrating"
pnpm db:migrate
echo "fireround: starting on ${HOSTNAME:-0.0.0.0}:${PORT:-3000}"
exec pnpm exec next start -H "${HOSTNAME:-0.0.0.0}" -p "${PORT:-3000}"
